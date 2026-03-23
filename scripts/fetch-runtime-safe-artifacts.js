#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "../lib/cli.js";
import { loadSourceConfig } from "../lib/source-config.js";
import { buildPhase1Artifacts } from "../lib/source-adapters.js";
import { summarizeManifest, writeManifestFile } from "../lib/manifest.js";
import { writeJson } from "../lib/io.js";

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const configPath = path.resolve(
    projectRoot,
    args.config || "config/phase1.sources.example.json"
  );
  const outPath = path.resolve(
    projectRoot,
    args.out || `artifacts/generated/phase1/runtime-safe-manifest.${Date.now()}.jsonl`
  );
  const summaryPath = path.resolve(
    projectRoot,
    args.summary || outPath.replace(/\.jsonl$/u, ".summary.json")
  );

  const config = await loadSourceConfig(configPath);
  const artifacts = await buildPhase1Artifacts(config);
  const normalized = await writeManifestFile({
    manifestPath: outPath,
    artifacts
  });

  const summary = summarizeManifest(normalized);
  await writeJson(summaryPath, {
    generated_at: new Date().toISOString(),
    config_path: configPath,
    manifest_path: outPath,
    summary
  });

  console.log(
    JSON.stringify(
      {
        manifest_path: outPath,
        summary_path: summaryPath,
        summary
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
