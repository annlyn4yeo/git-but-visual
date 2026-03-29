/**
 * @typedef {object} CommandResult
 * @property {import("./state.js").GitState} prevState
 * @property {import("./state.js").GitState} nextState
 * @property {Array<{type: string} & Record<string, unknown>>} animationHints
 * @property {Error | null} error
 */

export const HINT_TYPES = Object.freeze({
  FILE_MOVED: "FILE_MOVED",
  COMMIT_CREATED: "COMMIT_CREATED",
  HEAD_MOVED: "HEAD_MOVED",
  STAGING_CLEARED: "STAGING_CLEARED",
  ZONE_UPDATED: "ZONE_UPDATED",
  BRANCH_CREATED: "BRANCH_CREATED",
  BRANCH_SWITCHED: "BRANCH_SWITCHED",
  MERGE_COMMIT: "MERGE_COMMIT",
  FAST_FORWARD: "FAST_FORWARD",
  REMOTE_UPDATED: "REMOTE_UPDATED",
  TRACKING_UPDATED: "TRACKING_UPDATED",
  SYNC_PULSE: "SYNC_PULSE",
  RESET_PERFORMED: "RESET_PERFORMED",
  REVERT_COMMIT: "REVERT_COMMIT",
  STASH_PUSHED: "STASH_PUSHED",
  STASH_APPLIED: "STASH_APPLIED",
  STASH_POPPED: "STASH_POPPED",
  FILES_RESTORED: "FILES_RESTORED",
});

/**
 * Build a normalized command result payload.
 * @param {object} params
 * @param {import("./state.js").GitState} params.prevState
 * @param {import("./state.js").GitState} params.nextState
 * @param {Array<{type: string} & Record<string, unknown>>} [params.hints=[]]
 * @param {Error | null} [params.error=null]
 * @returns {Readonly<CommandResult>}
 */
export function buildResult({ prevState, nextState, hints = [], error = null }) {
  const normalizedHints = Array.isArray(hints) ? hints : [];

  for (const hint of normalizedHints) {
    if (!hint || typeof hint.type !== "string" || hint.type.length === 0) {
      throw new TypeError("Every hint object must include a non-empty string 'type' field.");
    }
  }

  const safeNextState = error ? prevState : nextState;
  const frozenHints = Object.freeze(normalizedHints.map((hint) => Object.freeze({ ...hint })));

  return Object.freeze({
    prevState,
    nextState: safeNextState,
    animationHints: frozenHints,
    error,
  });
}
