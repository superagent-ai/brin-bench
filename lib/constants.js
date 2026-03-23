export const PROJECT_SCHEMA_VERSION = "2026-03-21";

export const ARTIFACT_CATEGORIES = ["page", "domain", "skill", "repo", "npm", "contributor"];
export const ARTIFACT_TIERS = ["runtime_live", "synthetic_probe", "local_mirror", "brin_sourced"];
export const ARTIFACT_LABELS = ["safe", "malicious", "synthetic_probe"];
export const FRESHNESS_TIERS = ["established", "fresh", "not_applicable"];
export const VERDICTS = ["safe", "caution", "suspicious", "dangerous"];

export const DEFAULT_FRESHNESS_WINDOWS = {
  page: 60,
  domain: 60,
  skill: 60,
  repo: 60,
  npm: 60,
  contributor: 60
};

export const BRIN_ORIGINS = {
  page: "page",
  domain: "domain",
  skill: "skill",
  repo: "repo",
  npm: "npm",
  contributor: "contributor",
  pypi: "pypi",
  crate: "crate",
  mcp: "mcp"
};

export const RUN_DIRECTORY_PARTS = ["results", "runs"];

export const RUN_SUBDIRECTORIES = {
  manifest: ["manifest"],
  artifacts: ["artifacts"],
  model: ["model"],
  brin: ["brin"],
  logs: ["logs"],
  report: ["report"]
};

export const MODEL_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: VERDICTS
    },
    allow_or_block: {
      type: "string",
      enum: ["pass", "block"]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    source_summary: {
      type: "string"
    },
    reasoning: {
      type: "string"
    },
    red_flags: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: [
    "verdict",
    "allow_or_block",
    "confidence",
    "source_summary",
    "reasoning",
    "red_flags"
  ]
};

export const PROMPT_VERSION = "brin-truth-v1";
export const SHURU_POLICY_VERSION = "brin-truth-v1";
export const SHURU_CHECKPOINT = "brin-bench";
