/** @type {Map<string, unknown>} */
const timelinesByHash = new Map();

/**
 * @typedef {{type?: string, mode?: string, targetHash?: string, from?: string, to?: string, branch?: string} & Record<string, unknown>} UndoHint
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
  const parts = [`M ${first.x} ${first.y}`];
  rest.forEach((p) => parts.push(`L ${p.x} ${p.y}`));
  return parts.join(" ");
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
 * Animate reset hints with focused soft-reset behavior.
 * @param {UndoHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
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
  if (!resetHint || resetHint.mode !== "soft") {
    return null;
  }

  const headMoved = hints.find((hint) => hint?.type === "HEAD_MOVED");
  const fromHash = typeof headMoved?.from === "string" ? headMoved.from : "";
  const toHash = typeof headMoved?.to === "string" ? headMoved.to : "";
  if (!fromHash || !toHash || fromHash === toHash) {
    return null;
  }

  const root = options.root ?? document;
  const svg = root.querySelector?.(".commit-graph-svg");
  if (!(svg instanceof SVGSVGElement)) {
    return null;
  }

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
  const duration = Math.min(1.2, Math.max(0.56, distance / 280));

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

  const targetHash = typeof resetHint.targetHash === "string" ? resetHint.targetHash : toHash;
  storeTimeline(targetHash, timeline);
  if (typeof options.storeTimeline === "function") {
    options.storeTimeline(targetHash, timeline);
    if (typeof options.command === "string" && options.command.trim()) {
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
