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
export function parseCommand(rawInput) {}

