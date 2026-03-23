# brin-bench

A benchmark that measures the gap between what a frontier AI model can detect on its own and what it catches with [Brin](https://github.com/superagent-ai/brin).

## The problem

When a coding agent fetches something from the internet -- a web page, a package, a skill file, a repo -- it has to decide whether that content is safe. The best defense most teams have today is the model itself: a strong system prompt that says "watch out for phishing, prompt injection, and malicious content."

The question is whether that actually works.

## What we measure

We pull a balanced set of recently scanned artifacts from Brin's own intelligence database -- some safe, some flagged -- across six categories. Then we run each artifact through a frontier model with a security-focused system prompt and compare the model's verdict against Brin's.

The key metric: **of the threats Brin identified, how many were invisible to the model alone?**

The model sees the same content a coding agent would encounter in production: web page HTML, npm registry metadata, skill definitions, repo READMEs, contributor profiles. It does not see Brin's scores, signals, or verdicts. It classifies based on content alone.

## Why the model isn't enough

A model can only judge what's in front of it: the raw content of one artifact at one point in time. It can't check whether a domain was registered yesterday on a bulletproof host, or whether an npm package was published two hours ago by a throwaway account. It doesn't see dependency graphs, publisher reputation, or cross-artifact trust signals.

Brin scores artifacts across four dimensions -- identity, behavior, content, and graph -- using reputation data, protocol verification, and cross-artifact relationships. This benchmark measures how much that gap costs you in missed threats.

## Dataset

Around 560 artifacts across six categories, sourced from Brin's database via its list API:

| Category | What the model sees | What Brin checks | Count |
|----------|-------------------|-----------------|-------|
| Web pages | Fetched HTML content | Page reputation, content scanning, blocklists | 50 + 50 |
| Domains | Homepage HTML | Domain registration, DNS, behavior signals | 50 + 50 |
| Skills | SKILL.md from source repo | Skill identity, code analysis, graph context | 50 + 50 |
| Repositories | GitHub API metadata + README | Repo identity, contributor patterns, code signals | 50 + 50 |
| npm packages | Registry metadata JSON | Package identity, install behavior, dependency graph | 50 + 50 |
| Contributors | GitHub profile + recent events | Account age, PR patterns, cross-repo behavior | 50 + 10 |

For each category, we pull recently scanned artifacts in two groups: those Brin scored as safe, and those Brin flagged as suspicious or dangerous. Brin's verdicts are the ground truth for detection. False positive rate is measured on the safe subset.

## Metrics

Three numbers, reported overall and per category:

- **Model coverage** -- of artifacts Brin flagged, what percentage did the model also flag
- **Model gap** -- what the model missed (broken down by which Brin signal drove the detection: identity, behavior, content, or graph)
- **Model false positive rate** -- percentage of Brin-safe artifacts the model incorrectly flagged

Verdict mapping: safe and caution = pass. Suspicious and dangerous = block.

The report also breaks down model misses by Brin threat type (blocklist, brand impersonation, credential harvest, prompt injection, etc.) to show exactly where content-only classification falls short.

## Results

**Run date:** March 23, 2026 | **Model:** `claude-4.6-opus-high-thinking` | **Dataset:** 485 artifacts

The model missed **57.3%** of the threats Brin identified. Out of 185 artifacts Brin flagged as suspicious or dangerous, the model only caught 79. The other 106 went undetected.

| Metric | Value |
|---|---|
| Total artifacts tested | 485 |
| Brin flagged (suspicious or dangerous) | 185 |
| Model also flagged | 42.7% (79/185) |
| Model missed | 57.3% (106/185) |
| Model false positive rate | 1.3% (4/300) |

### By artifact category

| Category | Brin flagged | Model caught | Model missed |
|---|---|---|---|
| Repositories | 18 | 11.1% (2) | **88.9%** (16) |
| Web pages | 50 | 30.0% (15) | **70.0%** (35) |
| npm packages | 7 | 28.6% (2) | **71.4%** (5) |
| Domains | 50 | 34.0% (17) | **66.0%** (33) |
| Contributors | 10 | 40.0% (4) | **60.0%** (6) |
| Skills | 50 | 78.0% (39) | 22.0% (11) |

### By Brin signal type

Brin scores artifacts across four dimensions. The model has zero visibility into three of them.

| Signal | Brin flagged | Model caught | Model missed |
|---|---|---|---|
| Graph (dependency chains, cross-repo trust) | 5 | 0% | **100%** |
| Identity (domain reputation, account age) | 49 | 30.6% | **69.4%** |
| Behavior (runtime patterns, install hooks) | 10 | 40.0% | **60.0%** |
| Content (what's in the artifact) | 121 | 49.6% | **50.4%** |

### By threat type

| Threat | Count | Model missed |
|---|---|---|
| Blocklisted entities | 22 | **100%** |
| TLS failures (dead infrastructure) | 4 | **100%** |
| Encoded payloads | 26 | **76.9%** |
| Install attacks | 5 | **80.0%** |
| Credential harvesting | 5 | **80.0%** |
| Phishing | 46 | **67.4%** |
| Exfiltration | 103 | **61.2%** |
| Cloaking | 8 | **50.0%** |
| Prompt injection | 17 | **41.2%** |
| Typosquat | 21 | **42.9%** |

The model spots obvious content-level threats -- skills with prompt injection, packages with suspicious install scripts. But it has no way to check domain registration age, publisher reputation, or cross-artifact trust graphs. The false positive rate is low (1.3%), confirming that Brin fills a detection gap without creating noise.

See [RESULTS.md](RESULTS.md) for the full writeup, and [docs/benchmark/methodology.md](docs/benchmark/methodology.md) for how the benchmark was run.

## Limitations

This benchmark measures what you miss without Brin. It does not measure what Brin misses -- artifacts that both systems fail to detect are invisible by design. The contributor (10 flagged) and npm (7 flagged) categories have small flagged samples and should be interpreted with that caveat.

## Implementation

### Prerequisites

- **macOS 14+ on Apple Silicon** (required for [Shuru](https://github.com/superhq-ai/shuru))
- **Node.js 20+** and `npm install` in this repo
- **Shuru CLI** -- `brew tap superhq-ai/tap && brew install shuru`, then `npm run setup:shuru`
- **Cursor headless CLI** on `PATH` (default binary name `agent`; override with `CURSOR_CLI`)
- **`CURSOR_API_KEY`** -- copy [`.env.example`](.env.example) to `.env` and set the key

See [RUNBOOK.md](RUNBOOK.md) for the full run sequence.

### Agent

The model path uses the Cursor headless CLI (`agent`) with `claude-4.6-opus-high-thinking` by default (override with `BENCH_MODEL` or `--model`). The harness pre-fetches each artifact's content, sends it plus the security-focused system prompt to the model, and parses a structured JSON verdict from the reply.

### Sandboxing

The model path runs inside a [Shuru](https://github.com/superhq-ai/shuru) microVM. The malicious artifacts in the dataset are real -- a skill with prompt injection could instruct the agent to exfiltrate credentials, a phishing page could redirect to a payload. Shuru gives us hypervisor isolation, no host filesystem access beyond mounted paths, and an ephemeral rootfs that resets between runs.

## Scope

This is a detection accuracy benchmark. We don't test what happens when an agent acts on a malicious artifact. Brin tells you whether something is dangerous; what you do with that information is your call.
