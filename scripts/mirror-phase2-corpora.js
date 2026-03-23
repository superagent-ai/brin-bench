#!/usr/bin/env node

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "../lib/cli.js";
import { fetchWithTrace } from "../lib/http.js";
import { writeJson, writeText, toSafeSlug } from "../lib/io.js";

const MIRROR_BASE = "artifacts/phase2/mirror";

const OPENPHISH_FEED_URL = "https://openphish.com/feed.txt";
const NAZARIO_MBOX_URL = "https://monkey.org/~jose/phishing/phishing-2025";
const NAZARIO_MBOX_URL_FALLBACK = "https://monkey.org/~jose/phishing/phishing-2024";
const SKILLS_AUDITS_URL = "https://skills.sh/audits";
const TOXICSKILLS_TREE_URL =
  "https://api.github.com/repos/snyk-labs/toxicskills-goof/git/trees/main?recursive=1";
const TOXICSKILLS_RAW_BASE =
  "https://raw.githubusercontent.com/snyk-labs/toxicskills-goof/main";

const TARGET_WEB_MALICIOUS = 100;
const TARGET_EMAIL_MALICIOUS = 100;
const TARGET_SKILL_MALICIOUS = 50;
const TARGET_PACKAGE_MALICIOUS = 50;

function parseMbox(text) {
  const messages = [];
  const lines = text.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    if (line.startsWith("From ") && (current === null || current.length > 0)) {
      if (current !== null && current.length > 0) {
        messages.push(current.join("\n"));
      }
      current = [];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null && current.length > 0) {
    messages.push(current.join("\n"));
  }
  return messages;
}

function extractSubject(emlText) {
  const match = /^Subject:\s*(.+)$/im.exec(emlText);
  return match ? match[1].trim().slice(0, 120) : null;
}

function extractFrom(emlText) {
  const match = /^From:\s*(.+)$/im.exec(emlText);
  return match ? match[1].trim().slice(0, 120) : null;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": "brin-bench-phase2-mirror", ...options.headers },
    signal: options.signal
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchBuffer(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120_000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "brin-bench-phase2-mirror", ...options.headers },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function mirrorMaliciousWeb(projectRoot) {
  console.log("[mirror] Fetching OpenPhish phishing feed...");
  const feedText = await fetchText(OPENPHISH_FEED_URL);
  const urls = feedText
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));

  const outDir = path.join(projectRoot, MIRROR_BASE, "web-malicious");
  await mkdir(outDir, { recursive: true });

  const selected = urls.slice(0, Math.min(urls.length, TARGET_WEB_MALICIOUS * 2));
  const mirrored = [];

  for (const url of selected) {
    if (mirrored.length >= TARGET_WEB_MALICIOUS) break;
    const slug = toSafeSlug(url).slice(0, 60);
    const filePath = path.join(outDir, `${slug}.html`);
    const metaPath = path.join(outDir, `${slug}.meta.json`);

    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }

    let content = null;
    let fetchError = null;
    try {
      const trace = await fetchWithTrace(url, { timeoutMs: 10_000 });
      content = trace.text;
      await writeFile(filePath, content, "utf8");
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
      content = `<!-- Phishing page was offline at mirror time: ${url} -->\n<html><body><p>Phishing page (verified by OpenPhish): ${url}</p></body></html>`;
      await writeFile(filePath, content, "utf8");
    }

    const meta = {
      source: "openphish",
      original_url: url,
      hostname,
      local_path: filePath,
      fetched: !fetchError,
      fetch_error: fetchError,
      mirrored_at: new Date().toISOString()
    };
    await writeJson(metaPath, meta);
    mirrored.push(meta);
    if (mirrored.length % 20 === 0) {
      console.log(`[mirror] Web malicious: ${mirrored.length}/${TARGET_WEB_MALICIOUS}`);
    }
  }

  console.log(`[mirror] Web malicious: ${mirrored.length} mirrored (${mirrored.filter((m) => m.fetched).length} live)`);
  return mirrored;
}

