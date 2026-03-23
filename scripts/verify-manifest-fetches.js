#!/usr/bin/env node

import path from "node:path";
import { loadArtifactMaterial } from "../lib/artifact-material.js";
import { parseArgs, parseInteger, requireArg } from "../lib/cli.js";
import { writeJson } from "../lib/io.js";
import { readManifestFile } from "../lib/manifest.js";

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) {
      return;
    }
    results[index] = await worker(items[index], index);
    await runNext();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

function summarizeChecks(results) {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      summary.by_category[result.category] = (summary.by_category[result.category] || 0) + 1;

      if (result.error) {
        summary.failures.total += 1;
        summary.failures.by_category[result.category] =
          (summary.failures.by_category[result.category] || 0) + 1;
      }

      return summary;
    },
    {
      total: 0,
      by_category: {},
      failures: {
        total: 0,
        by_category: {}
      }
    }
  );
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const outPath = path.resolve(
    projectRoot,
    args.out || manifestPath.replace(/\.jsonl$/u, ".fetch-check.json")
  );
  const timeoutMs = parseInteger(args["timeout-ms"], 20_000);
  const concurrency = parseInteger(args.concurrency, 8);

  const artifacts = await readManifestFile(manifestPath);
  const results = await mapWithConcurrency(artifacts, concurrency, async (artifact) => {
    try {
      const material = await loadArtifactMaterial(artifact.requested_ref, {
        timeoutMs
      });

      return {
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        requested_ref: artifact.requested_ref,
        resolved_ref: material.resolved_url,
        status: material.status,
        fetched_at: material.fetched_at,
        content_hash: material.content_hash,
        content_length: material.body.length,
        error: null
      };
    } catch (error) {
      return {
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        requested_ref: artifact.requested_ref,
        resolved_ref: null,
        status: null,
        fetched_at: null,
        content_hash: null,
        content_length: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  const summary = {
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    timeout_ms: timeoutMs,
    concurrency,
    summary: summarizeChecks(results),
    failures: results.filter((result) => result.error),
    results
  };

  await writeJson(outPath, summary);

  console.log(
    JSON.stringify(
      {
        out_path: outPath,
        summary: summary.summary
      },
      null,
      2
    )
  );

  if (summary.summary.failures.total > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
