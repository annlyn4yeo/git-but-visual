import { parseCommand } from "../terminal/parser.js";
import { initTerminal } from "../terminal/index.js";
import { createInitialState, runCommand } from "../simulator/index.js";
import { emit, on, off } from "../utils/events.js";
import { initZones, renderZones } from "./zones.js";

/** @type {Map<string, {el: HTMLElement, demoEl: HTMLElement}>} */
const sectionRefs = new Map();
/** @type {Map<string, {reset: () => void, dispose: () => void}>} */
const demoControllers = new Map();
/** @type {Map<string, number>} */
const nudgeTimeouts = new Map();
const COMPLETION_STORAGE_KEY = "gitvisual:section-completions:v1";

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
    layout: "split-sync-world",
    number: "05",
    heading: "Syncing with Remote",
    copy: [
      "Fetch is always safe and updates your view of remote refs.",
      "Pull is fetch plus merge, so it changes your local branch too.",
    ],
    chips: [],
  },
  {
    id: "undoing-changes",
    layout: "timeline-undo",
    number: "06",
    heading: "Undoing Changes",
    copy: [
      "Reset rewrites pointers and can discard local state if used hard.",
      "Revert is history-safe for shared branches because it adds a new commit.",
    ],
    chips: [],
  },
  {
    id: "stashing",
    layout: "stash-shelf",
    number: "07",
    heading: "Stashing",
    copy: [
      "Stash acts like a clipboard for incomplete work.",
      "Save in-progress changes, switch context, then apply or pop later.",
    ],
    chips: [],
  },
  {
    id: "playground",
    layout: "workspace-playground",
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
 * @param {string} rawInput
 * @param {string} scopeLabel
 * @returns {string}
 */
function scopeRedirectMessage(rawInput, scopeLabel) {
  const normalized = String(rawInput ?? "").trim() || "That command";
  return `${normalized} isn't part of ${scopeLabel} yet. Try it in the Playground.`;
}

/**
 * @returns {Set<string>}
 */
function readCompletionSet() {
  if (typeof window === "undefined" || !window.localStorage) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(COMPLETION_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((item) => typeof item === "string"));
  } catch {
    return new Set();
  }
}

/**
 * @param {Set<string>} completionSet
 * @returns {void}
 */
function writeCompletionSet(completionSet) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify([...completionSet]));
  } catch {
    // Ignore storage write failures.
  }
}

/**
 * @param {string} sectionId
 * @returns {boolean}
 */
function isSectionCompleted(sectionId) {
  return readCompletionSet().has(sectionId);
}

/**
 * @param {string} sectionId
 * @returns {boolean}
 */
function markSectionCompleted(sectionId) {
  if (!sectionId || sectionId === "playground") {
    return false;
  }

  const completionSet = readCompletionSet();
  if (completionSet.has(sectionId)) {
    return false;
  }

  completionSet.add(sectionId);
  writeCompletionSet(completionSet);
  emit("section:completed", { sectionId });
  return true;
}

/**
 * @param {string} sectionId
 * @returns {void}
 */
function showSectionNudge(sectionId) {
  const refs = sectionRefs.get(sectionId);
  if (!refs) {
    return;
  }

  const sectionIndex = SECTIONS.findIndex((item) => item.id === sectionId);
  const nextSection = sectionIndex >= 0 ? SECTIONS[sectionIndex + 1] : null;
  if (!nextSection) {
    return;
  }

  const oldNudge = refs.demoEl.querySelector('[data-role="section-nudge"]');
  if (oldNudge) {
    oldNudge.remove();
  }

  const nudge = document.createElement("p");
  nudge.className = "section-next-nudge";
  nudge.setAttribute("data-role", "section-nudge");
  nudge.textContent = `Core idea unlocked. Continue to ${nextSection.number}: ${nextSection.heading}.`;
  refs.demoEl.appendChild(nudge);

  const removeNudge = () => {
    if (nudge.isConnected) {
      nudge.remove();
    }
  };

  const oldTimeout = nudgeTimeouts.get(sectionId);
  if (oldTimeout) {
    window.clearTimeout(oldTimeout);
  }
  const timeoutId = window.setTimeout(() => {
    removeNudge();
    nudgeTimeouts.delete(sectionId);
  }, 4600);
  nudgeTimeouts.set(sectionId, timeoutId);

  const mainPanel = document.getElementById("main-content");
  if (mainPanel) {
    const onScroll = () => {
      removeNudge();
      mainPanel.removeEventListener("scroll", onScroll);
    };
    mainPanel.addEventListener("scroll", onScroll, { passive: true });
  }
}

/**
 * @param {string} sectionId
 * @returns {void}
 */
function acknowledgeSectionCompletion(sectionId) {
  const isNew = markSectionCompleted(sectionId);
  if (isNew) {
    showSectionNudge(sectionId);
  }
}

/**
 * Emit a state-change event and wait for the interceptor to finish.
 * Falls back to immediate resolve when no interceptor is registered.
 * @param {{
 *   sectionId?: string,
 *   command?: string,
 *   prevState: import("../simulator/state.js").GitState,
 *   nextState: import("../simulator/state.js").GitState,
 *   hints: Array<{type: string} & Record<string, unknown>>,
 *   zonesRoot?: ParentNode | null,
 *   domRefs?: Record<string, unknown>,
 * }} payload
 * @returns {Promise<void>}
 */
