#!/usr/bin/env node

import path from "node:path";
import { parseArgs, parseInteger } from "../lib/cli.js";
import { writeJson } from "../lib/io.js";

const BRIN_API_BASE = "https://api.brin.sh";

const CATEGORY_TARGETS = {
  page: { safe: 50, flagged: 50 },
  domain: { safe: 50, flagged: 50 },
  skill: { safe: 50, flagged: 50 },
  repo: { safe: 50, flagged: 50 },
  npm: { safe: 50, flagged: 50 },
  contributor: { safe: 50, flagged: 10 }
};

const OVERFETCH_MULTIPLIER = 4;

const FLAGGED_VERDICTS = ["suspicious", "dangerous"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBrinList(origin, verdict, limit, offset = 0) {
  const url = new URL(BRIN_API_BASE);
  url.searchParams.set("origin", origin);
  url.searchParams.set("verdict", verdict);
  url.searchParams.set("sort", "scanned_at");
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(Math.min(limit, 200)));
  url.searchParams.set("offset", String(offset));

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: { "user-agent": "brin-bench-dataset-builder" }
    });

    if (response.status === 429) {
      const wait = 2000 * (attempt + 1);
      console.warn(`[dataset] Rate limited, waiting ${wait}ms...`);
      await sleep(wait);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Brin API ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  throw new Error(`Brin API rate limited after 5 retries for ${origin}/${verdict}`);
}

async function collectArtifacts(origin, verdict, target) {
  const pool = target * OVERFETCH_MULTIPLIER;
  const seen = new Set();
  const items = [];
  let offset = 0;
  let totalAvailable = 0;

  while (items.length < pool) {
    const batchSize = Math.min(200, pool - items.length);
    const result = await fetchBrinList(origin, verdict, batchSize, offset);
    totalAvailable = result.total;

    const batch = result.data || [];
    if (batch.length === 0) break;

    for (const item of batch) {
      const key = `${item.origin}::${item.identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= pool) break;
    }

    offset += batch.length;
    if (offset >= totalAvailable) break;
    await sleep(1100);
  }

  return { items, total_available: totalAvailable };
}

async function buildCategoryDataset(origin, targets) {
  const safeResult = await collectArtifacts(origin, "safe", targets.safe);

  const flaggedItems = [];
  const flaggedPool = targets.flagged * OVERFETCH_MULTIPLIER;
  for (const verdict of FLAGGED_VERDICTS) {
    const remaining = flaggedPool - flaggedItems.length;
    if (remaining <= 0) break;
    const result = await collectArtifacts(origin, verdict, Math.ceil(remaining / OVERFETCH_MULTIPLIER));
    flaggedItems.push(...result.items);
  }

  return {
    origin,
    safe: {
      total_available: safeResult.total_available,
      pool_size: safeResult.items.length,
      target: targets.safe,
      artifacts: safeResult.items
    },
    flagged: {
      pool_size: flaggedItems.length,
      target: targets.flagged,
      artifacts: flaggedItems
    }
  };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const outputPath = path.resolve(
    projectRoot,
    args.out || "config/brin-truth-dataset.json"
  );

  const categories = Object.keys(CATEGORY_TARGETS);
  const dataset = {
    generated_at: new Date().toISOString(),
    brin_api_base: BRIN_API_BASE,
    categories: {}
  };

  let totalSafe = 0;
  let totalFlagged = 0;

  for (const origin of categories) {
    const targets = CATEGORY_TARGETS[origin];
    console.log(`[dataset] Querying ${origin}: ${targets.safe} safe + ${targets.flagged} flagged...`);
    const result = await buildCategoryDataset(origin, targets);
    dataset.categories[origin] = result;
    totalSafe += result.safe.pool_size;
    totalFlagged += result.flagged.pool_size;
    console.log(`[dataset] ${origin}: ${result.safe.pool_size} safe candidates (target ${result.safe.target}), ${result.flagged.pool_size} flagged candidates (target ${result.flagged.target})`);
  }

  dataset.summary = {
    total: totalSafe + totalFlagged,
    safe: totalSafe,
    flagged: totalFlagged,
    by_category: Object.fromEntries(
      categories.map((origin) => [
        origin,
        {
          safe_pool: dataset.categories[origin].safe.pool_size,
          safe_target: dataset.categories[origin].safe.target,
          flagged_pool: dataset.categories[origin].flagged.pool_size,
          flagged_target: dataset.categories[origin].flagged.target
        }
      ])
    )
  };

  await writeJson(outputPath, dataset);

  console.log(
    JSON.stringify(
      { output_path: outputPath, summary: dataset.summary },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
