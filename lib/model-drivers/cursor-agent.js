import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  deriveAllowOrBlock,
  normalizeModelVerdict
} from "../model-classification.js";

const DEFAULT_MODEL = "claude-4.6-opus-high-thinking";

/**
 * Tracks streamed assistant text and deduplicates the final complete event
 * (same pattern as Cursor headless client in autonomy).
 */
class AssistantTextDedup {
  constructor() {
    this.accumulated = "";
  }

  isDuplicate(text) {
    if (text.length > 0 && this.accumulated.endsWith(text)) {
      return true;
    }
    this.accumulated += text;
    return false;
  }
}

function parseStreamJsonLine(line) {
  try {
    const event = JSON.parse(line);
    if (typeof event?.type !== "string") {
      return null;
    }
    return event;
  } catch {
    return null;
  }
}

function extractAssistantTextFromEvent(event) {
  const text = event.message?.content?.[0]?.text;
  return typeof text === "string" ? text : null;
}

/**
 * Pull the first JSON object from model output (handles ```json fences).
 */
export function extractJsonObjectFromText(text) {
  const trimmed = String(text).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }
  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object in model output");
  }
  let depth = 0;
  for (let i = start; i < trimmed.length; i += 1) {
    const c = trimmed[i];
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(trimmed.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unbalanced JSON in model output");
}

function buildClassificationPrompt({ promptText, userPrompt, promptSchema }) {
  const schemaJson = JSON.stringify(promptSchema, null, 2);
  return `System instructions:
${promptText}

Your response must be a single JSON object only (no markdown fences unless wrapping JSON), matching this schema:
${schemaJson}

User task:
${userPrompt}`;
}

function createChat({ cliBinary, workingDirectory, env }) {
  const args = ["--workspace", workingDirectory, "create-chat"];
  return new Promise((resolve, reject) => {
    const child = spawn(cliBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd: workingDirectory
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`create-chat timed out after 60s. stderr: ${stderr}`));
    }, 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const chatId = stdout.trim().split("\n").pop()?.trim();
      if (chatId && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(chatId);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`create-chat spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        const chatId = stdout.trim().split("\n").pop()?.trim();
        if (chatId) {
          resolve(chatId);
        } else {
          reject(new Error("create-chat returned empty output"));
        }
      } else {
        reject(new Error(`create-chat exited with code ${code}: ${stderr}`));
      }
    });
  });
}

function sendPromptStream({
  cliBinary,
  workingDirectory,
  sessionId,
  model,
  promptText,
  env
}) {
  const args = [
    "-p",
    "--force",
    "--approve-mcps",
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--resume",
    sessionId,
    "--workspace",
    workingDirectory,
    "--model",
    model,
    promptText
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(cliBinary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: workingDirectory
    });

    let stderr = "";
    let rlClosed = false;
    let exitCode = null;
    let settled = false;
    const dedup = new AssistantTextDedup();
    const assistantChunks = [];

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const rl = createInterface({ input: child.stdout });

    const trySettle = () => {
      if (settled || !rlClosed || exitCode === null) {
        return;
      }
      settled = true;
      const fullText = assistantChunks.join("");
      if (exitCode === 0) {
        resolve({ assistantText: fullText, stderr });
      } else {
        reject(
          new Error(
            `Cursor CLI exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      }
    };

    rl.on("line", (line) => {
      const event = parseStreamJsonLine(line);
      if (!event || event.type === "result") {
        return;
      }
      if (event.type === "assistant") {
        const text = extractAssistantTextFromEvent(event);
        if (typeof text === "string" && !dedup.isDuplicate(text)) {
          assistantChunks.push(text);
        }
      }
    });

    rl.on("close", () => {
      rlClosed = true;
      trySettle();
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Cursor CLI spawn error: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      exitCode = code ?? 1;
      trySettle();
    });
  });
}

function buildChildEnv(apiKey) {
  const env = { ...process.env };
  if (apiKey) {
    env.CURSOR_API_KEY = apiKey;
  }
  return env;
}

/**
 * Classify using Cursor headless CLI (`agent` by default), same flow as autonomy adam.
 */
export async function classifyWithCursorAgent({
  promptText,
  userPrompt,
  model,
  promptSchema
}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const apiKey = process.env.CURSOR_API_KEY;
  const cliBinary = process.env.CURSOR_CLI || "agent";
  const workingDirectory = process.cwd();

  const fullPrompt = buildClassificationPrompt({
    promptText,
    userPrompt,
    promptSchema
  });

  const env = buildChildEnv(apiKey);

  const sessionId = await createChat({
    cliBinary,
    workingDirectory,
    env
  });

  const { assistantText, stderr } = await sendPromptStream({
    cliBinary,
    workingDirectory,
    sessionId,
    model: resolvedModel,
    promptText: fullPrompt,
    env
  });

  let parsed;
  try {
    parsed = extractJsonObjectFromText(assistantText);
  } catch (err) {
    throw new Error(
      `Failed to parse model JSON: ${err instanceof Error ? err.message : String(err)}. Raw assistant text (truncated): ${assistantText.slice(0, 2000)}`
    );
  }

  const normalized = normalizeModelVerdict({
    ...parsed,
    allow_or_block:
      parsed?.allow_or_block || deriveAllowOrBlock(parsed?.verdict)
  });

  return {
    normalized,
    raw: {
      driver: "cursor-agent",
      session_id: sessionId,
      model: resolvedModel,
      stderr: stderr || undefined,
      assistant_text: assistantText
    }
  };
}
