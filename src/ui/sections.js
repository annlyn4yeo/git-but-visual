import { parseCommand } from "../terminal/parser.js";
import { initTerminal } from "../terminal/index.js";
import { createInitialState, runCommand } from "../simulator/index.js";
import { emit, on, off } from "../utils/events.js";
import { initZones, renderZones } from "./zones.js";
import { renderCommitGraph } from "./commit-graph.js";

/** @type {Map<string, {el: HTMLElement, demoEl: HTMLElement}>} */
const sectionRefs = new Map();
/** @type {Map<string, {reset: () => void, dispose: () => void}>} */
const demoControllers = new Map();

const SECTIONS = [
  {
    id: "the-four-zones",
    layout: "orientation",
    number: "01",
    heading: "The Four Zones",
    copy: [
      "All git operations move files or pointers between these four zones.",
      "Every command you learn is just moving something from one zone to another.",
    ],
    chips: [],
  },
  {
    id: "saving-changes",
    layout: "guided-save-workflow",
    number: "02",
    heading: "Saving Changes",
    copy: [
      "The add to commit to push workflow is the core save loop in git.",
      "Stage the right files, snapshot with a commit, then sync upstream.",
    ],
    chips: [],
  },
  {
    id: "branching",
    layout: "graph-focused",
    number: "03",
    heading: "Branching",
    copy: [
      "Branches are lightweight named pointers to commits.",
      "Creating a branch is instant, so branching early is almost always free.",
    ],
    chips: [],
  },
  {
    id: "merging",
    layout: "graph-focused",
    number: "04",
    heading: "Merging",
    copy: [
      "Fast-forward merges move a pointer with no new commit.",
      "Diverged histories create a merge commit with two parents.",
    ],
    chips: [],
  },
  {
    id: "syncing-remote",
    layout: "interactive",
    number: "05",
    heading: "Syncing with Remote",
    copy: [
      "Fetch is always safe and updates your view of remote refs.",
      "Pull is fetch plus merge, so it changes your local branch too.",
    ],
    chips: [
      { command: "git fetch", tone: "remote" },
      { command: "git pull", tone: "remote" },
      { command: "git push", tone: "remote" },
    ],
  },
  {
    id: "undoing-changes",
    layout: "interactive",
    number: "06",
    heading: "Undoing Changes",
    copy: [
      "Reset rewrites pointers and can discard local state if used hard.",
      "Revert is history-safe for shared branches because it adds a new commit.",
    ],
    chips: [
      { command: "git reset", tone: "destructive" },
      { command: "git revert", tone: "history" },
    ],
  },
  {
    id: "stashing",
    layout: "interactive",
    number: "07",
    heading: "Stashing",
    copy: [
      "Stash acts like a clipboard for incomplete work.",
      "Save in-progress changes, switch context, then apply or pop later.",
    ],
    chips: [
      { command: "git stash", tone: "staging" },
      { command: "git stash pop", tone: "staging" },
      { command: "git stash apply", tone: "staging" },
    ],
  },
  {
    id: "playground",
    layout: "interactive",
    number: "08",
    heading: "Playground",
    copy: ["A blank repo. Type any command. Watch what happens."],
    chips: [],
  },
];

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {string} tone
 * @returns {string}
 */
function chipToneClass(tone) {
  return `chip-tone-${tone}`;
}

/**
 * @param {ReturnType<typeof parseCommand> & { ok: true }} parsed
 * @param {import("../simulator/result.js").CommandResult} result
 * @returns {string}
 */
function formatSuccess(parsed, result) {
  const movedFiles = (result.animationHints ?? [])
    .filter((hint) => hint.type === "FILE_MOVED")
    .map((hint) => hint.file)
    .filter(Boolean);

  if (parsed.command === "add" && movedFiles.length > 0) {
    return `\u2713 ${movedFiles.join(", ")} added to staging area`;
  }

  if (parsed.command === "commit") {
    const created = (result.animationHints ?? []).find((hint) => hint.type === "COMMIT_CREATED");
    return `\u2713 [${result.nextState.HEAD} ${String(created?.hash ?? "").slice(0, 7)}] ${created?.message ?? ""}`.trim();
  }

  return `\u2713 ${parsed.command} completed`;
}

/**
 * @param {HTMLElement} demoEl
 * @returns {{shell: HTMLElement, zonesMount: HTMLElement, terminalMount: HTMLElement, resetButton: HTMLButtonElement}}
 */
