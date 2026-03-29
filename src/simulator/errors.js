export const ERROR_CODES = Object.freeze({
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_ALREADY_STAGED: "FILE_ALREADY_STAGED",
  NOTHING_TO_COMMIT: "NOTHING_TO_COMMIT",
  NOTHING_TO_STASH: "NOTHING_TO_STASH",
  EMPTY_COMMIT_MESSAGE: "EMPTY_COMMIT_MESSAGE",
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
  BRANCH_ALREADY_EXISTS: "BRANCH_ALREADY_EXISTS",
  CANNOT_CHECKOUT_DIRTY: "CANNOT_CHECKOUT_DIRTY",
  ALREADY_ON_BRANCH: "ALREADY_ON_BRANCH",
  INVALID_RESET_TARGET: "INVALID_RESET_TARGET",
  NO_REMOTE_CONFIGURED: "NO_REMOTE_CONFIGURED",
  DETACHED_HEAD_OPERATION: "DETACHED_HEAD_OPERATION",
});

export class GitSimulatorError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {Record<string, unknown>} [context={}]
   */
  constructor(message, code, context = {}) {
    super(message);
    this.name = "GitSimulatorError";
    this.code = code;
    this.context = context;
  }
}
