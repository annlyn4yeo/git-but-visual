/** @type {Map<string, unknown>} */
const timelinesByHash = new Map();

/**
 * @typedef {{type?: string, mode?: string, targetHash?: string, filesReturned?: string[], files?: string[], from?: string, to?: string, branch?: string} & Record<string, unknown>} UndoHint
 */

/**
 * @param {SVGSVGElement} svg
 * @param {string} hash
 * @returns {SVGCircleElement | null}
 */
function getNode(svg, hash) {
  const el = svg.querySelector(`[data-role="commit-node"][data-commit-hash="${CSS.escape(hash)}"]`);
  return el instanceof SVGCircleElement ? el : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} hash
 * @returns {SVGCircleElement | null}
 */
function getHeadRing(svg, hash) {
  const el = svg.querySelector(`[data-role="head-ring"][data-commit-hash="${CSS.escape(hash)}"]`);
  return el instanceof SVGCircleElement ? el : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} childHash
 * @returns {{parentHash: string, edge: SVGPathElement} | null}
 */
function getFirstParentEdge(svg, childHash) {
  const edges = svg.querySelectorAll(
    `[data-role="commit-edge"][data-child-hash="${CSS.escape(childHash)}"][data-parent-hash]`,
  );

  /** @type {{parentHash: string, edge: SVGPathElement} | null} */
  let best = null;
  edges.forEach((edge) => {
    if (!(edge instanceof SVGPathElement)) {
      return;
    }

    const parentHash = edge.getAttribute("data-parent-hash");
    if (!parentHash) {
      return;
    }

    if (!best) {
      best = { parentHash, edge };
      return;
    }

    const currentWidth = Number(edge.getAttribute("stroke-width") ?? "0");
    const bestWidth = Number(best.edge.getAttribute("stroke-width") ?? "0");
    if (currentWidth > bestWidth) {
      best = { parentHash, edge };
    }
  });

  return best;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} fromHash
 * @param {string} targetHash
 * @returns {{chain: string[], traversedEdges: SVGPathElement[]}}
 */
function buildFirstParentPath(svg, fromHash, targetHash) {
  const chain = [fromHash];
  const traversedEdges = [];
  let cursor = fromHash;
  let guard = 0;

  while (cursor !== targetHash && guard < 64) {
    guard += 1;
    const step = getFirstParentEdge(svg, cursor);
    if (!step) {
      break;
    }

    traversedEdges.push(step.edge);
    cursor = step.parentHash;
    chain.push(cursor);
  }

  return { chain, traversedEdges };
}

/**
 * @param {SVGSVGElement} svg
 * @param {string[]} chain
 * @returns {string | null}
 */
function buildTravelPathD(svg, chain) {
  const points = chain
    .map((hash) => {
      const node = getNode(svg, hash);
      if (!node) {
        return null;
      }
      return {
        x: Number(node.getAttribute("cx") ?? "0"),
        y: Number(node.getAttribute("cy") ?? "0"),
      };
    })
    .filter(Boolean);

  if (points.length < 2) {
    return null;
  }

  const [first, ...rest] = points;
  const d = [`M ${first.x} ${first.y}`];
  rest.forEach((point) => {
    d.push(`L ${point.x} ${point.y}`);
  });
  return d.join(" ");
}

/**
 * @param {SVGSVGElement} svg
 * @param {string[]} hashes
 * @returns {SVGCircleElement[]}
 */