function waitForStateChangeInterception(payload) {
  return new Promise((resolve) => {
    /** @type {Record<string, unknown>} */
    const eventPayload = {
      sectionId: payload.sectionId ?? "",
      command: payload.command ?? "",
      prevState: payload.prevState,
      nextState: payload.nextState,
      hints: payload.hints,
      zonesRoot: payload.zonesRoot ?? null,
      domRefs: payload.domRefs ?? {},
      __handled: false,
      resolve,
    };

    emit("state:changed", eventPayload);
    if (eventPayload.__handled !== true) {
      resolve();
    }
  });
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

  const visitedZones = new Set();
  let completionDone = isSectionCompleted(sectionId);
  const zoneEls = demoEl.querySelectorAll(".orientation-zone[data-zone]");

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleZoneSeen = (event) => {
    const zoneEl = /** @type {HTMLElement | null} */ (event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    if (!zoneEl) {
      return;
    }
    const zoneName = zoneEl.getAttribute("data-zone");
    if (!zoneName) {
      return;
    }

    visitedZones.add(zoneName);
    if (!completionDone && visitedZones.size >= 4) {
      acknowledgeSectionCompletion(sectionId);
      completionDone = true;
    }
  };

  zoneEls.forEach((zoneEl) => {
    zoneEl.addEventListener("mouseenter", handleZoneSeen);
    zoneEl.addEventListener("focusin", handleZoneSeen);
  });

  demoControllers.set(sectionId, {
    reset() {},
    dispose() {
      zoneEls.forEach((zoneEl) => {
        zoneEl.removeEventListener("mouseenter", handleZoneSeen);
        zoneEl.removeEventListener("focusin", handleZoneSeen);
      });
    },
  });
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
  let completionDone = isSectionCompleted(sectionId);
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
      if (!completionDone) {
        acknowledgeSectionCompletion(sectionId);
        completionDone = true;
      }
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
  state = withSyntheticWorkingChange(state, "feature-note.md");
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
  const centerSingle = options.centerSingle === true;
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

  if (centerSingle && commits.length === 1) {
    const only = commits[0];
    const point = positionsByHash.get(only.hash);
    if (point) {
      point.x = width * 0.5;
      point.y = height * 0.5;
    }
  }

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
    if (centerSingle && commits.length === 1) {
      laneX.set(name, width * 0.5);
      return;
    }
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
  let completionDone = isSectionCompleted(section.id);
  let hasCreatedBranch = false;
  let hasCommittedOnBranch = false;
  const chipCommands = isMerging
    ? [{ command: "git merge feature/auth", tone: "history" }]
    : [
        { command: "git branch feature/ui", tone: "history" },
        { command: "git switch feature/ui", tone: "history" },
        { command: "git add .", tone: "staging" },
        { command: 'git commit -m "Feature pass"', tone: "history" },
      ];

  demoEl.innerHTML = `
    <div class="graph-focus-demo ${isMerging ? "graph-focus-merging" : "graph-focus-branching"}" data-role="graph-focus-demo">
      <div class="graph-focus-stage" data-role="graph-stage">
        <svg class="graph-focus-svg" data-role="graph-svg" viewBox="0 0 900 520" preserveAspectRatio="xMidYMid meet" aria-label="Commit graph walkthrough"></svg>
        <div class="graph-transient-layer" data-role="graph-transient-layer"></div>
      </div>
      <div class="sync-command-row">
        ${chipCommands
          .map(
            (chip) =>
              `<button class="command-chip ${chipToneClass(chip.tone)}" type="button" data-command="${chip.command}">${chip.command}</button>`,
          )
          .join("")}
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
  const commandChipEls = demoEl.querySelectorAll(".sync-command-row [data-command]");

  const allowedCommands = isMerging
    ? new Set(["merge"])
    : new Set(["branch", "checkout", "switch", "add", "commit"]);
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
    hasCreatedBranch = false;
    hasCommittedOnBranch = false;
    layerEl.innerHTML = "";
    graphMeta = renderGraphFocusedSvg(svgEl, state);
    syncMergingShape();
    showGraphToast(layerEl, stageEl, graphMeta, isMerging ? "Diverged branches ready to merge" : "Main has history. Create a branch to begin.");
  };

  /**
   * @param {SubmitEvent} event
   * @returns {void}
   */
  /**
   * @param {string} rawInput
   * @returns {void}
   */
  const executeCommand = (rawInput) => {
    const normalizedInput = String(rawInput ?? "").trim();
    const rawInputText = normalizedInput;
    if (!normalizedInput) {
      return;
    }

    const parsed = parseCommand(rawInputText);
    if (!parsed.ok) {
      showGraphToast(layerEl, stageEl, graphMeta, parsed.reason ?? "Invalid command");
      return;
    }

    if (!allowedCommands.has(parsed.command)) {
      showGraphToast(
        layerEl,
        stageEl,
        graphMeta,
        scopeRedirectMessage(rawInputText, isMerging ? "the merging section" : "the branching section"),
      );
      return;
    }

    const prevState = state;
    const result = runCommand(state, rawInputText);
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
      hasCreatedBranch = true;
      showGraphToast(layerEl, stageEl, graphMeta, `Branch ${parsed.args[0]} created`, { branch: parsed.args[0] });
    } else if (parsed.command === "checkout" || parsed.command === "switch") {
      showGraphToast(layerEl, stageEl, graphMeta, `Now on ${state.detached ? "detached HEAD" : state.HEAD}`, {
        branch: state.detached ? undefined : state.HEAD,
        hash: getHeadHash(state),
      });
    } else if (parsed.command === "add") {
      showGraphToast(layerEl, stageEl, graphMeta, "Staged for commit on current branch");
    } else if (parsed.command === "commit") {
      const committedOnFeature = !result.prevState.detached && result.prevState.HEAD !== "main";
      if (committedOnFeature) {
        hasCommittedOnBranch = true;
      }
      showGraphToast(
        layerEl,
        stageEl,
        graphMeta,
        committedOnFeature ? "Commit added on feature branch" : "Commit added",
      );
    } else if (parsed.command === "merge") {
      const newestHash = [...newCommits][0] ?? getHeadHash(state);
      showGraphToast(layerEl, stageEl, graphMeta, "Tracks converged by merge", { hash: newestHash });
      if (isMerging && !completionDone) {
        acknowledgeSectionCompletion(section.id);
        completionDone = true;
      }
    }

    if (!isMerging && hasCreatedBranch && hasCommittedOnBranch && !completionDone) {
      acknowledgeSectionCompletion(section.id);
      completionDone = true;
    }

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const rawInput = String(inputEl.value ?? "").trim();
    executeCommand(rawInput);
    inputEl.value = "";
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleChipClick = (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target) {
      return;
    }
    const button = target.closest("[data-command]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const command = button.getAttribute("data-command");
    if (!command) {
      return;
    }
    executeCommand(command);
  };

  const handleReset = () => {
    reset();
  };

  formEl.addEventListener("submit", handleSubmit);
  resetEl.addEventListener("click", handleReset);
  commandChipEls.forEach((chipEl) => chipEl.addEventListener("click", handleChipClick));
  reset();

  demoControllers.set(section.id, {
    reset,
    dispose() {
      formEl.removeEventListener("submit", handleSubmit);
      resetEl.removeEventListener("click", handleReset);
      commandChipEls.forEach((chipEl) => chipEl.removeEventListener("click", handleChipClick));
    },
  });
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @param {string} seed
 * @returns {string}
 */
function createSyntheticHash(state, seed) {
  let hash = 5381;
  const value = `${seed}|${Date.now()}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }

  let candidate = hash.toString(16).padStart(8, "0").slice(0, 7);
  let suffix = 0;
  while (Object.hasOwn(state.commits, candidate)) {
    suffix += 1;
    const mixed = (hash + suffix * 1013904223) >>> 0;
    candidate = mixed.toString(16).padStart(8, "0").slice(0, 7);
  }

  return candidate;
}

