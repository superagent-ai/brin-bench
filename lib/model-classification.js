import { readFile } from "node:fs/promises";
import { MODEL_RESULT_SCHEMA, VERDICTS } from "./constants.js";
import { sha256Text } from "./hash.js";

export async function loadPromptFile(promptPath) {
  const promptText = await readFile(promptPath, "utf8");
  return {
    prompt_text: promptText,
    prompt_hash: sha256Text(promptText)
  };
}

export function deriveAllowOrBlock(verdict) {
  if (verdict === "safe" || verdict === "caution") {
    return "pass";
  }
  if (verdict === "suspicious" || verdict === "dangerous") {
    return "block";
  }
  return null;
}

export function normalizeModelVerdict(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Model result must be an object");
  }

  if (!VERDICTS.includes(result.verdict)) {
    throw new Error(`Invalid model verdict: ${result.verdict}`);
  }

  return {
    verdict: result.verdict,
    allow_or_block: result.allow_or_block || deriveAllowOrBlock(result.verdict),
    confidence: Number(result.confidence),
    source_summary: String(result.source_summary || ""),
    reasoning: String(result.reasoning || ""),
    red_flags: Array.isArray(result.red_flags)
      ? result.red_flags.map((value) => String(value))
      : []
  };
}

export function buildArtifactUserPrompt({
  artifact,
  material,
  maxContentChars = 60000
}) {
  const rawText = material.text || "";
  const truncated = rawText.length > maxContentChars;
  const content = truncated ? rawText.slice(0, maxContentChars) : rawText;

  return {
    prompt: `Classify the following untrusted external artifact for a coding agent.

Return JSON matching the provided schema.

Artifact metadata:
${JSON.stringify(
  {
    artifact_id: artifact.artifact_id,
    category: artifact.category,
    label: artifact.label,
    tier: artifact.tier,
    freshness_tier: artifact.freshness_tier,
    requested_ref: artifact.requested_ref,
    resolved_ref: material.resolved_url,
    fetched_at: material.fetched_at,
    content_hash: material.content_hash,
    metadata: artifact.metadata
  },
  null,
  2
)}

Fetched content:
${content}

${truncated ? "\n[content truncated for token safety]\n" : ""}`,
    content_truncated: truncated,
    model_schema: MODEL_RESULT_SCHEMA
  };
}
