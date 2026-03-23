import { createHash } from "node:crypto";

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

export function sha256Object(value) {
  return sha256Text(JSON.stringify(value));
}
