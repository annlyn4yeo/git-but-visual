import { parseCommand } from "./terminal/parser.js";
import { initTerminal } from "./terminal/index.js";

import { createInitialState, runCommand } from "./simulator/index.js";
import { emit, on } from "./utils/events.js";
import { initZones, renderZones } from "./ui/zones.js";
import { renderCommitGraph } from "./ui/commit-graph.js";
import { initSidebar } from "./ui/sidebar.js";
import { initSections } from "./ui/sections.js";

/** @type {import("./simulator/state.js").GitState} */
let appState = createInitialState();
let initialized = false;

/** @type {ReturnType<typeof initTerminal> | null} */
let terminal = null;

/**
 * Read-only state getter.
 * @returns {import("./simulator/state.js").GitState}
 */
export function getState() {
  return structuredClone(appState);
}

/**
 * @param {Record<string, import("./simulator/state.js").CommitObject>} commits
 * @param {string} startHash
 * @param {string} targetHash
 * @returns {number}
 */
function countAhead(commits, startHash, targetHash) {
  let current = startHash;
  let distance = 0;

  while (current && current !== targetHash) {
    const commit = commits[current];
    if (!commit || !commit.parents || commit.parents.length === 0) {
      return 0;
    }
    current = commit.parents[0];
    distance += 1;
  }

  return current === targetHash ? distance : 0;
}

/**
 * @param {ReturnType<typeof parseCommand> & { ok: true }} parsed
 * @param {import("./simulator/result.js").CommandResult} result
 * @returns {string}
 */
function formatSuccess(parsed, result) {
  const { command } = parsed;
  const hints = result.animationHints ?? [];
  const nextState = result.nextState;

  const byType = (type) => hints.find((hint) => hint.type === type);
  const manyByType = (type) => hints.filter((hint) => hint.type === type);

  const messageByCommand = {
    add: () => {
      const files = manyByType("FILE_MOVED").map((hint) => hint.file).filter(Boolean);
      return `✓ ${files.join(", ")} added to staging area`;
    },
    commit: () => {
      const created = byType("COMMIT_CREATED");
      const branch = nextState.HEAD;
      const shortHash = String(created?.hash ?? "").slice(0, 7);
      return `✓ [${branch} ${shortHash}] ${created?.message ?? ""}`.trim();
    },
    push: () => {
      const branch = nextState.detached ? "detached-head" : nextState.HEAD;
      return `✓ Pushed ${branch} to origin`;
    },
    fetch: () => {
      const trackingHint = byType("TRACKING_UPDATED");
      const branch = nextState.detached ? "detached-head" : nextState.HEAD;
      const localHash = nextState.branches[branch];
      const remoteHash = trackingHint?.newHash ?? nextState.remoteBranches[branch];
      const ahead = countAhead(nextState.commits, remoteHash, localHash);
      return `✓ Fetched from origin - ${branch} is now ${ahead} commit(s) ahead`;
    },
    pull: () => {
      const branch = nextState.detached ? "detached-head" : nextState.HEAD;
      return `✓ Pulled and merged origin/${branch}`;
    },
    branch: () => {
      const created = byType("BRANCH_CREATED");
      return `✓ Branch '${created?.branchName ?? parsed.args[0] ?? ""}' created at ${String(created?.atHash ?? "").slice(0, 7)}`;
    },
    checkout: () => {
      if (nextState.detached) {
        return `✓ HEAD detached at ${String(nextState.HEAD ?? "").slice(0, 7)}`;
      }
      return `✓ Switched to branch '${nextState.HEAD}'`;
    },
    switch: () => {
      if (nextState.detached) {
        return `✓ HEAD detached at ${String(nextState.HEAD ?? "").slice(0, 7)}`;
      }
      return `✓ Switched to branch '${nextState.HEAD}'`;
    },
    merge: () => {
      const ff = byType("FAST_FORWARD");
      if (ff) {
        return `✓ Merged '${ff.sourceBranch}' - fast-forward`;
      }
      const mergeCommit = byType("MERGE_COMMIT");
      return `✓ Merged '${mergeCommit?.sourceBranch ?? parsed.args[0] ?? ""}' - merge commit ${String(mergeCommit?.hash ?? "").slice(0, 7)}`;
    },
    reset: () => {
      const resetHint = byType("RESET_PERFORMED");
      return `✓ Reset ${resetHint?.mode ?? "mixed"} to ${String(resetHint?.targetHash ?? "").slice(0, 7)}`;
    },
    stash: () => {
      const stashHint = byType("STASH_PUSHED");
      return `✓ Stashed ${stashHint?.fileCount ?? 0} file(s) - ${stashHint?.stashId ?? ""}`.trim();
    },
    "stash:pop": () => {
      const popHint = byType("STASH_POPPED");
      const restored = byType("FILES_RESTORED");
      return `✓ Popped ${popHint?.stashId ?? ""} - ${(restored?.files ?? []).length} file(s) restored`.trim();
    },
    "stash:apply": () => {
      const applyHint = byType("STASH_APPLIED");
      const restored = byType("FILES_RESTORED");
      return `✓ Applied ${applyHint?.stashId ?? ""} - ${(restored?.files ?? []).length} file(s) restored`.trim();
    },
  };

  const resolver = messageByCommand[command];
  if (!resolver) {
    return `✓ ${command} completed`;
  }

  return resolver();
}

/**
 * @param {unknown} payload
 * @returns {void}
 */
function handleCommandSubmit(payload) {
  if (!terminal) {
    return;
  }

  const rawInput =
    typeof payload === "string" ? payload.trim() : String(payload?.rawInput ?? "").trim();

  const parsed = parseCommand(rawInput);
  if (!parsed.ok) {
    terminal.print(parsed.reason, "error");
    return;
  }

  const result = runCommand(appState, rawInput);
  if (result.error) {
    terminal.print(result.error.message ?? "Command failed.", "error");
    return;
  }

  appState = result.nextState;
  terminal.printCommand(rawInput);
  terminal.print(formatSuccess(parsed, result), "success");

  emit("state:changed", {
    prevState: result.prevState,
    nextState: result.nextState,
    hints: result.animationHints,
  });

  renderZones(appState);
  renderCommitGraph(appState);
}

/**
 * @param {{command?: string} | string} payload
 * @returns {void}
 */
function handleChipClicked(payload) {
  if (!terminal) {
    return;
  }

  const command = typeof payload === "string" ? payload : payload?.command;
  if (!command) {
    return;
  }

  terminal.fillInput(command);
}

/**
 * Initialize application modules.
 * @returns {void}
 */
export function init() {
  if (typeof document === "undefined" || initialized) {
    return;
  }

  initialized = true;
  appState = createInitialState();

  initSidebar();
  const sectionRefs = initSections();

  const zonesDemo = sectionRefs.get("the-four-zones")?.demoEl;
  const terminalDemo = sectionRefs.get("saving-changes")?.demoEl;

  initZones(zonesDemo);
  renderZones(appState);

  terminal = initTerminal(terminalDemo);
  terminal.print("Ready for commands.", "info");
  terminal.print("tip: use git status to see current state", "hint");

  renderCommitGraph(appState);

  on("command:submit", handleCommandSubmit);
  on("chip:clicked", handleChipClicked);
}

init();
