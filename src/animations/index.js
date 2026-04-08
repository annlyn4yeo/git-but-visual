import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { on, off } from "../utils/events.js";
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
let animationSpeedMultiplier = 1;
/** @type {(payload: any) => void | Promise<void> | null} */
let stateChangedListener = null;

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
});

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

    const commitHints = hintList.filter((hint) =>
      ["COMMIT_CREATED", "STAGING_CLEARED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (commitHints.some((hint) => hint?.type === "COMMIT_CREATED")) {
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
      ["RESET_PERFORMED", "HEAD_MOVED"].includes(String(hint?.type ?? "")),
    );
    if (resetHints.some((hint) => hint?.type === "RESET_PERFORMED")) {
      const resetTimeline = undo.animateResetSequence(resetHints, {
        root: document,
        zonesRoot:
          context.zonesRoot && typeof context.zonesRoot.querySelector === "function"
            ? context.zonesRoot
            : document,
        gsap,
        storeTimeline,
        command: typeof context.command === "string" ? context.command : "",
      });
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
        hintType === "RESET_PERFORMED"
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
