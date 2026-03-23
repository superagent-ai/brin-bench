#!/usr/bin/env node

import path from "node:path";
import { parseArgs, requireArg } from "../lib/cli.js";
import { readManifestFile } from "../lib/manifest.js";
import { buildEvaluationReport, buildMarkdownSummary } from "../lib/evaluation.js";
import { readJson, writeJson, writeText } from "../lib/io.js";

function flattenMetrics(report) {
  const rows = [];

  for (const [systemName, systemReport] of Object.entries(report.systems)) {
    rows.push([
      systemName,
      "overall",
      "all",
      systemReport.overall.detection_rate.value ?? "",
      systemReport.overall.false_positive_rate.value ?? "",
      systemReport.overall.safe_artifacts,
      systemReport.overall.malicious_artifacts
    ]);

    for (const [category, metrics] of Object.entries(systemReport.by_category)) {
      rows.push([
        systemName,
        "category",
        category,
        metrics.detection_rate.value ?? "",
        metrics.false_positive_rate.value ?? "",
        metrics.safe_artifacts,
        metrics.malicious_artifacts
      ]);
    }

    for (const [tier, metrics] of Object.entries(systemReport.by_freshness)) {
      rows.push([
        systemName,
        "freshness",
        tier,
        metrics.detection_rate.value ?? "",
        metrics.false_positive_rate.value ?? "",
        metrics.safe_artifacts,
        metrics.malicious_artifacts
      ]);
    }
  }

  return [
    [
      "system",
      "scope",
      "key",
      "detection_rate",
      "false_positive_rate",
      "safe_artifacts",
      "malicious_artifacts"
    ],
    ...rows
  ]
    .map((row) => row.join(","))
    .join("\n");
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const manifestPath = path.resolve(projectRoot, requireArg(args, "manifest"));
  const modelSummaryPath = path.resolve(projectRoot, requireArg(args, "model-summary"));
  const brinSummaryPath = path.resolve(projectRoot, requireArg(args, "brin-summary"));
  const outputDir = path.resolve(
    projectRoot,
    args.outdir || `results/reports/eval-${Date.now()}`
  );

  const [artifacts, modelSummary, brinSummary] = await Promise.all([
    readManifestFile(manifestPath),
    readJson(modelSummaryPath),
    readJson(brinSummaryPath)
  ]);

  const report = buildEvaluationReport({
    artifacts,
    modelSummary,
    brinSummary
  });
  const markdown = buildMarkdownSummary(report);
  const csv = flattenMetrics(report);

  const reportJsonPath = path.join(outputDir, "report.json");
  const reportMarkdownPath = path.join(outputDir, "summary.md");
  const metricsCsvPath = path.join(outputDir, "metrics.csv");

  await Promise.all([
    writeJson(reportJsonPath, report),
    writeText(reportMarkdownPath, markdown),
    writeText(metricsCsvPath, `${csv}\n`)
  ]);

  console.log(
    JSON.stringify(
      {
        report_json: reportJsonPath,
        report_markdown: reportMarkdownPath,
        metrics_csv: metricsCsvPath
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
