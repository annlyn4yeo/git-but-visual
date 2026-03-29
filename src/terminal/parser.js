/**
 * @typedef {object} ParsedCommand
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string | boolean>} flags
 */

/**
 * @typedef {object} ParseError
 * @property {string} message
 * @property {string} rawInput
 */

/**
 * Tokenize command input while preserving quoted groups.
 * @param {string} input
 * @returns {{ tokens: string[] } | ParseError}
 */
function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    return { message: "Unterminated quoted string.", rawInput: input };
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return { tokens };
}

/**
 * Parse raw user terminal input.
 * @param {string} rawInput
 * @returns {ParsedCommand | ParseError}
 */
export function parseCommand(rawInput) {
  const normalizedInput = String(rawInput ?? "").trim();
  if (!normalizedInput) {
    return { message: "Empty command.", rawInput: String(rawInput ?? "") };
  }

  const tokenized = tokenize(normalizedInput);
  if ("message" in tokenized) {
    return tokenized;
  }

  const withoutGitPrefix =
    tokenized.tokens[0]?.toLowerCase() === "git" ? tokenized.tokens.slice(1) : tokenized.tokens;

  if (withoutGitPrefix.length === 0) {
    return { message: "Missing command after git prefix.", rawInput: normalizedInput };
  }

  const [commandToken, ...rest] = withoutGitPrefix;
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const args = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];

    if (token.startsWith("--")) {
      const [flagKey, flagValue] = token.slice(2).split("=", 2);
      if (!flagKey) {
        return { message: "Invalid long flag syntax.", rawInput: normalizedInput };
      }

      flags[flagKey] = flagValue === undefined ? true : flagValue;
      continue;
    }

    if (token === "-m") {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        return { message: "Flag -m requires a message value.", rawInput: normalizedInput };
      }

      flags.m = value;
      i += 1;
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const shortFlags = token.slice(1).split("");
      for (const shortFlag of shortFlags) {
        flags[shortFlag] = true;
      }
      continue;
    }

    args.push(token);
  }

  return {
    command: commandToken.toLowerCase(),
    args,
    flags,
  };
}
