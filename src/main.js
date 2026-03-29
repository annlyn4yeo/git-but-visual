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
import { initSidebar, setActiveSection } from "./ui/sidebar.js";
import { initSections, resetSection } from "./ui/sections.js";

/**
 * Initialize application modules.
 * @returns {void}
 */
export function init() {}

void events;
void dom;
void createInitialState;
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
void initSidebar;
void setActiveSection;
void initSections;
void resetSection;

init();

