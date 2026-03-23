import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeText(filePath, text) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, text, "utf8");
  return filePath;
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJsonl(filePath, records) {
  await ensureDir(path.dirname(filePath));
  const lines = records.map((record) => JSON.stringify(record));
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

export async function appendJsonl(filePath, record) {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return filePath;
}

export async function readJsonl(filePath) {
  const contents = await readFile(filePath, "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function toSafeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
