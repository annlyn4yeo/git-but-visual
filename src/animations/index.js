import * as fileFlight from "./file-flight.js";
import * as commitGraph from "./commit-graph.js";
import * as syncPulse from "./sync-pulse.js";
import * as stash from "./stash.js";
import * as undo from "./undo.js";

/**
 * Handle animation hints from simulator output.
 * @param {Array<object>} hints
 * @param {Record<string, Element>} domRefs
 * @returns {void}
 */
export function handleAnimationHints(hints, domRefs) {}

export { fileFlight, commitGraph, syncPulse, stash, undo };

