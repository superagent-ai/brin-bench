# Runbook

## What this project does

This benchmark compares a frontier model's security classification against Brin's intelligence database. We pull artifacts from Brin's API, fetch the content a coding agent would see, run the model on that content inside a Shuru sandbox, and measure how many of Brin's flagged threats the model would have missed on its own.

## Prerequisites

- **macOS 14+ on Apple Silicon** (required for [Shuru](https://github.com/superhq-ai/shuru); the model path assumes a Shuru-capable host)
- **Node.js 20+** and `npm install` in this repo
- **Shuru CLI** -- e.g. `brew tap superhq-ai/tap && brew install shuru` (see upstream [install options](https://github.com/superhq-ai/shuru))
- **Cursor headless CLI** on `PATH` -- default binary name `agent`; override with `CURSOR_CLI` if you use a different path or name
- **`CURSOR_API_KEY`** -- copy [`.env.example`](.env.example) to `.env` and set the key (dotenv loads it in model scripts)
- **`GITHUB_TOKEN`** -- set in `.env` or export in your shell. Required for fetching repo metadata and contributor profiles from the GitHub API without hitting rate limits. Generate one at [github.com/settings/tokens](https://github.com/settings/tokens) (no scopes needed for public data).
- optional: `BENCH_MODEL` to override the default Cursor model (`claude-4.6-opus-high-thinking`)

### Shuru checkpoint

The Shuru base VM is minimal Linux with no runtimes. Before running the benchmark you need a checkpoint with Node.js:

```bash
npm run setup:shuru
```

This creates a checkpoint called `brin-bench` with Node.js 20.x. You only need to do this once.

### Quick verification

```bash
npm run check:shuru
```

For a full agent smoke test inside the VM:

```bash
RUN_LIVE_SHURU_E2E=1 npm run test:shuru-live
```

## Benchmark sequence

### 1. Build the ground truth dataset from Brin

Query Brin's list API for recently scanned artifacts across all six categories (page, domain, skill, repo, npm, contributor). Pulls a balanced set of safe and flagged artifacts.

```bash
npm run build:brin-truth-dataset
```

This writes `config/brin-truth-dataset.json` with Brin's verdicts, scores, sub-scores, and threat details for each artifact. This file is the ground truth.

### 2. Fetch artifact content and build the manifest

For each artifact in the dataset, fetch the content a coding agent would see: web page HTML, npm registry metadata, SKILL.md files, GitHub repo metadata, contributor profiles. Content is cached locally under `artifacts/brin-truth/`.

```bash
npm run fetch:brin-truth-content -- --dataset config/brin-truth-dataset.json
```

This writes `artifacts/brin-truth/manifest.jsonl` -- the frozen manifest that drives the model run.

Before running the model, optionally verify all fetches:

```bash
npm run verify:manifest -- --manifest artifacts/brin-truth/manifest.jsonl
```

### 3. Smoke-test the model path

Run the mock driver first to validate the harness without live model calls:

```bash
node scripts/run-model-benchmark.js \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --driver mock \
  --no-shuru \
  --phase brin-truth
```

### 4. Run the model inside Shuru

For the full run, split the manifest into shards and run in parallel:

```bash
node scripts/run-model-benchmark.js \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --driver cursor-agent \
  --phase brin-truth
```

Or via the Shuru wrapper:

```bash
shuru/run-model-benchmark.sh \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --driver cursor-agent \
  --phase brin-truth
```

For parallel execution, split the manifest into shards and run each shard as a separate process. The model runner writes results under `results/runs/<run_id>/`.

### 5. Evaluate

Compare model verdicts against Brin's ground truth:

```bash
npm run evaluate:brin-truth -- \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --model-summary <model-run-dir>/report/model-summary.json
```

This writes under `results/reports/brin-truth-<timestamp>/`:

- `report.json` -- full metrics including per-category and per-signal breakdowns
- `summary.md` -- human-readable report
- `metrics.csv` -- flat metrics for analysis

## How to inspect a run

Every run has a full ledger under `results/runs/<run_id>/`.

The most useful files are:
- `logs/run.json` -- model, prompt, git commit, recency window definition
- `logs/events.jsonl` -- timestamps, retries, failures, per-artifact execution
- `manifest/artifacts.jsonl` -- exact artifact refs and freshness metadata
- `model/<category>/<artifact_id>/result.json` -- model classification
- `model/<category>/<artifact_id>/captured-artifact.txt` -- raw fetched content
- `report/model-summary.json` -- aggregated model results

## Ground truth

Brin's verdicts are the detection ground truth. The benchmark answers "what would a coding agent miss without Brin?" rather than testing Brin's accuracy against an independent dataset.

This means:
- Brin's false negatives are not measured (by design)
- False positives are measured on the safe subset (artifacts Brin scored as safe)
- The evaluation report breaks down model misses by Brin's signal type (identity, behavior, content, graph) and threat type (blocklist, brand impersonation, credential harvest, etc.)
