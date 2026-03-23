#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SHURU_CHECKPOINT } from "../lib/constants.js";

const ENDPOINT_HOST = "am.i.mullvad.net";
const ENDPOINT_PATH = "/json";
const DEFAULT_TIMEOUT_SECONDS = 20;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(projectRoot, "shuru-unrestricted.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ok(message) {
  console.log(message);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exit_code: code ?? 0,
        stdout,
        stderr
      });
    });
  });
}

function parseArgs(argv) {
  const options = {
    checkpoint: SHURU_CHECKPOINT,
    config: defaultConfigPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--checkpoint") {
      options.checkpoint = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/confirm-vpn-routing.js [--checkpoint <name>] [--config <path>]",
          "",
          "Confirms that the host and Shuru guest egress through the same Mullvad exit IP."
        ].join("\n")
      );
      process.exit(0);
    }
    fail(`confirm-vpn-routing: unknown argument "${arg}"`);
  }

  if (!options.checkpoint) {
    fail("confirm-vpn-routing: --checkpoint requires a value.");
  }
  if (!options.config) {
    fail("confirm-vpn-routing: --config requires a value.");
  }

  return options;
}

function endpointUrl() {
  return `https://${ENDPOINT_HOST}${ENDPOINT_PATH}`;
}

function curlArgs(resolvedIp) {
  return [
    "-sS",
    "-f",
    "--max-time",
    String(DEFAULT_TIMEOUT_SECONDS),
    "--resolve",
    `${ENDPOINT_HOST}:443:${resolvedIp}`,
    endpointUrl()
  ];
}

function parseStatus(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label}: expected JSON from ${endpointUrl()}, got: ${stdout.trim()}`);
  }
}

async function fetchHostStatus(resolvedIp) {
  const result = await runProcess("curl", curlArgs(resolvedIp));
  if (result.exit_code !== 0) {
    throw new Error(`host curl failed: ${result.stderr || result.stdout}`);
  }
  return parseStatus(result.stdout, "host");
}

async function fetchGuestStatus({ checkpoint, config, resolvedIp }) {
  const result = await runProcess("shuru", [
    "run",
    "--from",
    checkpoint,
    "--config",
    config,
    "--allow-net",
    "--",
    "curl",
    ...curlArgs(resolvedIp)
  ]);

  if (result.exit_code !== 0) {
    throw new Error(`guest curl failed: ${result.stderr || result.stdout}`);
  }
  return parseStatus(result.stdout, "guest");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolved = await lookup(ENDPOINT_HOST, { family: 4 });

  ok(`confirm-vpn-routing: using ${ENDPOINT_HOST} at ${resolved.address} (resolved on host).`);

  // Resolve on the host and pin the HTTPS connection so verification does not depend on guest DNS.
  const [hostStatus, guestStatus] = await Promise.all([
    fetchHostStatus(resolved.address),
    fetchGuestStatus({
      checkpoint: options.checkpoint,
      config: options.config,
      resolvedIp: resolved.address
    })
  ]);

  ok(
    `confirm-vpn-routing: host ip=${hostStatus.ip} guest ip=${guestStatus.ip} host_exit=${hostStatus.mullvad_exit_ip} guest_exit=${guestStatus.mullvad_exit_ip}`
  );

  if (hostStatus.ip !== guestStatus.ip) {
    fail("confirm-vpn-routing: host and guest egress IPs differ.");
  }

  if (!hostStatus.mullvad_exit_ip || !guestStatus.mullvad_exit_ip) {
    fail("confirm-vpn-routing: expected both host and guest to report a Mullvad exit IP.");
  }

  ok(
    `confirm-vpn-routing: confirmed shared Mullvad exit ${hostStatus.ip} (${hostStatus.country}, ${hostStatus.city}).`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