/**
 * @returns {import("../simulator/state.js").GitState}
 */
function createSyncingInitialState() {
  const base = createBranchingInitialState();
  const nextState = structuredClone(base);
  const remoteParent = nextState.remoteBranches.main;
  const remoteHash = createSyntheticHash(nextState, "remote-sync-ahead");

  nextState.commits[remoteHash] = {
    hash: remoteHash,
    message: "Remote: CI workflow update",
    parents: remoteParent ? [remoteParent] : [],
    branch: "main",
    timestamp: Date.now() - 2500,
  };
  nextState.remoteBranches.main = remoteHash;
  nextState.trackingBranches.main = "origin/main";

  return nextState;
}

/**
 * @param {Record<string, import("../simulator/state.js").CommitObject>} commits
 * @param {string | null | undefined} headHash
 * @param {number} [limit=6]
 * @returns {Array<import("../simulator/state.js").CommitObject>}
 */
function getFirstParentChain(commits, headHash, limit = 6) {
  const chain = [];
  const seen = new Set();
  let current = headHash ?? null;

  while (current && !seen.has(current) && chain.length < limit) {
    const commit = commits[current];
    if (!commit) {
      break;
    }

    chain.push(commit);
    seen.add(current);
    current = Array.isArray(commit.parents) && commit.parents.length > 0 ? commit.parents[0] : null;
  }

  return chain;
}

/**
 * @param {"local" | "remote"} side
 * @param {Array<import("../simulator/state.js").CommitObject>} chain
 * @param {string | null | undefined} tipHash
 * @returns {string}
 */
