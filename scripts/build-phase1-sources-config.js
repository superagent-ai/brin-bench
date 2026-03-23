#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "../lib/cli.js";
import { PROJECT_SCHEMA_VERSION } from "../lib/constants.js";
import { fetchWithTrace } from "../lib/http.js";
import { assertUniqueArtifactIds } from "../lib/manifest.js";
import { toSafeSlug, writeJson } from "../lib/io.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESHNESS_WINDOW_DAYS = 60;
const EMAIL_TREE_URL = "https://api.github.com/repos/mikel/mail/git/trees/master?recursive=1";
const EMAIL_RAW_BASE = "https://raw.githubusercontent.com/mikel/mail/master";
const SKILLS_AUDITS_URL = "https://skills.sh/audits";
const TRANC0_LATEST_URL = "https://tranco-list.eu/api/lists/date/latest";
const TARGET_COUNTS = {
  web: {
    established: 50,
    fresh: 50
  },
  email: {
    established: 50,
    fresh: 50
  },
  skill: {
    established: 25,
    fresh: 25
  },
  package: {
    established: 25,
    fresh: 25
  }
};

const ESTABLISHED_PACKAGE_CANDIDATES = [
  { ecosystem: "npm", name: "react" },
  { ecosystem: "npm", name: "react-dom" },
  { ecosystem: "npm", name: "next" },
  { ecosystem: "npm", name: "express" },
  { ecosystem: "npm", name: "lodash" },
  { ecosystem: "npm", name: "axios" },
  { ecosystem: "npm", name: "typescript" },
  { ecosystem: "npm", name: "eslint" },
  { ecosystem: "npm", name: "prettier" },
  { ecosystem: "npm", name: "vite" },
  { ecosystem: "npm", name: "tailwindcss" },
  { ecosystem: "npm", name: "zod" },
  { ecosystem: "npm", name: "commander" },
  { ecosystem: "npm", name: "ws" },
  { ecosystem: "npm", name: "dotenv" },
  { ecosystem: "pypi", name: "requests" },
  { ecosystem: "pypi", name: "numpy" },
  { ecosystem: "pypi", name: "pandas" },
  { ecosystem: "pypi", name: "flask" },
  { ecosystem: "pypi", name: "django" },
  { ecosystem: "pypi", name: "fastapi" },
  { ecosystem: "pypi", name: "httpx" },
  { ecosystem: "pypi", name: "pydantic" },
  { ecosystem: "pypi", name: "pytest" },
  { ecosystem: "pypi", name: "rich" }
];

const FRESH_PACKAGE_CANDIDATES = [
  { ecosystem: "npm", name: "@modelcontextprotocol/sdk" },
  { ecosystem: "npm", name: "ai" },
  { ecosystem: "npm", name: "@vercel/analytics" },
  { ecosystem: "npm", name: "@vercel/functions" },
  { ecosystem: "npm", name: "@sentry/node" },
  { ecosystem: "npm", name: "drizzle-orm" },
  { ecosystem: "npm", name: "hono" },
  { ecosystem: "npm", name: "vitest" },
  { ecosystem: "npm", name: "tsx" },
  { ecosystem: "npm", name: "turbo" },
  { ecosystem: "npm", name: "openai" },
  { ecosystem: "npm", name: "@anthropic-ai/sdk" },
  { ecosystem: "npm", name: "better-auth" },
  { ecosystem: "npm", name: "react-router" },
  { ecosystem: "npm", name: "rolldown" },
  { ecosystem: "npm", name: "undici" },
  { ecosystem: "npm", name: "@tanstack/react-query" },
  { ecosystem: "npm", name: "wrangler" },
  { ecosystem: "npm", name: "esbuild" },
  { ecosystem: "npm", name: "knip" },
  { ecosystem: "npm", name: "inngest" },
  { ecosystem: "npm", name: "pino" },
  { ecosystem: "pypi", name: "anthropic" },
  { ecosystem: "pypi", name: "openai" },
  { ecosystem: "pypi", name: "pydantic-ai" },
  { ecosystem: "pypi", name: "fastmcp" },
  { ecosystem: "pypi", name: "langgraph" },
  { ecosystem: "pypi", name: "langchain" },
  { ecosystem: "pypi", name: "litellm" },
  { ecosystem: "pypi", name: "ruff" },
  { ecosystem: "pypi", name: "marimo" },
  { ecosystem: "pypi", name: "textual" },
  { ecosystem: "pypi", name: "mypy" },
  { ecosystem: "pypi", name: "griffe" },
  { ecosystem: "pypi", name: "crawl4ai" },
  { ecosystem: "pypi", name: "typer" },
  { ecosystem: "pypi", name: "pytest-asyncio" },
  { ecosystem: "pypi", name: "pydantic-settings" },
  { ecosystem: "pypi", name: "orjson" },
  { ecosystem: "pypi", name: "uvicorn" },
  { ecosystem: "pypi", name: "trafilatura" },
  { ecosystem: "pypi", name: "anyio" }
];

