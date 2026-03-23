#!/usr/bin/env node

import "dotenv/config";

import path from "node:path";
import { parseArgs, requireArg, parseInteger } from "../lib/cli.js";
import { loadArtifactMaterial } from "../lib/artifact-material.js";
import {
  buildArtifactUserPrompt,
  loadPromptFile
} from "../lib/model-classification.js";
import { readJson } from "../lib/io.js";

async function loadDriver(driverName) {
  if (driverName === "mock") {
    return import("../lib/model-drivers/mock.js");
  }
  if (driverName === "cursor-agent") {
    return import("../lib/model-drivers/cursor-agent.js");
  }
  throw new Error(`Unsupported model driver ${driverName}`);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const taskPath = path.resolve(process.cwd(), requireArg(args, "task"));
  const task = await readJson(taskPath);

  const promptData = await loadPromptFile(task.prompt_path);
  const material = await loadArtifactMaterial(task.artifact.requested_ref, {
    timeoutMs: parseInteger(task.fetch_timeout_ms, 30000)
  });
  const builtPrompt = buildArtifactUserPrompt({
    artifact: task.artifact,
    material,
    maxContentChars: parseInteger(task.max_content_chars, 60000)
  });

  const driverModule = await loadDriver(task.driver);
  const classification =
    task.driver === "mock"
      ? await driverModule.classifyWithMockDriver({
          artifact: task.artifact,
          material,
          promptText: promptData.prompt_text,
          userPrompt: builtPrompt.prompt,
          promptSchema: builtPrompt.model_schema
        })
      : await driverModule.classifyWithCursorAgent({
          promptText: promptData.prompt_text,
          userPrompt: builtPrompt.prompt,
          model: task.model,
          promptSchema: builtPrompt.model_schema
        });

  const output = {
    artifact_id: task.artifact.artifact_id,
    category: task.artifact.category,
    driver: task.driver,
    model: task.model,
    prompt_path: task.prompt_path,
    prompt_hash: promptData.prompt_hash,
    fetch_trace: {
      requested_ref: task.artifact.requested_ref,
      resolved_ref: material.resolved_url,
      fetched_at: material.fetched_at,
      status: material.status,
      headers: material.headers,
      content_hash: material.content_hash,
      content_length: material.body.length,
      content_truncated_for_prompt: builtPrompt.content_truncated
    },
    captured_body_base64: material.body.toString("base64"),
    classification: classification.normalized,
    raw: classification.raw
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch((error) => {
  const payload = {
    error: error instanceof Error ? error.message : String(error)
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
