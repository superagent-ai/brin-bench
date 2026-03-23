#!/usr/bin/env node

import path from "node:path";
import { parseArgs, parseInteger, requireArg } from "../lib/cli.js";
import { writeJson } from "../lib/io.js";
import {
  readManifestFile,
  summarizeManifest,
  writeManifestFile
} from "../lib/manifest.js";

function selectCategorySample(artifacts, perCategory) {
  const selected = [];
  const usedIds = new Set();
  const byFreshness = {
    established: artifacts.filter((artifact) => artifact.freshness_tier === "established"),
    fresh: artifacts.filter((artifact) => artifact.freshness_tier === "fresh")
  };

  for (const tier of ["established", "fresh"]) {
    const candidate = byFreshness[tier][0];
    if (candidate && selected.length < perCategory) {
      selected.push(candidate);
      usedIds.add(candidate.artifact_id);
    }
  }

  for (const artifact of artifacts) {
    if (selected.length === perCategory) {
      break;
    }
    if (usedIds.has(artifact.artifact_id)) {
      continue;
    }
    selected.push(artifact);
    usedIds.add(artifact.artifact_id);
  }

  return selected;
}

function selectSampleArtifacts(artifacts, perCategory) {
  const categories = [...new Set(artifacts.map((artifact) => artifact.category))].sort();
  return categories.flatMap((category) =>
    selectCategorySample(
      artifacts.filter((artifact) => artifact.category === category),
      perCategory
    )
  );
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const perCategory = parseInteger(args["per-category"], 2);
  const outputPath = path.resolve(
    projectRoot,
    args.out || manifestPath.replace(/\.jsonl$/u, ".sample.jsonl")
  );
  const summaryPath = path.resolve(
    projectRoot,
    args.summary || outputPath.replace(/\.jsonl$/u, ".summary.json")
  );

  const artifacts = await readManifestFile(manifestPath);
  const sample = selectSampleArtifacts(artifacts, perCategory);

  await writeManifestFile({
    manifestPath: outputPath,
    artifacts: sample
  });
  await writeJson(summaryPath, {
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    sample_manifest_path: outputPath,
    per_category: perCategory,
    summary: summarizeManifest(sample)
  });

  console.log(
    JSON.stringify(
      {
        manifest_path: outputPath,
        summary_path: summaryPath,
        summary: summarizeManifest(sample)
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
