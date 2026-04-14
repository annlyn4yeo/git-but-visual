import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { on, off } from "../utils/events.js";
import { setActiveSection } from "../ui/sidebar.js";
import * as fileFlight from "./file-flight.js";
import * as commitGraph from "./commit-graph.js";
import * as syncPulse from "./sync-pulse.js";
import * as stash from "./stash.js";
import * as undo from "./undo.js";

// DrawSVG is a Club GSAP plugin and may not be installed in all environments.
// Register a no-op plugin so calls stay stable until the real plugin is added.
const DrawSVGPlugin = { name: "drawSVG", register() {} };
gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, DrawSVGPlugin);

/** @type {Map<string, unknown>} */
const timelineRegistry = new Map();
/** @type {Map<string, {entrance?: import("gsap/ScrollTrigger").ScrollTrigger, pin?: import("gsap/ScrollTrigger").ScrollTrigger}>} */
const sectionTriggerRegistry = new Map();
/** @type {Map<string, import("gsap/ScrollTrigger").ScrollTrigger>} */
const sidebarScrollTriggerRegistry = new Map();
/** @type {Map<string, ResizeObserver>} */
const sectionResizeObservers = new Map();
const HERO_ORIENTATION_PLAYED_KEY = "gitvisual:hero-orientation-played:v1";
let animationSpeedMultiplier = 1;
/** @type {(payload: any) => void | Promise<void> | null} */
let stateChangedListener = null;
let refreshFrame = 0;
/** @type {import("gsap").GSAPTween | null} */
let appLayoutTween = null;
let playgroundShellCollapsed = false;

/**
 * @returns {boolean}
 */
function hasPlayedOrientationHeroThisSession() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(HERO_ORIENTATION_PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * @returns {void}
 */
function markOrientationHeroPlayedThisSession() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.setItem(HERO_ORIENTATION_PLAYED_KEY, "1");
  } catch {
    // Ignore storage errors.
  }
}

const HINT_ANIMATORS = Object.freeze({
  COMMIT_CREATED: (hint) => commitGraph.animateNewCommit(hint, null),
  SYNC_PULSE: (hint, context) => {
    if (hint.direction === "push") {
      return syncPulse.animatePush(context.pathEl ?? null);
    }
    if (hint.direction === "pull") {
      return syncPulse.animatePull(context.pathEl ?? null);
    }
    return syncPulse.animateFetch(context.pathEl ?? null);
  },
  STASH_PUSHED: (hint, context) => stash.animateStash(context.fileEls ?? [], context.stashBoxEl ?? null),
  STASH_POPPED: (hint, context) => stash.animateStashPop(context.stashBoxEl ?? null, context.targetZoneEl ?? null),
  STASH_APPLIED: (hint, context) => stash.animateStashApply(context.stashBoxEl ?? null, context.targetZoneEl ?? null),
});

/**
 * @param {Array<{type?: string, mode?: string} & Record<string, unknown>>} resetHints
 * @param {Record<string, unknown>} context
 * @returns {unknown}
 */
function dispatchResetAnimationByMode(resetHints, context) {
  const resetHint = resetHints.find((hint) => hint?.type === "RESET_PERFORMED");
  if (!resetHint) {
    return null;
  }

  const options = {
    root: document,
    zonesRoot:
      context.zonesRoot && typeof context.zonesRoot.querySelector === "function"
        ? context.zonesRoot
        : document,
    gsap,
    storeTimeline,
    getTimeline,
    command: typeof context.command === "string" ? context.command : "",
  };

  switch (resetHint.mode) {
    case "soft":
    case "mixed":
    case "hard":
      return undo.animateResetSequence(resetHints, options);
    default:
      return null;
  }
}

/**
 * @param {unknown} timeline
 * @returns {Promise<void>}
 */
function asAnimationPromise(timeline) {
  if (!timeline) {
    return Promise.resolve();
  }

  if (typeof timeline.then === "function") {
    return Promise.resolve(timeline).then(() => {});
  }

  if (typeof timeline.play === "function" && typeof timeline.eventCallback === "function") {
    return new Promise((resolve) => {
      timeline.eventCallback("onComplete", () => resolve());
      timeline.play();
    });
  }

  return Promise.resolve();
}

/**
 * @returns {void}
 */
function scheduleScrollRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  if (refreshFrame) {
    window.cancelAnimationFrame(refreshFrame);
  }

  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = 0;
    ScrollTrigger.refresh();
  });
}

/**
 * @returns {void}
 */
function disposeSectionScrollAnimations() {
  sectionTriggerRegistry.forEach((entry) => {
    entry.entrance?.kill();
    entry.pin?.kill();
  });
  sectionTriggerRegistry.clear();

  sectionResizeObservers.forEach((observer) => observer.disconnect());
  sectionResizeObservers.clear();
}

/**
 * @returns {void}
 */
function disposeSidebarScrollSync() {
  sidebarScrollTriggerRegistry.forEach((trigger) => trigger.kill());
  sidebarScrollTriggerRegistry.clear();
}

/**
 * @param {boolean} collapsed
 * @param {{immediate?: boolean}} [options]
 * @returns {void}
 */
function animatePlaygroundShell(collapsed, options = {}) {
  if (typeof document === "undefined") {
    return;
  }

  if (!options.immediate && playgroundShellCollapsed === collapsed) {
    return;
  }

  const app = document.getElementById("app");
  if (!(app instanceof HTMLElement)) {
    return;
  }

  const targetColumns = collapsed ? "78px minmax(0, 1fr)" : "220px minmax(0, 1fr)";
  playgroundShellCollapsed = collapsed;

  if (appLayoutTween) {
    appLayoutTween.kill();
    appLayoutTween = null;
  }

  if (collapsed) {
    app.classList.add("is-playground-focus");
  } else {
    app.classList.remove("is-playground-focus");
  }

  if (options.immediate) {
    gsap.set(app, { gridTemplateColumns: targetColumns });
    return;
  }

  appLayoutTween = gsap.to(app, {
    duration: 0.4,
    ease: "power2.inOut",
    gridTemplateColumns: targetColumns,
    overwrite: "auto",
    onComplete: () => {
      appLayoutTween = null;
    },
  });
}

/**
 * @param {HTMLElement | null | undefined} sectionEl
 * @returns {void}
 */
function runOrientationHeroEntrance(sectionEl) {
  if (!(sectionEl instanceof HTMLElement)) {
    return;
  }

  const zoneEls = Array.from(sectionEl.querySelectorAll(".orientation-zone")).filter(
    (el) => el instanceof HTMLElement,
  );
  const flowPaths = Array.from(sectionEl.querySelectorAll(".orientation-flow-path")).filter(
    (el) => el instanceof SVGPathElement,
  );
  if (zoneEls.length === 0) {
    return;
  }

  const applyFlowReadyState = () => {
    flowPaths.forEach((path) => {
      const length = path.getTotalLength();
      path.setAttribute("stroke-dasharray", String(length));
      path.setAttribute("stroke-dashoffset", "0");
    });
    if (flowPaths.length > 0) {
      gsap.set(flowPaths, { autoAlpha: 1, drawSVG: "0% 100%" });
    }
  };

  if (hasPlayedOrientationHeroThisSession()) {
    gsap.set(zoneEls, { autoAlpha: 1, y: 0 });
    applyFlowReadyState();
    return;
  }

  gsap.set(zoneEls, { autoAlpha: 0, y: 22 });
  flowPaths.forEach((path) => {
    const length = path.getTotalLength();
    path.setAttribute("stroke-dasharray", String(length));
    path.setAttribute("stroke-dashoffset", String(length));
  });
  if (flowPaths.length > 0) {
    gsap.set(flowPaths, { autoAlpha: 1, drawSVG: "0% 0%" });
  }

  const timeline = gsap.timeline({
    defaults: { ease: "power2.out" },
    onComplete: () => {
      markOrientationHeroPlayedThisSession();
      scheduleScrollRefresh();
    },
  });

  zoneEls.forEach((zoneEl, index) => {
    timeline.to(
      zoneEl,
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.42,
      },
      index === 0 ? 0.06 : `>-0.12`,
    );
  });

  flowPaths.forEach((path, index) => {
    timeline.to(
      path,
      {
        duration: 0.3,
        ease: "none",
        drawSVG: "0% 100%",
        attr: { "stroke-dashoffset": 0 },
      },
      index === 0 ? ">-0.02" : ">-0.06",
    );
  });
}

