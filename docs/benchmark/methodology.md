# Benchmark methodology

## Overview

This benchmark measures the gap between what a frontier AI model can detect on its own and what it catches with Brin's intelligence database. We pull real artifacts from Brin's API, fetch the content a coding agent would see, run the model against that content with a security-focused system prompt, and compare its verdicts against Brin's.

## Dataset construction

### Step 1: Ground truth from Brin

We queried Brin's list API for recently scanned artifacts across six categories. For each category, we pulled a balanced set of safe and flagged (suspicious or dangerous) artifacts with 4x overfetching to ensure target counts were met even after fetch failures.

| Category | Safe target | Flagged target | Safe fetched | Flagged fetched |
|---|---|---|---|---|
| Web pages | 50 | 50 | 50 | 50 |
| Domains | 50 | 50 | 50 | 50 |
| Skills | 50 | 50 | 50 | 50 |
| Repositories | 50 | 50 | 50 | 18 |
| npm packages | 50 | 50 | 50 | 7 |
| Contributors | 50 | 10 | 50 | 10 |
| **Total** | **300** | **260** | **300** | **185** |

Repositories and npm had fewer flagged artifacts available in Brin's database at query time. The contributor flagged sample is intentionally smaller (10) per the benchmark design.

### Step 2: Content fetching

For each artifact, we fetched the content a coding agent would encounter in production:

- **Web pages and domains**: raw HTML via HTTPS fetch
- **Skills**: SKILL.md from source GitHub repositories (with fallback to skills.sh registry)
- **Repositories**: GitHub API metadata (repo info + README content)
- **npm packages**: registry metadata JSON from registry.npmjs.org
- **Contributors**: GitHub profile + 30 most recent public events

Fetched content was cached under `artifacts/brin-truth/` and a frozen manifest (`manifest.jsonl`) was written with 485 entries.

### Step 3: Manifest verification

All 485 artifacts were verified with zero fetch failures before the model run.

## Model evaluation

### System prompt

The model received a security-focused system prompt ([prompts/model-only-detection.md](../../prompts/model-only-detection.md)) instructing it to classify artifacts using four verdicts:

- **safe**: no meaningful threat signals
- **caution**: weak or ambiguous signals
- **suspicious**: credible evidence of malicious intent (should block)
- **dangerous**: strong, direct evidence of malicious behavior (must block)

The prompt covers six threat categories: prompt injection, credential harvesting, covert exfiltration, social engineering, malicious install behavior, and tool abuse.

### Model and driver

- **Model**: `claude-4.6-opus-high-thinking`
- **Driver**: Cursor headless CLI (`agent`) in streaming mode
- **Execution**: each artifact processed independently -- create a fresh chat session, send the classification prompt with artifact metadata and fetched content, parse structured JSON verdict from the response

### Parallelization

The 485-artifact manifest was split into shards and run in parallel across 4 processes. Each shard's results were merged into a single model summary for evaluation.

### What the model sees

For each artifact, the model receives:

1. The security system prompt
2. Artifact metadata (category, tier, freshness, content hash)
3. The full fetched content (truncated to 60,000 characters for token safety)
4. A JSON schema for structured output

The model must return a JSON verdict with: verdict, allow_or_block, confidence (0-1), source_summary, reasoning, and red_flags array.

## Evaluation

### Verdict mapping

Brin and model verdicts are mapped to a binary:

- **Pass** (safe): `safe` or `caution`
- **Block** (flagged): `suspicious` or `dangerous`

### Metrics

Three primary metrics, reported overall and per category:

1. **Model coverage**: of artifacts Brin flagged, what percentage did the model also flag
2. **Model gap**: what the model missed (broken down by Brin signal type and threat type)
3. **Model false positive rate**: percentage of Brin-safe artifacts the model incorrectly flagged

### Signal-type breakdown

Model misses are broken down by which Brin signal drove the detection:

- **Identity**: domain registration, account age, publisher reputation
- **Behavior**: runtime patterns, install hooks, network callbacks
- **Content**: what's visible in the artifact text/code
- **Graph**: dependency chains, cross-artifact trust, contributor patterns

### Threat-type breakdown

Model misses are also broken down by Brin's threat classification: blocklist, brand impersonation, credential harvest, phishing, exfiltration, prompt injection, typosquat, supply chain, and others.

## Reproduction

```bash
# 1. Build ground truth from Brin API
npm run build:brin-truth-dataset

# 2. Fetch content (requires GITHUB_TOKEN for repos/contributors)
GITHUB_TOKEN=$(gh auth token) npm run fetch:brin-truth-content -- --dataset config/brin-truth-dataset.json

# 3. Verify all fetches
npm run verify:manifest -- --manifest artifacts/brin-truth/manifest.jsonl

# 4. Run model (split into shards for speed)
node scripts/run-model-benchmark.js \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --driver cursor-agent \
  --no-shuru \
  --phase brin-truth

# 5. Evaluate
npm run evaluate:brin-truth -- \
  --manifest artifacts/brin-truth/manifest.jsonl \
  --model-summary <run-dir>/report/model-summary.json
```

## Ground truth

Brin's verdicts are the detection ground truth. The benchmark answers "what would a coding agent miss without Brin?" rather than testing Brin's accuracy against an independent dataset. This means Brin's false negatives are not measured by design.