function requireOk(response, url) {
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": "brin-bench-phase1-config-builder",
      ...(init.headers || {})
    }
  });
  requireOk(response, url);
  return response.json();
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": "brin-bench-phase1-config-builder",
      ...(init.headers || {})
    }
  });
  requireOk(response, url);
  return response.text();
}

function buildArtifactId(category, identifier) {
  return `${category}-${toSafeSlug(identifier)}`;
}

function webContentTypeLooksRenderable(trace) {
  const contentType = String(trace.headers?.["content-type"] || "").toLowerCase();
  return (
    trace.ok &&
    (!contentType ||
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml") ||
      contentType.includes("text/plain"))
  );
}

async function probeWebCandidate(domain) {
  const candidates = [`https://${domain}/`];
  if (!domain.startsWith("www.")) {
    candidates.push(`https://www.${domain}/`);
  }

  for (const requestedRef of candidates) {
    try {
      const trace = await fetchWithTrace(requestedRef, {
        timeoutMs: 15_000
      });
      if (webContentTypeLooksRenderable(trace)) {
        return {
          domain,
          requested_ref: requestedRef,
          resolved_ref: trace.resolved_url || requestedRef
        };
      }
    } catch {
      // Ignore individual candidate failures and keep probing.
    }
  }

  return null;
}

async function selectFetchableWebDomains(rows, targetCount) {
  const selected = [];
  const candidateRows = rows.slice(0, 500);
  const batchSize = 12;

  for (let index = 0; index < candidateRows.length && selected.length < targetCount; index += batchSize) {
    const batch = candidateRows.slice(index, index + batchSize);
    const resolved = await Promise.all(
      batch.map(async ([rank, domain]) => {
        const probe = await probeWebCandidate(domain);
        return probe
          ? {
              rank,
              domain,
              requested_ref: probe.requested_ref,
              resolved_ref: probe.resolved_ref
            }
          : null;
      })
    );

    for (const candidate of resolved) {
      if (!candidate) {
        continue;
      }
      selected.push(candidate);
      if (selected.length === targetCount) {
        break;
      }
    }
  }

  return selected;
}

function latestAllowedFreshDate() {
  return new Date(Date.now() - FRESHNESS_WINDOW_DAYS * DAY_MS);
}

function isFreshTimestamp(timestamp) {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed >= latestAllowedFreshDate();
}

function packageMetadataUrl(ecosystem, name) {
  if (ecosystem === "npm") {
    return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  }
  if (ecosystem === "pypi") {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  }
  throw new Error(`Unsupported package ecosystem ${ecosystem}`);
}

function inferLatestPackagePublishTime(ecosystem, metadata) {
  if (ecosystem === "npm") {
    const versions = Object.entries(metadata.time || {})
      .filter(([key]) => !["created", "modified"].includes(key))
      .map(([, value]) => value)
      .filter(Boolean)
      .sort();
    return versions.at(-1) || metadata.time?.modified || metadata.time?.created || null;
  }

  if (ecosystem === "pypi") {
    const releases = Object.values(metadata.releases || {})
      .flat()
      .map((release) => release.upload_time_iso_8601)
      .filter(Boolean)
      .sort();
    return releases.at(-1) || null;
  }

  return null;
}

async function buildWebConfig() {
  const latest = await fetchJson(TRANC0_LATEST_URL);
  const csv = await fetchText(latest.download);
  const rows = csv
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","))
    .filter((parts) => parts.length >= 2);

  const total = TARGET_COUNTS.web.established + TARGET_COUNTS.web.fresh;
  const selectedRows = await selectFetchableWebDomains(rows, total);
  const selected = selectedRows.map((entry, index) => {
    const freshnessTier = index < TARGET_COUNTS.web.established ? "established" : "fresh";
    const tierLabel = freshnessTier === "established" ? "Stable" : "Fresh-slice";
    const brinUrl = new URL(entry.resolved_ref || entry.requested_ref);
    return {
      artifact_id: buildArtifactId("web", entry.domain),
      source_name: "tranco",
      source_kind: "live_index",
      requested_ref: entry.requested_ref,
      resolved_ref: entry.resolved_ref,
      domain: entry.domain,
      brin_origin: "page",
      brin_identifier: `${brinUrl.hostname}/`,
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      selection_reason: `${tierLabel} safe web artifact from the latest Tranco top list (rank ${entry.rank}) after confirming that the page resolves for runtime fetching.`,
      freshness_note:
        "Phase 1 infers web freshness from the latest Tranco window because page publish timestamps are not consistently available."
    };
  });

  if (selected.length !== total) {
    throw new Error(`Expected ${total} web artifacts, found ${selected.length}`);
  }

  return {
    tranco_api_url: TRANC0_LATEST_URL,
    artifacts: selected
  };
}

