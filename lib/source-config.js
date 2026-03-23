import { PROJECT_SCHEMA_VERSION } from "./constants.js";
import { readJson } from "./io.js";

export async function loadSourceConfig(configPath) {
  const config = await readJson(configPath);
  if (config.schema_version && config.schema_version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported source config schema ${config.schema_version}; expected ${PROJECT_SCHEMA_VERSION}`
    );
  }
  return config;
}

export function getFreshnessWindow(config, category, fallback = 60) {
  return config.freshness_windows?.[category] ?? fallback;
}
