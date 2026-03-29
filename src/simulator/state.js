/**
 * @typedef {object} GitFile
 * @property {string} path
 * @property {string} status
 */

/**
 * @typedef {object} GitCommit
 * @property {string} hash
 * @property {string} message
 * @property {string | null} parent
 * @property {number} timestamp
 */

/**
 * @typedef {object} GitBranch
 * @property {string} name
 * @property {string | null} head
 */

/**
 * @typedef {object} GitRemoteState
 * @property {Record<string, GitBranch>} branches
 * @property {string} currentBranch
 */

/**
 * @typedef {object} GitState
 * @property {GitFile[]} workingDirectory
 * @property {GitFile[]} stagingArea
 * @property {Record<string, GitCommit>} commits
 * @property {Record<string, GitBranch>} branches
 * @property {string} currentBranch
 * @property {GitRemoteState} remote
 * @property {GitFile[][]} stash
 * @property {string[]} commandHistory
 */

/**
 * Create the initial simulator state.
 * @returns {GitState}
 */
export function createInitialState() {}

