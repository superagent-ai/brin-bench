import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, readJsonl } from "../lib/io.js";
import { runModelTask } from "../lib/shuru.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("phase1 shuru policy blocks dangerous capabilities", async () => {
  const policy = await readJson(path.join(projectRoot, "shuru", "policy.json"));
  const shuruConfig = await readJson(path.join(projectRoot, "shuru.json"));

  assert.equal(policy.version, "phase1-v1");
  assert.ok(policy.blocked_actions.includes("shell_execution"));
  assert.ok(policy.blocked_actions.includes("host_filesystem_access"));
  assert.equal(policy.cursor.driver, "cursor-agent");
  assert.ok(Array.isArray(policy.cursor.notes));

  assert.ok(Array.isArray(shuruConfig.network.allow));
  assert.ok(shuruConfig.network.allow.includes("api.anthropic.com"));
  assert.ok(shuruConfig.network.allow.includes("api.cursor.com"));
  assert.ok(shuruConfig.network.allow.includes("skills.sh"));
  assert.ok(shuruConfig.secrets.ANTHROPIC_API_KEY);
  assert.ok(shuruConfig.secrets.CURSOR_API_KEY);
});

test("runModelTask uses shuru with allow-net and a workspace mount", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "brin-bench-shuru-"));
  const fakeShuruPath = path.join(tempDir, "fake-shuru.js");
  const fakeLogPath = path.join(tempDir, "fake-shuru-log.json");
  const taskFile = path.join(projectRoot, "artifacts", "probes", "generated", "check", "synthetic-probes.jsonl");

  await writeFile(
    fakeShuruPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_SHURU_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  env: {}
}, null, 2));
process.stdout.write(JSON.stringify({ ok: true }));
`,
    "utf8"
  );
  await chmod(fakeShuruPath, 0o755);

  const result = await runModelTask({
    projectRoot,
    taskFile,
    shuruCommand: fakeShuruPath,
    extraEnv: {
      FAKE_SHURU_LOG: fakeLogPath
    }
  });

  assert.equal(result.exit_code, 0);
  assert.equal(result.stdout, JSON.stringify({ ok: true }));

  const log = await readJson(fakeLogPath);
  assert.equal(log.argv[0], "run");
  assert.ok(log.argv.includes("--from"));
  assert.ok(log.argv.includes("brin-bench"));
  assert.ok(log.argv.includes("--config"));
  assert.ok(log.argv.includes(path.join(projectRoot, "shuru.json")));
  assert.ok(log.argv.includes("--allow-net"));
  assert.ok(log.argv.includes("--mount"));
  assert.ok(log.argv.includes(`${projectRoot}:/workspace`));
});

test("synthetic probes stay local and classify without leaking unrelated host data", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "brin-bench-probes-"));
  const probesDir = path.join(tempDir, "probes");
  const secretFile = path.join(tempDir, "sentinel-secret.txt");
  const taskFile = path.join(tempDir, "task.json");

  await writeFile(secretFile, "THIS_SHOULD_NEVER_APPEAR_IN_OUTPUT", "utf8");

  await execFileAsync("node", ["scripts/generate-safety-probes.js", "--outdir", probesDir], {
    cwd: projectRoot
  });

  const manifest = await readJsonl(path.join(probesDir, "synthetic-probes.jsonl"));
  const probe = manifest.find((entry) => entry.artifact_id === "probe-web-hidden-exfil");
  assert.ok(probe);

  await writeFile(
    taskFile,
    JSON.stringify(
      {
        artifact: probe,
        prompt_path: path.join(projectRoot, "prompts", "model-only-detection.md"),
        model: null,
        driver: "mock",
        fetch_timeout_ms: 1000,
        max_content_chars: 60000
      },
      null,
      2
    ),
    "utf8"
  );

  const { stdout } = await execFileAsync("node", ["scripts/run-model-artifact.js", "--task", taskFile], {
    cwd: projectRoot
  });
  const output = JSON.parse(stdout);

  assert.equal(output.classification.verdict, "dangerous");
  assert.equal(output.classification.allow_or_block, "block");
  assert.match(output.classification.red_flags.join(","), /prompt-injection/);
  assert.doesNotMatch(stdout, /THIS_SHOULD_NEVER_APPEAR_IN_OUTPUT/);
});
