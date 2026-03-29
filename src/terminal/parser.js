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
 * Parse raw user terminal input.
 * @param {string} rawInput
 * @returns {ParsedCommand | ParseError}
 */
export function parseCommand(rawInput) {
  const normalizedInput = String(rawInput ?? "").trim();
  if (!normalizedInput) {
    return { message: "Empty command.", rawInput: String(rawInput ?? "") };
  }

  const tokens = normalizedInput.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const cleanedTokens = tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
  const withoutGitPrefix =
    cleanedTokens[0]?.toLowerCase() === "git" ? cleanedTokens.slice(1) : cleanedTokens;

  if (withoutGitPrefix.length === 0) {
    return { message: "Missing command after git prefix.", rawInput: normalizedInput };
  }

  const [commandToken, ...rest] = withoutGitPrefix;
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const args = [];

  for (const token of rest) {
    if (token.startsWith("--")) {
      const [flagKey, flagValue] = token.slice(2).split("=", 2);
      flags[flagKey] = flagValue === undefined ? true : flagValue;
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
