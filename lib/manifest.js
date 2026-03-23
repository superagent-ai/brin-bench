import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  ARTIFACT_CATEGORIES,
  ARTIFACT_LABELS,
  ARTIFACT_TIERS,
  DEFAULT_FRESHNESS_WINDOWS,
  FRESHNESS_TIERS,
  PROJECT_SCHEMA_VERSION
} from "./constants.js";
import { writeJsonl, readJsonl, toSafeSlug } from "./io.js";

function assertNonEmptyString(fieldName, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected ${fieldName} to be a non-empty string`);
  }
  return value.trim();
}

function assertOptionalString(fieldName, value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string when present`);
  }
  return value;
}

function assertEnum(fieldName, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(
      `Expected ${fieldName} to be one of ${allowed.join(", ")}, received ${value}`
    );
  }
  return value;
}

function assertIsoTimestamp(fieldName, value, { allowNull = true } = {}) {
  if ((value === undefined || value === null || value === "") && allowNull) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Expected ${fieldName} to be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

export function createArtifactId(category, suffix) {
  return `${category}-${toSafeSlug(suffix || randomUUID())}`;
}

export function assertUniqueArtifactIds(artifacts) {
  const seen = new Set();
  const duplicates = new Set();

  for (const artifact of artifacts) {
    const artifactId = artifact?.artifact_id;
    if (!artifactId) {
      continue;
    }
    if (seen.has(artifactId)) {
      duplicates.add(artifactId);
      continue;
    }
    seen.add(artifactId);
  }

  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate artifact_id values are not allowed: ${[...duplicates].sort().join(", ")}`
    );
  }
}

export function normalizeArtifactRecord(input) {
  const category = assertEnum(
    "category",
    assertNonEmptyString("category", input.category),
    ARTIFACT_CATEGORIES
  );

  const tier = assertEnum(
    "tier",
    input.tier || "runtime_live",
    ARTIFACT_TIERS
  );

  const label = assertEnum(
    "label",
    input.label || "safe",
    ARTIFACT_LABELS
  );

  const freshnessTier = assertEnum(
    "freshness_tier",
    input.freshness_tier || "not_applicable",
    FRESHNESS_TIERS
  );

  const freshnessWindowDays =
    input.freshness_window_days ??
    DEFAULT_FRESHNESS_WINDOWS[category] ??
    60;

  if (!Number.isInteger(freshnessWindowDays) || freshnessWindowDays < 0) {
    throw new Error("Expected freshness_window_days to be a non-negative integer");
  }

  if (typeof input.metadata !== "object" || input.metadata === null || Array.isArray(input.metadata)) {
    throw new Error("Expected metadata to be an object");
  }

  const artifactId =
    input.artifact_id ||
    `${category}-${toSafeSlug(
      input.metadata.identifier ||
        input.metadata.brin_identifier ||
        input.requested_ref ||
        input.selection_reason ||
        Date.now().toString()
    )}`;

  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    artifact_id: assertNonEmptyString("artifact_id", artifactId),
    category,
    tier,
    freshness_tier: freshnessTier,
    freshness_window_days: freshnessWindowDays,
    label,
    source_name: assertNonEmptyString("source_name", input.source_name),
    source_kind: assertNonEmptyString("source_kind", input.source_kind),
    requested_ref: assertNonEmptyString("requested_ref", input.requested_ref),
    resolved_ref: assertOptionalString("resolved_ref", input.resolved_ref),
    collected_at: assertIsoTimestamp("collected_at", input.collected_at, { allowNull: false }),
    source_published_at: assertIsoTimestamp("source_published_at", input.source_published_at),
    source_first_seen_at: assertIsoTimestamp("source_first_seen_at", input.source_first_seen_at),
    fetched_at: assertIsoTimestamp("fetched_at", input.fetched_at),
    content_hash: assertOptionalString("content_hash", input.content_hash),
    selection_reason: assertNonEmptyString(
      "selection_reason",
      input.selection_reason || "manual_selection"
    ),
    freshness_note: assertOptionalString("freshness_note", input.freshness_note),
    metadata: input.metadata
  };
}

export async function writeManifestFile({ manifestPath, artifacts }) {
  const normalized = artifacts.map(normalizeArtifactRecord);
  assertUniqueArtifactIds(normalized);
  await writeJsonl(manifestPath, normalized);
  return normalized;
}

export async function readManifestFile(manifestPath) {
  const records = await readJsonl(manifestPath);
  return records.map(normalizeArtifactRecord);
}

export function summarizeManifest(artifacts) {
  return artifacts.reduce(
    (summary, artifact) => {
      summary.total += 1;
      summary.by_category[artifact.category] =
        (summary.by_category[artifact.category] || 0) + 1;
      summary.by_freshness[artifact.freshness_tier] =
        (summary.by_freshness[artifact.freshness_tier] || 0) + 1;
      summary.by_label[artifact.label] = (summary.by_label[artifact.label] || 0) + 1;
      return summary;
    },
    {
      total: 0,
      by_category: {},
      by_freshness: {},
      by_label: {}
    }
  );
}

export function getArtifactOutputDirectory(runDir, artifact) {
  return path.join(runDir, "artifacts", artifact.category, artifact.artifact_id);
}

export function isBenchmarkArtifact(artifact) {
  return artifact.label === "safe" || artifact.label === "malicious";
}