async function mirrorMaliciousEmail(projectRoot) {
  console.log("[mirror] Downloading Nazario phishing corpus...");
  const outDir = path.join(projectRoot, MIRROR_BASE, "email-malicious");
  await mkdir(outDir, { recursive: true });

  let mboxBuffer;
  let mboxSource;
  try {
    mboxBuffer = await fetchBuffer(NAZARIO_MBOX_URL, { timeoutMs: 180_000 });
    mboxSource = NAZARIO_MBOX_URL;
    console.log(`[mirror] Downloaded ${(mboxBuffer.length / 1e6).toFixed(1)}MB from ${mboxSource}`);
  } catch {
    console.log("[mirror] Primary Nazario file unavailable, trying fallback...");
    mboxBuffer = await fetchBuffer(NAZARIO_MBOX_URL_FALLBACK, { timeoutMs: 180_000 });
    mboxSource = NAZARIO_MBOX_URL_FALLBACK;
    console.log(`[mirror] Downloaded ${(mboxBuffer.length / 1e6).toFixed(1)}MB from ${mboxSource}`);
  }

  const mboxText = mboxBuffer.toString("utf8");
  const messages = parseMbox(mboxText);
  console.log(`[mirror] Parsed ${messages.length} emails from mbox`);

  const mirrored = [];
  const usedSlugs = new Set();

  for (const emailText of messages) {
    if (mirrored.length >= TARGET_EMAIL_MALICIOUS) break;
    if (emailText.trim().length < 100) continue;

    const subject = extractSubject(emailText) || `phishing-${mirrored.length}`;
    let slug = toSafeSlug(subject).slice(0, 60);
    if (usedSlugs.has(slug)) {
      slug = `${slug}-${mirrored.length}`;
    }
    usedSlugs.add(slug);

    const filePath = path.join(outDir, `${slug}.eml`);
    await writeFile(filePath, emailText, "utf8");

    mirrored.push({
      source: "nazario",
      mbox_source: mboxSource,
      subject,
      from: extractFrom(emailText),
      local_path: filePath,
      mirrored_at: new Date().toISOString()
    });
  }

  console.log(`[mirror] Email malicious: ${mirrored.length} emails saved`);
  return mirrored;
}

async function mirrorMaliciousSkills(projectRoot) {
  console.log("[mirror] Fetching flagged skills from skills.sh + Snyk ToxicSkills...");
  const outDir = path.join(projectRoot, MIRROR_BASE, "skill-malicious");
  await mkdir(outDir, { recursive: true });

  const mirrored = [];

  const auditsHtml = await fetchText(SKILLS_AUDITS_URL);
  const anchorRegex = /<a[^>]+href="(?<href>\/[^"]+)"[^>]*>[\s\S]*?<\/a>/gu;
  const seen = new Set();

  for (const match of auditsHtml.matchAll(anchorRegex)) {
    if (mirrored.length >= TARGET_SKILL_MALICIOUS) break;
    const { href } = match.groups || {};
    const anchorHtml = match[0];
    const status = anchorHtml.includes(">High Risk</span>")
      ? "High Risk"
      : anchorHtml.includes(">Med Risk</span>")
        ? "Med Risk"
        : null;

    if (!href || !status || seen.has(href)) continue;
    seen.add(href);

    const identifier = href.replace(/^\/+/, "");
    const skillUrl = `https://skills.sh${href}`;
    const slug = toSafeSlug(identifier).slice(0, 60);
    const filePath = path.join(outDir, `${slug}.md`);

    let content;
    try {
      content = await fetchText(skillUrl);
    } catch {
      content = `# ${identifier}\n\n(Flagged as ${status} by skills.sh but content unavailable at mirror time)`;
    }

    await writeFile(filePath, content, "utf8");
    mirrored.push({
      source: "skills.sh",
      risk_level: status,
      identifier,
      skill_url: skillUrl,
      local_path: filePath,
      mirrored_at: new Date().toISOString()
    });
  }

  console.log(`[mirror] skills.sh flagged: ${mirrored.length}`);

  const treeData = await fetchText(TOXICSKILLS_TREE_URL);
  const tree = JSON.parse(treeData);
  const skillFiles = (tree.tree || [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        (entry.path.endsWith("SKILL.md") || entry.path.endsWith("skill.md"))
    )
    .map((entry) => entry.path);

  for (const skillPath of skillFiles) {
    if (mirrored.length >= TARGET_SKILL_MALICIOUS) break;
    const rawUrl = `${TOXICSKILLS_RAW_BASE}/${skillPath}`;
    const identifier = `snyk-toxicskills/${skillPath.replace(/\//g, "-")}`;
    const slug = toSafeSlug(identifier).slice(0, 60);

    if (seen.has(slug)) continue;
    seen.add(slug);

    const filePath = path.join(outDir, `${slug}.md`);
    let content;
    try {
      content = await fetchText(rawUrl);
    } catch {
      continue;
    }

    await writeFile(filePath, content, "utf8");
    mirrored.push({
      source: "snyk-toxicskills",
      github_path: skillPath,
      identifier,
      raw_url: rawUrl,
      local_path: filePath,
      mirrored_at: new Date().toISOString()
    });
  }

  console.log(`[mirror] Skill malicious total: ${mirrored.length}`);
  return mirrored;
}

