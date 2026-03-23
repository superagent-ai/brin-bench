import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchWithTrace } from "./http.js";
import { sha256Buffer } from "./hash.js";

function isHttpRef(value) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isFileRef(value) {
  return value.startsWith("file://");
}

export async function loadArtifactMaterial(requestedRef, options = {}) {
  if (isHttpRef(requestedRef)) {
    return fetchWithTrace(requestedRef, options);
  }

  const filePath = isFileRef(requestedRef)
    ? fileURLToPath(requestedRef)
    : path.resolve(process.cwd(), requestedRef);
  const body = await readFile(filePath);

  return {
    requested_url: requestedRef,
    resolved_url: `file://${filePath}`,
    method: "GET",
    status: 200,
    ok: true,
    headers: {
      "content-length": String(body.length)
    },
    fetched_at: new Date().toISOString(),
    content_hash: sha256Buffer(body),
    body,
    text: body.toString("utf8")
  };
}