/**
 * @param {Map<string, {el: HTMLElement, demoEl: HTMLElement}> | null | undefined} sectionRefs
 * @returns {void}
 */
export function initSectionEntranceAnimations(sectionRefs) {
  if (typeof document === "undefined") {
    return;
  }

  const mainScroller = document.getElementById("main-content");
  if (!mainScroller) {
    return;
  }

  disposeSectionScrollAnimations();
  ScrollTrigger.defaults({ scroller: mainScroller });

  const entries = sectionRefs instanceof Map ? [...sectionRefs.entries()] : [];
  /** @type {HTMLElement | null} */
  let heroSectionEl = null;
  entries.forEach(([sectionId, refs], index) => {
    if (!refs?.el || !(refs.el instanceof HTMLElement)) {
      return;
    }

    const sectionEl = refs.el;
    const isOrientationHero = sectionId === "the-four-zones";
    const headerEl = sectionEl.querySelector(".lesson-header");
    const numberEl = sectionEl.querySelector(".lesson-number");
    const titleEl = sectionEl.querySelector(".lesson-title");
    const bodyLines = Array.from(sectionEl.querySelectorAll(".lesson-copy"));
    const demoEl = refs.demoEl instanceof HTMLElement ? refs.demoEl : sectionEl.querySelector('[data-role="demo-area"]');

    let entrance;
    if (isOrientationHero) {
      heroSectionEl = sectionEl;
      const heroVisibleTargets = [numberEl, titleEl, ...bodyLines, demoEl].filter(
        (el) => el instanceof HTMLElement,
      );
      if (heroVisibleTargets.length > 0) {
        gsap.set(heroVisibleTargets, { autoAlpha: 1, y: 0 });
      }
    } else {
      const revealTargets = [numberEl, titleEl, ...bodyLines, demoEl].filter(
        (el) => el instanceof HTMLElement,
      );
      if (revealTargets.length > 0) {
        gsap.set(revealTargets, { autoAlpha: 0, y: 20 });
      }

      const timeline = gsap.timeline({
        paused: true,
        defaults: { ease: "power2.out" },
      });
      const headingTargets = [numberEl, titleEl].filter(
        (el) => el instanceof HTMLElement,
      );
      if (headingTargets.length > 0) {
        timeline.to(headingTargets, {
          autoAlpha: 1,
          y: 0,
          duration: 0.42,
          stagger: 0.08,
        });
      }

      const bodyTargets = bodyLines.filter((el) => el instanceof HTMLElement);
      if (bodyTargets.length > 0) {
        timeline.to(
          bodyTargets,
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.36,
            stagger: 0.07,
          },
          headingTargets.length > 0 ? "-=0.06" : 0,
        );
      }

      if (demoEl instanceof HTMLElement) {
        timeline.to(
          demoEl,
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.46,
          },
          bodyTargets.length > 0 || headingTargets.length > 0 ? "-=0.05" : 0,
        );
      }

      entrance = ScrollTrigger.create({
        trigger: sectionEl,
        start: "top 78%",
        animation: timeline,
        once: true,
      });
    }

    let pin;
    if (headerEl instanceof HTMLElement && index > 0) {
      pin = ScrollTrigger.create({
        trigger: sectionEl,
        start: "top top+=72",
        end: "+=44",
        pin: headerEl,
        pinSpacing: false,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      });
    }

    sectionTriggerRegistry.set(sectionId, { entrance, pin });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        scheduleScrollRefresh();
      });
      observer.observe(sectionEl);
      sectionResizeObservers.set(sectionId, observer);
    }
  });

  runOrientationHeroEntrance(heroSectionEl);
  scheduleScrollRefresh();
}

/**
 * @returns {void}
 */
export function refreshSectionEntranceAnimations() {
  scheduleScrollRefresh();
}

/**
 * @param {Map<string, {el: HTMLElement, demoEl: HTMLElement}> | null | undefined} sectionRefs
 * @returns {void}
 */
