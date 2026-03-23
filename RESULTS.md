# Benchmark results

**Run date:** March 23, 2026
**Model tested:** `claude-4.6-opus-high-thinking` via Cursor headless CLI
**Dataset:** 485 artifacts from Brin's intelligence database across 6 categories

## The question

When a coding agent fetches something from the internet, it has to decide whether the content is safe. Most teams rely on the model itself -- a strong system prompt that says "watch out for threats." Does that actually work?

## The answer

The model missed **57.3%** of the threats Brin identified. Out of 185 artifacts Brin flagged as suspicious or dangerous, the model only caught 79. The other 106 went undetected.

| Metric | Value |
|---|---|
| Total artifacts tested | 485 |
| Brin flagged (suspicious or dangerous) | 185 |
| Model also flagged | 42.7% (79/185) |
| Model missed | 57.3% (106/185) |
| Model false positive rate | 1.3% (4/300) |

## Where the model fails

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

## What this means

A frontier model can spot obvious content-level threats -- skills with prompt injection, packages with suspicious install scripts. But it has no way to know whether a domain was registered yesterday on a bulletproof host, whether an npm package was published two hours ago by a throwaway account, or whether a contributor is spraying rejected PRs across dozens of repos.

These are the signals that Brin checks: identity, behavior, and graph. The model can't see any of them. The false positive rate is low (1.3%), confirming that adding Brin fills a detection gap without creating noise.

## Methodology and detailed analysis

See [docs/benchmark/methodology.md](docs/benchmark/methodology.md) for how the benchmark was run and [docs/benchmark/detailed-results.md](docs/benchmark/detailed-results.md) for per-artifact breakdowns and model reasoning samples.

## Limitations

This benchmark measures what you miss without Brin. It does not measure what Brin misses. Artifacts that both systems fail to detect are invisible by design. The contributor (10 flagged) and npm (7 flagged) categories have small flagged samples and should be interpreted with that caveat.
