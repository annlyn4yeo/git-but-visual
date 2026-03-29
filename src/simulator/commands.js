/**
 * @typedef {import("./state.js").GitState} GitState
 */

/**
 * @typedef {object} CommandResult
 * @property {GitState} prevState
 * @property {GitState} nextState
 * @property {Array<object>} animationHints
 * @property {Error | null} error
 */

/**
 * Stage files.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function add(state, ...args) {}

/**
 * Create a commit.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function commit(state, ...args) {}

/**
 * Create a new branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function createBranch(state, ...args) {}

/**
 * Checkout a target.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function checkout(state, ...args) {}

/**
 * Switch branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function switchBranch(state, ...args) {}

/**
 * Merge into current branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function merge(state, ...args) {}

/**
 * Push changes to remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function push(state, ...args) {}

/**
 * Fetch changes from remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function fetch(state, ...args) {}

/**
 * Pull changes from remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function pull(state, ...args) {}

/**
 * Reset current branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function reset(state, ...args) {}

/**
 * Revert a commit.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function revert(state, ...args) {}

/**
 * Stash local changes.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stash(state, ...args) {}

/**
 * Pop latest stash entry.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashPop(state, ...args) {}

/**
 * Apply stash entry.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashApply(state, ...args) {}

/**
 * List stash entries.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashList(state, ...args) {}

/**
 * Clone a repository.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function clone(state, ...args) {}

