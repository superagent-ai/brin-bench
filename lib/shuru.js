import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { SHURU_CHECKPOINT } from "./constants.js";

const CURSOR_DRIVER_HOSTS = [
  "api.cursor.com",
  "api2.cursor.sh",
  "api2direct.cursor.sh",
  "agentn.global.api5.cursor.sh",
  "repo42.cursor.sh",
  "staging.cursor.sh",
  "dev-staging.cursor.sh",
  "api.anthropic.com",
  "api.openai.com"
];

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function workspacePath(projectRoot, filePath) {
  const relativePath = path.relative(projectRoot, filePath);
  return path.posix.join("/workspace", relativePath.split(path.sep).join(path.posix.sep));
}

function buildChildEnv(extraEnv = {}) {
  return {
    ...process.env,
    ...extraEnv
  };
}

function isHttpRef(value) {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

async function resolveGuestHosts(taskFile) {
  const hosts = new Set();

  try {
    const task = JSON.parse(await readFile(taskFile, "utf8"));
    if (isHttpRef(task?.artifact?.requested_ref)) {
      hosts.add(new URL(task.artifact.requested_ref).hostname);
    }
    if (task?.driver === "cursor-agent") {
      for (const host of CURSOR_DRIVER_HOSTS) {
        hosts.add(host);
      }
    }
  } catch {
    return [];
  }

  const resolved = [];
  for (const host of hosts) {
    try {
      const { address } = await lookup(host, {
        family: 4
      });
      resolved.push(`${address} ${host}`);
    } catch {
      // Leave hosts unresolved rather than failing the entire task setup.
    }
  }

  return resolved;
}

export async function runModelTask({
  projectRoot,
  taskFile,
  useShuru = true,
  shuruCommand = "shuru",
  shuruCheckpoint = SHURU_CHECKPOINT,
  shuruConfig,
  nodeCommand = "node",
  extraEnv = {}
}) {
  if (!useShuru) {
    return runProcess(
      nodeCommand,
      ["scripts/run-model-artifact.js", "--task", taskFile],
      {
        cwd: projectRoot,
        env: buildChildEnv(extraEnv)
      }
    );
  }

  const shuruConfigPath = shuruConfig || path.join(projectRoot, "shuru.json");
  const mountSpec = `${projectRoot}:/workspace`;
  const guestTaskPath = workspacePath(projectRoot, taskFile);
  const guestHosts = await resolveGuestHosts(taskFile);

  const exportLines = Object.entries(extraEnv)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join(" && ");
  const envPrefix = exportLines ? `${exportLines} && ` : "";
  const hostPrefix = guestHosts.length
    ? `printf '%s\\n' ${guestHosts.map((entry) => shellQuote(entry)).join(" ")} >> /etc/hosts && `
    : "";

  const dnsSetup = "grep -q nameserver /etc/resolv.conf 2>/dev/null || echo 'nameserver 8.8.8.8' >> /etc/resolv.conf && ";
  const guestCommand = `${hostPrefix}${dnsSetup}${envPrefix}cd /workspace && ${nodeCommand} scripts/run-model-artifact.js --task ${shellQuote(
    guestTaskPath
  )}`;

  const shuruArgs = ["run"];
  if (shuruCheckpoint) {
    shuruArgs.push("--from", shuruCheckpoint);
  }
  shuruArgs.push(
    "--config",
    shuruConfigPath,
    "--allow-net",
    "--mount",
    mountSpec,
    "--",
    "sh",
    "-lc",
    guestCommand
  );

  return runProcess(
    shuruCommand,
    shuruArgs,
    {
      cwd: projectRoot,
      env: buildChildEnv(extraEnv)
    }
  );
}
