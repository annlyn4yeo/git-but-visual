/**
 * @typedef {object} ParsedCommandSuccess
 * @property {true} ok
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string | boolean>} flags
 */

/**
 * @typedef {object} ParsedCommandFailure
 * @property {false} ok
 * @property {string} reason
 */

/**
 * @typedef {ParsedCommandSuccess | ParsedCommandFailure} ParsedCommandResult
 */

/**
 * @param {string} input
 * @returns {{ ok: true, tokens: string[] } | ParsedCommandFailure}
 */
function tokenize(input) {
  /** @type {string[]} */
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\" && i + 1 < input.length) {
      current += input[i + 1];
      i += 1;
      continue;
    }

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
    return { ok: false, reason: "Unterminated quoted string." };
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return { ok: true, tokens };
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isCommandLike(token) {
  return /^[A-Za-z][A-Za-z0-9:-]*$/.test(token);
}

/**
 * Parse raw user terminal input.
 * @param {string} rawInput
 * @returns {ParsedCommandResult}
 */
export function parseCommand(rawInput) {
  const normalizedInput = String(rawInput ?? "").trim();
  if (!normalizedInput) {
    return { ok: false, reason: "Empty input. Type a git command." };
  }

  const tokenized = tokenize(normalizedInput);
  if (!tokenized.ok) {
    return tokenized;
  }

  const tokens = tokenized.tokens;
  if (tokens.length === 0) {
    return { ok: false, reason: "Empty input. Type a git command." };
  }

  const hasGitPrefix = tokens[0].toLowerCase() === "git";
  const commandTokens = hasGitPrefix ? tokens.slice(1) : tokens;

  if (commandTokens.length === 0) {
    return {
      ok: false,
      reason: "Missing command after git. Did you mean git <command>?",
    };
  }

  if (!hasGitPrefix && !isCommandLike(commandTokens[0])) {
    return {
      ok: false,
      reason: `Input should start with a command. Did you mean git ${commandTokens[0]}?`,
    };
  }

  let command = commandTokens[0].toLowerCase();
  const rest = commandTokens.slice(1);

  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const args = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];

    if (token.startsWith("--")) {
      const [flagKey, flagValue] = token.slice(2).split("=", 2);
      if (!flagKey) {
        return { ok: false, reason: "Invalid long flag syntax." };
      }

      flags[flagKey] = flagValue === undefined ? true : flagValue;
      continue;
    }

    if (token === "-m") {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        return {
          ok: false,
          reason: 'Commit message missing. Use -m "your message".',
        };
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

  if (command === "commit" && Object.hasOwn(flags, "m")) {
    const message = String(flags.m ?? "").trim();
    if (!message) {
      return {
        ok: false,
        reason: 'Commit message missing. Use -m "your message".',
      };
    }
    flags.m = message;
  }

  if (command === "stash" && args.length > 0) {
    const subcommand = args[0].toLowerCase();
    if (
      subcommand === "pop" ||
      subcommand === "apply" ||
      subcommand === "list"
    ) {
      command = `stash:${subcommand}`;
      args.shift();
    }
  }

  return {
    ok: true,
    command,
    args,
    flags,
  };
}