async function buildEmailConfig() {
  const tree = await fetchJson(EMAIL_TREE_URL);
  const paths = (tree.tree || [])
    .filter((entry) => entry.type === "blob" && entry.path.endsWith(".eml"))
    .map((entry) => entry.path)
    .sort();

  const total = TARGET_COUNTS.email.established + TARGET_COUNTS.email.fresh;
  const selected = paths.slice(0, total).map((fixturePath, index) => {
    const freshnessTier = index < TARGET_COUNTS.email.established ? "established" : "fresh";
    const messageId = fixturePath
      .replace(/^spec\/fixtures\/emails\//u, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return {
      artifact_id: buildArtifactId("email", fixturePath),
      source_name: "mikel-mail-fixture",
      source_kind: "live_direct",
      requested_ref: `${EMAIL_RAW_BASE}/${fixturePath}`,
      message_id: `phase1-${messageId}`,
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      selection_reason:
        freshnessTier === "established"
          ? `Representative RFC822 fixture from mikel/mail for the established safe email slice (${fixturePath}).`
          : `Representative RFC822 fixture from mikel/mail for the fresh safe email slice (${fixturePath}).`,
      freshness_note:
        "Phase 1 uses runtime-fetched public .eml fixtures. Freshness tier is operator-assigned because the fixture repository does not expose reliable per-message publish dates."
    };
  });

  if (selected.length !== total) {
    throw new Error(`Expected ${total} email artifacts, found ${selected.length}`);
  }

  return {
    artifacts: selected
  };
}

function parseSafeSkills(auditsHtml) {
  const safeEntries = [];
  const anchorRegex = /<a[^>]+href="(?<href>\/[^"]+)"[^>]*>[\s\S]*?<\/a>/gu;
  const seen = new Set();

  for (const match of auditsHtml.matchAll(anchorRegex)) {
    const { href } = match.groups || {};
    const anchorHtml = match[0];
    const repo = /<p[^>]*>([^<]+)<\/p>/u.exec(anchorHtml)?.[1] || null;
    const status = anchorHtml.includes(">Safe</span>")
      ? "Safe"
      : anchorHtml.includes(">Med Risk</span>")
        ? "Med Risk"
        : anchorHtml.includes(">High Risk</span>")
          ? "High Risk"
          : null;

    if (!href || !repo || status !== "Safe" || seen.has(href)) {
      continue;
    }
    seen.add(href);
    safeEntries.push({
      href,
      repo,
      identifier: href.replace(/^\/+/u, "")
    });
  }

  return safeEntries;
}

async function buildSkillConfig() {
  const auditsHtml = await fetchText(SKILLS_AUDITS_URL);
  const safeEntries = parseSafeSkills(auditsHtml);
  const desiredTotal = TARGET_COUNTS.skill.established + TARGET_COUNTS.skill.fresh;
  const selectedTotal = Math.min(desiredTotal, safeEntries.length);

  if (selectedTotal < 40) {
    throw new Error(`Expected at least 40 safe skills, found ${selectedTotal}`);
  }

  const establishedCount = Math.ceil(selectedTotal / 2);
  const selected = safeEntries.slice(0, selectedTotal).map((entry, index) => {
    const freshnessTier = index < establishedCount ? "established" : "fresh";
    return {
      artifact_id: buildArtifactId("skill", entry.identifier),
      source_name: "skills.sh",
      source_kind: "live_index",
      requested_ref: `https://skills.sh${entry.href}`,
      brin_identifier: entry.identifier,
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      selection_reason:
        freshnessTier === "established"
          ? `Safe-rated skills.sh entry from the audit leaderboard for the established slice (${entry.repo}).`
          : `Safe-rated skills.sh entry from the audit leaderboard for the fresh slice (${entry.repo}).`,
      freshness_note:
        "skills.sh audits does not expose reliable publish timestamps, so phase-1 freshness is inferred from the current safe leaderboard selection."
    };
  });

  return {
    audits_url: SKILLS_AUDITS_URL,
    artifacts: selected
  };
}

async function resolvePackageMetadata(candidate) {
  const requestedRef = packageMetadataUrl(candidate.ecosystem, candidate.name);
  const metadata = await fetchJson(requestedRef);
  return {
    ...candidate,
    requested_ref: requestedRef,
    latest_publish_at: inferLatestPackagePublishTime(candidate.ecosystem, metadata)
  };
}

