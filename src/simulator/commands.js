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
 * Resolve a branch-like reference to a commit hash.
 * Supports local branches, remote branch keys, and refs like origin/main.
 * @param {GitState} state
 * @param {string} refName
 * @returns {string | null}
 */
function resolveBranchRefHash(state, refName) {
  if (Object.hasOwn(state.branches, refName)) {
    return state.branches[refName];
  }

  if (Object.hasOwn(state.remoteBranches, refName)) {
    return state.remoteBranches[refName];
  }

  const prefix = `${state.remote.name}/`;
  if (refName.startsWith(prefix)) {
    const remoteBranchName = refName.slice(prefix.length);
    if (Object.hasOwn(state.remoteBranches, remoteBranchName)) {
      return state.remoteBranches[remoteBranchName];
    }
  }

  return null;
}

/**
 * Return true when candidateHash appears in targetHash ancestry.
 * @param {Record<string, {parents?: string[]}>} commits
 * @param {string} candidateHash
 * @param {string} targetHash
 * @returns {boolean}
 */
function isAncestor(commits, candidateHash, targetHash) {
  if (!candidateHash || !targetHash || !Object.hasOwn(commits, targetHash)) {
    return false;
  }

  const stack = [targetHash];
  const visited = new Set();

  while (stack.length > 0) {
    const currentHash = stack.pop();
    if (!currentHash || visited.has(currentHash)) {
      continue;
    }

    if (currentHash === candidateHash) {
      return true;
    }

    visited.add(currentHash);
    const commit = commits[currentHash];
    if (!commit || !Array.isArray(commit.parents)) {
      continue;
    }

    for (const parentHash of commit.parents) {
      if (parentHash && !visited.has(parentHash)) {
        stack.push(parentHash);
      }
    }
  }

  return false;
}

/**
 * Apply merge updates to a mutable cloned state.
 * @param {GitState} nextState
 * @param {string} sourceBranchName
 * @returns {Array<object>}
 */
function applyMerge(nextState, sourceBranchName) {
  if (nextState.detached) {
    throw new GitSimulatorError(
      "Cannot merge while HEAD is detached.",
      ERROR_CODES.DETACHED_HEAD_OPERATION,
      { HEAD: nextState.HEAD },
    );
  }

  const currentBranch = nextState.HEAD;
  const normalizedSource = String(sourceBranchName ?? "").trim();
  if (!normalizedSource) {
    throw new GitSimulatorError("Source branch is required for merge.", ERROR_CODES.BRANCH_NOT_FOUND, {
      sourceBranchName,
    });
  }

  if (normalizedSource === currentBranch) {
    throw new GitSimulatorError("cannot merge a branch into itself", ERROR_CODES.BRANCH_ALREADY_EXISTS, {
      sourceBranchName: normalizedSource,
    });
  }

  const sourceBranchHash = resolveBranchRefHash(nextState, normalizedSource);
  if (!sourceBranchHash) {
    throw new GitSimulatorError(`Branch not found: ${normalizedSource}`, ERROR_CODES.BRANCH_NOT_FOUND, {
      sourceBranchName: normalizedSource,
    });
  }

  const currentHeadHash = nextState.branches[currentBranch];
  const now = Date.now();
  nextState.log = [...nextState.log, { command: "merge", timestamp: now }];

  if (isAncestor(nextState.commits, currentHeadHash, sourceBranchHash)) {
    nextState.branches[currentBranch] = sourceBranchHash;

    return [
      {
        type: HINT_TYPES.FAST_FORWARD,
        branch: currentBranch,
        fromHash: currentHeadHash,
        toHash: sourceBranchHash,
        sourceBranch: normalizedSource,
      },
      {
        type: HINT_TYPES.HEAD_MOVED,
        from: currentHeadHash,
        to: sourceBranchHash,
        branch: currentBranch,
      },
    ];
  }

  const message = `Merge branch '${normalizedSource}'`;
  const mergeHash = createDeterministicHash(`${message}|${currentHeadHash}|${sourceBranchHash}`);

  nextState.commits[mergeHash] = {
    hash: mergeHash,
    message,
    parents: [currentHeadHash, sourceBranchHash],
    branch: currentBranch,
    timestamp: now,
  };

  nextState.branches[currentBranch] = mergeHash;

  return [
    {
      type: HINT_TYPES.MERGE_COMMIT,
      hash: mergeHash,
      parents: [currentHeadHash, sourceBranchHash],
      sourceBranch: normalizedSource,
    },
    {
      type: HINT_TYPES.HEAD_MOVED,
      from: currentHeadHash,
      to: mergeHash,
      branch: currentBranch,
    },
  ];
}

