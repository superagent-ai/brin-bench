import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  PROJECT_SCHEMA_VERSION,
  RUN_DIRECTORY_PARTS,
  RUN_SUBDIRECTORIES
} from "./constants.js";
import { appendJsonl, ensureDir, writeJson, writeJsonl } from "./io.js";

const execFileAsync = promisify(execFile);

async function getGitValue(projectRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectRoot
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getGitMetadata(projectRoot) {
  const [commit, branch, status] = await Promise.all([
    getGitValue(projectRoot, ["rev-parse", "HEAD"]),
    getGitValue(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    getGitValue(projectRoot, ["status", "--short"])
  ]);

  return {
    commit,
    branch,
    dirty: Boolean(status),
    status
  };
}

function buildRunId(runKind) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${runKind}-${randomUUID().slice(0, 8)}`;
}

export async function createRunContext({
  projectRoot,
  runKind,
  phase,
  promptVersion,
  model,
  shuruPolicyVersion,
  sourceConfigPath,
  recencyWindowDefinition = {},
  manifest = []
}) {
  const runId = buildRunId(runKind);
  const runDir = path.join(projectRoot, ...RUN_DIRECTORY_PARTS, runId);

  await Promise.all(
    Object.values(RUN_SUBDIRECTORIES).map((parts) =>
      ensureDir(path.join(runDir, ...parts))
    )
  );

  const ledger = {
    schema_version: PROJECT_SCHEMA_VERSION,
    run_id: runId,
    run_kind: runKind,
    phase,
    created_at: new Date().toISOString(),
    prompt_version: promptVersion,
    model,
    shuru_policy_version: shuruPolicyVersion,
    source_config_path: sourceConfigPath || null,
    recency_window_definition: recencyWindowDefinition,
    git: await getGitMetadata(projectRoot),
    artifact_manifest_summary: {
      total: manifest.length,
      artifacts: manifest.map((artifact) => ({
        artifact_id: artifact.artifact_id,
        category: artifact.category,
        tier: artifact.tier,
        freshness_tier: artifact.freshness_tier,
        label: artifact.label,
        requested_ref: artifact.requested_ref,
        resolved_ref: artifact.resolved_ref
      }))
    },
    finished_at: null
  };

  const paths = {
    runDir,
    manifestDir: path.join(runDir, "manifest"),
    artifactsDir: path.join(runDir, "artifacts"),
    modelDir: path.join(runDir, "model"),
    brinDir: path.join(runDir, "brin"),
    logsDir: path.join(runDir, "logs"),
    reportDir: path.join(runDir, "report"),
    ledger: path.join(runDir, "logs", "run.json"),
    events: path.join(runDir, "logs", "events.jsonl")
  };

  await writeJson(paths.ledger, ledger);

  return {
    runId,
    runDir,
    paths,
    ledger
  };
}

export async function writeManifestSnapshot(runContext, artifacts, fileName = "artifacts.jsonl") {
  const manifestPath = path.join(runContext.paths.manifestDir, fileName);
  await writeJsonl(manifestPath, artifacts);
  return manifestPath;
}

export async function appendRunEvent(runContext, type, data) {
  return appendJsonl(runContext.paths.events, {
    timestamp: new Date().toISOString(),
    type,
    data
  });
}

export async function updateLedger(runContext, patch) {
  runContext.ledger = {
    ...runContext.ledger,
    ...patch
  };
  await writeJson(runContext.paths.ledger, runContext.ledger);
  return runContext.ledger;
}

export async function finalizeRun(runContext, patch = {}) {
  return updateLedger(runContext, {
    ...patch,
    finished_at: new Date().toISOString()
  });
}
