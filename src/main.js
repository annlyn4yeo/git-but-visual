import { initSidebar } from "./ui/sidebar.js";
import { initSections } from "./ui/sections.js";

let initialized = false;
/** @type {{ sectionRefs: Map<string, {el: HTMLElement, demoEl: HTMLElement}>, resetDemo: (sectionId: string) => void } | null} */
let sectionsApi = null;

/**
 * Reset a section demo to its initial state.
 * @param {string} sectionId
 * @returns {void}
 */
export function resetDemo(sectionId) {
  sectionsApi?.resetDemo(sectionId);
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
  initSidebar();
  sectionsApi = initSections();
}

init();
