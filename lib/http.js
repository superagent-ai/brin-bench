import { sha256Buffer } from "./hash.js";

function pickHeaders(headers) {
  const interesting = [
    "content-type",
    "content-length",
    "last-modified",
    "etag",
    "cache-control",
    "date",
    "location"
  ];

  const result = {};
  for (const key of interesting) {
    const value = headers.get(key);
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

export async function fetchWithTrace(url, { method = "GET", headers = {}, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      redirect: "follow",
      signal: controller.signal
    });

    const body = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());

    return {
      requested_url: url,
      resolved_url: response.url,
      method,
      status: response.status,
      ok: response.ok,
      headers: pickHeaders(response.headers),
      fetched_at: new Date().toISOString(),
      content_hash: body.length > 0 ? sha256Buffer(body) : null,
      body,
      text: body.length > 0 ? body.toString("utf8") : ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function headWithFallback(url, options = {}) {
  try {
    return await fetchWithTrace(url, {
      ...options,
      method: "HEAD"
    });
  } catch {
    return fetchWithTrace(url, {
      ...options,
      method: "GET",
      headers: {
        Range: "bytes=0-0",
        ...(options.headers || {})
      }
    });
  }
}
