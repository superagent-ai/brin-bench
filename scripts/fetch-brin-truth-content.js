#!/usr/bin/env node

import "dotenv/config";

import path from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { parseArgs, requireArg } from "../lib/cli.js";
import { readJson, writeJson, writeJsonl, toSafeSlug } from "../lib/io.js";
import { fetchWithTrace } from "../lib/http.js";
import { sha256Buffer } from "../lib/hash.js";
import { PROJECT_SCHEMA_VERSION, DEFAULT_FRESHNESS_WINDOWS } from "../lib/constants.js";

const MIRROR_BASE = "artifacts/brin-truth";

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  const headers = { "user-agent": "brin-bench-content-fetcher" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch(url, { timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function isBlockVerdict(verdict) {
  return verdict === "suspicious" || verdict === "dangerous";
}

async function fetchAndCache(url, filePath, { timeoutMs = 15_000 } = {}) {
  const trace = await fetchWithTrace(url, { timeoutMs });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, trace.body);
  return {
    content_hash: trace.content_hash,
    fetched_at: trace.fetched_at,
    status: trace.status,
    resolved_url: trace.resolved_url,
    content_length: trace.body.length
  };
}

async function fetchJsonAndCache(url, filePath, { timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": "brin-bench-content-fetcher" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const data = await response.json();
  const text = JSON.stringify(data, null, 2);
  const body = Buffer.from(text, "utf8");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
  return {
    content_hash: sha256Buffer(body),
    fetched_at: new Date().toISOString(),
    status: response.status,
    content_length: body.length
  };
}

async function fetchPage(identifier, outDir) {
  const url = `https://${identifier}`;
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.html`);
  const trace = await fetchAndCache(url, filePath);
  return { local_path: filePath, ...trace };
}

async function fetchDomain(identifier, outDir) {
  const url = `https://${identifier}/`;
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.html`);
  const trace = await fetchAndCache(url, filePath);
  return { local_path: filePath, ...trace };
}

async function fetchSkill(identifier, outDir) {
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.md`);

  const skillsShUrl = `https://skills.sh/${identifier}`;
  let html;
  try {
    const response = await fetch(skillsShUrl, {
      headers: { "user-agent": "brin-bench-content-fetcher" },
      signal: AbortSignal.timeout(15_000)
    });
    html = await response.text();
  } catch {
    html = "";
  }

  const githubLink = html.match(/href="(https:\/\/github\.com\/[^"]+\/blob\/[^"]+)"/);
  if (githubLink) {
    const rawUrl = githubLink[1]
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
    try {
      const trace = await fetchAndCache(rawUrl, filePath);
      return { local_path: filePath, source_url: rawUrl, ...trace };
    } catch {
      // Fall through to skills.sh content extraction.
    }
  }

  const parts = identifier.split("/");
  if (parts.length >= 2) {
    const candidates = [
      `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/HEAD/SKILL.md`,
      `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/SKILL.md`,
      parts.length >= 3
        ? `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/HEAD/plugin/skills/${parts.slice(2).join("/")}/SKILL.md`
        : null,
      parts.length >= 3
        ? `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/HEAD/${parts.slice(2).join("/")}/SKILL.md`
        : null
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const trace = await fetchAndCache(candidate, filePath);
        return { local_path: filePath, source_url: candidate, ...trace };
      } catch {
        continue;
      }
    }
  }

  const content = html.length > 500 ? html : `# ${identifier}\n\n(Skill content unavailable at fetch time)`;
  const body = Buffer.from(content, "utf8");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return {
    local_path: filePath,
    source_url: skillsShUrl,
    content_hash: sha256Buffer(body),
    fetched_at: new Date().toISOString(),
    status: 200,
    content_length: body.length,
    fallback: true
  };
}

function parseRepoIdentifier(identifier) {
  const parts = identifier.split("/");
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return { owner: parts[0], repo: parts[0] };
}

async function fetchRepo(identifier, outDir) {
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.json`);

  const { owner, repo } = parseRepoIdentifier(identifier);
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const repoMeta = await githubFetch(repoUrl);

  let readmeContent = null;
  try {
    const readmeData = await githubFetch(`${repoUrl}/readme`);
    readmeContent = Buffer.from(readmeData.content || "", "base64").toString("utf8");
  } catch {
    readmeContent = null;
  }

  const combined = { ...repoMeta, readme_content: readmeContent };
  const text = JSON.stringify(combined, null, 2);
  const body = Buffer.from(text, "utf8");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");

  return {
    local_path: filePath,
    content_hash: sha256Buffer(body),
    fetched_at: new Date().toISOString(),
    status: 200,
    content_length: body.length
  };
}

async function fetchNpm(identifier, outDir) {
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.json`);
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(identifier)}`;
  const trace = await fetchJsonAndCache(registryUrl, filePath);
  return { local_path: filePath, source_url: registryUrl, ...trace };
}

async function fetchContributor(identifier, outDir) {
  const slug = toSafeSlug(identifier);
  const filePath = path.join(outDir, `${slug}.json`);

  const profile = await githubFetch(
    `https://api.github.com/users/${encodeURIComponent(identifier)}`
  );

  let events = [];
  try {
    events = await githubFetch(
      `https://api.github.com/users/${encodeURIComponent(identifier)}/events/public?per_page=30`
    );
  } catch {
    events = [];
  }

  const combined = { profile, recent_events: events };
  const text = JSON.stringify(combined, null, 2);
  const body = Buffer.from(text, "utf8");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");

  return {
    local_path: filePath,
    content_hash: sha256Buffer(body),
    fetched_at: new Date().toISOString(),
    status: 200,
    content_length: body.length
  };
}