export function initSidebarScrollSync(sectionRefs) {
  if (typeof document === "undefined") {
    return;
  }

  const mainScroller = document.getElementById("main-content");
  if (!mainScroller) {
    return;
  }

  disposeSidebarScrollSync();
  ScrollTrigger.defaults({ scroller: mainScroller });
  animatePlaygroundShell(false, { immediate: true });

  const entries = sectionRefs instanceof Map ? [...sectionRefs.entries()] : [];
  entries.forEach(([sectionId, refs], index) => {
    if (!refs?.el || !(refs.el instanceof HTMLElement)) {
      return;
    }

    const previousSectionId = index > 0 ? entries[index - 1]?.[0] ?? sectionId : sectionId;
    const trigger = ScrollTrigger.create({
      trigger: refs.el,
      start: "top 30%",
      end: "bottom 30%",
      onEnter: () => {
        setActiveSection(sectionId);
        animatePlaygroundShell(sectionId === "playground");
      },
      onEnterBack: () => {
        setActiveSection(sectionId);
        animatePlaygroundShell(sectionId === "playground");
      },
      onLeaveBack: () => {
        setActiveSection(previousSectionId);
        animatePlaygroundShell(previousSectionId === "playground");
      },
    });

    sidebarScrollTriggerRegistry.set(sectionId, trigger);
  });

  scheduleScrollRefresh();
}

/**
 * @param {Array<{type?: string} & Record<string, unknown>>} hints
 * @param {Record<string, unknown>} [context]
 * @returns {Promise<void>}
 */