function renderSyncHistory(side, chain, tipHash) {
  const sideLabel = side === "local" ? "Local" : "Remote";
  const refName = side === "local" ? "main" : "origin/main";
  return `
    <div class="sync-history-header">
      <span class="sync-side-title">${sideLabel}</span>
      <span class="sync-ref-pill">${refName}</span>
    </div>
    <div class="sync-history-list">
      ${chain
        .map((commit, index) => {
          const isTip = commit.hash === tipHash;
          const rowClass = isTip ? "sync-history-row is-tip" : "sync-history-row";
          const lineClass = index === chain.length - 1 ? "sync-history-line is-end" : "sync-history-line";
          return `
            <div class="${rowClass}">
              <span class="sync-history-node" aria-hidden="true"></span>
              <span class="${lineClass}" aria-hidden="true"></span>
              <span class="sync-history-hash">${commit.hash.slice(0, 7)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

/**
 * @param {HTMLElement} layerEl
 * @param {string} message
 * @param {"left" | "center" | "right"} anchor
 * @returns {void}
 */
function showSyncToast(layerEl, message, anchor) {
  const toast = document.createElement("div");
  toast.className = `sync-transient-label sync-transient-${anchor}`;
  toast.textContent = message;
  layerEl.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 1300);
}

/**
 * @param {HTMLElement} pulseEl
 * @param {"rtl-tracking" | "ltr-remote"} mode
 * @returns {Promise<void>}
 */
function playSyncPulse(pulseEl, mode) {
  return new Promise((resolve) => {
    pulseEl.classList.remove("is-active", "pulse-rtl-tracking", "pulse-ltr-remote");
    // Force reflow so restarting animation is reliable.
    void pulseEl.offsetWidth;
    pulseEl.classList.add("is-active", `pulse-${mode}`);

    const complete = () => {
      pulseEl.classList.remove("is-active", `pulse-${mode}`);
      pulseEl.removeEventListener("animationend", complete);
      resolve();
    };

    pulseEl.addEventListener("animationend", complete, { once: true });
  });
}

/**
 * @param {{id: string, number: string}} section
 * @returns {void}
 */
function mountSplitSyncWorldSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  demoEl.innerHTML = `
    <div class="sync-world-demo" data-role="sync-world-demo">
      <div class="sync-command-row">
        <button class="command-chip chip-tone-remote" type="button" data-command="git fetch">git fetch</button>
        <button class="command-chip chip-tone-history" type="button" data-command="git merge origin/main">git merge origin/main</button>
        <button class="command-chip chip-tone-remote" type="button" data-command="git pull">git pull</button>
        <button class="command-chip chip-tone-remote" type="button" data-command="git push">git push</button>
      </div>
      <div class="sync-world-stage" data-role="sync-world-stage">
        <section class="sync-world-side sync-world-local" data-role="sync-local"></section>
        <div class="sync-world-channel">
          <div class="sync-channel-line" aria-hidden="true"></div>
          <div class="sync-tracking-ref" data-role="sync-tracking-ref">origin/main</div>
          <div class="sync-channel-pulse" data-role="sync-channel-pulse" aria-hidden="true"></div>
        </div>
        <section class="sync-world-side sync-world-remote" data-role="sync-remote"></section>
        <div class="sync-transient-layer" data-role="sync-transient-layer"></div>
      </div>
      <form class="graph-mini-terminal" data-role="sync-terminal-form">
        <span class="graph-mini-prompt" aria-hidden="true">gitvisual ~/syncing-remote $</span>
        <input class="graph-mini-input" data-role="sync-terminal-input" type="text" autocomplete="off" spellcheck="false" placeholder="try: git fetch | git merge origin/main | git pull | git push" />
        <button class="graph-mini-reset" type="button" data-role="sync-reset">Reset</button>
      </form>
    </div>
  `;

  const localEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="sync-local"]'));
  const remoteEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="sync-remote"]'));
  const layerEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="sync-transient-layer"]'));
  const pulseEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="sync-channel-pulse"]'));
  const trackingRefEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="sync-tracking-ref"]'));
  const formEl = /** @type {HTMLFormElement} */ (demoEl.querySelector('[data-role="sync-terminal-form"]'));
  const inputEl = /** @type {HTMLInputElement} */ (demoEl.querySelector('[data-role="sync-terminal-input"]'));
  const resetEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="sync-reset"]'));
  const commandChipEls = demoEl.querySelectorAll(".sync-command-row [data-command]");

  let state = createSyncingInitialState();
  let trackingHash = state.branches[state.HEAD];
  let isRunning = false;
  let sawFetch = false;
  let sawPull = false;
  let completionDone = isSectionCompleted(section.id);

  /**
   * @returns {void}
   */
  const renderWorlds = () => {
    const branch = state.detached ? "main" : state.HEAD;
    const localTip = state.branches[branch] ?? null;
    const remoteTip = state.remoteBranches[branch] ?? null;
    const localChain = getFirstParentChain(state.commits, localTip, 6);
    const remoteChain = getFirstParentChain(state.commits, remoteTip, 6);

    localEl.innerHTML = renderSyncHistory("local", localChain, localTip);
    remoteEl.innerHTML = renderSyncHistory("remote", remoteChain, remoteTip);

    const trackingInSync = Boolean(trackingHash && remoteTip && trackingHash === remoteTip);
    trackingRefEl.classList.toggle("is-updated", trackingInSync);
  };

  /**
   * @param {string} rawInput
   * @returns {Promise<void>}
   */
  const executeCommand = async (rawInput) => {
    if (isRunning) {
      return;
    }

    const parsed = parseCommand(rawInput);
    if (!parsed.ok) {
      showSyncToast(layerEl, parsed.reason ?? "Invalid command.", "center");
      return;
    }

    if (!["fetch", "merge", "pull", "push"].includes(parsed.command)) {
      showSyncToast(layerEl, scopeRedirectMessage(rawInput, "the sync section"), "center");
      return;
    }

    isRunning = true;
    const branch = state.detached ? "main" : state.HEAD;
    const remoteTipBefore = state.remoteBranches[branch] ?? null;
    /** @type {import("../simulator/result.js").CommandResult | null} */
    let executedResult = null;

    try {
      if (parsed.command === "fetch") {
        sawFetch = true;
        await playSyncPulse(pulseEl, "rtl-tracking");
        const result = runCommand(state, "git fetch");
        if (result.error) {
          showSyncToast(layerEl, result.error.message ?? "Fetch failed.", "center");
          return;
        }
        executedResult = result;
        state = result.nextState;
        trackingHash = state.remoteBranches[branch] ?? trackingHash;
        renderWorlds();
        showSyncToast(layerEl, "Tracking ref updated", "center");
      } else if (parsed.command === "merge") {
        const remoteTip = state.remoteBranches[branch] ?? null;
        if (!remoteTip || trackingHash !== remoteTip) {
          showSyncToast(layerEl, "Fetch first so tracking is current.", "center");
          return;
        }

        const mergeTarget = parsed.args[0] ? rawInput : "git merge origin/main";
        const result = runCommand(state, mergeTarget);
        if (result.error) {
          showSyncToast(layerEl, result.error.message ?? "Merge failed.", "left");
          return;
        }
        executedResult = result;
        state = result.nextState;
        localEl.classList.add("is-updating");
        renderWorlds();
        showSyncToast(layerEl, "Local history merged", "left");
        window.setTimeout(() => localEl.classList.remove("is-updating"), 420);
      } else if (parsed.command === "pull") {
        sawPull = true;
        await playSyncPulse(pulseEl, "rtl-tracking");
        const result = runCommand(state, "git pull");
        if (result.error) {
          showSyncToast(layerEl, result.error.message ?? "Pull failed.", "center");
          return;
        }
        executedResult = result;
        state = result.nextState;
        trackingHash = state.remoteBranches[branch] ?? trackingHash;
        renderWorlds();
        localEl.classList.add("is-updating");
        showSyncToast(layerEl, "Fetched then merged", "left");
        window.setTimeout(() => localEl.classList.remove("is-updating"), 460);
      } else if (parsed.command === "push") {
        await playSyncPulse(pulseEl, "ltr-remote");
        const result = runCommand(state, "git push");
        if (result.error) {
          showSyncToast(layerEl, result.error.message ?? "Push failed.", "right");
          return;
        }
        executedResult = result;
        state = result.nextState;
        renderWorlds();
        const remoteTipAfter = state.remoteBranches[branch] ?? null;
        if (remoteTipAfter !== remoteTipBefore) {
          remoteEl.classList.add("is-updating");
          window.setTimeout(() => remoteEl.classList.remove("is-updating"), 420);
        }
        showSyncToast(layerEl, "Remote updated", "right");
      }

      if (executedResult) {
        emit(`demo:${section.number}:state:changed`, {
          sectionId: section.id,
          prevState: executedResult.prevState,
          nextState: executedResult.nextState,
          hints: executedResult.animationHints,
        });
      }

      if (sawFetch && sawPull && !completionDone) {
        acknowledgeSectionCompletion(section.id);
        completionDone = true;
      }
    } finally {
      isRunning = false;
    }
  };

  /**
   * @returns {void}
   */
  const reset = () => {
    state = createSyncingInitialState();
    trackingHash = state.branches[state.HEAD];
    sawFetch = false;
    sawPull = false;
    localEl.classList.remove("is-updating");
    remoteEl.classList.remove("is-updating");
    layerEl.innerHTML = "";
    renderWorlds();
    showSyncToast(layerEl, "Two worlds start diverged", "center");
  };

  /**
   * @param {SubmitEvent} event
   * @returns {void}
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    const rawInput = String(inputEl.value ?? "").trim();
    if (!rawInput) {
      return;
    }
    await executeCommand(rawInput);
    inputEl.value = "";
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleChipClick = async (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target) {
      return;
    }
    const button = target.closest("[data-command]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const command = button.getAttribute("data-command");
    if (!command) {
      return;
    }
    await executeCommand(command);
  };

  const handleReset = () => reset();

  formEl.addEventListener("submit", handleSubmit);
  resetEl.addEventListener("click", handleReset);
  commandChipEls.forEach((chipEl) => chipEl.addEventListener("click", handleChipClick));
  reset();

  demoControllers.set(section.id, {
    reset,
    dispose() {
      formEl.removeEventListener("submit", handleSubmit);
      resetEl.removeEventListener("click", handleReset);
      commandChipEls.forEach((chipEl) => chipEl.removeEventListener("click", handleChipClick));
    },
  });
}

/**
 * @returns {import("../simulator/state.js").GitState}
 */
