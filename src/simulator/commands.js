import { GitSimulatorError, ERROR_CODES } from "./errors.js";
import { buildResult, HINT_TYPES } from "./result.js";
import { cloneState } from "./state.js";

/**
 * @typedef {import("./state.js").GitState} GitState
 */

/**
 * @typedef {import("./result.js").CommandResult} CommandResult
 */

/**
 * Deterministically create a 7-char lowercase hex hash using djb2.
 * @param {string} input
 * @returns {string}
 */
function createDeterministicHash(input) {
  let hash = 5381;

  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0").slice(0, 7);
}

/**
 * Validate branch identifier format.
 * @param {string} branchName
 * @returns {boolean}
 */
function isValidBranchIdentifier(branchName) {
  return /^[A-Za-z0-9/_-]+$/.test(branchName);
}

/**
 * Resolve commit hashes by exact or prefix match.
 * @param {Record<string, unknown>} commits
 * @param {string} target
 * @returns {string | null}
 */
function resolveCommitTarget(commits, target) {
  if (Object.hasOwn(commits, target)) {
    return target;
  }

  const matches = Object.keys(commits).filter((hash) => hash.startsWith(target));
  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

/**
 * Stage files.
 * @param {GitState} state
 * @param {string[]} fileArgs
 * @returns {CommandResult}
 */
export function add(state, fileArgs) {
  const nextState = cloneState(state);

  try {
    const args = Array.isArray(fileArgs) ? fileArgs : [];
    const stageAll = args.length === 1 && args[0] === ".";

    /** @type {Array<{name: string, status: string}>} */
    let filesToMove = [];

    if (stageAll) {
      filesToMove = [...nextState.workingDirectory];
    } else {
      const seenNames = new Set();

      filesToMove = args.map((name) => {
        if (seenNames.has(name)) {
          throw new GitSimulatorError(
            `File already staged: ${name}`,
            ERROR_CODES.FILE_ALREADY_STAGED,
            { filename: name },
          );
        }
        seenNames.add(name);

        const inStaging = nextState.stagingArea.some((file) => file.name === name);
        if (inStaging) {
          throw new GitSimulatorError(
            `File already staged: ${name}`,
            ERROR_CODES.FILE_ALREADY_STAGED,
            { filename: name },
          );
        }

        const existing = nextState.workingDirectory.find((file) => file.name === name);
        if (!existing) {
          throw new GitSimulatorError(
            `File not found: ${name}`,
            ERROR_CODES.FILE_NOT_FOUND,
            { filename: name },
          );
        }

        return existing;
      });
    }

    const fileNames = new Set(filesToMove.map((file) => file.name));

    nextState.workingDirectory = nextState.workingDirectory.filter((file) => !fileNames.has(file.name));
    nextState.stagingArea = [...nextState.stagingArea, ...filesToMove];
    nextState.log = [...nextState.log, { command: "add", timestamp: Date.now() }];

    const hints = [
      ...filesToMove.map((file) => ({
        type: HINT_TYPES.FILE_MOVED,
        file: file.name,
        from: "workingDirectory",
        to: "stagingArea",
      })),
      { type: HINT_TYPES.ZONE_UPDATED, zone: "workingDirectory" },
      { type: HINT_TYPES.ZONE_UPDATED, zone: "stagingArea" },
    ];

    return buildResult({
      prevState: state,
      nextState,
      hints,
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown add error"),
    });
  }
}

/**
 * Create a commit from staged files.
 * @param {GitState} state
 * @param {string} message
 * @returns {CommandResult}
 */
export function commit(state, message) {
  const nextState = cloneState(state);

  try {
    const trimmedMessage = String(message ?? "").trim();
    if (!trimmedMessage) {
      throw new GitSimulatorError(
        "Commit message cannot be empty.",
        ERROR_CODES.EMPTY_COMMIT_MESSAGE,
        { message },
      );
    }

    if (nextState.stagingArea.length === 0) {
      throw new GitSimulatorError("Nothing to commit.", ERROR_CODES.NOTHING_TO_COMMIT);
    }

    if (nextState.detached) {
      throw new GitSimulatorError(
        "Cannot commit while HEAD is detached.",
        ERROR_CODES.DETACHED_HEAD_OPERATION,
        { HEAD: nextState.HEAD },
      );
    }

    const currentBranch = nextState.HEAD;
    const parentHash = nextState.branches[currentBranch];
    const newHash = createDeterministicHash(`${trimmedMessage}|${parentHash ?? ""}`);
    const timestamp = Date.now();

    nextState.commits[newHash] = {
      hash: newHash,
      message: trimmedMessage,
      parents: parentHash ? [parentHash] : [],
      branch: currentBranch,
      timestamp,
    };

    nextState.branches[currentBranch] = newHash;
    nextState.stagingArea = [];
    nextState.log = [...nextState.log, { command: "commit", timestamp }];

    const hints = [
      {
        type: HINT_TYPES.COMMIT_CREATED,
        hash: newHash,
        message: trimmedMessage,
        parentHash,
      },
      {
        type: HINT_TYPES.HEAD_MOVED,
        from: parentHash,
        to: newHash,
        branch: currentBranch,
      },
      { type: HINT_TYPES.STAGING_CLEARED },
      { type: HINT_TYPES.ZONE_UPDATED, zone: "stagingArea" },
    ];

    return buildResult({
      prevState: state,
      nextState,
      hints,
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown commit error"),
    });
  }
}

/**
 * Create a new branch.
 * @param {GitState} state
 * @param {string} branchName
 * @returns {CommandResult}
 */
export function createBranch(state, branchName) {
  const nextState = cloneState(state);

  try {
    const normalizedBranchName = String(branchName ?? "").trim();
    if (!normalizedBranchName || !isValidBranchIdentifier(normalizedBranchName)) {
      throw new GitSimulatorError(
        "Invalid branch name. Use letters, numbers, hyphens, underscores, or forward slashes.",
        ERROR_CODES.BRANCH_NOT_FOUND,
        { branchName },
      );
    }

    if (Object.hasOwn(nextState.branches, normalizedBranchName)) {
      throw new GitSimulatorError(
        `Branch already exists: ${normalizedBranchName}`,
        ERROR_CODES.BRANCH_ALREADY_EXISTS,
        { branchName: normalizedBranchName },
      );
    }

    const currentHeadHash = nextState.detached
      ? nextState.HEAD
      : nextState.branches[nextState.HEAD];

    nextState.branches[normalizedBranchName] = currentHeadHash;
    nextState.log = [...nextState.log, { command: "branch", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        {
          type: HINT_TYPES.BRANCH_CREATED,
          branchName: normalizedBranchName,
          atHash: currentHeadHash,
        },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown createBranch error"),
    });
  }
}

/**
 * Checkout a target.
 * @param {GitState} state
 * @param {string} target
 * @returns {CommandResult}
 */
export function checkout(state, target) {
  const nextState = cloneState(state);

  try {
    const normalizedTarget = String(target ?? "").trim();
    const prevHEAD = state.HEAD;

    if (Object.hasOwn(nextState.branches, normalizedTarget)) {
      if (!nextState.detached && prevHEAD === normalizedTarget) {
        throw new GitSimulatorError(
          `Already on branch '${normalizedTarget}'.`,
          ERROR_CODES.ALREADY_ON_BRANCH,
          { target: normalizedTarget },
        );
      }

      nextState.HEAD = normalizedTarget;
      nextState.detached = false;
      nextState.log = [...nextState.log, { command: "checkout", timestamp: Date.now() }];

      return buildResult({
        prevState: state,
        nextState,
        hints: [
          {
            type: HINT_TYPES.BRANCH_SWITCHED,
            from: prevHEAD,
            to: normalizedTarget,
            detached: nextState.detached,
          },
          {
            type: HINT_TYPES.HEAD_MOVED,
            from: prevHEAD,
            to: normalizedTarget,
          },
        ],
      });
    }

    const resolvedHash = resolveCommitTarget(nextState.commits, normalizedTarget);
    if (resolvedHash) {
      nextState.HEAD = resolvedHash;
      nextState.detached = true;
      nextState.log = [...nextState.log, { command: "checkout", timestamp: Date.now() }];

      return buildResult({
        prevState: state,
        nextState,
        hints: [
          {
            type: HINT_TYPES.BRANCH_SWITCHED,
            from: prevHEAD,
            to: resolvedHash,
            detached: nextState.detached,
          },
          {
            type: HINT_TYPES.HEAD_MOVED,
            from: prevHEAD,
            to: resolvedHash,
          },
        ],
      });
    }

    throw new GitSimulatorError(
      `Branch or commit not found: ${normalizedTarget}`,
      ERROR_CODES.BRANCH_NOT_FOUND,
      { target: normalizedTarget },
    );
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown checkout error"),
    });
  }
}