/**
 * Apply fetch updates to a mutable cloned state.
 * @param {GitState} nextState
 * @param {"fetch" | "pull"} pulseDirection
 * @returns {Array<object>}
 */
function applyFetch(nextState, pulseDirection) {
  if (!nextState.remote.connected) {
    throw new GitSimulatorError(
      "No remote configured or remote is disconnected.",
      ERROR_CODES.NO_REMOTE_CONFIGURED,
    );
  }

  if (nextState.detached) {
    throw new GitSimulatorError(
      "Cannot fetch while HEAD is detached.",
      ERROR_CODES.DETACHED_HEAD_OPERATION,
      { HEAD: nextState.HEAD },
    );
  }

  const branch = nextState.HEAD;
  const localHash = nextState.branches[branch];
  const currentRemoteHash = nextState.remoteBranches[branch] ?? localHash;

  let fetchedHash = currentRemoteHash;

  // Simulate teammates pushing one new commit only when local and remote are aligned.
  if (currentRemoteHash === localHash) {
    const message = "Remote: update from origin";
    let syntheticHash = createDeterministicHash(`remote|${branch}|${currentRemoteHash}|${message}`);
    let suffix = 1;

    while (Object.hasOwn(nextState.commits, syntheticHash)) {
      syntheticHash = createDeterministicHash(
        `remote|${branch}|${currentRemoteHash}|${message}|${suffix}`,
      );
      suffix += 1;
    }

    fetchedHash = syntheticHash;
    nextState.commits[syntheticHash] = {
      hash: syntheticHash,
      message,
      parents: currentRemoteHash ? [currentRemoteHash] : [],
      branch,
      timestamp: Date.now(),
    };
    nextState.remoteBranches[branch] = syntheticHash;
  }

  const trackingRef = `${nextState.remote.name}/${branch}`;
  nextState.trackingBranches[branch] = trackingRef;
  nextState.log = [...nextState.log, { command: "fetch", timestamp: Date.now() }];

  return [
    {
      type: HINT_TYPES.TRACKING_UPDATED,
      branch,
      newHash: fetchedHash,
    },
    {
      type: HINT_TYPES.SYNC_PULSE,
      direction: pulseDirection,
      branch,
      hash: fetchedHash,
    },
  ];
}

/**
 * Resolve current HEAD to a commit hash.
 * @param {GitState} state
 * @returns {string}
 */
function getCurrentHeadHash(state) {
  return state.detached ? state.HEAD : state.branches[state.HEAD];
}

/**
 * Resolve reset target supporting raw hashes and HEAD~n refs.
 * @param {GitState} state
 * @param {string} target
 * @returns {string}
 */
function resolveResetTargetHash(state, target) {
  const normalizedTarget = String(target ?? "").trim();
  if (!normalizedTarget) {
    throw new GitSimulatorError("Invalid reset target.", ERROR_CODES.INVALID_RESET_TARGET, { target });
  }

  if (normalizedTarget.startsWith("HEAD")) {
    const match = /^HEAD(?:~([1-5]))?$/.exec(normalizedTarget);
    if (!match) {
      throw new GitSimulatorError("Invalid reset target.", ERROR_CODES.INVALID_RESET_TARGET, {
        target: normalizedTarget,
      });
    }

    const steps = Number(match[1] ?? "0");
    let hash = getCurrentHeadHash(state);

    for (let step = 0; step < steps; step += 1) {
      const commit = state.commits[hash];
      const nextParent = commit?.parents?.[0];
      if (!nextParent) {
        throw new GitSimulatorError("Invalid reset target.", ERROR_CODES.INVALID_RESET_TARGET, {
          target: normalizedTarget,
        });
      }
      hash = nextParent;
    }

    return hash;
  }

  const resolvedHash = resolveCommitTarget(state.commits, normalizedTarget);
  if (!resolvedHash) {
    throw new GitSimulatorError("Invalid reset target.", ERROR_CODES.INVALID_RESET_TARGET, {
      target: normalizedTarget,
    });
  }

  return resolvedHash;
}

