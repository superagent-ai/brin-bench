import { VERDICTS } from "./constants.js";
import { isBenchmarkArtifact } from "./manifest.js";

function createConfusionMatrix() {
  return Object.fromEntries(
    VERDICTS.map((expected) => [
      expected,
      Object.fromEntries(VERDICTS.map((predicted) => [predicted, 0]))
    ])
  );
}

function valueOrNull(numerator, denominator) {
  if (!denominator) {
    return null;
  }
  return numerator / denominator;
}

function isBlockingVerdict(verdict) {
  return verdict === "suspicious" || verdict === "dangerous";
}

function expectedVerdictForArtifact(artifact) {
  return (
    artifact.metadata?.expected_verdict ||
    (artifact.label === "safe"
      ? "safe"
      : artifact.label === "malicious"
        ? "dangerous"
        : null)
  );
}

function buildMetricBucket(records, verdictKey) {
  const benchmarkRecords = records.filter((record) => isBenchmarkArtifact(record.artifact));
  const malicious = benchmarkRecords.filter((record) => record.artifact.label === "malicious");
  const safe = benchmarkRecords.filter((record) => record.artifact.label === "safe");

  const detectionHits = malicious.filter((record) =>
    isBlockingVerdict(record[verdictKey]?.verdict || null)
  ).length;
  const falsePositiveHits = safe.filter((record) =>
    isBlockingVerdict(record[verdictKey]?.verdict || null)
  ).length;

  const confusionMatrix = createConfusionMatrix();
  for (const record of benchmarkRecords) {
    const expected = expectedVerdictForArtifact(record.artifact);
    const predicted = record[verdictKey]?.verdict || null;
    if (expected && predicted && confusionMatrix[expected]?.[predicted] !== undefined) {
      confusionMatrix[expected][predicted] += 1;
    }
  }

  return {
    total_artifacts: benchmarkRecords.length,
    safe_artifacts: safe.length,
    malicious_artifacts: malicious.length,
    detection_rate: {
      numerator: detectionHits,
      denominator: malicious.length,
      value: valueOrNull(detectionHits, malicious.length)
    },
    false_positive_rate: {
      numerator: falsePositiveHits,
      denominator: safe.length,
      value: valueOrNull(falsePositiveHits, safe.length)
    },
    confusion_matrix: confusionMatrix
  };
}

function groupBy(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }
  return groups;
}

function mapGroups(groups, verdictKey) {
  return Object.fromEntries(
    [...groups.entries()].map(([key, records]) => [key, buildMetricBucket(records, verdictKey)])
  );
}

export function buildJoinedRecords({ artifacts, modelSummary, brinSummary }) {
  const byArtifactId = new Map();

  for (const artifact of artifacts) {
    byArtifactId.set(artifact.artifact_id, {
      artifact,
      model: null,
      brin: null
    });
  }

  for (const result of modelSummary.results || []) {
    const record = byArtifactId.get(result.artifact_id);
    if (record) {
      record.model = result;
    }
  }

  for (const result of brinSummary.results || []) {
    const record = byArtifactId.get(result.artifact_id);
    if (record) {
      record.brin = result;
    }
  }

  return [...byArtifactId.values()];
}

export function buildEvaluationReport({ artifacts, modelSummary, brinSummary }) {
  const joined = buildJoinedRecords({ artifacts, modelSummary, brinSummary });
  const categoryGroups = groupBy(joined, (record) => record.artifact.category);
  const freshnessGroups = groupBy(joined, (record) => record.artifact.freshness_tier);
  const categoryFreshnessGroups = groupBy(
    joined,
    (record) => `${record.artifact.category}::${record.artifact.freshness_tier}`
  );

  return {
    generated_at: new Date().toISOString(),
    manifest_path: modelSummary.manifest_path || brinSummary.manifest_path || null,
    systems: {
      model: {
        overall: buildMetricBucket(joined, "model"),
        by_category: mapGroups(categoryGroups, "model"),
        by_freshness: mapGroups(freshnessGroups, "model"),
        by_category_freshness: mapGroups(categoryFreshnessGroups, "model")
      },
      brin: {
        overall: buildMetricBucket(joined, "brin"),
        by_category: mapGroups(categoryGroups, "brin"),
        by_freshness: mapGroups(freshnessGroups, "brin"),
        by_category_freshness: mapGroups(categoryFreshnessGroups, "brin")
      }
    }
  };
}

function formatRate(rate) {
  if (rate.value === null) {
    return "n/a";
  }
  return `${(rate.value * 100).toFixed(1)}% (${rate.numerator}/${rate.denominator})`;
}

export function buildMarkdownSummary(report) {
  const modelOverall = report.systems.model.overall;
  const brinOverall = report.systems.brin.overall;

  const sections = [
    "# Benchmark report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Overall",
    "",
    "| System | Detection rate | False positive rate | Safe artifacts | Malicious artifacts |",
    "| --- | --- | --- | --- | --- |",
    `| Model | ${formatRate(modelOverall.detection_rate)} | ${formatRate(modelOverall.false_positive_rate)} | ${modelOverall.safe_artifacts} | ${modelOverall.malicious_artifacts} |`,
    `| Brin | ${formatRate(brinOverall.detection_rate)} | ${formatRate(brinOverall.false_positive_rate)} | ${brinOverall.safe_artifacts} | ${brinOverall.malicious_artifacts} |`,
    "",
    "## Freshness split",
    "",
    "| Tier | System | Detection rate | False positive rate |",
    "| --- | --- | --- | --- |"
  ];

  for (const tier of Object.keys(report.systems.model.by_freshness).sort()) {
    const modelTier = report.systems.model.by_freshness[tier];
    const brinTier = report.systems.brin.by_freshness[tier];
    sections.push(
      `| ${tier} | Model | ${formatRate(modelTier.detection_rate)} | ${formatRate(modelTier.false_positive_rate)} |`
    );
    sections.push(
      `| ${tier} | Brin | ${formatRate(brinTier.detection_rate)} | ${formatRate(brinTier.false_positive_rate)} |`
    );
  }

  sections.push("", "## Category split", "", "| Category | System | Detection rate | False positive rate |", "| --- | --- | --- | --- |");

  for (const category of Object.keys(report.systems.model.by_category).sort()) {
    const modelCategory = report.systems.model.by_category[category];
    const brinCategory = report.systems.brin.by_category[category];
    sections.push(
      `| ${category} | Model | ${formatRate(modelCategory.detection_rate)} | ${formatRate(modelCategory.false_positive_rate)} |`
    );
    sections.push(
      `| ${category} | Brin | ${formatRate(brinCategory.detection_rate)} | ${formatRate(brinCategory.false_positive_rate)} |`
    );
  }

  return `${sections.join("\n")}\n`;
}