function collectDanglingNodes(svg, hashes) {
  return hashes
    .map((hash) => getNode(svg, hash))
    .filter((node) => node instanceof SVGCircleElement);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {ParentNode | Document | null | undefined} root
 * @returns {SVGSVGElement | null}
 */
function resolveGraphSvg(root) {
  if (!root) {
    return null;
  }
  const svg = root.querySelector?.(".commit-graph-svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

/**
 * @param {typeof import("gsap").gsap} gsap
 * @param {SVGSVGElement} svg
 * @param {string} fromHash
 * @param {string} toHash
 * @returns {import("gsap").GSAPTimeline | null}
 */
function createHeadRollbackTimeline(gsap, svg, fromHash, toHash) {
  const fromNode = getNode(svg, fromHash);
  const toNode = getNode(svg, toHash);
  if (!fromNode || !toNode) {
    return null;
  }

  const { chain, traversedEdges } = buildFirstParentPath(svg, fromHash, toHash);
  if (chain[chain.length - 1] !== toHash) {
    return null;
  }

  const travelD = buildTravelPathD(svg, chain);
  if (!travelD) {
    return null;
  }

  const travelPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  travelPath.setAttribute("d", travelD);
  travelPath.setAttribute("fill", "none");
  travelPath.setAttribute("stroke", "transparent");
  svg.appendChild(travelPath);

  const token = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  token.setAttribute("cx", fromNode.getAttribute("cx") ?? "0");
  token.setAttribute("cy", fromNode.getAttribute("cy") ?? "0");
  token.setAttribute("r", "10");
  token.setAttribute("fill", "none");
  token.setAttribute("stroke", "var(--color-green)");
  token.setAttribute("stroke-width", "2");
  token.setAttribute("opacity", "0");
  svg.appendChild(token);

  const oldHeadRing = getHeadRing(svg, fromHash);
  const distance = travelPath.getTotalLength();
  const duration = clamp(distance / 280, 0.56, 1.2);

  const danglingHashes = chain.slice(0, -1);
  const danglingNodes = collectDanglingNodes(svg, danglingHashes);

  const timeline = gsap.timeline();
  timeline.add(() => {
    if (oldHeadRing) {
      oldHeadRing.setAttribute("opacity", "0.22");
    }
  });

  timeline.to(token, { duration: 0.12, opacity: 1, ease: "power1.out" });
  timeline.to(
    token,
    {
      duration,
      ease: "power2.inOut",
      motionPath: {
        path: travelPath,
        align: travelPath,
        autoRotate: false,
        start: 0,
        end: 1,
      },
    },
    "<",
  );

  if (danglingNodes.length > 0) {
    timeline.to(
      danglingNodes,
      {
        duration: 0.28,
        ease: "power1.out",
        opacity: 0.6,
        fill: "var(--bg-hover)",
        stroke: "var(--text-muted)",
      },
      "-=0.24",
    );
  }

  if (traversedEdges.length > 0) {
    timeline.to(
      traversedEdges,
      {
        duration: 0.28,
        ease: "power1.out",
        opacity: 0.66,
        stroke: "var(--border-default)",
        attr: { "stroke-dasharray": "4 4" },
      },
      "<",
    );
  }

  timeline.to(token, { duration: 0.1, opacity: 0, ease: "power1.out" });
  timeline.add(() => {
    token.remove();
    travelPath.remove();
  });

  return timeline;
}

/**
 * @param {ParentNode | Document | null | undefined} root
 * @returns {{stagingZone: HTMLElement, workingZone: HTMLElement, stagingBody: HTMLElement, workingBody: HTMLElement} | null}
 */
function resolveZones(root) {
  if (!root || typeof root.querySelector !== "function") {
    return null;
  }

  const stagingZone = root.querySelector('[data-zone="stagingArea"]');
  const workingZone = root.querySelector('[data-zone="workingDirectory"]');
  const stagingBody = root.querySelector('[data-role="staging-files"]');
  const workingBody = root.querySelector('[data-role="working-files"]');

  if (
    !(stagingZone instanceof HTMLElement) ||
    !(workingZone instanceof HTMLElement) ||
    !(stagingBody instanceof HTMLElement) ||
    !(workingBody instanceof HTMLElement)
  ) {
    return null;
  }

  return { stagingZone, workingZone, stagingBody, workingBody };
}

/**
 * @param {HTMLElement} workingBody
 * @param {DOMRect} sourceRect
 * @param {number} index
 * @returns {{left: number, top: number}}
 */
function resolveWorkingTarget(workingBody, sourceRect, index) {
  const workingRect = workingBody.getBoundingClientRect();
  const existing = workingBody.querySelectorAll('.zone-file-card[data-zone="workingDirectory"]').length;
  const gap = 8;
  const insetX = 10;
  const insetY = 8;

  const projectedTop = workingRect.top + insetY + (existing + index) * (sourceRect.height + gap);
  const maxTop = Math.max(workingRect.top + insetY, workingRect.bottom - sourceRect.height - insetY);

  return {
    left: workingRect.left + insetX,
    top: Math.min(projectedTop, maxTop),
  };
}

/**
 * @param {typeof import("gsap").gsap} gsap
 * @param {ParentNode | Document | null | undefined} zonesRoot
 * @param {string[]} fileNames
 * @returns {import("gsap").GSAPTimeline | null}
 */
function createMixedReturnTimeline(gsap, zonesRoot, fileNames) {
  const zones = resolveZones(zonesRoot);
  if (!zones || fileNames.length === 0) {
    return null;
  }

  const { stagingZone, workingZone, stagingBody, workingBody } = zones;
  const ghosts = [];

  fileNames.forEach((name, index) => {
    const source = stagingBody.querySelector(
      `.zone-file-card[data-zone="stagingArea"][data-filename="${CSS.escape(name)}"]`,
    );
    if (!(source instanceof HTMLElement)) {
      return;
    }

    const rect = source.getBoundingClientRect();
    const target = resolveWorkingTarget(workingBody, rect, index);
    const ghost = /** @type {HTMLElement} */ (source.cloneNode(true));
    ghost.classList.add("reset-mixed-return-ghost");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);

    ghosts.push({ source, ghost, rect, target });
  });

  if (ghosts.length === 0) {
    return null;
  }

  const timeline = gsap.timeline();

  timeline.to(
    stagingZone,
    {
      duration: 0.22,
      boxShadow: "none",
      ease: "power1.out",
    },
    0,
  );

  ghosts.forEach(({ source, ghost, rect, target }, index) => {
    const deltaX = target.left - rect.left;
    const deltaY = target.top - rect.top;
    const startAt = index * 0.09;

    timeline.to(
      source,
      {
        duration: 0.2,
        opacity: 0.14,
        ease: "power1.out",
      },
      startAt,
    );

    timeline.to(
      ghost,
      {
        duration: 0.74,
        ease: "sine.inOut",
        motionPath: {
          path: [
            { x: 0, y: 0 },
            { x: deltaX * 0.46, y: deltaY - 16 },
            { x: deltaX, y: deltaY },
          ],
          curviness: 1.1,
        },
        scale: 0.98,
      },
      startAt,
    );

    timeline.to(
      ghost,
      {
        duration: 0.12,
        opacity: 0,
        ease: "power1.out",
      },
      startAt + 0.66,
    );
  });

  timeline.add(() => {
    ghosts.forEach(({ ghost }) => ghost.remove());
  });

  timeline.add(() => {
    gsap.fromTo(
      workingZone,
      { boxShadow: "0 0 0 1px rgba(255, 179, 71, 0.35), 0 0 18px rgba(255, 179, 71, 0.2)" },
      {
        duration: 0.34,
        yoyo: true,
        repeat: 1,
        ease: "sine.inOut",
        boxShadow: "0 0 0 1px rgba(255, 179, 71, 0.52), 0 0 26px rgba(255, 179, 71, 0.3)",
      },
    );
  }, "-=0.2");

  return timeline;
}

/**
 * Animate reset hints with focused soft/mixed behavior.
 * @param {UndoHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   zonesRoot?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   command?: string,
 * }} [options]
 * @returns {unknown}
 */
export function animateResetSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const resetHint = hints.find((hint) => hint?.type === "RESET_PERFORMED");
  if (!resetHint || (resetHint.mode !== "soft" && resetHint.mode !== "mixed")) {
    return null;
  }

  const headMoved = hints.find((hint) => hint?.type === "HEAD_MOVED");
  const fromHash = typeof headMoved?.from === "string" ? headMoved.from : "";
  const toHash = typeof headMoved?.to === "string" ? headMoved.to : "";
  if (!fromHash || !toHash || fromHash === toHash) {
    return null;
  }

  const graphRoot = options.root ?? document;
  const svg = resolveGraphSvg(graphRoot);
  if (!svg) {
    return null;
  }

  const timeline = gsap.timeline();
  const headTimeline = createHeadRollbackTimeline(gsap, svg, fromHash, toHash);
  if (!headTimeline) {
    return null;
  }
  timeline.add(headTimeline);

  if (resetHint.mode === "mixed") {
    const filesFromReset = Array.isArray(resetHint.filesReturned)
      ? resetHint.filesReturned.filter((name) => typeof name === "string" && name.trim().length > 0)
      : [];
    const filesHint = hints.find((hint) => hint?.type === "FILES_RETURNED");
    const filesFromHint = Array.isArray(filesHint?.files)
      ? filesHint.files.filter((name) => typeof name === "string" && name.trim().length > 0)
      : [];
    const fileNames = filesFromReset.length > 0 ? filesFromReset : filesFromHint;

    const mixedTimeline = createMixedReturnTimeline(gsap, options.zonesRoot ?? document, fileNames);
    if (mixedTimeline) {
      timeline.add(mixedTimeline);
    }
  }

  const targetHash = typeof resetHint.targetHash === "string" ? resetHint.targetHash : toHash;
  storeTimeline(targetHash, timeline);
  if (typeof options.storeTimeline === "function") {
    options.storeTimeline(targetHash, timeline);
    if (typeof options.command === "string" && options.command.trim().length > 0) {
      options.storeTimeline(options.command.trim(), timeline);
    }
  }

  return timeline;
}

/**
 * Legacy single-hint entry point.
 * @param {'soft' | 'mixed' | 'hard' | string} mode
 * @param {Element[]} affectedEls
 * @returns {null}
 */
export function animateReset(mode, affectedEls) {
  void mode;
  void affectedEls;
  return null;
}

/**
 * Store a timeline for later reversal.
 * @param {string} hash
 * @param {unknown} timeline
 * @returns {void}
 */
export function storeTimeline(hash, timeline) {
  if (!hash || !timeline) {
    return;
  }
  timelinesByHash.set(hash, timeline);
}

/**
 * Read a stored timeline by hash.
 * @param {string} hash
 * @returns {unknown}
 */
export function getTimeline(hash) {
  return timelinesByHash.get(hash);
}