function createUndoTimelineInitialState() {
  let state = createInitialState();

  const seedCommits = [
    { file: "layout.css", message: "Refine layout spacing" },
    { file: "menu.js", message: "Add menu interactions" },
    { file: "api-client.js", message: "Wire API client" },
    { file: "theme.css", message: "Tune visual theme" },
  ];

  for (const item of seedCommits) {
    state = withSyntheticWorkingChange(state, item.file);
    state = runCommandOrKeep(state, "git add .");
    state = runCommandOrKeep(state, `git commit -m "${item.message}"`);
  }

  const nextState = structuredClone(state);
  nextState.stagingArea = [{ name: "draft-plan.md", status: "modified" }];
  nextState.workingDirectory = [{ name: "experiment.css", status: "modified" }];
  return nextState;
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @returns {Set<string>}
 */
function getReachableHashes(state) {
  const reachable = new Set();
  const stack = Object.values(state.branches);

  while (stack.length > 0) {
    const hash = stack.pop();
    if (!hash || reachable.has(hash)) {
      continue;
    }

    reachable.add(hash);
    const commit = state.commits[hash];
    if (!commit || !Array.isArray(commit.parents)) {
      continue;
    }

    for (const parentHash of commit.parents) {
      if (parentHash && !reachable.has(parentHash)) {
        stack.push(parentHash);
      }
    }
  }

  return reachable;
}

/**
 * @param {import("../simulator/state.js").GitState} state
 * @returns {Array<import("../simulator/state.js").CommitObject>}
 */
function getTimelineCommits(state) {
  return Object.values(state.commits).sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.hash.localeCompare(b.hash);
  });
}

/**
 * @param {{id: string, number: string}} section
 * @returns {void}
 */
function mountTimelineUndoSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  demoEl.innerHTML = `
    <div class="undo-timeline-demo">
      <div class="sync-command-row undo-command-row">
        <button class="command-chip chip-tone-destructive" type="button" data-command="git reset --soft HEAD~1">git reset --soft HEAD~1</button>
        <button class="command-chip chip-tone-destructive" type="button" data-command="git reset --mixed HEAD~1">git reset --mixed HEAD~1</button>
        <button class="command-chip chip-tone-destructive" type="button" data-command="git reset --hard HEAD~1">git reset --hard HEAD~1</button>
        <button class="command-chip chip-tone-history" type="button" data-role="undo-revert-chip">git revert</button>
      </div>
      <div class="undo-timeline-shell" data-role="undo-timeline-shell"></div>
      <div class="undo-reset-indicator" data-role="undo-indicator"></div>
      <p class="undo-command-note" data-role="undo-note"></p>
      <form class="graph-mini-terminal" data-role="undo-terminal-form">
        <span class="graph-mini-prompt" aria-hidden="true">gitvisual ~/undoing-changes $</span>
        <input class="graph-mini-input" data-role="undo-terminal-input" type="text" autocomplete="off" spellcheck="false" placeholder="try: git reset --hard HEAD~2 or git revert" />
        <button class="graph-mini-reset" type="button" data-role="undo-reset">Reset</button>
      </form>
    </div>
  `;

  const timelineEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="undo-timeline-shell"]'));
  const indicatorEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="undo-indicator"]'));
  const noteEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="undo-note"]'));
  const formEl = /** @type {HTMLFormElement} */ (demoEl.querySelector('[data-role="undo-terminal-form"]'));
  const inputEl = /** @type {HTMLInputElement} */ (demoEl.querySelector('[data-role="undo-terminal-input"]'));
  const resetEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="undo-reset"]'));
  const revertChipEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="undo-revert-chip"]'));
  const commandChipEls = demoEl.querySelectorAll(".undo-command-row [data-command], .undo-command-row [data-role='undo-revert-chip']");

  let state = createUndoTimelineInitialState();
  /** @type {{kind: "idle" | "reset" | "revert", mode?: "soft"|"mixed"|"hard", message: string}} */
  let status = { kind: "idle", message: "Timeline ready: reset moves back, revert moves forward." };
  let sawReset = false;
  let sawRevert = false;
  let completionDone = isSectionCompleted(section.id);

  /**
   * @returns {void}
   */
  const renderTimeline = () => {
    const commits = getTimelineCommits(state);
    const headHash = getHeadHash(state);
    const reachable = getReachableHashes(state);
    const headIndex = Math.max(
      0,
      commits.findIndex((commit) => commit.hash === headHash),
    );
    const maxIndex = Math.max(1, commits.length - 1);
    const playheadPercent = (headIndex / maxIndex) * 100;

    timelineEl.innerHTML = `
      <div class="undo-timeline-track">
        <div class="undo-timeline-line" aria-hidden="true"></div>
        <div class="undo-commit-row" style="grid-template-columns: repeat(${commits.length}, minmax(84px, 1fr));">
          ${commits
            .map((commit) => {
              const isHead = commit.hash === headHash;
              const isReachable = reachable.has(commit.hash);
              const classes = [
                "undo-commit-cell",
                isHead ? "is-head" : "",
                isReachable ? "is-reachable" : "is-unreachable",
              ]
                .filter(Boolean)
                .join(" ");
              return `
                <article class="${classes}">
                  <span class="undo-commit-point" aria-hidden="true"></span>
                  <p class="undo-commit-hash">${commit.hash.slice(0, 7)}</p>
                </article>
              `;
            })
            .join("")}
        </div>
        <div class="undo-playhead" style="left: calc(${playheadPercent}%);">
          <span class="undo-playhead-label">HEAD</span>
        </div>
      </div>
    `;

    if (revertChipEl) {
      revertChipEl.setAttribute("data-command", `git revert ${headHash.slice(0, 7)}`);
      revertChipEl.textContent = "git revert";
    }
  };

  /**
   * @returns {void}
   */
  const renderIndicator = () => {
    if (status.kind === "reset") {
      const modeClass = status.mode ? `is-${status.mode}` : "";
      indicatorEl.className = `undo-reset-indicator ${modeClass}`.trim();
      indicatorEl.innerHTML = `
        <span class="undo-indicator-pill">reset --${status.mode}</span>
        <span class="undo-indicator-copy">${status.message}</span>
      `;
      noteEl.textContent = "";
      return;
    }

    if (status.kind === "revert") {
      indicatorEl.className = "undo-reset-indicator is-revert";
      indicatorEl.innerHTML = `
        <span class="undo-indicator-pill">revert</span>
        <span class="undo-indicator-copy">${status.message}</span>
      `;
      noteEl.textContent = "";
      return;
    }

    indicatorEl.className = "undo-reset-indicator";
    indicatorEl.innerHTML = `
      <span class="undo-indicator-pill">status</span>
      <span class="undo-indicator-copy">${status.message}</span>
    `;
    noteEl.textContent = "";
  };

  /**
   * @returns {void}
   */
  const renderUndo = () => {
    renderTimeline();
    renderIndicator();
  };

  /**
   * @param {string} rawInput
   * @returns {void}
   */
  const executeCommand = (rawInput) => {
    const normalized = String(rawInput ?? "").trim();
    if (!normalized) {
      return;
    }

    const parsed = parseCommand(normalized);
    if (!parsed.ok) {
      noteEl.textContent = parsed.reason ?? "Invalid command.";
      return;
    }

    if (!["reset", "revert"].includes(parsed.command)) {
      noteEl.textContent = scopeRedirectMessage(normalized, "the undo section");
      return;
    }

    let commandToRun = normalized;
    if (parsed.command === "revert" && parsed.args.length === 0) {
      commandToRun = `git revert ${getHeadHash(state)}`;
    }

    const result = runCommand(state, commandToRun);
    if (result.error) {
      noteEl.textContent = result.error.message ?? "Command failed.";
      return;
    }

    state = result.nextState;
    const resetHint = (result.animationHints ?? []).find((hint) => hint.type === "RESET_PERFORMED");
    const revertHint = (result.animationHints ?? []).find((hint) => hint.type === "REVERT_COMMIT");

    if (resetHint && typeof resetHint.mode === "string") {
      sawReset = true;
      /** @type {"soft"|"mixed"|"hard"} */
      const mode = resetHint.mode;
      if (mode === "soft") {
        status = {
          kind: "reset",
          mode,
          message: "Soft reset keeps changes staged.",
        };
      } else if (mode === "mixed") {
        status = {
          kind: "reset",
          mode,
          message: "Mixed reset returns files to working directory.",
        };
      } else {
        status = {
          kind: "reset",
          mode,
          message: "Hard reset clears working and staged changes.",
        };
      }
    } else if (revertHint) {
      sawRevert = true;
      status = {
        kind: "revert",
        message: "Revert creates a new commit to move history forward.",
      };
    } else {
      status = { kind: "idle", message: "Timeline updated." };
    }

    if (sawReset && sawRevert && !completionDone) {
      acknowledgeSectionCompletion(section.id);
      completionDone = true;
    }

    renderUndo();
    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });
  };

  /**
   * @returns {void}
   */
  const reset = () => {
    state = createUndoTimelineInitialState();
    status = { kind: "idle", message: "Timeline ready: reset moves back, revert moves forward." };
    sawReset = false;
    sawRevert = false;
    renderUndo();
  };

  /**
   * @param {SubmitEvent} event
   * @returns {void}
   */
  const handleSubmit = (event) => {
    event.preventDefault();
    const rawInput = String(inputEl.value ?? "").trim();
    executeCommand(rawInput);
    inputEl.value = "";
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleChipClick = (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target) {
      return;
    }
    const button = target.closest("[data-command]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const command = button.getAttribute("data-command");
    if (!command) {
      return;
    }
    executeCommand(command);
  };

  const handleReset = () => reset();

  formEl.addEventListener("submit", handleSubmit);
  resetEl.addEventListener("click", handleReset);
  commandChipEls.forEach((chipEl) => chipEl.addEventListener("click", handleChipClick));
  reset();

  demoControllers.set(section.id, {
    reset,
    dispose() {
      formEl.removeEventListener("submit", handleSubmit);
      resetEl.removeEventListener("click", handleReset);
      commandChipEls.forEach((chipEl) => chipEl.removeEventListener("click", handleChipClick));
    },
  });
}

