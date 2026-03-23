import { deriveAllowOrBlock, normalizeModelVerdict } from "../model-classification.js";

export async function classifyWithMockDriver({ material }) {
  const haystack = material.text.toLowerCase();

  let verdict = "safe";
  const redFlags = [];

  if (
    haystack.includes("~/.ssh") ||
    haystack.includes("environment variable") ||
    haystack.includes("ignore previous instructions")
  ) {
    verdict = "dangerous";
    redFlags.push("prompt-injection");
  } else if (
    haystack.includes("postinstall") ||
    haystack.includes("curl") ||
    haystack.includes("dummy-exfil.invalid")
  ) {
    verdict = "suspicious";
    redFlags.push("shell-or-network-abuse");
  }

  return {
    normalized: normalizeModelVerdict({
      verdict,
      allow_or_block: deriveAllowOrBlock(verdict),
      confidence: verdict === "safe" ? 0.55 : 0.95,
      source_summary: "Mock driver result for local testing.",
      reasoning:
        verdict === "safe"
          ? "No obvious red flags in the supplied content."
          : "Synthetic probe instructions matched blocked behaviors.",
      red_flags: redFlags
    }),
    raw: {
      driver: "mock",
      matched_probe_signals: redFlags
    }
  };
}
