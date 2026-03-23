#!/usr/bin/env node

import path from "node:path";
import { parseArgs, requireArg } from "../lib/cli.js";
import { readManifestFile } from "../lib/manifest.js";
import { readJson, writeJson, writeText } from "../lib/io.js";
import { VERDICTS } from "../lib/constants.js";

function isBlock(verdict) {
  return verdict === "suspicious" || verdict === "dangerous";
}

function createConfusionMatrix() {
  return Object.fromEntries(
    VERDICTS.map((expected) => [
      expected,
      Object.fromEntries(VERDICTS.map((predicted) => [predicted, 0]))
    ])
  );
}

function dominantSignal(subScores) {
  if (!subScores) return "unknown";
  const entries = [
    ["identity", subScores.identity],
    ["behavior", subScores.behavior],
    ["content", subScores.content],
    ["graph", subScores.graph]
  ].filter(([, v]) => typeof v === "number");

  if (entries.length === 0) return "unknown";

  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

function buildReport({ artifacts, modelSummary }) {
  const modelByArtifactId = new Map();
  for (const result of modelSummary.results || []) {
    modelByArtifactId.set(result.artifact_id, result);
  }

  const records = artifacts.map((artifact) => ({
    artifact,
    brin_verdict: artifact.metadata?.brin_verdict || null,
    brin_score: artifact.metadata?.brin_score ?? null,
    brin_sub_scores: artifact.metadata?.brin_sub_scores || null,
    brin_threats: artifact.metadata?.brin_threats || [],
    model_verdict: modelByArtifactId.get(artifact.artifact_id)?.verdict || null,
    model_error: modelByArtifactId.get(artifact.artifact_id)?.error || null
  }));

  const brinFlagged = records.filter((r) => isBlock(r.brin_verdict));
  const brinSafe = records.filter((r) => !isBlock(r.brin_verdict));

  const modelAgreesOnFlagged = brinFlagged.filter((r) => isBlock(r.model_verdict));
  const modelMissed = brinFlagged.filter((r) => !isBlock(r.model_verdict));
  const modelFalsePositives = brinSafe.filter((r) => isBlock(r.model_verdict));

  const byCategory = {};
  const bySignal = {};
  const byThreatType = {};

  for (const record of records) {
    const cat = record.artifact.category;
    if (!byCategory[cat]) {
      byCategory[cat] = {
        total: 0,
        brin_flagged: 0,
        model_agrees: 0,
        model_missed: 0,
        brin_safe: 0,
        model_fp: 0
      };
    }
    const bucket = byCategory[cat];
    bucket.total += 1;

    if (isBlock(record.brin_verdict)) {
      bucket.brin_flagged += 1;
      if (isBlock(record.model_verdict)) {
        bucket.model_agrees += 1;
      } else {
        bucket.model_missed += 1;
      }
    } else {
      bucket.brin_safe += 1;
      if (isBlock(record.model_verdict)) {
        bucket.model_fp += 1;
      }
    }
  }

  for (const record of brinFlagged) {
    const signal = dominantSignal(record.brin_sub_scores);
    if (!bySignal[signal]) {
      bySignal[signal] = { brin_flagged: 0, model_agrees: 0, model_missed: 0 };
    }
    bySignal[signal].brin_flagged += 1;
    if (isBlock(record.model_verdict)) {
      bySignal[signal].model_agrees += 1;
    } else {
      bySignal[signal].model_missed += 1;
    }

    for (const threat of record.brin_threats) {
      const type = threat.type || "unknown";
      if (!byThreatType[type]) {
        byThreatType[type] = { count: 0, model_agrees: 0, model_missed: 0 };
      }
      byThreatType[type].count += 1;
      if (isBlock(record.model_verdict)) {
        byThreatType[type].model_agrees += 1;
      } else {
        byThreatType[type].model_missed += 1;
      }
    }
  }

  const confusionMatrix = createConfusionMatrix();
  for (const record of records) {
    const expected = record.brin_verdict;
    const predicted = record.model_verdict;
    if (expected && predicted && confusionMatrix[expected]?.[predicted] !== undefined) {
      confusionMatrix[expected][predicted] += 1;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    total_artifacts: records.length,
    brin_flagged: brinFlagged.length,
    brin_safe: brinSafe.length,
    model_coverage: {
      agrees: modelAgreesOnFlagged.length,
      missed: modelMissed.length,
      coverage_rate: brinFlagged.length > 0
        ? modelAgreesOnFlagged.length / brinFlagged.length
        : null,
      gap_rate: brinFlagged.length > 0
        ? modelMissed.length / brinFlagged.length
        : null
    },
    model_false_positives: {
      count: modelFalsePositives.length,
      rate: brinSafe.length > 0
        ? modelFalsePositives.length / brinSafe.length
        : null
    },
    by_category: byCategory,
    by_signal: bySignal,
    by_threat_type: byThreatType,
    confusion_matrix: confusionMatrix,
    missed_details: modelMissed.map((r) => ({
      artifact_id: r.artifact.artifact_id,
      category: r.artifact.category,
      brin_verdict: r.brin_verdict,
      brin_score: r.brin_score,
      model_verdict: r.model_verdict,
      dominant_signal: dominantSignal(r.brin_sub_scores),
      threat_types: r.brin_threats.map((t) => t.type)
    }))
  };
}

function formatRate(numerator, denominator) {
  if (!denominator) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

function buildMarkdownSummary(report) {
  const sections = [
    "# Brin-truth benchmark report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## What this measures",
    "",
    "Brin's verdicts are the ground truth. The metric is: of the threats Brin identified,",
    "how many were invisible to the model alone?",
    "",
    "## Overall",
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total artifacts | ${report.total_artifacts} |`,
    `| Brin flagged (suspicious/dangerous) | ${report.brin_flagged} |`,
    `| Model also flagged | ${formatRate(report.model_coverage.agrees, report.brin_flagged)} |`,
    `| Model missed | ${formatRate(report.model_coverage.missed, report.brin_flagged)} |`,
    `| Model false positives (on Brin-safe set) | ${formatRate(report.model_false_positives.count, report.brin_safe)} |`,
    "",
    "## By category",
    "",
    "| Category | Brin flagged | Model agrees | Model missed | Model FP rate |",
    "| --- | --- | --- | --- | --- |"
  ];

  for (const [cat, metrics] of Object.entries(report.by_category).sort()) {
    sections.push(
      `| ${cat} | ${metrics.brin_flagged} | ${formatRate(metrics.model_agrees, metrics.brin_flagged)} | ${formatRate(metrics.model_missed, metrics.brin_flagged)} | ${formatRate(metrics.model_fp, metrics.brin_safe)} |`
    );
  }

  sections.push("", "## By Brin signal type (on flagged artifacts)", "", "| Signal | Brin flagged | Model caught | Model missed |", "| --- | --- | --- | --- |");

  for (const [signal, metrics] of Object.entries(report.by_signal).sort()) {
    sections.push(
      `| ${signal} | ${metrics.brin_flagged} | ${formatRate(metrics.model_agrees, metrics.brin_flagged)} | ${formatRate(metrics.model_missed, metrics.brin_flagged)} |`
    );
  }

  if (Object.keys(report.by_threat_type).length > 0) {
    sections.push("", "## By threat type", "", "| Threat | Count | Model caught | Model missed |", "| --- | --- | --- | --- |");

    const sorted = Object.entries(report.by_threat_type).sort((a, b) => b[1].count - a[1].count);
    for (const [type, metrics] of sorted) {
      sections.push(
        `| ${type} | ${metrics.count} | ${formatRate(metrics.model_agrees, metrics.count)} | ${formatRate(metrics.model_missed, metrics.count)} |`
      );
    }
  }

  return `${sections.join("\n")}\n`;
}

function flattenMetrics(report) {
  const rows = [
    ["scope", "key", "metric", "value"].join(",")
  ];

  rows.push(["overall", "all", "brin_flagged", report.brin_flagged].join(","));
  rows.push(["overall", "all", "model_coverage_rate", report.model_coverage.coverage_rate ?? ""].join(","));
  rows.push(["overall", "all", "model_gap_rate", report.model_coverage.gap_rate ?? ""].join(","));
  rows.push(["overall", "all", "model_fp_rate", report.model_false_positives.rate ?? ""].join(","));

  for (const [cat, m] of Object.entries(report.by_category)) {
    rows.push(["category", cat, "brin_flagged", m.brin_flagged].join(","));
    rows.push(["category", cat, "model_agrees", m.model_agrees].join(","));
    rows.push(["category", cat, "model_missed", m.model_missed].join(","));
    rows.push(["category", cat, "model_fp", m.model_fp].join(","));
  }

  for (const [signal, m] of Object.entries(report.by_signal)) {
    rows.push(["signal", signal, "brin_flagged", m.brin_flagged].join(","));
    rows.push(["signal", signal, "model_agrees", m.model_agrees].join(","));
    rows.push(["signal", signal, "model_missed", m.model_missed].join(","));
  }

  return rows.join("\n");
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const modelSummaryPath = path.resolve(projectRoot, requireArg(args, "model-summary"));
  const outputDir = path.resolve(
    projectRoot,
    args.outdir || `results/reports/brin-truth-${Date.now()}`
  );

  const [artifacts, modelSummary] = await Promise.all([
    readManifestFile(manifestPath),
    readJson(modelSummaryPath)
  ]);

  const report = buildReport({ artifacts, modelSummary });
  const markdown = buildMarkdownSummary(report);
  const csv = flattenMetrics(report);

  await Promise.all([
    writeJson(path.join(outputDir, "report.json"), report),
    writeText(path.join(outputDir, "summary.md"), markdown),
    writeText(path.join(outputDir, "metrics.csv"), `${csv}\n`)
  ]);

  console.log(
    JSON.stringify(
      {
        report_json: path.join(outputDir, "report.json"),
        report_markdown: path.join(outputDir, "summary.md"),
        metrics_csv: path.join(outputDir, "metrics.csv")
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