function toPackageEntry(candidate, freshnessTier) {
  const artifactId = buildArtifactId("package", `${candidate.ecosystem}-${candidate.name}`);
  const latestPublishSuffix = candidate.latest_publish_at
    ? ` Latest registry publish timestamp: ${candidate.latest_publish_at}.`
    : "";

  return {
    artifact_id: artifactId,
    source_name: `${candidate.ecosystem}-registry`,
    source_kind: "live_index",
    ecosystem: candidate.ecosystem,
    name: candidate.name,
    requested_ref: candidate.requested_ref,
    freshness_tier: freshnessTier,
    freshness_window_days: FRESHNESS_WINDOW_DAYS,
    selection_reason:
      freshnessTier === "established"
        ? `Widely used ${candidate.ecosystem} package selected for the established safe package slice.`
        : `Recently published safe ${candidate.ecosystem} package selected for the fresh package slice.`,
    freshness_note:
      freshnessTier === "established"
        ? `Phase 1 treats this as an established package using registry metadata during manifest generation.${latestPublishSuffix}`
        : `Fresh tier was verified from registry metadata within the last ${FRESHNESS_WINDOW_DAYS} days.${latestPublishSuffix}`
  };
}

async function buildPackageConfig() {
  const establishedCount = TARGET_COUNTS.package.established;
  const freshCount = TARGET_COUNTS.package.fresh;

  if (ESTABLISHED_PACKAGE_CANDIDATES.length < establishedCount) {
    throw new Error("Not enough established package candidates configured");
  }

  const establishedMetadata = [];
  for (const candidate of ESTABLISHED_PACKAGE_CANDIDATES.slice(0, establishedCount)) {
    establishedMetadata.push(await resolvePackageMetadata(candidate));
  }

  const freshMetadata = [];
  for (const candidate of FRESH_PACKAGE_CANDIDATES) {
    const resolved = await resolvePackageMetadata(candidate);
    if (!isFreshTimestamp(resolved.latest_publish_at)) {
      continue;
    }
    freshMetadata.push(resolved);
    if (freshMetadata.length === freshCount) {
      break;
    }
  }

  if (freshMetadata.length !== freshCount) {
    throw new Error(
      `Expected ${freshCount} fresh package candidates with publishes inside ${FRESHNESS_WINDOW_DAYS} days, found ${freshMetadata.length}`
    );
  }

  return {
    artifacts: [
      ...establishedMetadata.map((candidate) => toPackageEntry(candidate, "established")),
      ...freshMetadata.map((candidate) => toPackageEntry(candidate, "fresh"))
    ]
  };
}

function summarizeConfig(config) {
  const byCategory = {
    web: config.web.artifacts.length,
    email: config.email.artifacts.length,
    skill: config.skill.artifacts.length,
    package: config.package.artifacts.length
  };

  const byFreshness = Object.values(config)
    .filter((section) => section && Array.isArray(section.artifacts))
    .flatMap((section) => section.artifacts)
    .reduce((accumulator, artifact) => {
      accumulator[artifact.freshness_tier] = (accumulator[artifact.freshness_tier] || 0) + 1;
      return accumulator;
    }, {});

  return {
    total: Object.values(byCategory).reduce((sum, count) => sum + count, 0),
    by_category: byCategory,
    by_freshness: byFreshness
  };
}

function getAllArtifacts(config) {
  return Object.values(config)
    .filter((section) => section && Array.isArray(section.artifacts))
    .flatMap((section) => section.artifacts);
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const outputPath = path.resolve(projectRoot, args.out || "config/phase1.sources.json");
  const summaryPath = path.resolve(
    projectRoot,
    args.summary || outputPath.replace(/\.json$/u, ".summary.json")
  );

  const [web, email, skill, packageSection] = await Promise.all([
    buildWebConfig(),
    buildEmailConfig(),
    buildSkillConfig(),
    buildPackageConfig()
  ]);

  const config = {
    schema_version: PROJECT_SCHEMA_VERSION,
    freshness_windows: {
      web: FRESHNESS_WINDOW_DAYS,
      email: FRESHNESS_WINDOW_DAYS,
      skill: FRESHNESS_WINDOW_DAYS,
      package: FRESHNESS_WINDOW_DAYS
    },
    web,
    email,
    skill,
    package: packageSection
  };

  assertUniqueArtifactIds(getAllArtifacts(config));

  const summary = {
    generated_at: new Date().toISOString(),
    config_path: outputPath,
    summary: summarizeConfig(config)
  };

  await Promise.all([writeJson(outputPath, config), writeJson(summaryPath, summary)]);

  console.log(
    JSON.stringify(
      {
        config_path: outputPath,
        summary_path: summaryPath,
        summary: summary.summary
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
