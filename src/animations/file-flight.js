/**
 * @typedef {{type?: string, file?: string, from?: string, to?: string} & Record<string, unknown>} FileMoveHint
 */

/**
 * @param {ParentNode | Document | null | undefined} root
 * @param {string} fileName
 * @returns {HTMLElement | null}
 */
function findWorkingCard(root, fileName) {
  if (!root || !fileName) {
    return null;
  }

  const selector = `.zone-file-card[data-zone="workingDirectory"][data-filename="${CSS.escape(fileName)}"]`;
  const el = root.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

/**
 * @param {HTMLElement} stagingBodyEl
 * @param {DOMRect} sourceRect
 * @param {number} index
 * @returns {{left: number, top: number}}
 */
function resolveTargetPoint(stagingBodyEl, sourceRect, index) {
  const stagingRect = stagingBodyEl.getBoundingClientRect();
  const existingCards = stagingBodyEl.querySelectorAll('.zone-file-card[data-zone="stagingArea"]').length;
  const cardGap = 8;
  const insetX = 10;
  const insetY = 8;

  const targetLeft = stagingRect.left + insetX;
  const projectedTop = stagingRect.top + insetY + (existingCards + index) * (sourceRect.height + cardGap);
  const maxTop = Math.max(stagingRect.top + insetY, stagingRect.bottom - sourceRect.height - insetY);

  return {
    left: targetLeft,
    top: Math.min(projectedTop, maxTop),
  };
}

/**
 * Animate FILE_MOVED hints for workingDirectory -> stagingArea.
 * @param {FileMoveHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 * }} [options]
 * @returns {unknown}
 */
export function animateFileToStaging(hints, options = {}) {
  const root = options.root ?? document;
  const gsap = options.gsap;
  if (!gsap || !root || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const stagingBodyEl = root.querySelector('[data-role="staging-files"]');
  const stagingZoneEl = root.querySelector('[data-zone="stagingArea"]');
  if (!(stagingBodyEl instanceof HTMLElement) || !(stagingZoneEl instanceof HTMLElement)) {
    return null;
  }

  const moveHints = hints.filter(
    (hint) =>
      hint?.type === "FILE_MOVED" &&
      hint.from === "workingDirectory" &&
      hint.to === "stagingArea" &&
      typeof hint.file === "string" &&
      hint.file.trim().length > 0,
  );

  if (moveHints.length === 0) {
    return null;
  }

  const master = gsap.timeline();
  master.to(
    stagingZoneEl,
    {
      duration: 0.22,
      boxShadow: "0 0 0 1px rgba(31, 217, 139, 0.28), 0 0 16px rgba(31, 217, 139, 0.14)",
      ease: "power1.out",
    },
    0,
  );

  moveHints.forEach((hint, index) => {
    const fileName = String(hint.file ?? "").trim();
    const sourceEl = findWorkingCard(root, fileName);
    if (!sourceEl) {
      return;
    }

    const sourceRect = sourceEl.getBoundingClientRect();
    const target = resolveTargetPoint(stagingBodyEl, sourceRect, index);
    const deltaX = target.left - sourceRect.left;
    const deltaY = target.top - sourceRect.top;
    const arcLift = Math.max(34, Math.min(96, Math.abs(deltaX) * 0.18 + 42));

    const ghost = /** @type {HTMLElement} */ (sourceEl.cloneNode(true));
    ghost.classList.add("file-flight-ghost");
    ghost.style.left = `${sourceRect.left}px`;
    ghost.style.top = `${sourceRect.top}px`;
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    document.body.appendChild(ghost);

    const single = gsap.timeline();
    single.to(
      sourceEl,
      {
        duration: 0.18,
        opacity: 0.12,
        ease: "power1.out",
      },
      0,
    );
    single.to(
      ghost,
      {
        duration: 0.62,
        ease: "power2.inOut",
        motionPath: {
          path: [
            { x: 0, y: 0 },
            { x: deltaX * 0.58, y: deltaY - arcLift },
            { x: deltaX, y: deltaY },
          ],
          curviness: 1.25,
        },
        rotation: 3,
      },
      0,
    );
    single.to(
      ghost,
      {
        duration: 0.18,
        rotation: 0,
        ease: "power1.out",
      },
      0.42,
    );
    single.to(
      ghost,
      {
        duration: 0.08,
        scale: 0.94,
        ease: "power1.in",
      },
      0.58,
    );
    single.to(
      ghost,
      {
        duration: 0.14,
        scale: 1,
        ease: "power2.out",
      },
      0.66,
    );
    single.add(() => {
      gsap.fromTo(
        stagingZoneEl,
        {
          boxShadow: "0 0 0 1px rgba(31, 217, 139, 0.34), 0 0 18px rgba(31, 217, 139, 0.2)",
        },
        {
          duration: 0.22,
          yoyo: true,
          repeat: 1,
          ease: "sine.inOut",
          boxShadow: "0 0 0 1px rgba(31, 217, 139, 0.5), 0 0 28px rgba(31, 217, 139, 0.28)",
        },
      );
    }, 0.66);
    single.add(() => {
      ghost.remove();
    });

    const startAt = index * 0.1;
    master.add(single, startAt);

    if (typeof options.storeTimeline === "function") {
      options.storeTimeline(`file-move:${fileName}`, single);
    }
  });

  master.to(stagingZoneEl, {
    duration: 0.24,
    ease: "power1.out",
    boxShadow: "0 0 0 1px rgba(31, 217, 139, 0.42), 0 0 22px rgba(31, 217, 139, 0.22)",
  });

  if (typeof options.storeTimeline === "function") {
    const keys = moveHints.map((hint) => hint.file).filter((name) => typeof name === "string" && name.length > 0);
    if (keys.length > 0) {
      options.storeTimeline(`file-move:${keys.join("|")}`, master);
    }
  }

  return master;
}