/**
 * Re-index stash ids to keep newest entry at stash@{0}.
 * @param {Array<{id: string, message: string, files: Array<{name: string, status: string}>, timestamp: number}>} entries
 * @returns {Array<{id: string, message: string, files: Array<{name: string, status: string}>, timestamp: number}>}
 */
function reindexStashEntries(entries) {
  return entries.map((entry, index) => ({
    ...entry,
    id: `stash@{${index}}`,
  }));
}

/**
 * Restore file entries into workingDirectory, replacing by name when needed.
 * @param {Array<{name: string, status: string}>} workingDirectory
 * @param {Array<{name: string, status: string}>} restoredFiles
 * @returns {Array<{name: string, status: string}>}
 */
function mergeIntoWorkingDirectory(workingDirectory, restoredFiles) {
  const byName = new Map(workingDirectory.map((file) => [file.name, file]));

  for (const file of restoredFiles) {
    byName.set(file.name, { ...file });
  }

  return [...byName.values()];
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
 * Merge a source branch or remote-tracking ref into the current branch.
 * @param {GitState} state
 * @param {string} sourceBranchName
 * @returns {CommandResult}
 */
export function merge(state, sourceBranchName) {
  const nextState = cloneState(state);

  try {
    const hints = applyMerge(nextState, sourceBranchName);
    return buildResult({ prevState: state, nextState, hints });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown merge error"),
    });
  }
}

/**
 * Push current branch tip to remote.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function push(state) {
  const nextState = cloneState(state);

  try {
    if (!nextState.remote.connected) {
      throw new GitSimulatorError(
        "No remote configured or remote is disconnected.",
        ERROR_CODES.NO_REMOTE_CONFIGURED,
      );
    }

    if (nextState.detached) {
      throw new GitSimulatorError(
        "Cannot push while HEAD is detached.",
        ERROR_CODES.DETACHED_HEAD_OPERATION,
        { HEAD: nextState.HEAD },
      );
    }

    const branch = nextState.HEAD;
    const localHash = nextState.branches[branch];
    const prevRemoteHash = nextState.remoteBranches[branch] ?? null;

    nextState.remoteBranches[branch] = localHash;
    nextState.log = [...nextState.log, { command: "push", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        {
          type: HINT_TYPES.REMOTE_UPDATED,
          branch,
          fromHash: prevRemoteHash,
          toHash: localHash,
        },
        {
          type: HINT_TYPES.SYNC_PULSE,
          direction: "push",
          branch,
          hash: localHash,
        },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown push error"),
    });
  }
}

/**
 * Fetch remote updates into tracking refs.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function fetch(state) {
  const nextState = cloneState(state);

  try {
    const hints = applyFetch(nextState, "fetch");
    return buildResult({ prevState: state, nextState, hints });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown fetch error"),
    });
  }
}

/**
 * Pull by fetching remote updates and merging the tracking branch.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function pull(state) {
  const nextState = cloneState(state);

  try {
    const fetchHints = applyFetch(nextState, "pull");
    const currentBranch = nextState.HEAD;
    const trackingRef = nextState.trackingBranches[currentBranch];

    const mergeHints = applyMerge(nextState, trackingRef);
    nextState.log = [...nextState.log, { command: "pull", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [...fetchHints, ...mergeHints],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown pull error"),
    });
  }
}

/**
 * Reset current branch.
 * @param {GitState} state
 * @param {"soft" | "mixed" | "hard" | undefined} mode
 * @param {string | undefined} target
 * @returns {CommandResult}
 */