const FETCHERS = {
  page: fetchPage,
  domain: fetchDomain,
  skill: fetchSkill,
  repo: fetchRepo,
  npm: fetchNpm,
  contributor: fetchContributor
};

function buildManifestEntry(origin, brinArtifact, fetchResult, label) {
  const identifier = brinArtifact.identifier;
  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    artifact_id: `${origin}-${toSafeSlug(identifier)}`,
    category: origin,
    tier: "brin_sourced",
    freshness_tier: "fresh",
    freshness_window_days: DEFAULT_FRESHNESS_WINDOWS[origin] || 60,
    label,
    source_name: "brin-database",
    source_kind: "brin_api",
    requested_ref: fetchResult.local_path,
    resolved_ref: fetchResult.resolved_url || fetchResult.source_url || null,
    collected_at: new Date().toISOString(),
    source_published_at: null,
    source_first_seen_at: brinArtifact.scanned_at || null,
    fetched_at: fetchResult.fetched_at,
    content_hash: fetchResult.content_hash || null,
    selection_reason: `Selected from Brin database (verdict: ${brinArtifact.verdict}, score: ${brinArtifact.score}).`,
    freshness_note: `Brin scanned at ${brinArtifact.scanned_at || "unknown"}.`,
    metadata: {
      brin_origin: origin,
      brin_identifier: identifier,
      brin_verdict: brinArtifact.verdict,
      brin_score: brinArtifact.score,
      brin_confidence: brinArtifact.confidence,
      brin_sub_scores: brinArtifact.sub_scores || null,
      brin_threats: brinArtifact.threats || [],
      brin_scanned_at: brinArtifact.scanned_at
    }
  };
}

async function processCategory(origin, categoryData, projectRoot) {
  const fetcher = FETCHERS[origin];
  if (!fetcher) {
    console.warn(`[fetch] No fetcher for origin ${origin}, skipping`);
    return { artifacts: [], stats: { safe: 0, malicious: 0, skipped: 0 } };
  }

  const outDir = path.join(projectRoot, MIRROR_BASE, origin);
  await mkdir(outDir, { recursive: true });

  const safeTarget = categoryData.safe.target;
  const flaggedTarget = categoryData.flagged.target;
  const artifacts = [];
  const catStats = { safe: 0, malicious: 0, skipped: 0 };
  const seen = new Set();

  for (const { items, label, target } of [
    { items: categoryData.safe.artifacts, label: "safe", target: safeTarget },
    { items: categoryData.flagged.artifacts, label: "malicious", target: flaggedTarget }
  ]) {
    let collected = 0;
    for (const item of items) {
      if (collected >= target) break;

      const key = `${origin}::${item.identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const fetchResult = await fetcher(item.identifier, outDir);
        const entry = buildManifestEntry(origin, item, fetchResult, label);
        artifacts.push(entry);
        collected += 1;
        catStats[label === "safe" ? "safe" : "malicious"] += 1;
      } catch {
        catStats.skipped += 1;
      }
    }

    if (collected < target) {
      console.warn(`[fetch] ${origin}/${label}: only got ${collected}/${target} (exhausted ${items.length} candidates)`);
    }
  }

  console.log(
    `[fetch] ${origin}: ${catStats.safe} safe + ${catStats.malicious} flagged (${catStats.skipped} skipped)`
  );

  return { artifacts, stats: catStats };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const datasetPath = path.resolve(
    projectRoot,
    requireArg(args, "dataset")
  );
  const manifestPath = path.resolve(
    projectRoot,
    args.out || `${MIRROR_BASE}/manifest.jsonl`
  );
  const summaryPath = args.summary
    ? path.resolve(projectRoot, args.summary)
    : manifestPath.replace(/\.jsonl$/, ".summary.json");

  const dataset = await readJson(datasetPath);
  const allArtifacts = [];
  const totalStats = { safe: 0, malicious: 0, skipped: 0, by_category: {} };

  for (const [origin, categoryData] of Object.entries(dataset.categories || {})) {
    const { artifacts, stats } = await processCategory(origin, categoryData, projectRoot);
    allArtifacts.push(...artifacts);
    totalStats.safe += stats.safe;
    totalStats.malicious += stats.malicious;
    totalStats.skipped += stats.skipped;
    totalStats.by_category[origin] = stats;
  }

  const seen = new Set();
  const deduped = [];
  for (const a of allArtifacts) {
    if (seen.has(a.artifact_id)) {
      a.artifact_id = `${a.artifact_id}-${seen.size}`;
    }
    seen.add(a.artifact_id);
    deduped.push(a);
  }

  await writeJsonl(manifestPath, deduped);
  await writeJson(summaryPath, {
    generated_at: new Date().toISOString(),
    dataset_path: datasetPath,
    manifest_path: manifestPath,
    total: deduped.length,
    stats: totalStats
  });

  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        summary_path: summaryPath,
        total: deduped.length,
        stats: totalStats
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
