#!/usr/bin/env node
/**
 * Lightweight prerequisite check for Shuru + Cursor (no VM boot, no model calls).
 * Run from the repo root: node scripts/check-shuru-setup.js
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import process from "node:process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ok(message) {
  console.log(message);
}

if (os.platform() !== "darwin") {
  fail("check-shuru-setup: requires macOS.");
}

if (os.arch() !== "arm64") {
  fail("check-shuru-setup: requires Apple Silicon (arm64). Shuru targets Apple Virtualization.framework on ARM.");
}

const shuruVersion = spawnSync("shuru", ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
if (shuruVersion.status !== 0 || shuruVersion.error) {
  fail(
    'check-shuru-setup: "shuru" not found or failed. Install: brew tap superhq-ai/tap && brew install shuru\nSee https://github.com/superhq-ai/shuru'
  );
}
ok(`check-shuru-setup: shuru OK (${String(shuruVersion.stdout || "").trim() || "version unknown"})`);

const checkpointList = spawnSync("shuru", ["checkpoint", "list"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
if (
  checkpointList.status !== 0 ||
  !String(checkpointList.stdout || "").includes("brin-bench")
) {
  fail(
    'check-shuru-setup: checkpoint "brin-bench" not found. Run: npm run setup:shuru'
  );
}
ok('check-shuru-setup: checkpoint "brin-bench" exists.');

const cliBinary = process.env.CURSOR_CLI || "agent";
if (cliBinary.includes("/") || cliBinary.includes("\\")) {
  if (!existsSync(cliBinary)) {
    fail(`check-shuru-setup: CURSOR_CLI points to missing file: ${cliBinary}`);
  }
} else {
  const which = spawnSync("which", [cliBinary], { encoding: "utf8" });
  if (which.status !== 0) {
    fail(
      `check-shuru-setup: Cursor CLI "${cliBinary}" not on PATH. Install the Cursor headless CLI or set CURSOR_CLI.`
    );
  }
}
ok(`check-shuru-setup: Cursor CLI OK (${cliBinary})`);

const key = process.env.CURSOR_API_KEY;
if (!key || !String(key).trim()) {
  fail(
    "check-shuru-setup: CURSOR_API_KEY is not set. Copy .env.example to .env and add your key, or export it in the shell."
  );
}
ok("check-shuru-setup: CURSOR_API_KEY is set.");

ok("check-shuru-setup: all prerequisite checks passed.");