function createInteractiveDemoShell(demoEl) {
  demoEl.innerHTML = `
    <div class="lesson-demo-toolbar">
      <button class="lesson-demo-reset" type="button" data-role="reset-demo">Reset demo</button>
    </div>
    <div class="lesson-demo-shell">
      <div class="lesson-demo-zones" data-role="demo-zones"></div>
      <div class="lesson-demo-terminal" data-role="demo-terminal"></div>
    </div>
  `;

  return {
    shell: /** @type {HTMLElement} */ (demoEl.querySelector(".lesson-demo-shell")),
    zonesMount: /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="demo-zones"]')),
    terminalMount: /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="demo-terminal"]')),
    resetButton: /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="reset-demo"]')),
  };
}

/**
 * @param {string} sectionId
 * @returns {void}
 */
function mountOrientationSection(sectionId) {
  const refs = sectionRefs.get(sectionId);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  const initialState = createInitialState();
  const workingFilesMarkup = initialState.workingDirectory
    .map(
      (file) => `
        <article class="orientation-file-card" data-status="${escapeHtml(file.status)}">
          <span class="orientation-file-name">${escapeHtml(file.name)}</span>
          <span class="orientation-file-status">${escapeHtml(file.status)}</span>
        </article>
      `,
    )
    .join("");

  demoEl.innerHTML = `
    <div class="orientation-map-shell">
      <div class="orientation-map" data-role="orientation-map">
        <article class="orientation-zone orientation-zone-working" data-zone="working-directory" tabindex="0">
          <header class="orientation-zone-header">
            <p class="orientation-zone-kicker">Working Directory</p>
            <h3 class="orientation-zone-title">Your Files</h3>
          </header>
          <div class="orientation-zone-content orientation-zone-content-default">
            <div class="orientation-file-stack">
              ${workingFilesMarkup}
            </div>
          </div>
          <div class="orientation-zone-content orientation-zone-content-hover">
            <p class="orientation-zone-explainer">Where you edit files freely. Nothing here is queued for history yet.</p>
          </div>
        </article>

        <div class="orientation-flow" aria-hidden="true">\u2192</div>

        <article class="orientation-zone orientation-zone-staging" data-zone="staging-area" tabindex="0">
          <header class="orientation-zone-header">
            <p class="orientation-zone-kicker">Staging Area</p>
            <h3 class="orientation-zone-title">Next Snapshot</h3>
          </header>
          <div class="orientation-zone-content orientation-zone-content-default">
            <p class="orientation-zone-placeholder">Choose exactly what will be included in the next commit.</p>
          </div>
          <div class="orientation-zone-content orientation-zone-content-hover">
            <p class="orientation-zone-explainer">A review table for your next snapshot. Curate files here before committing.</p>
          </div>
        </article>

        <div class="orientation-flow" aria-hidden="true">\u2192</div>

        <article class="orientation-zone orientation-zone-local" data-zone="local-repository" tabindex="0">
          <header class="orientation-zone-header">
            <p class="orientation-zone-kicker">Local Repository</p>
            <h3 class="orientation-zone-title">Commit History</h3>
          </header>
          <div class="orientation-zone-content orientation-zone-content-default">
            <p class="orientation-zone-placeholder">Commits live here as a timeline on your machine.</p>
          </div>
          <div class="orientation-zone-content orientation-zone-content-hover">
            <p class="orientation-zone-explainer">Structured history with branches and HEAD pointers. Safe place to inspect and organize work.</p>
          </div>
        </article>

        <div class="orientation-flow" aria-hidden="true">\u2192</div>

        <article class="orientation-zone orientation-zone-remote" data-zone="remote-repository" tabindex="0">
          <header class="orientation-zone-header">
            <p class="orientation-zone-kicker">Remote Repository</p>
            <h3 class="orientation-zone-title">Shared Source</h3>
          </header>
          <div class="orientation-zone-content orientation-zone-content-default">
            <p class="orientation-zone-placeholder">Team-visible history lives here after you sync.</p>
          </div>
          <div class="orientation-zone-content orientation-zone-content-hover">
            <p class="orientation-zone-explainer">The collaborative copy on origin. Push sends commits here, pull brings changes back.</p>
          </div>
        </article>
      </div>
    </div>
  `;
}

const GUIDED_SAVE_STEPS = [
  {
    key: "add",
    label: "git add",
    command: "git add .",
    tone: "staging",
    focusClass: "zones-focus-working-staging",
    description: "Moves selected working files into the staging area for review.",
  },
  {
    key: "commit",
    label: "git commit",
    command: 'git commit -m "Save tracked updates"',
    tone: "history",
    focusClass: "zones-focus-staging-local",
    description: "Creates a local snapshot from staged files and advances HEAD.",
  },
  {
    key: "push",
    label: "git push",
    command: "git push",
    tone: "remote",
    focusClass: "zones-focus-local-remote",
    description: "Syncs your local branch tip to the remote repository.",
  },
];

