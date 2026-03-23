#!/usr/bin/env node

import "dotenv/config";
import path from "node:path";
import { parseArgs, parseInteger, requireArg } from "../lib/cli.js";
import { readManifestFile, summarizeManifest } from "../lib/manifest.js";
import {
  appendRunEvent,
  createRunContext,
  finalizeRun,
  writeManifestSnapshot
} from "../lib/run-ledger.js";
import { persistBrinResult, runBrinLookup } from "../lib/brin.js";
import { writeJson } from "../lib/io.js";

function buildRecencyWindowDefinition(artifacts) {
  return artifacts.reduce((accumulator, artifact) => {
    accumulator[artifact.category] = artifact.freshness_window_days;
    return accumulator;
  }, {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBrinLookupWithRetries(
  artifact,
  { baseUrl, maxRetries, retryDelayMs }
) {
  let lastResult = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    lastResult = await runBrinLookup(artifact, { baseUrl });
    if (lastResult.status !== 429) {
      return {
        result: lastResult,
        retries: attempt
      };
    }
    if (attempt < maxRetries) {
      console.warn(
        `[brin-benchmark] rate limited (429) for artifact ${artifact.artifact_id}; retrying (${attempt + 1}/${maxRetries})`
      );
      const retryAfterMs = lastResult.retry_after_ms;
      const linear = retryDelayMs * (attempt + 1);
      const waitMs = Math.max(retryAfterMs ?? 0, linear);
      await sleep(waitMs);
    }
  }

  return {
    result: lastResult,
    retries: maxRetries
  };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const baseUrl = args["base-url"] || "https://api.brin.sh";
  const includeProbes = Boolean(args["include-probes"]);
  const maxRetries = parseInteger(args["retry-count"], 2);
  const retryDelayMs = parseInteger(args["retry-delay-ms"], 3000);
  const throttleMs = parseInteger(args["throttle-ms"], 0);

  const artifacts = await readManifestFile(manifestPath);
  const runnableArtifacts = artifacts.filter(
    (artifact) => includeProbes || artifact.label !== "synthetic_probe"
  );

  const runContext = await createRunContext({
    projectRoot,
    runKind: "brin",
    phase: args.phase || "phase1",
    promptVersion: null,
    model: null,
    shuruPolicyVersion: null,
    sourceConfigPath: args.config || null,
    recencyWindowDefinition: buildRecencyWindowDefinition(runnableArtifacts),
    manifest: runnableArtifacts
  });

  await writeManifestSnapshot(runContext, runnableArtifacts);

  const results = [];

  for (const artifact of runnableArtifacts) {
    await appendRunEvent(runContext, "artifact.started", {
      artifact_id: artifact.artifact_id,
      category: artifact.category,
      requested_ref: artifact.requested_ref,
      freshness_tier: artifact.freshness_tier
    });

    try {
      const { result, retries } = await runBrinLookupWithRetries(artifact, {
        baseUrl,
        maxRetries,
        retryDelayMs
      });
      const outputDir = await persistBrinResult(runContext, artifact, result);
      results.push(result);

      await appendRunEvent(runContext, "artifact.completed", {
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        verdict: result.verdict,
        status: result.status,
        retries,
        output_dir: outputDir
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendRunEvent(runContext, "artifact.failed", {
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        error: message
      });
      results.push({
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        verdict: null,
        score: null,
        confidence: null,
        status: 0,
        error: message
      });
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    manifest_path: manifestPath,
    retry_count: maxRetries,
    retry_delay_ms: retryDelayMs,
    throttle_ms: throttleMs,
    artifact_summary: summarizeManifest(runnableArtifacts),
    results: results.map((result) => ({
      artifact_id: result.artifact_id,
      category: result.category,
      verdict: result.verdict,
      score: result.score,
      confidence: result.confidence,
      status: result.status,
      error: result.error || null
    }))
  };

  await writeJson(path.join(runContext.paths.reportDir, "brin-summary.json"), summary);
  await finalizeRun(runContext, {
    brin_summary_path: path.join(runContext.paths.reportDir, "brin-summary.json")
  });

  console.log(
    JSON.stringify(
      {
        run_id: runContext.runId,
        run_dir: runContext.runDir,
        summary_path: path.join(runContext.paths.reportDir, "brin-summary.json")
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