async function mirrorMaliciousPackages(projectRoot) {
  console.log("[mirror] Fetching OSV MAL advisories for npm/PyPI...");
  const outDir = path.join(projectRoot, MIRROR_BASE, "package-malicious");
  await mkdir(outDir, { recursive: true });

  const mirrored = [];
  const maxId = 500;

  for (let year = 2025; year >= 2024 && mirrored.length < TARGET_PACKAGE_MALICIOUS; year--) {
    for (let i = 1; i <= maxId && mirrored.length < TARGET_PACKAGE_MALICIOUS; i++) {
      const vulnId = `MAL-${year}-${i}`;
      let data;
      try {
        const response = await fetch(`https://api.osv.dev/v1/vulns/${vulnId}`, {
          headers: { "user-agent": "brin-bench-phase2-mirror" }
        });
        if (!response.ok) continue;
        data = await response.json();
      } catch {
        continue;
      }

      const affected = data.affected?.[0];
      const ecosystem = affected?.package?.ecosystem;
      const packageName = affected?.package?.name;

      if (!ecosystem || !packageName) continue;
      if (ecosystem !== "npm" && ecosystem !== "PyPI") continue;

      const slug = toSafeSlug(`${ecosystem}-${packageName}`).slice(0, 60);
      const filePath = path.join(outDir, `${slug}.json`);

      let registryMeta = null;
      try {
        const registryUrl =
          ecosystem === "npm"
            ? `https://registry.npmjs.org/${encodeURIComponent(packageName)}`
            : `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
        const resp = await fetch(registryUrl, {
          headers: { "user-agent": "brin-bench-phase2-mirror" }
        });
        if (resp.ok) {
          registryMeta = await resp.json();
        }
      } catch {
        // Package may have been removed from registry.
      }

      const mirrorData = {
        osv_id: vulnId,
        ecosystem,
        package_name: packageName,
        summary: data.summary || null,
        details: data.details || null,
        severity: data.database_specific?.severity || null,
        affected_versions: affected?.versions || [],
        registry_metadata: registryMeta
          ? { available: true, name: packageName }
          : { available: false }
      };

      await writeJson(filePath, mirrorData);
      mirrored.push({
        source: "osv",
        osv_id: vulnId,
        ecosystem,
        package_name: packageName,
        local_path: filePath,
        mirrored_at: new Date().toISOString()
      });

      if (mirrored.length % 10 === 0) {
        console.log(
          `[mirror] Package malicious: ${mirrored.length}/${TARGET_PACKAGE_MALICIOUS}`
        );
      }
    }
  }

  console.log(`[mirror] Package malicious: ${mirrored.length} mirrored`);
  return mirrored;
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const summaryPath = path.join(
    projectRoot,
    args.summary || `${MIRROR_BASE}/mirror-summary.json`
  );

  const [web, email, skill, packageResults] = await Promise.all([
    mirrorMaliciousWeb(projectRoot),
    mirrorMaliciousEmail(projectRoot),
    mirrorMaliciousSkills(projectRoot),
    mirrorMaliciousPackages(projectRoot)
  ]);

  const summary = {
    mirrored_at: new Date().toISOString(),
    counts: {
      web_malicious: web.length,
      email_malicious: email.length,
      skill_malicious: skill.length,
      package_malicious: packageResults.length,
      total_malicious: web.length + email.length + skill.length + packageResults.length
    },
    web,
    email,
    skill,
    package: packageResults
  };

  await writeJson(summaryPath, summary);
  console.log(JSON.stringify({ summary_path: summaryPath, counts: summary.counts }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