/**
 * @param {{id: string, number: string}} section
 * @returns {void}
 */
function mountStashShelfSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  demoEl.innerHTML = `
    <div class="stash-shelf-demo">
      <div class="sync-command-row stash-command-row">
        <button class="command-chip chip-tone-staging" type="button" data-command="git stash">git stash</button>
        <button class="command-chip chip-tone-staging" type="button" data-command="git stash pop">git stash pop</button>
        <button class="command-chip chip-tone-staging" type="button" data-command="git stash apply">git stash apply</button>
        <button class="command-chip chip-tone-staging" type="button" data-command="git stash list">git stash list</button>
      </div>

      <div class="stash-stage" data-role="stash-stage">
        <section class="stash-working-area">
          <header class="stash-area-header">
            <h3 class="stash-area-title">Working Area</h3>
          </header>
          <div class="stash-working-cards" data-role="stash-working-cards"></div>
        </section>

        <aside class="stash-shelf-area">
          <header class="stash-area-header">
            <h3 class="stash-area-title">Stash Shelf</h3>
          </header>
          <div class="stash-shelf-bin" data-role="stash-shelf-bin">
            <div class="stash-shelf-empty" data-role="stash-shelf-empty">
              <span class="stash-shelf-empty-icon" aria-hidden="true">[ ]</span>
              <span class="stash-shelf-empty-copy">Shelf is empty</span>
            </div>
            <div class="stash-stack" data-role="stash-stack"></div>
          </div>
        </aside>
      </div>

      <div class="stash-terminal-output" data-role="stash-output"></div>
      <form class="graph-mini-terminal" data-role="stash-terminal-form">
        <span class="graph-mini-prompt" aria-hidden="true">gitvisual ~/stashing $</span>
        <input class="graph-mini-input" data-role="stash-terminal-input" type="text" autocomplete="off" spellcheck="false" placeholder="try: git stash | git stash pop | git stash apply | git stash list" />
        <button class="graph-mini-reset" type="button" data-role="stash-reset">Reset</button>
      </form>
    </div>
  `;

  const workingCardsEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="stash-working-cards"]'));
  const stackEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="stash-stack"]'));
  const emptyEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="stash-shelf-empty"]'));
  const outputEl = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="stash-output"]'));
  const formEl = /** @type {HTMLFormElement} */ (demoEl.querySelector('[data-role="stash-terminal-form"]'));
  const inputEl = /** @type {HTMLInputElement} */ (demoEl.querySelector('[data-role="stash-terminal-input"]'));
  const resetEl = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="stash-reset"]'));
  const commandChipEls = demoEl.querySelectorAll(".stash-command-row [data-command]");

  let state = createInitialState();
  let isAnimating = false;
  let didStash = false;
  let didPop = false;
  let completionDone = isSectionCompleted(section.id);

  /**
   * @param {string} value
   * @returns {string}
   */
  const sanitize = (value) => escapeHtml(value);

  /**
   * @param {"info"|"success"|"error"} tone
   * @param {string} text
   * @returns {void}
   */
  const printOutput = (tone, text) => {
    const line = document.createElement("p");
    line.className = `stash-output-line is-${tone}`;
    line.textContent = text;
    outputEl.appendChild(line);
    const lines = outputEl.querySelectorAll(".stash-output-line");
    if (lines.length > 7) {
      lines[0]?.remove();
    }
    outputEl.scrollTop = outputEl.scrollHeight;
  };

  /**
   * @returns {void}
   */
  const renderShelf = () => {
    workingCardsEl.innerHTML = state.workingDirectory
      .map(
        (file) => `
          <article class="stash-working-card" data-file="${sanitize(file.name)}">
            <p class="stash-working-name">${sanitize(file.name)}</p>
            <p class="stash-working-status">${sanitize(file.status)}</p>
          </article>
        `,
      )
      .join("");

    stackEl.innerHTML = state.stash
      .map((entry, index) => {
        const isTop = index === 0;
        return `
          <article class="stash-entry ${isTop ? "is-top" : ""}" data-entry="${sanitize(entry.id)}" style="--stack-depth:${index};">
            <p class="stash-entry-id">${sanitize(entry.id)}</p>
            <div class="stash-entry-files">
              ${entry.files
                .slice(0, 4)
                .map((file) => `<span class="stash-entry-file" data-file="${sanitize(file.name)}">${sanitize(file.name)}</span>`)
                .join("")}
            </div>
          </article>
        `;
      })
      .join("");

    const hasStash = state.stash.length > 0;
    emptyEl.hidden = hasStash;
    stackEl.hidden = !hasStash;
  };

  /**
   * @param {string[]} fileNames
   * @returns {Map<string, DOMRect>}
   */
  const captureWorkingRects = (fileNames) => {
    const map = new Map();
    for (const name of fileNames) {
      const card = workingCardsEl.querySelector(`[data-file="${CSS.escape(name)}"]`);
      if (card instanceof HTMLElement) {
        map.set(name, card.getBoundingClientRect());
      }
    }
    return map;
  };

  /**
   * @returns {Map<string, DOMRect>}
   */
  const captureTopEntryRects = () => {
    const map = new Map();
    const topEntry = stackEl.querySelector(".stash-entry.is-top");
    if (!(topEntry instanceof HTMLElement)) {
      return map;
    }
    const fileEls = topEntry.querySelectorAll(".stash-entry-file[data-file]");
    fileEls.forEach((fileEl) => {
      if (!(fileEl instanceof HTMLElement)) {
        return;
      }
      const fileName = fileEl.getAttribute("data-file");
      if (!fileName) {
        return;
      }
      map.set(fileName, fileEl.getBoundingClientRect());
    });
    return map;
  };

  /**
   * @param {string[]} fileNames
   * @returns {Map<string, DOMRect>}
   */
  const captureTopEntryTargetRects = (fileNames) => {
    const map = new Map();
    const topEntry = stackEl.querySelector(".stash-entry.is-top");
    if (!(topEntry instanceof HTMLElement)) {
      return map;
    }
    for (const name of fileNames) {
      const fileEl = topEntry.querySelector(`[data-file="${CSS.escape(name)}"]`);
      if (fileEl instanceof HTMLElement) {
        map.set(name, fileEl.getBoundingClientRect());
      }
    }
    return map;
  };

  /**
   * @param {string[]} fileNames
   * @returns {Map<string, DOMRect>}
   */
  const captureWorkingTargetRects = (fileNames) => {
    const map = new Map();
    for (const name of fileNames) {
      const card = workingCardsEl.querySelector(`[data-file="${CSS.escape(name)}"]`);
      if (card instanceof HTMLElement) {
        map.set(name, card.getBoundingClientRect());
      }
    }
    return map;
  };

  /**
   * @param {Map<string, DOMRect>} fromRects
   * @param {Map<string, DOMRect>} toRects
   * @param {{drop?: boolean}} [options]
   * @returns {Promise<void>}
   */
  const animateRectFlight = async (fromRects, toRects, options = {}) => {
    const ghosts = [];

    for (const [name, from] of fromRects.entries()) {
      const to = toRects.get(name);
      if (!to) {
        continue;
      }

      const ghost = document.createElement("div");
      ghost.className = "stash-flight-ghost";
      ghost.textContent = name;
      ghost.style.left = `${from.left}px`;
      ghost.style.top = `${from.top}px`;
      ghost.style.width = `${from.width}px`;
      ghost.style.height = `${from.height}px`;
      document.body.appendChild(ghost);

      const deltaX = to.left - from.left;
      const deltaY = to.top - from.top;
      const rotate = options.drop ? 6 : -4;

      const animation = ghost.animate(
        [
          { transform: "translate(0px, 0px) scale(1) rotate(0deg)", opacity: 1, offset: 0 },
          {
            transform: `translate(${deltaX}px, ${deltaY}px) scale(0.82) rotate(${rotate}deg)`,
            opacity: 0.96,
            offset: 1,
          },
        ],
        {
          duration: 560,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );

      ghosts.push({ ghost, animation });
    }

    if (ghosts.length === 0) {
      return;
    }

    await Promise.all(ghosts.map(({ animation }) => animation.finished.catch(() => {})));
    ghosts.forEach(({ ghost }) => ghost.remove());
  };

  /**
   * @returns {void}
   */
  const reset = () => {
    state = createInitialState();
    didStash = false;
    didPop = false;
    outputEl.innerHTML = "";
    printOutput("info", "Shelf ready. Try git stash.");
    renderShelf();
  };

  /**
   * @param {string} rawInput
   * @returns {Promise<void>}
   */
  const executeCommand = async (rawInput) => {
    if (isAnimating) {
      return;
    }

    const command = String(rawInput ?? "").trim();
    if (!command) {
      return;
    }

    const parsed = parseCommand(command);
    if (!parsed.ok) {
      printOutput("error", parsed.reason ?? "Invalid command.");
      return;
    }

    if (!["stash", "stash:pop", "stash:apply", "stash:list"].includes(parsed.command)) {
      printOutput("info", scopeRedirectMessage(command, "the stash section"));
      return;
    }

    const preWorkingFiles = state.workingDirectory.map((file) => file.name);
    const preTopEntryRects = captureTopEntryRects();
    const preWorkingRects = captureWorkingRects(preWorkingFiles);
    const result = runCommand(state, command);
    if (result.error) {
      printOutput("error", result.error.message ?? "Command failed.");
      return;
    }

    state = result.nextState;
    renderShelf();

    if (parsed.command === "stash:list") {
      if (state.stash.length === 0) {
        printOutput("info", "stash list is empty");
      } else {
        state.stash.forEach((entry) => {
          printOutput("info", `${entry.id}: ${entry.message}`);
        });
      }
      emit(`demo:${section.number}:state:changed`, {
        sectionId: section.id,
        prevState: result.prevState,
        nextState: result.nextState,
        hints: result.animationHints,
      });
      return;
    }

    isAnimating = true;
    try {
      if (parsed.command === "stash") {
        didStash = true;
        const toRects = captureTopEntryTargetRects(preWorkingFiles);
        await animateRectFlight(preWorkingRects, toRects, { drop: true });
        printOutput("success", `stashed ${preWorkingFiles.length} file(s)`);
      } else if (parsed.command === "stash:pop" || parsed.command === "stash:apply") {
        if (parsed.command === "stash:pop") {
          didPop = true;
        }
        const movedFiles = (result.animationHints ?? [])
          .find((hint) => hint.type === "FILES_RESTORED")
          ?.files?.filter(Boolean);
        const fileNames = Array.isArray(movedFiles) ? movedFiles : [];
        const toRects = captureWorkingTargetRects(fileNames);
        await animateRectFlight(preTopEntryRects, toRects);
        printOutput("success", parsed.command === "stash:pop" ? "popped top stash entry" : "applied top stash entry");
      }
    } finally {
      isAnimating = false;
    }

    if (didStash && didPop && !completionDone) {
      acknowledgeSectionCompletion(section.id);
      completionDone = true;
    }

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });
  };

  /**
   * @param {SubmitEvent} event
   * @returns {void}
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    const rawInput = inputEl.value;
    inputEl.value = "";
    await executeCommand(rawInput);
  };

  /**
   * @param {Event} event
   * @returns {void}
   */
  const handleChipClick = async (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (!target) {
      return;
    }

    const button = target.closest("[data-command]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const command = button.getAttribute("data-command");
    if (!command) {
      return;
    }
    await executeCommand(command);
  };

  const handleReset = () => reset();

  formEl.addEventListener("submit", handleSubmit);
  resetEl.addEventListener("click", handleReset);
  commandChipEls.forEach((chipEl) => chipEl.addEventListener("click", handleChipClick));
  reset();

  demoControllers.set(section.id, {
    reset,
    dispose() {
      formEl.removeEventListener("submit", handleSubmit);
      resetEl.removeEventListener("click", handleReset);
      commandChipEls.forEach((chipEl) => chipEl.removeEventListener("click", handleChipClick));
    },
  });
}

