import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObjectFromText } from "../lib/model-drivers/cursor-agent.js";

test("extractJsonObjectFromText parses raw JSON", () => {
  const out = extractJsonObjectFromText(
    '{"verdict":"safe","allow_or_block":"pass","confidence":0.9,"source_summary":"x","reasoning":"y","red_flags":[]}'
  );
  assert.equal(out.verdict, "safe");
});

test("extractJsonObjectFromText parses fenced json", () => {
  const out = extractJsonObjectFromText(
    'Here:\n```json\n{"verdict":"caution","allow_or_block":"pass","confidence":0.5,"source_summary":"s","reasoning":"r","red_flags":["a"]}\n```'
  );
  assert.equal(out.verdict, "caution");
  assert.deepEqual(out.red_flags, ["a"]);
});

test("extractJsonObjectFromText finds object in prose", () => {
  const out = extractJsonObjectFromText(
    'Result: {"verdict":"dangerous","allow_or_block":"block","confidence":1,"source_summary":"","reasoning":"","red_flags":[]}'
  );
  assert.equal(out.verdict, "dangerous");
});
