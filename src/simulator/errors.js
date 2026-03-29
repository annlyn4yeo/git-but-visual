/**
 * Known simulator error codes.
 */
export const ERROR_CODES = {
  FILE_NOT_FOUND: "",
  NOTHING_TO_COMMIT: "",
  BRANCH_NOT_FOUND: "",
  BRANCH_ALREADY_EXISTS: "",
  EMPTY_MESSAGE: "",
  CLEAN_WORKING_TREE: "",
};

export class GitSimulatorError extends Error {
  /**
   * @param {string} message Error message.
   * @param {string} code Error code.
   */
  constructor(message, code) {
    super(message);
    /** @type {string} */
    this.message = message;
    /** @type {string} */
    this.code = code;
  }
}