/**
 * @param {{id: string, number: string, heading: string}} section
 * @returns {void}
 */
function mountWorkspacePlaygroundSection(section) {
  const refs = sectionRefs.get(section.id);
  if (!refs) {
    return;
  }

  const { demoEl } = refs;
  demoEl.innerHTML = `
    <div class="playground-workspace">
      <div class="playground-toolbar">
        <button class="playground-reset-cta" type="button" data-role="playground-reset">Reset Workspace</button>
      </div>
      <div class="playground-grid">
        <section class="playground-pane playground-pane-zones">
          <header class="playground-pane-header">
            <p class="playground-pane-title">Zone Diagram</p>
          </header>
          <div class="playground-pane-body" data-role="playground-zones"></div>
        </section>
        <section class="playground-pane playground-pane-terminal">
          <header class="playground-pane-header">
            <p class="playground-pane-title">Terminal</p>
          </header>
          <div class="playground-pane-body playground-terminal-body" data-role="playground-terminal"></div>
        </section>
      </div>
    </div>
  `;

  const zonesMount = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="playground-zones"]'));
  const terminalMount = /** @type {HTMLElement} */ (demoEl.querySelector('[data-role="playground-terminal"]'));
  const resetButton = /** @type {HTMLButtonElement} */ (demoEl.querySelector('[data-role="playground-reset"]'));

  const eventName = `demo:${section.number}:command:submit`;
  let state = createInitialState();

  initZones(zonesMount, { title: "Zone Diagram" });
  renderZones(state, zonesMount);

  const terminal = initTerminal(terminalMount, {
    eventName,
    shellId: `terminal-${section.id}`,
    sectionId: section.id,
    autoFocus: true,
    retainFocusOnBlur: false,
    pathLabel: "gitvisual ~/playground",
  });

  terminal.clear();
  terminal.print("Blank repo. Type anything.", "info");

  const handler = async (payload) => {
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
    await waitForStateChangeInterception({
      sectionId: section.id,
      command: rawInput,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
      zonesRoot: zonesMount,
    });

    if (parsed.command === "stash:list") {
      if (state.stash.length === 0) {
        terminal.print("stash list is empty", "info");
      } else {
        state.stash.forEach((entry) => terminal.print(`${entry.id}: ${entry.message}`, "info"));
      }
    } else {
      terminal.print(formatSuccess(parsed, result), "success");
    }

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });
  };

  on(eventName, handler);

  const reset = () => {
    state = createInitialState();
    terminal.clear();
    terminal.print("Blank repo. Type anything.", "info");
    renderZones(state, zonesMount);
  };

  resetButton.addEventListener("click", reset);

  demoControllers.set(section.id, {
    reset,
    dispose() {
      off(eventName, handler);
      resetButton.removeEventListener("click", reset);
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

  const terminal = initTerminal(terminalMount, {
    eventName,
    shellId: `terminal-${section.id}`,
    sectionId: section.id,
    autoFocus: false,
    pathLabel: `gitvisual ~/${section.id}`,
  });

  terminal.print(`${section.heading} demo ready.`, "info");

  const handler = async (payload) => {
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
    await waitForStateChangeInterception({
      sectionId: section.id,
      command: rawInput,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
      zonesRoot: zonesMount,
    });
    terminal.print(formatSuccess(parsed, result), "success");

    emit(`demo:${section.number}:state:changed`, {
      sectionId: section.id,
      prevState: result.prevState,
      nextState: result.nextState,
      hints: result.animationHints,
    });

  };

  on(eventName, handler);

  const reset = () => {
    state = createInitialState();
    terminal.clear();
    terminal.print(`${section.heading} demo reset.`, "info");
    renderZones(state, zonesMount);
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
  // Always start from the first lesson on reload; do not restore prior scroll
  // position (which can reopen directly on Playground).
  mainContent.scrollTop = 0;
  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      mainContent.scrollTop = 0;
    });
  }

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

    if (section.layout === "split-sync-world") {
      mountSplitSyncWorldSection(section);
      continue;
    }

    if (section.layout === "timeline-undo") {
      mountTimelineUndoSection(section);
      continue;
    }

    if (section.layout === "stash-shelf") {
      mountStashShelfSection(section);
      continue;
    }

    if (section.layout === "workspace-playground") {
      mountWorkspacePlaygroundSection(section);
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
