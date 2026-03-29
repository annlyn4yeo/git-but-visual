import * as events from "./utils/events.js";
import * as dom from "./utils/dom.js";

import { createInitialState, runCommand } from "./simulator/index.js";
import * as simulatorCommands from "./simulator/commands.js";
import { GitSimulatorError, ERROR_CODES } from "./simulator/errors.js";

import * as fileFlight from "./animations/file-flight.js";
import * as commitGraph from "./animations/commit-graph.js";
import * as syncPulse from "./animations/sync-pulse.js";
import * as stashAnimations from "./animations/stash.js";
import * as undoAnimations from "./animations/undo.js";
import { handleAnimationHints } from "./animations/index.js";

import { parseCommand } from "./terminal/parser.js";
import { initTerminal, printOutput, clearOutput } from "./terminal/index.js";

import { initZones, renderZones } from "./ui/zones.js";
import { renderCommitGraph } from "./ui/commit-graph.js";
import { initSidebar, setActiveSection } from "./ui/sidebar.js";
import { initSections, resetSection } from "./ui/sections.js";

/**
 * @returns {import("./simulator/state.js").GitState}
 */
function createCommitGraphSmokeState() {
  return {
    HEAD: "main",
    detached: false,
    branches: {
      main: "f6a1d4c",
      "feature/login": "d3f4a8b",
    },
    remoteBranches: {
      main: "f6a1d4c",
      "feature/login": "d3f4a8b",
    },
    trackingBranches: {
      main: "origin/main",
      "feature/login": "origin/feature/login",
    },
    commits: {
      e3a1f92: {
        hash: "e3a1f92",
        message: "Initial commit",
        parents: [],
        branch: "main",
        timestamp: 1704067200,
      },
      b4d7c2e: {
        hash: "b4d7c2e",
        message: "Add auth shell",
        parents: ["e3a1f92"],
        branch: "main",
        timestamp: 1704068200,
      },
      d3f4a8b: {
        hash: "d3f4a8b",
        message: "Feature login form",
        parents: ["b4d7c2e"],
        branch: "feature/login",
        timestamp: 1704069200,
      },
      c1e9a0f: {
        hash: "c1e9a0f",
        message: "Main docs update",
        parents: ["b4d7c2e"],
        branch: "main",
        timestamp: 1704070200,
      },
      f6a1d4c: {
        hash: "f6a1d4c",
        message: "Merge branch 'feature/login'",
        parents: ["c1e9a0f", "d3f4a8b"],
        branch: "main",
        timestamp: 1704071200,
      },
    },
    workingDirectory: [],
    stagingArea: [],
    stash: [],
    remote: {
      name: "origin",
      url: "https://github.com/user/gitvisual-demo.git",
      connected: true,
    },
    log: [],
  };
}

/**
 * Initialize application modules.
 * @returns {void}
 */
export function init() {
  if (typeof document === "undefined") {
    return;
  }

  initSidebar();

  // Temporary smoke render to validate multi-branch + merge graph drawing.
  renderCommitGraph(createCommitGraphSmokeState());

  // Default persistent panel state uses simulator's initial state.
  renderCommitGraph(createInitialState());
}

void events;
void dom;
void runCommand;
void simulatorCommands;
void GitSimulatorError;
void ERROR_CODES;
void fileFlight;
void commitGraph;
void syncPulse;
void stashAnimations;
void undoAnimations;
void handleAnimationHints;
void parseCommand;
void initTerminal;
void printOutput;
void clearOutput;
void initZones;
void renderZones;
void setActiveSection;
void initSections;
void resetSection;

init();
