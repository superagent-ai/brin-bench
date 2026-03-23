#!/usr/bin/env node

import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs, requireArg } from "../lib/cli.js";
import { readManifestFile, writeManifestFile, summarizeManifest } from "../lib/manifest.js";
import { readJson, writeJson, toSafeSlug } from "../lib/io.js";
import { sha256Buffer } from "../lib/hash.js";

const FRESHNESS_WINDOW_DAYS = 60;

function hashContent(text) {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

async function loadLocalContent(filePath) {
  const body = await readFile(filePath);
  return {
    body,
    text: body.toString("utf8"),
    content_hash: sha256Buffer(body)
  };
}

function buildMaliciousWebArtifacts(mirrorData) {
  const collectedAt = new Date().toISOString();
  const seenSlugs = new Map();
  return mirrorData.map((entry, index) => {
    const hostname = entry.hostname;
    const freshnessTier = index < mirrorData.length / 2 ? "established" : "fresh";
    let baseSlug = toSafeSlug(hostname).slice(0, 50);
    const count = seenSlugs.get(baseSlug) || 0;
    seenSlugs.set(baseSlug, count + 1);
    const slug = count > 0 ? `${baseSlug}-${count}` : baseSlug;
    return {
      artifact_id: `web-phish-${slug}`,
      category: "web",
      tier: "local_mirror",
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      label: "malicious",
      source_name: "openphish",
      source_kind: "verified_feed",
      requested_ref: entry.local_path,
      resolved_ref: entry.original_url,
      collected_at: collectedAt,
      source_published_at: entry.mirrored_at,
      source_first_seen_at: null,
      fetched_at: entry.mirrored_at,
      content_hash: null,
      selection_reason: `Verified phishing URL from OpenPhish feed, mirrored locally for reproducible evaluation.`,
      freshness_note:
        "Phishing URLs from OpenPhish are typically fresh (hours to days old). Tier assignment is based on position in feed.",
      metadata: {
        brin_origin: "page",
        brin_identifier: `${hostname}/`,
        original_url: entry.original_url,
        hostname,
        content_available: entry.fetched
      }
    };
  });
}

function buildMaliciousEmailArtifacts(mirrorData) {
  const collectedAt = new Date().toISOString();
  const seenSlugs = new Map();
  return mirrorData.map((entry, index) => {
    let baseSlug = toSafeSlug(entry.subject || `nazario-${index}`).slice(0, 50);
    const count = seenSlugs.get(baseSlug) || 0;
    seenSlugs.set(baseSlug, count + 1);
    const slug = count > 0 ? `${baseSlug}-${count}` : baseSlug;
    const freshnessTier = index < mirrorData.length / 2 ? "established" : "fresh";
    return {
      artifact_id: `email-nazario-${slug}`,
      category: "email",
      tier: "local_mirror",
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      label: "malicious",
      source_name: "nazario",
      source_kind: "academic_corpus",
      requested_ref: entry.local_path,
      resolved_ref: null,
      collected_at: collectedAt,
      source_published_at: null,
      source_first_seen_at: null,
      fetched_at: entry.mirrored_at,
      content_hash: null,
      selection_reason: `Hand-classified phishing email from the Nazario corpus (CC-BY-4.0).`,
      freshness_note:
        "Nazario corpus emails span multiple years. Established tier covers older entries; fresh tier covers recent collections.",
      metadata: {
        brin_origin: "email",
        brin_identifier: null,
        subject: entry.subject,
        from: entry.from,
        mbox_source: entry.mbox_source
      }
    };
  });
}

function buildMaliciousSkillArtifacts(mirrorData) {
  const collectedAt = new Date().toISOString();
  return mirrorData.map((entry, index) => {
    const slug = toSafeSlug(entry.identifier).slice(0, 50);
    const freshnessTier = index < mirrorData.length / 2 ? "established" : "fresh";
    return {
      artifact_id: `skill-mal-${slug}`,
      category: "skill",
      tier: "local_mirror",
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      label: "malicious",
      source_name: entry.source === "snyk-toxicskills" ? "snyk-toxicskills" : "skills.sh",
      source_kind: entry.source === "snyk-toxicskills" ? "research_dataset" : "live_index",
      requested_ref: entry.local_path,
      resolved_ref: entry.skill_url || entry.raw_url || null,
      collected_at: collectedAt,
      source_published_at: null,
      source_first_seen_at: null,
      fetched_at: entry.mirrored_at,
      content_hash: null,
      selection_reason:
        entry.source === "snyk-toxicskills"
          ? `Malicious skill payload from Snyk ToxicSkills research dataset (${entry.github_path}).`
          : `Flagged as ${entry.risk_level} by skills.sh audit (${entry.identifier}).`,
      freshness_note:
        entry.source === "snyk-toxicskills"
          ? "ToxicSkills research dataset published in 2025. Freshness tier is operator-assigned."
          : "skills.sh audit risk ratings. Freshness tier is operator-assigned based on audit page order.",
      metadata: {
        brin_origin: "skill",
        brin_identifier: entry.identifier,
        risk_level: entry.risk_level || "malicious",
        data_source: entry.source
      }
    };
  });
}

function buildMaliciousPackageArtifacts(mirrorData) {
  const collectedAt = new Date().toISOString();
  return mirrorData.map((entry, index) => {
    const slug = toSafeSlug(`${entry.ecosystem}-${entry.package_name}`).slice(0, 50);
    const freshnessTier = index < mirrorData.length / 2 ? "established" : "fresh";
    return {
      artifact_id: `package-mal-${slug}`,
      category: "package",
      tier: "local_mirror",
      freshness_tier: freshnessTier,
      freshness_window_days: FRESHNESS_WINDOW_DAYS,
      label: "malicious",
      source_name: "osv",
      source_kind: "vulnerability_database",
      requested_ref: entry.local_path,
      resolved_ref: `https://osv.dev/vulnerability/${entry.osv_id}`,
      collected_at: collectedAt,
      source_published_at: null,
      source_first_seen_at: null,
      fetched_at: entry.mirrored_at,
      content_hash: null,
      selection_reason: `Malicious package identified by OSV advisory ${entry.osv_id} (${entry.ecosystem}/${entry.package_name}).`,
      freshness_note: `OSV MAL advisory ${entry.osv_id}. Freshness tier is operator-assigned.`,
      metadata: {
        brin_origin: entry.ecosystem === "npm" ? "npm" : "pypi",
        brin_identifier: entry.package_name,
        ecosystem: entry.ecosystem,
        osv_id: entry.osv_id
      }
    };
  });
}

async function addContentHashes(artifacts) {
  for (const artifact of artifacts) {
    try {
      const { content_hash } = await loadLocalContent(artifact.requested_ref);
      artifact.content_hash = content_hash;
    } catch {
      // Content hash unavailable for artifacts that couldn't be mirrored.
    }
  }
  return artifacts;
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const safeManifestPath = path.resolve(
    projectRoot,
    requireArg(args, "safe-manifest")
  );
  const mirrorSummaryPath = path.resolve(
    projectRoot,
    requireArg(args, "mirror-summary")
  );
  const outputPath = path.resolve(
    projectRoot,
    args.out || "artifacts/phase2/phase2-frozen.jsonl"
  );
  const summaryPath = path.resolve(
    projectRoot,
    args.summary || outputPath.replace(/\.jsonl$/, ".summary.json")
  );

  const safeArtifacts = await readManifestFile(safeManifestPath);
  const mirrorSummary = await readJson(mirrorSummaryPath);

  const maliciousWeb = buildMaliciousWebArtifacts(mirrorSummary.web || []);
  const maliciousEmail = buildMaliciousEmailArtifacts(mirrorSummary.email || []);
  const maliciousSkill = buildMaliciousSkillArtifacts(mirrorSummary.skill || []);
  const maliciousPackage = buildMaliciousPackageArtifacts(
    mirrorSummary.package || []
  );

  const allMalicious = [
    ...maliciousWeb,
    ...maliciousEmail,
    ...maliciousSkill,
    ...maliciousPackage
  ];

  await addContentHashes(allMalicious);

  const combined = [...safeArtifacts, ...allMalicious];

  const normalized = await writeManifestFile({
    manifestPath: outputPath,
    artifacts: combined
  });

  const summary = summarizeManifest(normalized);
  await writeJson(summaryPath, {
    generated_at: new Date().toISOString(),
    safe_manifest_path: safeManifestPath,
    mirror_summary_path: mirrorSummaryPath,
    manifest_path: outputPath,
    summary
  });

  console.log(
    JSON.stringify(
      { manifest_path: outputPath, summary_path: summaryPath, summary },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