/**
 * @param {string} sectionId
 * @returns {void}
 */
function mountGuidedSaveWorkflow(sectionId) {
  const refs = sectionRefs.get(sectionId);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  demoEl.innerHTML = `
    <div class="guided-save-demo" data-role="guided-save-demo">
      <ol class="guided-progress" data-role="guided-progress"></ol>
      <div class="guided-step-card" data-role="guided-step-card">
        <p class="guided-step-kicker" data-role="guided-step-kicker"></p>
        <p class="guided-step-description" data-role="guided-step-description"></p>
        <button class="command-chip" type="button" data-role="guided-step-action"></button>
      </div>
      <div class="guided-complete-card" data-role="guided-complete" hidden>
        <div class="guided-complete-glow" aria-hidden="true"></div>
        <p class="guided-complete-title">Save Loop Complete</p>
        <p class="guided-complete-copy">You moved changes through add, commit, and push in order. Ready to run it again?</p>
        <button class="guided-complete-reset" type="button" data-role="guided-reset">Reset Walkthrough</button>
      </div>
      <div class="guided-save-zones" data-role="guided-save-zones"></div>
    </div>
  `;

  const progressEl = /** @type {HTMLOListElement} */ (demoEl.querySelector('[data-role="guided-progress"]'));
  const stepCardEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="guided-step-card"]'));
  const stepKickerEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="guided-step-kicker"]'));
  const stepDescriptionEl = /** @type {HTMLElement} */ (
    demoEl.querySelector('[data-role="guided-step-description"]')
  );
  const stepActionEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="guided-step-action"]'));
  const completeCardEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="guided-complete"]'));
  const zonesMount = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="guided-save-zones"]'));

  let currentStepIndex = 0;
  let state = createInitialState();
  const zonesRoot = initZones(zonesMount, { title: "Zone Diagram" });

  /**
   * @returns {void}
   */
  const applyZoneFocus = () => {
    if (!zonesRoot) {
      return;
    }

    zonesRoot.classList.remove(
      "zones-focus-working-staging",
      "zones-focus-staging-local",
      "zones-focus-local-remote",
    );

    const step = GUIDED_SAVE_STEPS[currentStepIndex];
    if (step) {
      zonesRoot.classList.add(step.focusClass);
    }
  };

  /**
   * @returns {void}
   */
  const renderProgress = () => {
    progressEl.innerHTML = GUIDED_SAVE_STEPS.map((step, index) => {
      const status =
        index < currentStepIndex ? "complete" : index === currentStepIndex ? "current" : "future";
      const marker = status === "complete" ? "\u2713" : String(index + 1);
      return `
        <li class="guided-progress-item is-${status}">
          <span class="guided-progress-marker">${marker}</span>
          <span class="guided-progress-label">${step.label}</span>
        </li>
      `;
    }).join("");
  };

  /**
   * @returns {void}
   */
  const renderStepState = () => {
    const activeStep = GUIDED_SAVE_STEPS[currentStepIndex];
    const completedAll = currentStepIndex >= GUIDED_SAVE_STEPS.length;

    if (completedAll) {
      stepCardEl.hidden = true;
      completeCardEl.hidden = false;
      return;
    }

    stepCardEl.hidden = false;
    completeCardEl.hidden = true;
    stepKickerEl.textContent = `Step ${currentStepIndex + 1} of ${GUIDED_SAVE_STEPS.length} - ${activeStep.label}`;
    stepDescriptionEl.textContent = activeStep.description;
    stepActionEl.textContent = activeStep.label;
    stepActionEl.className = `command-chip ${chipToneClass(activeStep.tone)} guided-step-action`;
    stepActionEl.disabled = false;
  };

  /**
   * @returns {void}
   */
  const renderGuided = () => {
    renderZones(state, zonesMount);
    renderProgress();
    renderStepState();
    applyZoneFocus();
  };

  /**
   * @returns {void}
   */
  const advanceStep = () => {
    const activeStep = GUIDED_SAVE_STEPS[currentStepIndex];
    if (!activeStep) {
      return;
    }

    stepActionEl.disabled = true;
    const result = runCommand(state, activeStep.command);
    if (result.error) {
      stepActionEl.disabled = false;
      return;
    }

    state = result.nextState;
    currentStepIndex += 1;
    renderGuided();

    emit(`demo:02:state:changed`, {
      sectionId: sectionId,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });
  };

  /**
   * @returns {void}
   */
  const reset = () => {
    currentStepIndex = 0;
    state = createInitialState();
    renderGuided();
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleClick = (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target) {
      return;
    }

    const actionButton = target.closest('[data-role="guided-step-action"]');
    if (actionButton instanceof HTMLElement) {
      advanceStep();
      return;
    }

    const resetButton = target.closest('[data-role="guided-reset"]');
    if (resetButton instanceof HTMLElement) {
      reset();
    }
  };

  demoEl.addEventListener("click", handleClick);
  reset();

  demoControllers.set(sectionId, {
    reset,
    dispose() {
      demoEl.removeEventListener("click", handleClick);
    },
  });
}