export function reset(state, mode, target) {
  const nextState = cloneState(state);

  try {
    if (nextState.detached) {
      throw new GitSimulatorError(
        "Cannot reset while HEAD is detached.",
        ERROR_CODES.DETACHED_HEAD_OPERATION,
        { HEAD: nextState.HEAD },
      );
    }

    const normalizedMode = mode ?? "mixed";
    const allowedModes = new Set(["soft", "mixed", "hard"]);
    if (!allowedModes.has(normalizedMode)) {
      throw new GitSimulatorError("Invalid reset mode.", ERROR_CODES.INVALID_RESET_TARGET, { mode });
    }

    const targetHash = resolveResetTargetHash(nextState, target ?? "HEAD");
    const currentBranch = nextState.HEAD;
    const prevHeadHash = nextState.branches[currentBranch];

    nextState.branches[currentBranch] = targetHash;
    nextState.HEAD = currentBranch;
    nextState.log = [...nextState.log, { command: "reset", timestamp: Date.now() }];

    /** @type {Array<object>} */
    const hints = [];

    if (normalizedMode === "soft") {
      hints.push({
        type: HINT_TYPES.RESET_PERFORMED,
        mode: "soft",
        targetHash,
        affectedZones: ["commits"],
      });
    } else if (normalizedMode === "mixed") {
      const filesReturned = nextState.stagingArea.map((file) => file.name);
      const returnedAsModified = nextState.stagingArea.map((file) => ({
        name: file.name,
        status: "modified",
      }));

      nextState.workingDirectory = mergeIntoWorkingDirectory(
        nextState.workingDirectory,
        returnedAsModified,
      );
      nextState.stagingArea = [];

      hints.push({
        type: HINT_TYPES.RESET_PERFORMED,
        mode: "mixed",
        targetHash,
        affectedZones: ["commits", "stagingArea"],
        filesReturned,
      });
    } else {
      nextState.stagingArea = [];
      nextState.workingDirectory = [];

      hints.push({
        type: HINT_TYPES.RESET_PERFORMED,
        mode: "hard",
        targetHash,
        affectedZones: ["commits", "stagingArea", "workingDirectory"],
      });
      hints.push({ type: HINT_TYPES.ZONE_UPDATED, zone: "stagingArea" });
      hints.push({ type: HINT_TYPES.ZONE_UPDATED, zone: "workingDirectory" });
    }

    hints.push({
      type: HINT_TYPES.HEAD_MOVED,
      from: prevHeadHash,
      to: targetHash,
      branch: currentBranch,
    });

    return buildResult({ prevState: state, nextState, hints });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown reset error"),
    });
  }
}

/**
 * Revert a commit.
 * @param {GitState} state
 * @param {string} targetHash
 * @returns {CommandResult}
 */
export function revert(state, targetHash) {
  const nextState = cloneState(state);

  try {
    if (nextState.detached) {
      throw new GitSimulatorError(
        "Cannot revert while HEAD is detached.",
        ERROR_CODES.DETACHED_HEAD_OPERATION,
        { HEAD: nextState.HEAD },
      );
    }

    const resolvedHash = resolveCommitTarget(nextState.commits, String(targetHash ?? "").trim());
    if (!resolvedHash || !nextState.commits[resolvedHash]) {
      throw new GitSimulatorError(`Commit not found: ${targetHash}`, ERROR_CODES.BRANCH_NOT_FOUND, {
        targetHash,
      });
    }

    const originalCommit = nextState.commits[resolvedHash];
    const currentBranch = nextState.HEAD;
    const currentHeadHash = nextState.branches[currentBranch];
    const message = `Revert "${originalCommit.message}"`;
    const newHash = createDeterministicHash(`${message}|${currentHeadHash}`);
    const timestamp = Date.now();

    nextState.commits[newHash] = {
      hash: newHash,
      message,
      parents: [currentHeadHash],
      branch: currentBranch,
      timestamp,
    };

    nextState.branches[currentBranch] = newHash;
    nextState.log = [...nextState.log, { command: "revert", timestamp }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        {
          type: HINT_TYPES.REVERT_COMMIT,
          newHash,
          revertedHash: resolvedHash,
          message,
        },
        {
          type: HINT_TYPES.COMMIT_CREATED,
          hash: newHash,
          message,
          parentHash: currentHeadHash,
        },
        {
          type: HINT_TYPES.HEAD_MOVED,
          from: currentHeadHash,
          to: newHash,
          branch: currentBranch,
        },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown revert error"),
    });
  }
}

