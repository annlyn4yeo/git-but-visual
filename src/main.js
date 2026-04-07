import { initSidebar } from "./ui/sidebar.js";
import { initSections } from "./ui/sections.js";
import { renderZones } from "./ui/zones.js";
import { renderCommitGraph } from "./ui/commit-graph.js";
import { registerStateChangeInterceptor } from "./animations/index.js";

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
  registerStateChangeInterceptor({
    async onAfterAnimations(payload) {
      const nextState = payload?.nextState ?? null;
      if (!nextState) {
        return;
      }

      const zonesRoot = payload?.zonesRoot ?? null;
      if (zonesRoot) {
        renderZones(nextState, zonesRoot);
      }

      renderCommitGraph(nextState);
    },
  });

  initSidebar();
  sectionsApi = initSections();
}

init();
