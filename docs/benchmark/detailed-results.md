# Detailed benchmark results

Full evaluation data: [report.json](report.json) and [metrics.csv](metrics.csv).

## Confusion matrix

How model verdicts map against Brin verdicts across all 485 artifacts:

| Brin \ Model | safe | caution | suspicious | dangerous |
|---|---|---|---|---|
| **safe** | 280 | 14 | 3 | 1 |
| **suspicious** | 34 | 54 | 65 | 9 |
| **dangerous** | 13 | 5 | 2 | 3 |

Key observations:

- When Brin says safe, the model overwhelmingly agrees (280/298 = 93.6% correct, excluding 2 artifacts with no Brin "caution" mapping).
- When Brin says suspicious, the model calls it "caution" 33% of the time -- it notices something but does not cross the block threshold.
- When Brin says dangerous, the model calls it "safe" 56.5% of the time (13/23). These are the most severe blind spots.

## Per-category analysis

### Web pages (100 artifacts: 50 safe, 50 flagged)

**Model coverage: 30%** (15/50 flagged caught)

The model struggles with pages for two reasons. First, many Brin-flagged pages are on blocklists -- their content looks benign (empty GitHub Pages, generic business sites) but Brin knows the domain or URL has been reported for phishing or malware distribution. The model sees HTML that looks harmless and marks it safe. Second, exfiltration via standard analytics (tracking pixels, sendBeacon) is invisible to the model because these patterns are ubiquitous on legitimate sites.

**Blocklist blind spot**: 17 pages had Brin verdict "dangerous" with score 0 (hard blocklist). The model marked 12 of them "safe" and 5 "caution". Zero were correctly blocked.

### Domains (100 artifacts: 50 safe, 50 flagged)

**Model coverage: 34%** (17/50 flagged caught)

Similar to pages. The domain category suffers from the same blocklist and exfiltration gaps. The model can detect aggressive JavaScript (eval, service workers, keylogging) when it's visible in the HTML, but Brin's domain-level reputation signals -- registration age, hosting infrastructure, historical behavior -- are invisible to content-only analysis.

### Skills (100 artifacts: 50 safe, 50 flagged)

**Model coverage: 78%** (39/50 flagged caught)

The model's strongest category. Skills with prompt injection, hidden instructions, or scope violations are often detectable in the SKILL.md text. The 11 misses were mostly skills where the content returned 404 (repository removed or nonexistent) -- the model rated the inert 404 page as "caution" rather than blocking based on the suspicious provenance signals Brin detected.

### Repositories (68 artifacts: 50 safe, 18 flagged)

**Model coverage: 11.1%** (2/18 flagged caught)

The worst category. Brin flags repos based on identity signals (github_api_error, typosquat patterns), supply chain risks (dependency patterns, credential exposure in code), and graph-level trust. The model sees GitHub API metadata and a README, which typically looks legitimate. It has no way to detect typosquatting of package names, repository naming patterns that mimic trusted projects, or anomalous contributor graphs.

### npm packages (57 artifacts: 50 safe, 7 flagged)

**Model coverage: 28.6%** (2/7 flagged caught)

The flagged npm packages were detected by Brin through graph and behavior signals -- install attacks, credential harvesting via postinstall hooks, and dependency graph anomalies. The model sees the registry JSON metadata and generally finds it unremarkable. Packages like `nuxi` (typosquat) and `ssh2` (supply chain risk) look legitimate in their metadata alone.

### Contributors (60 artifacts: 50 safe, 10 flagged)

**Model coverage: 40%** (4/10 flagged caught)

Brin flags contributors based on behavioral patterns: PR spray (mass unsolicited PRs across repos), low merge rates, new accounts with suspicious activity, and rejected PRs. The model sees GitHub profile JSON and recent events, which often look like normal open-source contribution. It lacks the cross-repo behavioral analysis Brin performs.

## Model reasoning samples

Below are verbatim excerpts from the model's classification output showing how it reasons about artifacts. These illustrate both where the model succeeds and where it fails.

### Example 1: Model misses exfiltration on ya.ru (Yandex)

**Brin verdict**: suspicious (score 49) -- exfiltration, prompt injection
**Model verdict**: safe (confidence 0.85)

> The artifact is a Yandex SmartCaptcha page served when automated-looking requests are detected. The HTML contains a CAPTCHA checkbox form, standard Yandex Metrika analytics, and two tracking pixel images pointing to first-party Yandex domains. Despite the metadata claiming "Hidden HTML element contains AI-targeting instructions," no prompt injection or AI-targeting text was found anywhere in the HTML. The "exfiltration via image pixel tracking" refers to standard first-party Yandex analytics. None of this content poses a threat to a coding agent.

The model correctly identifies the visible content as standard Yandex infrastructure but cannot verify Brin's deeper behavioral and content signals about hidden elements or cross-domain exfiltration patterns.

