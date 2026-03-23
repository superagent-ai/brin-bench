import path from "node:path";
import { loadArtifactMaterial } from "./artifact-material.js";
import { VERDICTS } from "./constants.js";
import { writeJson, writeText } from "./io.js";

/**
 * @param {Headers} headers
 * @returns {number | null} milliseconds to wait, or null if header missing/invalid
 */
function parseRetryAfterMs(headers) {
  if (!headers || typeof headers.get !== "function") {
    return null;
  }
  const value = headers.get("retry-after");
  if (!value) {
    return null;
  }
  const asInt = Number.parseInt(value.trim(), 10);
  if (!Number.isNaN(asInt)) {
    return asInt * 1000;
  }
  const httpDate = Date.parse(value.trim());
  if (!Number.isNaN(httpDate)) {
    return Math.max(0, httpDate - Date.now());
  }
  return null;
}

/**
 * @param {string | undefined} apiKey
 * @param {Record<string, string>} base
 */
function withBrinAuthHeaders(apiKey, base) {
  if (!apiKey) {
    return base;
  }
  return {
    ...base,
    "X-API-Key": apiKey
  };
}

function normalizeVerdict(value) {
  if (typeof value !== "string") {
    return null;
  }
  return VERDICTS.includes(value) ? value : null;
}

function buildLookupUrl(baseUrl, artifact, { details = true, tolerance = "conservative", mode = "full" } = {}) {
  const origin = artifact.metadata.brin_origin;
  const identifier = artifact.metadata.brin_identifier;

  if (!origin || !identifier) {
    throw new Error(`Artifact ${artifact.artifact_id} is missing Brin lookup metadata`);
  }

  const encodedIdentifier = identifier
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = new URL(`${baseUrl.replace(/\/+$/u, "")}/${origin}/${encodedIdentifier}`);
  if (details) {
    url.searchParams.set("details", "true");
  }
  if (tolerance) {
    url.searchParams.set("tolerance", tolerance);
  }
  if (mode) {
    url.searchParams.set("mode", mode);
  }
  return url;
}

async function parseResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { text, json };
}

export async function runBrinLookup(
  artifact,
  {
    baseUrl = "https://api.brin.sh",
    details = true,
    tolerance = "conservative",
    mode = "full",
    apiKey = process.env.BRIN_API_KEY
  } = {}
) {
  const key = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined;

  if (artifact.category === "email") {
    const material = await loadArtifactMaterial(artifact.requested_ref);
    const url = new URL(`${baseUrl.replace(/\/+$/u, "")}/email`);
    if (details) {
      url.searchParams.set("details", "true");
    }
    if (tolerance) {
      url.searchParams.set("tolerance", tolerance);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: withBrinAuthHeaders(key, {
        "content-type": "message/rfc822"
      }),
      body: material.body
    });
    const parsed = await parseResponse(response);
    const retryAfterMs = parseRetryAfterMs(response.headers);

    return {
      artifact_id: artifact.artifact_id,
      category: artifact.category,
      requested_ref: artifact.requested_ref,
      brin_request: {
        method: "POST",
        url: url.toString()
      },
      input_capture: {
        requested_ref: material.requested_url,
        resolved_ref: material.resolved_url,
        fetched_at: material.fetched_at,
        content_hash: material.content_hash
      },
      status: response.status,
      retry_after_ms: retryAfterMs,
      verdict: normalizeVerdict(parsed.json?.verdict),
      score: parsed.json?.score ?? null,
      confidence: parsed.json?.confidence ?? null,
      raw_text: parsed.text,
      raw_json: parsed.json
    };
  }

  const url = buildLookupUrl(baseUrl, artifact, {
    details,
    tolerance,
    mode
  });
  const getHeaders = withBrinAuthHeaders(key, {});
  const response = await fetch(url, Object.keys(getHeaders).length ? { headers: getHeaders } : undefined);
  const parsed = await parseResponse(response);
  const retryAfterMs = parseRetryAfterMs(response.headers);

  return {
    artifact_id: artifact.artifact_id,
    category: artifact.category,
    requested_ref: artifact.requested_ref,
    brin_request: {
      method: "GET",
      url: url.toString()
    },
    input_capture: null,
    status: response.status,
    retry_after_ms: retryAfterMs,
    verdict: normalizeVerdict(parsed.json?.verdict),
    score: parsed.json?.score ?? null,
    confidence: parsed.json?.confidence ?? null,
    raw_text: parsed.text,
    raw_json: parsed.json
  };
}

export async function persistBrinResult(runContext, artifact, result) {
  const artifactDir = path.join(
    runContext.paths.brinDir,
    artifact.category,
    artifact.artifact_id
  );
  await writeJson(path.join(artifactDir, "result.json"), result);
  await writeText(path.join(artifactDir, "response.txt"), `${result.raw_text}\n`);
  return artifactDir;
}
