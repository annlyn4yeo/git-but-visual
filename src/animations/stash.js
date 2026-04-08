/**
 * Animate stashing files into stash box.
 * @param {Element[]} fileEls
 * @param {Element} stashBoxEl
 * @returns {void}
 */
export function animateStash(fileEls, stashBoxEl) {}

/**
 * Animate stash pop from box to zone.
 * @param {Element} stashBoxEl
 * @param {Element} targetZoneEl
 * @returns {void}
 */
export function animateStashPop(stashBoxEl, targetZoneEl) {}

/**
 * Animate stash apply from box to zone while preserving stash entry.
 * @param {Element} stashBoxEl
 * @param {Element} targetZoneEl
 * @returns {void}
 */
export function animateStashApply(stashBoxEl, targetZoneEl) {
  return animateStashPop(stashBoxEl, targetZoneEl);
}