const GRAPH_SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} branchName
 * @returns {string}
 */
function graphBranchColor(branchName) {
  return branchName === "main" ? "var(--color-green)" : "var(--color-purple)";
}

/**
 * @param {string} branchName
 * @returns {string}
 */
function graphBranchMutedColor(branchName) {
  return branchName === "main" ? "var(--color-green-border)" : "var(--color-purple-border)";
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} name
 * @param {Record<string, string | number>} attrs
 * @returns {SVGElement}
 */
function createGraphSvgElement(svg, name, attrs) {
  const el = document.createElementNS(GRAPH_SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  svg.appendChild(el);
  return el;
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @returns {string}
 */
function getHeadHash(state) {
  return state.detached ? state.HEAD : state.branches[state.HEAD];
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @returns {Array<import("../simulator/state.js").CommitObject>}
 */
function getGraphCommits(state) {
  return Object.values(state.commits).sort((a, b) => {
    if (b.timestamp !== a.timestamp) {
      return b.timestamp - a.timestamp;
    }
    return b.hash.localeCompare(a.hash);
  });
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @param {string} fileName
 * @returns {import("../simulator/state.js").GitState}
 */
function withSyntheticWorkingChange(state, fileName) {
  const next = structuredClone(state);
  next.workingDirectory = [{ name: fileName, status: "modified" }];
  next.stagingArea = [];
  return next;
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @param {string} command
 * @returns {import("../simulator/state.js").GitState}
 */
function runCommandOrKeep(state, command) {
  const result = runCommand(state, command);
  return result.error ? state : result.nextState;
}

/**
 * @returns {import("../simulator/state.js").GitState}
 */
function createBranchingInitialState() {
  let state = createInitialState();
  state = runCommandOrKeep(state, "git add .");
  state = runCommandOrKeep(state, 'git commit -m "Scaffold base structure"');
  state = withSyntheticWorkingChange(state, "router.js");
  state = runCommandOrKeep(state, "git add .");
  state = runCommandOrKeep(state, 'git commit -m "Add router shell"');
  return state;
}

/**
 * @returns {import("../simulator/state.js").GitState}
 */
function createMergingInitialState() {
  let state = createBranchingInitialState();
  state = runCommandOrKeep(state, "git branch feature/auth");
  state = runCommandOrKeep(state, "git switch feature/auth");
  state = withSyntheticWorkingChange(state, "auth-guard.js");
  state = runCommandOrKeep(state, "git add .");
  state = runCommandOrKeep(state, 'git commit -m "Add auth guard checks"');
  state = runCommandOrKeep(state, "git switch main");
  state = withSyntheticWorkingChange(state, "app-shell.js");
  state = runCommandOrKeep(state, "git add .");
  state = runCommandOrKeep(state, 'git commit -m "Refine app shell layout"');
  return state;
}

/**
 * @param {SVGSVGElement} svg
 * @param {import("../simulator/state.js").GitState} state
 * @param {{newCommits?: Set<string>, newBranches?: Set<string>}} [options]
 * @returns {{positionsByHash: Map<string, {x: number, y: number, branch: string}>, laneX: Map<string, number>, width: number, height: number}}
 */
function renderGraphFocusedSvg(svg, state, options = {}) {
  const newCommits = options.newCommits ?? new Set();
  const newBranches = options.newBranches ?? new Set();
  const activeBranch = state.detached ? null : state.HEAD;
  const commits = getGraphCommits(state);
  const headHash = getHeadHash(state);

  const branchNames = Object.keys(state.branches)
    .filter((name) => name !== "main")
    .sort((a, b) => a.localeCompare(b));
  branchNames.unshift("main");

  const branchLanes = new Map();
  branchNames.forEach((name, index) => branchLanes.set(name, index));

  const baseX = 56;
  const laneOffset = 126;
  const topY = 52;
  const rowSpacing = 88;
  const laneEndY = topY + Math.max(1, commits.length) * rowSpacing;

  const positionsByHash = new Map();
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const lane = branchLanes.get(commit.branch) ?? 0;
    positionsByHash.set(commit.hash, {
      x: baseX + lane * laneOffset,
      y: topY + index * rowSpacing,
      branch: commit.branch,
    });
  }

  const width = Math.max(700, baseX + Math.max(1, branchLanes.size) * laneOffset + 240);
  const height = Math.max(500, laneEndY + 40);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  for (const branchName of branchNames) {
    const laneX = baseX + (branchLanes.get(branchName) ?? 0) * laneOffset;
    const isActive = branchName === activeBranch;
    const guide = createGraphSvgElement(svg, "path", {
      d: `M ${laneX} ${topY - 28} L ${laneX} ${laneEndY}`,
      stroke: graphBranchMutedColor(branchName),
      "stroke-width": isActive ? 2.5 : 1.5,
      "stroke-dasharray": "5 9",
      opacity: isActive ? 0.75 : 0.26,
      fill: "none",
    });
    if (newBranches.has(branchName)) {
      guide.classList.add("graph-entity-new");
    }
  }

  for (const commit of commits) {
    const from = positionsByHash.get(commit.hash);
    if (!from) {
      continue;
    }

    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parentHash = commit.parents[parentIndex];
      const to = positionsByHash.get(parentHash);
      if (!to) {
        continue;
      }

      const isSecondaryParent = parentIndex > 0;
      const isActiveTrack = Boolean(activeBranch && (commit.branch === activeBranch || to.branch === activeBranch));
      const edge = createGraphSvgElement(svg, "path", {
        d: isSecondaryParent
          ? `M ${from.x} ${from.y} C ${from.x} ${from.y + 32}, ${to.x} ${to.y - 32}, ${to.x} ${to.y}`
          : `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        stroke: graphBranchMutedColor(isSecondaryParent ? to.branch : commit.branch),
        "stroke-width": isSecondaryParent ? 2 : 3,
        opacity: isActiveTrack ? 0.95 : 0.42,
        fill: "none",
        "stroke-linecap": "round",
      });
      if (newCommits.has(commit.hash)) {
        edge.classList.add("graph-entity-new");
      }
    }
  }

  for (const commit of commits) {
    const point = positionsByHash.get(commit.hash);
    if (!point) {
      continue;
    }

    const isHead = commit.hash === headHash;
    const isActiveTrack = Boolean(activeBranch && commit.branch === activeBranch);

    if (isHead) {
      createGraphSvgElement(svg, "circle", {
        cx: point.x,
        cy: point.y,
        r: 14,
        fill: "none",
        stroke: graphBranchColor(commit.branch),
        "stroke-width": 2.5,
        opacity: 0.95,
      });
    }

    const node = createGraphSvgElement(svg, "circle", {
      cx: point.x,
      cy: point.y,
      r: isHead ? 8 : 6,
      fill: "var(--bg-surface)",
      stroke: graphBranchColor(commit.branch),
      "stroke-width": isHead ? 3 : 2.2,
      opacity: isActiveTrack || isHead ? 1 : 0.58,
    });
    if (newCommits.has(commit.hash)) {
      node.classList.add("graph-entity-new");
    }

    createGraphSvgElement(svg, "text", {
      x: point.x + 18,
      y: point.y + 4,
      fill: isActiveTrack || isHead ? "var(--text-primary)" : "var(--text-secondary)",
      "font-family": "var(--font-mono)",
      "font-size": "13",
      opacity: isActiveTrack || isHead ? 0.95 : 0.72,
    }).textContent = commit.hash.slice(0, 7);
  }

  const branchTipsByHash = new Map();
  for (const [branchName, hash] of Object.entries(state.branches)) {
    const list = branchTipsByHash.get(hash) ?? [];
    list.push(branchName);
    branchTipsByHash.set(hash, list);
  }

  for (const [hash, names] of branchTipsByHash.entries()) {
    const point = positionsByHash.get(hash);
    if (!point) {
      continue;
    }

    names.forEach((branchName, index) => {
      const pillWidth = Math.max(58, branchName.length * 8 + 16);
      const pillX = point.x + 96 + index * (pillWidth + 8);
      const pillY = point.y - 13;
      const isActive = activeBranch === branchName;

      const pill = createGraphSvgElement(svg, "rect", {
        x: pillX,
        y: pillY,
        rx: 10,
        ry: 10,
        width: pillWidth,
        height: 22,
        fill: isActive ? graphBranchColor(branchName) : "var(--bg-hover)",
        stroke: graphBranchMutedColor(branchName),
        "stroke-width": isActive ? 1.5 : 1,
        opacity: isActive ? 0.96 : 0.74,
      });
      if (newBranches.has(branchName)) {
        pill.classList.add("graph-entity-new");
      }

      createGraphSvgElement(svg, "text", {
        x: pillX + 9,
        y: pillY + 15,
        fill: isActive ? "var(--text-inverse)" : graphBranchColor(branchName),
        "font-family": "var(--font-mono)",
        "font-size": "12",
        "font-weight": "700",
        opacity: 0.98,
      }).textContent = branchName;
    });
  }

  const laneX = new Map();
  branchNames.forEach((name) => {
    laneX.set(name, baseX + (branchLanes.get(name) ?? 0) * laneOffset);
  });

  return { positionsByHash, laneX, width, height };
}

/**
 * @param {HTMLElement} stageEl
 * @param {{positionsByHash: Map<string, {x: number, y: number, branch: string}>, laneX: Map<string, number>, width: number, height: number}} graphMeta
 * @param {{x?: number, y?: number, hash?: string, branch?: string}} anchor
 * @returns {{left: number, top: number}}
 */
function resolveGraphToastPoint(stageEl, graphMeta, anchor) {
  const width = stageEl.clientWidth || 1;
  const height = stageEl.clientHeight || 1;
  let x = anchor.x ?? width / 2;
  let y = anchor.y ?? Math.min(height - 26, 90);

  if (anchor.hash) {
    const point = graphMeta.positionsByHash.get(anchor.hash);
    if (point) {
      x = (point.x / graphMeta.width) * width;
      y = (point.y / graphMeta.height) * height - 24;
    }
  }

  if (anchor.branch && graphMeta.laneX.has(anchor.branch)) {
    const lane = graphMeta.laneX.get(anchor.branch) ?? 0;
    x = (lane / graphMeta.width) * width + 8;
    y = Math.min(height - 26, Math.max(44, y));
  }

  return {
    left: Math.max(16, Math.min(width - 16, x)),
    top: Math.max(18, Math.min(height - 18, y)),
  };
}

/**
 * @param {HTMLElement} layerEl
 * @param {HTMLElement} stageEl
 * @param {{positionsByHash: Map<string, {x: number, y: number, branch: string}>, laneX: Map<string, number>, width: number, height: number}} graphMeta
 * @param {string} message
 * @param {{hash?: string, branch?: string}} [anchor]
 * @returns {void}
 */
function showGraphToast(layerEl, stageEl, graphMeta, message, anchor = {}) {
  const point = resolveGraphToastPoint(stageEl, graphMeta, anchor);
  const toast = document.createElement("div");
  toast.className = "graph-transient-label";
  toast.textContent = message;
  toast.style.left = `${point.left}px`;
  toast.style.top = `${point.top}px`;
  layerEl.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => {
      toast.remove();
    }, 280);
  }, 1400);
}

/**
 * @param {{id: string, number: string}} section
 * @returns {void}
 */
function mountGraphFocusedSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  const isMerging = section.id === "merging";

  demoEl.innerHTML = `
    <div class="graph-focus-demo ${isMerging ? "graph-focus-merging" : "graph-focus-branching"}" data-role="graph-focus-demo">
      <div class="graph-focus-stage" data-role="graph-stage">
        <svg class="graph-focus-svg" data-role="graph-svg" viewBox="0 0 900 520" preserveAspectRatio="xMidYMid meet" aria-label="Commit graph walkthrough"></svg>
        <div class="graph-transient-layer" data-role="graph-transient-layer"></div>
      </div>
      <form class="graph-mini-terminal" data-role="graph-terminal-form">
        <span class="graph-mini-prompt" aria-hidden="true">gitvisual ~/${section.id} $</span>
        <input class="graph-mini-input" data-role="graph-terminal-input" type="text" autocomplete="off" spellcheck="false" placeholder="${isMerging ? "try: git merge feature/auth" : "try: git branch feature/ui"}" />
        <button class="graph-mini-reset" type="button" data-role="graph-terminal-reset">Reset</button>
      </form>
    </div>
  `;

  const stageEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="graph-stage"]'));
  const svgEl = /** @type {SVGSVGElement} */ (demoEl.querySelector('[data-role="graph-svg"]'));
  const layerEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="graph-transient-layer"]'));
  const formEl = /** @type {HTMLFormElement} */ (demoEl.querySelector('[data-role="graph-terminal-form"]'));
  const inputEl = /** @type {HTMLInputElement} */ (demoEl.querySelector('[data-role="graph-terminal-input"]'));
  const resetEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="graph-terminal-reset"]'));

  const allowedCommands = isMerging ? new Set(["merge", "switch", "checkout", "branch"]) : new Set(["branch", "checkout", "switch"]);
  let state = isMerging ? createMergingInitialState() : createBranchingInitialState();
  /** @type {{positionsByHash: Map<string, {x: number, y: number, branch: string}>, laneX: Map<string, number>, width: number, height: number}} */
  let graphMeta = renderGraphFocusedSvg(svgEl, state);

  /**
   * @returns {void}
   */
  const syncMergingShape = () => {
    if (!isMerging) {
      return;
    }
    const merged = Object.values(state.commits).some((commit) => Array.isArray(commit.parents) && commit.parents.length > 1);
    demoEl.classList.toggle("is-merged", merged);
    demoEl.classList.toggle("is-pre-merge", !merged);
  };

  /**
   * @returns {void}
   */
  const reset = () => {
    state = isMerging ? createMergingInitialState() : createBranchingInitialState();
    layerEl.innerHTML = "";
    graphMeta = renderGraphFocusedSvg(svgEl, state);
    syncMergingShape();
    showGraphToast(layerEl, stageEl, graphMeta, isMerging ? "Diverged branches ready to merge" : "Main has history. Create a branch to begin.");
  };

  /**
   * @param {SubmitEvent} event
   * @returns {void}
   */
  const handleSubmit = (event) => {
    event.preventDefault();
    const rawInput = String(inputEl.value ?? "").trim();
    if (!rawInput) {
      return;
    }

    const parsed = parseCommand(rawInput);
    if (!parsed.ok) {
      showGraphToast(layerEl, stageEl, graphMeta, parsed.reason ?? "Invalid command");
      return;
    }

    if (!allowedCommands.has(parsed.command)) {
      showGraphToast(
        layerEl,
        stageEl,
        graphMeta,
        isMerging ? "Use merge, checkout, switch, or branch here." : "Use branch, checkout, or switch in this section.",
      );
      return;
    }

    const prevState = state;
    const result = runCommand(state, rawInput);
    if (result.error) {
      showGraphToast(layerEl, stageEl, graphMeta, result.error.message ?? "Command failed.");
      return;
    }

    state = result.nextState;
    const prevHashes = new Set(Object.keys(prevState.commits));
    const nextHashes = Object.keys(state.commits);
    const newCommits = new Set(nextHashes.filter((hash) => !prevHashes.has(hash)));
    const prevBranches = new Set(Object.keys(prevState.branches));
    const newBranches = new Set(Object.keys(state.branches).filter((name) => !prevBranches.has(name)));

    graphMeta = renderGraphFocusedSvg(svgEl, state, { newCommits, newBranches });
    syncMergingShape();

    if (parsed.command === "branch") {
      showGraphToast(layerEl, stageEl, graphMeta, `Branch ${parsed.args[0]} created`, { branch: parsed.args[0] });
    } else if (parsed.command === "checkout" || parsed.command === "switch") {
      showGraphToast(layerEl, stageEl, graphMeta, `Now on ${state.detached ? "detached HEAD" : state.HEAD}`, {
        branch: state.detached ? undefined : state.HEAD,
        hash: getHeadHash(state),
      });
    } else if (parsed.command === "merge") {
      const newestHash = [...newCommits][0] ?? getHeadHash(state);
      showGraphToast(layerEl, stageEl, graphMeta, "Tracks converged by merge", { hash: newestHash });
    }

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });

    inputEl.value = "";
  };

  const handleReset = () => {
    reset();
  };

  formEl.addEventListener("submit", handleSubmit);
  resetEl.addEventListener("click", handleReset);
  reset();

  demoControllers.set(section.id, {
    reset,
    dispose() {
      formEl.removeEventListener("submit", handleSubmit);
      resetEl.removeEventListener("click", handleReset);
    },
  });
}

/**
 * @param {{id: string, number: string, heading: string}} section
 * @returns {void}
 */
function mountInteractiveSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl, el } = refs;
  const { zonesMount, terminalMount, resetButton } = createInteractiveDemoShell(demoEl);

  const eventName = `demo:${section.number}:command:submit`;
  let state = createInitialState();

  initZones(zonesMount, { title: "Zone Diagram" });
  renderZones(state, zonesMount);
  if (section.id === "playground") {
    renderCommitGraph(state);
  }

  const terminal = initTerminal(terminalMount, {
    eventName,
    shellId: `terminal-${section.id}`,
    sectionId: section.id,
    autoFocus: false,
    pathLabel: `gitvisual ~/${section.id}`,
  });

  terminal.print(`${section.heading} demo ready.`, "info");

  const handler = (payload) => {
    const rawInput = typeof payload === "string" ? payload : String(payload?.rawInput ?? "").trim();
    const parsed = parseCommand(rawInput);

    if (!parsed.ok) {
      terminal.print(`\u2717 ${parsed.reason}`, "error");
      return;
    }

    const result = runCommand(state, rawInput);
    if (result.error) {
      terminal.print(`\u2717 ${result.error.message ?? "Command failed."}`, "error");
      return;
    }

    state = result.nextState;
    renderZones(state, zonesMount);
    terminal.print(formatSuccess(parsed, result), "success");

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });

    if (section.id === "playground") {
      renderCommitGraph(state);
    }
  };

  on(eventName, handler);

  const reset = () => {
    state = createInitialState();
    terminal.clear();
    terminal.print(`${section.heading} demo reset.`, "info");
    renderZones(state, zonesMount);
    if (section.id === "playground") {
      renderCommitGraph(state);
    }
  };

  resetButton.addEventListener("click", reset);

  const chipButtons = el.querySelectorAll(".command-chip[data-command]");
  chipButtons.forEach((chipEl) => {
    chipEl.addEventListener("click", () => {
      const command = chipEl.getAttribute("data-command");
      if (!command) {
        return;
      }

      terminal.fillInput(command.replace(/^git\s+/i, ""));
      emit("chip:clicked", { command, sectionId: section.id });
    });
  });

  demoControllers.set(section.id, {
    reset,
    dispose() {
      off(eventName, handler);
      resetButton.removeEventListener("click", reset);
    },
  });
}

/**
 * Initialize sections.
 * @returns {{ sectionRefs: Map<string, {el: HTMLElement, demoEl: HTMLElement}>, resetDemo: (sectionId: string) => void }}
 */
export function initSections() {
  if (typeof document === "undefined") {
    return { sectionRefs: new Map(), resetDemo() {} };
  }

  const mainContent = document.getElementById("main-content");
  if (!mainContent) {
    return { sectionRefs: new Map(), resetDemo() {} };
  }

  demoControllers.forEach((controller) => controller.dispose());
  demoControllers.clear();

  mainContent.innerHTML = "";
  sectionRefs.clear();

  const fragment = document.createDocumentFragment();

  for (const section of SECTIONS) {
    const sectionEl = document.createElement("section");
    sectionEl.className = "lesson-section";
    sectionEl.id = section.id;
    sectionEl.setAttribute("data-section", section.id);

    const chipsMarkup =
      section.chips.length === 0
        ? ""
        : `<div class="command-chip-row">${section.chips
            .map(
              (chip) =>
                `<button class="command-chip ${chipToneClass(chip.tone)}" type="button" data-command="${chip.command}">${chip.command}</button>`,
            )
            .join("")}</div>`;

    const bodyMarkup = section.copy.map((line) => `<p class="lesson-copy">${line}</p>`).join("");

    sectionEl.innerHTML = `
      <header class="lesson-header">
        <p class="lesson-number">${section.number}</p>
        <h2 class="lesson-title">${section.heading}</h2>
      </header>
      <div class="lesson-body">
        ${bodyMarkup}
      </div>
      ${chipsMarkup}
      <div class="lesson-demo" data-role="demo-area">
        <p class="lesson-demo-placeholder">Loading demo...</p>
      </div>
    `;

    const demoEl = /** @type {HTMLElement} */ (sectionEl.querySelector('[data-role="demo-area"]'));
    sectionRefs.set(section.id, { el: sectionEl, demoEl });
    fragment.appendChild(sectionEl);
  }

  mainContent.appendChild(fragment);

  for (const section of SECTIONS) {
    if (section.layout === "orientation") {
      mountOrientationSection(section.id);
      continue;
    }

    if (section.layout === "guided-save-workflow") {
      mountGuidedSaveWorkflow(section.id);
      continue;
    }

    if (section.layout === "graph-focused") {
      mountGraphFocusedSection(section);
      continue;
    }

    mountInteractiveSection(section);
  }

  return {
    sectionRefs: new Map(sectionRefs),
    resetDemo(sectionId) {
      const controller = demoControllers.get(sectionId);
      controller?.reset();
    },
  };
}

/**
 * Reset a specific section.
 * @param {string} sectionId
 * @returns {void}
 */
export function resetSection(sectionId) {
  demoControllers.get(sectionId)?.reset();
}