export async function runAnimationHints(hints, context = {}) {
  const hintList = Array.isArray(hints) ? hints : [];
  if (hintList.length === 0 || animationSpeedMultiplier === 0) {
    return;
  }

  const previousScale = gsap.globalTimeline.timeScale();
  gsap.globalTimeline.timeScale(Math.max(0.01, animationSpeedMultiplier));

  try {
    const hasRevertHint = hintList.some((hint) => hint?.type === "REVERT_COMMIT");

    const fileMoveHints = hintList.filter(
      (hint) =>
        hint?.type === "FILE_MOVED" &&
        hint.from === "workingDirectory" &&
        hint.to === "stagingArea",
    );

    if (fileMoveHints.length > 0) {
      const fileMoveTimeline = fileFlight.animateFileToStaging(fileMoveHints, {
        root:
          context.zonesRoot && typeof context.zonesRoot.querySelector === "function"
            ? context.zonesRoot
            : document,
        gsap,
        storeTimeline,
      });
      await asAnimationPromise(fileMoveTimeline);
    }

    const revertHints = hintList.filter((hint) =>
      ["REVERT_COMMIT", "COMMIT_CREATED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (hasRevertHint) {
      const revertTimeline = undo.animateRevertSequence(revertHints, {
        root: document,
        gsap,
        storeTimeline,
        command: typeof context.command === "string" ? context.command : "",
      });
      await asAnimationPromise(revertTimeline);
    }

    const commitHints = hintList.filter((hint) =>
      ["COMMIT_CREATED", "STAGING_CLEARED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (!hasRevertHint && commitHints.some((hint) => hint?.type === "COMMIT_CREATED")) {
      const commitTimeline = commitGraph.animateCommitSequence(commitHints, {
        root: document,
        zonesRoot:
          context.zonesRoot && typeof context.zonesRoot.querySelector === "function"
            ? context.zonesRoot
            : document,
        gsap,
        storeTimeline,
      });
      await asAnimationPromise(commitTimeline);
    }

    const branchHints = hintList.filter((hint) =>
      ["BRANCH_CREATED", "BRANCH_SWITCHED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (branchHints.some((hint) => hint?.type === "BRANCH_CREATED" || hint?.type === "BRANCH_SWITCHED")) {
      const branchTimeline = commitGraph.animateBranchingSequence(branchHints, {
        root: document,
        gsap,
        storeTimeline,
        command: typeof context.command === "string" ? context.command : "",
      });
      await asAnimationPromise(branchTimeline);
    }

    const mergeHints = hintList.filter((hint) =>
      ["FAST_FORWARD", "MERGE_COMMIT", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (mergeHints.some((hint) => hint?.type === "FAST_FORWARD" || hint?.type === "MERGE_COMMIT")) {
      const mergeTimeline = commitGraph.animateMergeSequence(mergeHints, {
        root: document,
        gsap,
        storeTimeline,
        command: typeof context.command === "string" ? context.command : "",
      });
      await asAnimationPromise(mergeTimeline);
    }

    const syncHints = hintList.filter((hint) =>
      ["SYNC_PULSE", "TRACKING_UPDATED", "REMOTE_UPDATED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (syncHints.some((hint) => hint?.type === "SYNC_PULSE")) {
      const syncTimeline = syncPulse.animateSyncSequence(syncHints, {
        root: document,
        zonesRoot:
          context.zonesRoot && typeof context.zonesRoot.querySelector === "function"
            ? context.zonesRoot
            : document,
        gsap,
        storeTimeline,
        command: typeof context.command === "string" ? context.command : "",
      });
      await asAnimationPromise(syncTimeline);
    }

    const resetHints = hintList.filter((hint) =>
      ["RESET_PERFORMED", "HEAD_MOVED", "FILES_RETURNED"].includes(String(hint?.type ?? "")),
    );
    if (resetHints.some((hint) => hint?.type === "RESET_PERFORMED")) {
      const resetTimeline = dispatchResetAnimationByMode(resetHints, context);
      await asAnimationPromise(resetTimeline);
    }

    for (const hint of hintList) {
      const hintType = typeof hint?.type === "string" ? hint.type : "";
      if (
        hintType === "FILE_MOVED" ||
        hintType === "COMMIT_CREATED" ||
        hintType === "STAGING_CLEARED" ||
        hintType === "BRANCH_CREATED" ||
        hintType === "BRANCH_SWITCHED" ||
        hintType === "FAST_FORWARD" ||
        hintType === "MERGE_COMMIT" ||
        hintType === "SYNC_PULSE" ||
        hintType === "RESET_PERFORMED" ||
        hintType === "REVERT_COMMIT"
      ) {
        continue;
      }
      const animator = HINT_ANIMATORS[hintType];
      if (!animator) {
        continue;
      }

      const timelineOrPromise = animator(hint, context);
      await asAnimationPromise(timelineOrPromise);

      const key =
        hintType === "COMMIT_CREATED" && typeof hint.hash === "string"
          ? hint.hash
          : typeof context.command === "string" && context.command.trim().length > 0
            ? context.command.trim()
            : "";
      if (key && timelineOrPromise) {
        timelineRegistry.set(key, timelineOrPromise);
      }
    }
  } catch {
    // Animation failures should never block rendering.
  } finally {
    gsap.globalTimeline.timeScale(previousScale);
  }
}

/**
 * @param {{
 *   onAfterAnimations?: (payload: any) => void | Promise<void>,
 * }} [options]
 * @returns {void}
 */
export function registerStateChangeInterceptor(options = {}) {
  if (stateChangedListener) {
    off("state:changed", stateChangedListener);
  }

  const onAfterAnimations =
    typeof options.onAfterAnimations === "function" ? options.onAfterAnimations : async () => {};

  stateChangedListener = async (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    payload.__handled = true;

    try {
      await runAnimationHints(payload.hints, {
        command: payload.command,
        sectionId: payload.sectionId,
        zonesRoot: payload.zonesRoot ?? null,
        ...(payload.domRefs ?? {}),
      });
    } finally {
      try {
        await onAfterAnimations(payload);
      } finally {
        if (typeof payload.resolve === "function") {
          payload.resolve();
        }
      }
    }
  };

  on("state:changed", stateChangedListener);
}

/**
 * @param {number} value
 * @returns {void}
 */
export function setAnimationSpeedMultiplier(value) {
  const numeric = Number(value);
  animationSpeedMultiplier = Number.isFinite(numeric) && numeric >= 0 ? numeric : 1;
}

/**
 * @returns {number}
 */
export function getAnimationSpeedMultiplier() {
  return animationSpeedMultiplier;
}

/**
 * @param {string} key
 * @param {unknown} timeline
 * @returns {void}
 */
export function storeTimeline(key, timeline) {
  if (!key || !timeline) {
    return;
  }
  timelineRegistry.set(key, timeline);
}

/**
 * @param {string} key
 * @returns {unknown}
 */
export function getTimeline(key) {
  return timelineRegistry.get(key);
}

/**
 * @returns {Map<string, unknown>}
 */
export function getTimelineRegistry() {
  return timelineRegistry;
}

export { gsap, ScrollTrigger, MotionPathPlugin, DrawSVGPlugin, fileFlight, commitGraph, syncPulse, stash, undo };