### Example 2: Model misses encoded payloads on usepylon.com

**Brin verdict**: suspicious (score 33) -- encoded payload, phishing, cloaking, exfiltration, JS obfuscation
**Model verdict**: safe (confidence 0.88)

> The fetched content is the homepage of Pylon, a legitimate B2B customer support platform built on Webflow. The brin scanner flagged several threats, but each is a false positive when examined against the actual content: "encoded_payload" refers to a Webflow analytics endpoint with base64-encoded site identifiers -- standard Webflow behavior. "cloaking" refers to VWO's standard anti-flicker overlay. "exfiltration" of localStorage refers to VWO reading its own config key. None of these behaviors target the coding agent.

The model provides detailed, well-reasoned analysis of each signal and concludes each is a false positive from a content perspective. It cannot verify the domain-level reputation, hosting infrastructure, or cross-artifact signals that Brin used.

### Example 3: Model catches keylogging on bta.lt

**Brin verdict**: suspicious (score 48) -- exfiltration
**Model verdict**: suspicious (confidence 0.82)

> The page appears to be a legitimate Lithuanian insurance company website. However, the first inline script is a minified "capture.bundle.js" that raises significant concerns: (1) It uses eval() on remotely fetched script content, which is a classic vector for arbitrary code execution. (2) It registers a service worker with root scope, enabling interception of all page requests. (3) It continuously polls a remote server every 60 seconds. The BRIN scanner flagged critical threats for localStorage/sessionStorage data exfiltration and keylogging behavior.

When the malicious code is directly visible in the HTML, the model catches it. The eval() call, service worker registration, and "capture" bundle naming are clear signals.

### Example 4: Model catches fraudulent skill registration

**Brin verdict**: suspicious (score 49) -- credential exposure, supply chain
**Model verdict**: suspicious (confidence 0.72)

> Although the fetched content returned a 404, the artifact metadata provides strong signals warranting a block. The Brin scanner found 84 secret pattern matches in the source repository -- an extraordinarily high count for a skill/documentation repo. The presence of 4 unexpected binary files in what should be a text-based skill repository raises further concern. Combined with 12 install-script patterns and 12 remote-script patterns, the repository shows characteristics consistent with a supply-chain attack vector disguised as a helpful AI skill.

The model leverages metadata signals effectively when they point to concrete, interpretable patterns. Secret counts, binary files, and install scripts are signals the model can reason about.

### Example 5: Model misses blocklisted page (dangerous, score 0)

**Brin verdict**: dangerous (score 0) -- blocklist
**Model verdict**: safe

These artifacts have no reasoning to show -- the model saw benign HTML (often an empty GitHub Pages site or a generic business page) and had no way to know the URL appears on phishing or malware blocklists. This is the starkest example of the gap: Brin's intelligence database knows the URL is dangerous; the model only sees the current content.

### Example 6: Model misses contributor PR spray pattern

**Brin verdict**: suspicious (score 32) -- malicious new account, PR spray, unsolicited PR pattern
**Model verdict**: safe

> The model saw a GitHub profile and recent events that looked like normal open-source contribution activity.

Brin detected the behavioral pattern: a new account spraying unsolicited PRs across multiple repositories with a low merge rate and cross-repo rejections. The model cannot perform this kind of longitudinal behavioral analysis from a single API snapshot.

## Signal gap analysis

### Why graph signals are 100% missed

Graph signals capture relationships between artifacts: dependency chains, shared maintainers, cross-repository trust networks, package naming patterns relative to the ecosystem. A model processing one artifact at a time has no access to these relationships. This is a structural limitation -- not a prompt engineering problem.

### Why identity signals are 69.4% missed

Identity signals come from external databases: domain WHOIS records, blocklists, account creation dates relative to first activity, historical reputation scores. The model sees a snapshot of current content. It cannot check whether a domain was registered yesterday, whether an npm account was created hours before publishing, or whether a GitHub user has been flagged across multiple security databases.

### Why behavior signals are 60% missed

Behavior signals track how an artifact has behaved over time: install hooks that phone home, runtime patterns that change after initial scan, publishing velocity anomalies. The model sees a static content snapshot and can detect behavioral red flags only when they're encoded in visible text (like eval() calls or suspicious postinstall scripts).

### Why content signals are still 50.4% missed

Even on pure content analysis -- the model's strongest domain -- nearly half of threats are missed. This happens because:

1. **Truncation**: HTML pages are capped at 60,000 characters. Malicious payloads may exist beyond the cutoff.
2. **Obfuscation**: encoded payloads, base64 blobs, and minified JavaScript are hard to analyze from raw text.
3. **Context collapse**: standard analytics patterns (tracking pixels, sendBeacon, cookie reads) look identical whether they're benign first-party analytics or covert exfiltration. Brin uses cross-domain intelligence to distinguish them; the model cannot.
