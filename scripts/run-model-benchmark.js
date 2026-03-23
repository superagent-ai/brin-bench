#!/usr/bin/env node

import "dotenv/config";

import path from "node:path";
import { Buffer } from "node:buffer";
import { parseArgs, requireArg } from "../lib/cli.js";
import { PROMPT_VERSION, SHURU_POLICY_VERSION } from "../lib/constants.js";
import { readManifestFile, summarizeManifest } from "../lib/manifest.js";
import {
  appendRunEvent,
  createRunContext,
  finalizeRun,
  writeManifestSnapshot
} from "../lib/run-ledger.js";
import { writeJson, writeText } from "../lib/io.js";
import { runModelTask, workspacePath } from "../lib/shuru.js";

function buildRecencyWindowDefinition(artifacts) {
  return artifacts.reduce((accumulator, artifact) => {
    accumulator[artifact.category] = artifact.freshness_window_days;
    return accumulator;
  }, {});
}

function persistModelArtifact(runContext, artifact, output) {
  const artifactDir = path.join(
    runContext.paths.modelDir,
    artifact.category,
    artifact.artifact_id
  );
  return Promise.all([
    writeJson(path.join(artifactDir, "result.json"), output),
    writeText(path.join(artifactDir, "model-response.json"), `${JSON.stringify(output.raw, null, 2)}\n`),
    writeText(
      path.join(artifactDir, "captured-artifact.txt"),
      Buffer.from(output.captured_body_base64, "base64").toString("utf8")
    )
  ]).then(() => artifactDir);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const promptPath = path.resolve(
    projectRoot,
    args.prompt || "prompts/model-only-detection.md"
  );
  const driver = args.driver || "cursor-agent";
  const model =
    args.model || process.env.BENCH_MODEL || "claude-4.6-opus-high-thinking";
  const includeProbes = Boolean(args["include-probes"]);
  const useShuru = !args["no-shuru"];

  if (driver !== "mock" && !model) {
    throw new Error("Provide --model or BENCH_MODEL for the Cursor agent path");
  }

  const artifacts = await readManifestFile(manifestPath);
  const runnableArtifacts = artifacts.filter(
    (artifact) => includeProbes || artifact.label !== "synthetic_probe"
  );

  const runContext = await createRunContext({
    projectRoot,
    runKind: "model",
    phase: args.phase || "phase1",
    promptVersion: PROMPT_VERSION,
    model,
    shuruPolicyVersion: SHURU_POLICY_VERSION,
    sourceConfigPath: args.config || null,
    recencyWindowDefinition: buildRecencyWindowDefinition(runnableArtifacts),
    manifest: runnableArtifacts
  });

  await writeManifestSnapshot(runContext, runnableArtifacts);

  const results = [];

  for (const artifact of runnableArtifacts) {
    const taskFile = path.join(
      runContext.paths.manifestDir,
      "tasks",
      `${artifact.artifact_id}.json`
    );
    const taskPayload = {
      artifact,
      prompt_path: useShuru ? workspacePath(projectRoot, promptPath) : promptPath,
      model,
      driver,
      fetch_timeout_ms: Number(args["fetch-timeout-ms"] || 30000),
      max_content_chars: Number(args["max-content-chars"] || 60000)
    };
    await writeJson(taskFile, taskPayload);

    await appendRunEvent(runContext, "artifact.started", {
      artifact_id: artifact.artifact_id,
      category: artifact.category,
      driver,
      use_shuru: useShuru
    });

    const shuruConfig =
      driver === "cursor-agent"
        ? path.join(projectRoot, "shuru-unrestricted.json")
        : undefined;

    const execution = await runModelTask({
      projectRoot,
      taskFile,
      useShuru,
      shuruConfig,
      extraEnv: {
        BENCH_MODEL: model || "",
        CURSOR_API_KEY: process.env.CURSOR_API_KEY || ""
      }
    });

    if (execution.exit_code !== 0) {
      const errorMessage = execution.stderr || execution.stdout || "Model task failed";
      await appendRunEvent(runContext, "artifact.failed", {
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        error: errorMessage
      });
      results.push({
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        classification: null,
        error: errorMessage
      });
      continue;
    }

    const output = JSON.parse(execution.stdout);
    const outputDir = await persistModelArtifact(runContext, artifact, output);
    results.push(output);

    await appendRunEvent(runContext, "artifact.completed", {
      artifact_id: artifact.artifact_id,
      category: artifact.category,
      verdict: output.classification?.verdict || null,
      output_dir: outputDir
    });
  }

  const summaryPath = path.join(runContext.paths.reportDir, "model-summary.json");
  await writeJson(summaryPath, {
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    prompt_path: promptPath,
    driver,
    model,
    artifact_summary: summarizeManifest(runnableArtifacts),
    results: results.map((result) => ({
      artifact_id: result.artifact_id,
      category: result.category,
      verdict: result.classification?.verdict || null,
      allow_or_block: result.classification?.allow_or_block || null,
      confidence: result.classification?.confidence || null,
      error: result.error || null
    }))
  });

  await finalizeRun(runContext, {
    model_summary_path: summaryPath
  });

  console.log(
    JSON.stringify(
      {
        run_id: runContext.runId,
        run_dir: runContext.runDir,
        summary_path: summaryPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
