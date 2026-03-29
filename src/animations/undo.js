/** @type {Map<string, unknown>} */
const timelinesByHash = new Map();

/**
 * Animate reset operation.
 * @param {'soft' | 'mixed' | 'hard' | string} mode
 * @param {Element[]} affectedEls
 * @returns {void}
 */
export function animateReset(mode, affectedEls) {}

/**
 * Store a timeline for later reversal.
 * @param {string} hash
 * @param {unknown} timeline
 * @returns {void}
 */
export function storeTimeline(hash, timeline) {}

/**
 * Read a stored timeline by hash.
 * @param {string} hash
 * @returns {unknown}
 */
export function getTimeline(hash) {}
