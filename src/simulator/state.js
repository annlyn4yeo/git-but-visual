const INITIAL_COMMIT_HASH = "e3a1f92";
const INITIAL_COMMIT_TIMESTAMP = 1704067200;

/**
 * @typedef {"modified" | "untracked" | "staged" | "deleted" | "renamed"} GitFileStatus
 */

/**
 * @typedef {object} GitFileEntry
 * @property {string} name File name.
 * @property {GitFileStatus} status File status in the current area.
 */

/**
 * @typedef {object} CommitObject
 * @property {string} hash Unique commit hash.
 * @property {string} message Commit message.
 * @property {string[]} parents Parent commit hashes.
 * @property {string} branch Branch name associated with commit creation.
 * @property {number} timestamp Unix timestamp (seconds).
 */

/**
 * @typedef {object} StashEntry
 * @property {string} id Stash entry identifier.
 * @property {string} message Human-readable stash message.
 * @property {GitFileEntry[]} files Snapshot of stashed files.
 * @property {number} timestamp Unix timestamp (seconds).
 */

/**
 * @typedef {object} RemoteConfig
 * @property {string} name Remote name.
 * @property {string} url Remote repository URL.
 * @property {boolean} connected Whether remote is reachable.
 */

/**
 * @typedef {object} CommandLogEntry
 * @property {string} command Command input as entered by user.
 * @property {number} timestamp Unix timestamp (seconds).
 */

/**
 * Canonical simulator state.
 * @typedef {object} GitState
 * @property {string} HEAD Current branch name, or commit hash when detached.
 * @property {boolean} detached Whether HEAD points directly to a commit hash.
 * @property {Record<string, string>} branches Local branch map: branchName -> commitHash.
 * @property {Record<string, string>} remoteBranches Remote branch map: branchName -> commitHash.
 * @property {Record<string, string>} trackingBranches Local tracking map: localBranch -> remoteBranch.
 * @property {Record<string, CommitObject>} commits Commit object map by hash.
 * @property {GitFileEntry[]} workingDirectory Current working directory file entries.
 * @property {GitFileEntry[]} stagingArea Current staging area entries.
 * @property {StashEntry[]} stash Stash entries with index 0 as most recent.
 * @property {RemoteConfig} remote Remote configuration.
 * @property {CommandLogEntry[]} log Append-only command log.
 */

/**
 * Deep freeze object graphs so snapshots are immutable by default.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return Object.freeze(value);
}

/**
 * Create the initial simulator state.
 * @returns {GitState}
 */
export function createInitialState() {
  const initialState = {
    HEAD: "main",
    detached: false,
    branches: {
      main: INITIAL_COMMIT_HASH,
    },
    remoteBranches: {
      main: INITIAL_COMMIT_HASH,
    },
    trackingBranches: {
      main: "origin/main",
    },
    commits: {
      [INITIAL_COMMIT_HASH]: {
        hash: INITIAL_COMMIT_HASH,
        message: "Initial commit",
        parents: [],
        branch: "main",
        timestamp: INITIAL_COMMIT_TIMESTAMP,
      },
    },
    workingDirectory: [
      { name: "app.js", status: "modified" },
      { name: "README.md", status: "untracked" },
      { name: "style.css", status: "modified" },
    ],
    stagingArea: [],
    stash: [],
    remote: {
      name: "origin",
      url: "https://github.com/user/gitvisual-demo.git",
      connected: true,
    },
    log: [],
  };

  return deepFreeze(initialState);
}

/**
 * Clone simulator state using the canonical deep-clone path.
 * @param {GitState} state
 * @returns {GitState}
 */
export function cloneState(state) {
  return structuredClone(state);
}