/**
 * Switch branch.
 * @param {GitState} state
 * @param {string} branchName
 * @returns {CommandResult}
 */
export function switchBranch(state, branchName) {
  const nextState = cloneState(state);

  try {
    const normalizedBranchName = String(branchName ?? "").trim();
    const prevHEAD = state.HEAD;

    if (!Object.hasOwn(nextState.branches, normalizedBranchName)) {
      const commitMatch = resolveCommitTarget(nextState.commits, normalizedBranchName);
      if (commitMatch) {
        throw new GitSimulatorError(
          "use git checkout to detach HEAD to a specific commit",
          ERROR_CODES.DETACHED_HEAD_OPERATION,
          { target: normalizedBranchName },
        );
      }

      throw new GitSimulatorError(
        `Branch not found: ${normalizedBranchName}`,
        ERROR_CODES.BRANCH_NOT_FOUND,
        { target: normalizedBranchName },
      );
    }

    if (!nextState.detached && prevHEAD === normalizedBranchName) {
      throw new GitSimulatorError(
        `Already on branch '${normalizedBranchName}'.`,
        ERROR_CODES.ALREADY_ON_BRANCH,
        { target: normalizedBranchName },
      );
    }

    nextState.HEAD = normalizedBranchName;
    nextState.detached = false;
    nextState.log = [...nextState.log, { command: "switch", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        {
          type: HINT_TYPES.BRANCH_SWITCHED,
          from: prevHEAD,
          to: normalizedBranchName,
          detached: nextState.detached,
        },
        {
          type: HINT_TYPES.HEAD_MOVED,
          from: prevHEAD,
          to: normalizedBranchName,
        },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown switchBranch error"),
    });
  }
}

/**
 * Merge into current branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function merge(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Push changes to remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function push(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Fetch changes from remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function fetch(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Pull changes from remote.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function pull(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Reset current branch.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function reset(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Revert a commit.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function revert(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Stash local changes.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stash(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Pop latest stash entry.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashPop(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Apply stash entry.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashApply(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * List stash entries.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function stashList(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}

/**
 * Clone a repository.
 * @param {GitState} state
 * @param {...unknown} args
 * @returns {CommandResult}
 */
export function clone(state, ...args) {
  void args;
  return buildResult({ prevState: state, nextState: state });
}
