import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { buildEvaluationReport } from "../lib/evaluation.js";
import { writeManifestFile } from "../lib/manifest.js";

test("evaluation report computes detection and false positive rates by system and freshness", () => {
  const artifacts = [
    {
      artifact_id: "safe-established",
      category: "web",
      label: "safe",
      tier: "runtime_live",
      freshness_tier: "established",
      freshness_window_days: 60,
      metadata: {
        expected_verdict: "safe"
      }
    },
    {
      artifact_id: "malicious-fresh",
      category: "web",
      label: "malicious",
      tier: "runtime_live",
      freshness_tier: "fresh",
      freshness_window_days: 60,
      metadata: {
        expected_verdict: "dangerous"
      }
    }
  ];

  const modelSummary = {
    manifest_path: "artifacts.jsonl",
    results: [
      {
        artifact_id: "safe-established",
        verdict: "suspicious"
      },
      {
        artifact_id: "malicious-fresh",
        verdict: "safe"
      }
    ]
  };

  const brinSummary = {
    manifest_path: "artifacts.jsonl",
    results: [
      {
        artifact_id: "safe-established",
        verdict: "safe"
      },
      {
        artifact_id: "malicious-fresh",
        verdict: "dangerous"
      }
    ]
  };

  const report = buildEvaluationReport({
    artifacts,
    modelSummary,
    brinSummary
  });

  assert.equal(report.systems.model.overall.false_positive_rate.value, 1);
  assert.equal(report.systems.model.overall.detection_rate.value, 0);
  assert.equal(report.systems.brin.overall.false_positive_rate.value, 0);
  assert.equal(report.systems.brin.overall.detection_rate.value, 1);

  assert.equal(
    report.systems.model.by_freshness.fresh.detection_rate.value,
    0
  );
  assert.equal(
    report.systems.brin.by_freshness.fresh.detection_rate.value,
    1
  );
  assert.equal(
    report.systems.model.by_freshness.established.false_positive_rate.value,
    1
  );
  assert.equal(
    report.systems.brin.by_freshness.established.false_positive_rate.value,
    0
  );
});

test("writeManifestFile rejects duplicate artifact ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "brin-bench-manifest-"));
  const manifestPath = path.join(tempDir, "duplicate-artifacts.jsonl");

  await assert.rejects(
    () =>
      writeManifestFile({
        manifestPath,
        artifacts: [
          {
            artifact_id: "web-duplicate",
            category: "web",
            tier: "runtime_live",
            freshness_tier: "established",
            freshness_window_days: 60,
            label: "safe",
            source_name: "test",
            source_kind: "live_direct",
            requested_ref: "https://example.com/one",
            collected_at: "2026-03-22T00:00:00Z",
            selection_reason: "first duplicate",
            metadata: {}
          },
          {
            artifact_id: "web-duplicate",
            category: "web",
            tier: "runtime_live",
            freshness_tier: "fresh",
            freshness_window_days: 60,
            label: "safe",
            source_name: "test",
            source_kind: "live_direct",
            requested_ref: "https://example.com/two",
            collected_at: "2026-03-22T00:00:00Z",
            selection_reason: "second duplicate",
            metadata: {}
          }
        ]
      }),
    /Duplicate artifact_id values are not allowed/
  );
});
