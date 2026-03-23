export function parseArgs(argv) {
  const args = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }

    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }

    args[rawKey] = next;
    index += 1;
  }

  return { args, positionals };
}

export function requireArg(args, key) {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required argument --${key}`);
  }
  return value;
}

export function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer value, received ${value}`);
  }
  return parsed;
}