/**
 * Stash local changes.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function stash(state) {
  const nextState = cloneState(state);

  try {
    if (nextState.workingDirectory.length === 0 && nextState.stagingArea.length === 0) {
      throw new GitSimulatorError("Nothing to stash.", ERROR_CODES.NOTHING_TO_STASH);
    }

    const headHash = getCurrentHeadHash(nextState);
    const latestCommitMessage = nextState.commits[headHash]?.message ?? "No message";
    const shortHash = (headHash ?? "").slice(0, 7);
    const files = [...nextState.stagingArea, ...nextState.workingDirectory].map((file) => ({ ...file }));
    const stashId = `stash@{${nextState.stash.length}}`;

    const newEntry = {
      id: stashId,
      message: `WIP on ${nextState.HEAD}: ${shortHash} ${latestCommitMessage}`,
      files,
      timestamp: Date.now(),
    };

    nextState.stash = [newEntry, ...nextState.stash];
    nextState.workingDirectory = [];
    nextState.stagingArea = [];
    nextState.log = [...nextState.log, { command: "stash", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        { type: HINT_TYPES.STASH_PUSHED, stashId, fileCount: files.length },
        { type: HINT_TYPES.ZONE_UPDATED, zone: "workingDirectory" },
        { type: HINT_TYPES.ZONE_UPDATED, zone: "stagingArea" },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown stash error"),
    });
  }
}

/**
 * Pop latest stash entry.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function stashPop(state) {
  const nextState = cloneState(state);

  try {
    if (nextState.stash.length === 0) {
      throw new GitSimulatorError("Nothing to stash.", ERROR_CODES.NOTHING_TO_STASH);
    }

    const [entry, ...remaining] = nextState.stash;
    const restoredFiles = entry.files.map((file) => ({ ...file }));
    const restoredNames = restoredFiles.map((file) => file.name);

    nextState.workingDirectory = mergeIntoWorkingDirectory(nextState.workingDirectory, restoredFiles);
    nextState.stash = reindexStashEntries(remaining);
    nextState.log = [...nextState.log, { command: "stash pop", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        { type: HINT_TYPES.STASH_POPPED, stashId: entry.id },
        { type: HINT_TYPES.FILES_RESTORED, files: restoredNames, to: "workingDirectory" },
        { type: HINT_TYPES.ZONE_UPDATED, zone: "workingDirectory" },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown stashPop error"),
    });
  }
}

/**
 * Apply stash entry.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function stashApply(state) {
  const nextState = cloneState(state);

  try {
    if (nextState.stash.length === 0) {
      throw new GitSimulatorError("Nothing to stash.", ERROR_CODES.NOTHING_TO_STASH);
    }

    const entry = nextState.stash[0];
    const restoredFiles = entry.files.map((file) => ({ ...file }));
    const restoredNames = restoredFiles.map((file) => file.name);

    nextState.workingDirectory = mergeIntoWorkingDirectory(nextState.workingDirectory, restoredFiles);
    nextState.log = [...nextState.log, { command: "stash apply", timestamp: Date.now() }];

    return buildResult({
      prevState: state,
      nextState,
      hints: [
        { type: HINT_TYPES.STASH_APPLIED, stashId: entry.id },
        { type: HINT_TYPES.FILES_RESTORED, files: restoredNames, to: "workingDirectory" },
      ],
    });
  } catch (error) {
    return buildResult({
      prevState: state,
      nextState: state,
      error: error instanceof Error ? error : new Error("Unknown stashApply error"),
    });
  }
}

/**
 * List stash entries.
 * @param {GitState} state
 * @returns {CommandResult}
 */
export function stashList(state) {
  return buildResult({ prevState: state, nextState: state, hints: [] });
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
