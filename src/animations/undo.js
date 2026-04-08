/** @type {Map<string, unknown>} */
const timelinesByHash = new Map();

/**
 * @typedef {{type?: string, mode?: string, targetHash?: string, filesReturned?: string[], files?: string[], from?: string, to?: string, branch?: string, revertedHash?: string, newHash?: string, parentHash?: string} & Record<string, unknown>} UndoHint
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {SVGSVGElement} svg
 * @param {string} hash
 * @returns {SVGCircleElement | null}
 */
function getNode(svg, hash) {
  const el = svg.querySelector(
    `[data-role="commit-node"][data-commit-hash="${CSS.escape(hash)}"]`,
  );
  return el instanceof SVGCircleElement ? el : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} hash
 * @returns {SVGCircleElement | null}
 */
function getHeadRing(svg, hash) {
  const el = svg.querySelector(
    `[data-role="head-ring"][data-commit-hash="${CSS.escape(hash)}"]`,
  );
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
  const svg = root.querySelector?.(".commit-graph-svg, .graph-focus-svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} name
 * @param {Record<string, string | number>} attrs
 * @returns {SVGElement}
 */
function createSvgEl(svg, name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

/**
 * @param {SVGCircleElement} node
 * @returns {number}
 */
function getNodeRadius(node) {
  return Number(node.getAttribute("r") ?? "6");
}

/**
 * @param {SVGCircleElement} node
 * @returns {{x: number, y: number}}
 */
function getNodeCenter(node) {
  return {
    x: Number(node.getAttribute("cx") ?? "0"),
    y: Number(node.getAttribute("cy") ?? "0"),
  };
}

/**
 * Animate revert hints as additive forward motion.
 * @param {UndoHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   command?: string,
 * }} [options]
 * @returns {unknown}
 */
export function animateRevertSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const revertHint = hints.find((hint) => hint?.type === "REVERT_COMMIT");
  const commitHint = hints.find((hint) => hint?.type === "COMMIT_CREATED");
  const headMoved = hints.find((hint) => hint?.type === "HEAD_MOVED");
  if (!revertHint || !commitHint || !headMoved) {
    return null;
  }

  const revertedHash =
    typeof revertHint.revertedHash === "string" ? revertHint.revertedHash : "";
  const commitHash = typeof commitHint.hash === "string" ? commitHint.hash : "";
  const newHash =
    typeof revertHint.newHash === "string" ? revertHint.newHash : "";
  const fromHash = typeof headMoved.from === "string" ? headMoved.from : "";
  const toHash = typeof headMoved.to === "string" ? headMoved.to : "";
  if (
    !revertedHash ||
    !commitHash ||
    !newHash ||
    !fromHash ||
    !toHash ||
    newHash !== toHash ||
    commitHash !== newHash
  ) {
    return null;
  }

  const graphRoot = options.root ?? document;
  const svg = resolveGraphSvg(graphRoot);
  if (!svg) {
    return null;
  }

  const revertedNode = getNode(svg, revertedHash);
  const parentNode = getNode(svg, fromHash);
  if (!revertedNode || !parentNode) {
    return null;
  }

  const parentPoint = getNodeCenter(parentNode);
  const parentRadius = getNodeRadius(parentNode);
  const targetPoint = {
    x: parentPoint.x + 12,
    y: Math.max(20, parentPoint.y - 60),
  };

  const branch =
    typeof headMoved.branch === "string" && headMoved.branch.length > 0
      ? headMoved.branch
      : "main";
  const branchStroke =
    branch === "main" ? "var(--color-green)" : "var(--color-purple)";
  const branchFill =
    branch === "main" ? "var(--color-green-dim)" : "var(--color-purple-dim)";

  const layer = createSvgEl(svg, "g", {
    "data-role": "revert-animation-layer",
  });
  svg.appendChild(layer);

  const revertedOverlay = createSvgEl(svg, "circle", {
    cx: revertedNode.getAttribute("cx") ?? "0",
    cy: revertedNode.getAttribute("cy") ?? "0",
    r: Math.max(6, getNodeRadius(revertedNode) + 1.8),
    fill: "rgba(255, 94, 125, 0.14)",
    stroke: "rgba(255, 94, 125, 0.68)",
    "stroke-width": 1.2,
    opacity: 0,
  });
  const revertedStrike = createSvgEl(svg, "line", {
    x1: String(Number(revertedNode.getAttribute("cx") ?? "0") - 8),
    y1: String(Number(revertedNode.getAttribute("cy") ?? "0") + 2),
    x2: String(Number(revertedNode.getAttribute("cx") ?? "0") + 8),
    y2: String(Number(revertedNode.getAttribute("cy") ?? "0") - 2),
    stroke: "rgba(255, 94, 125, 0.78)",
    "stroke-width": 1.4,
    "stroke-linecap": "round",
    opacity: 0,
  });
  const strikeLength = revertedStrike.getTotalLength();
  revertedStrike.setAttribute("stroke-dasharray", String(strikeLength));
  revertedStrike.setAttribute("stroke-dashoffset", String(strikeLength));

  const connector = createSvgEl(svg, "path", {
    d: `M ${parentPoint.x} ${parentPoint.y} C ${parentPoint.x + 8} ${parentPoint.y - 20}, ${targetPoint.x - 8} ${targetPoint.y + 20}, ${targetPoint.x} ${targetPoint.y}`,
    fill: "none",
    stroke: branchStroke,
    "stroke-width": 2,
    "stroke-linecap": "round",
    opacity: 0.95,
  });
  const connectorLength = connector.getTotalLength();
  connector.setAttribute("stroke-dasharray", String(connectorLength));
  connector.setAttribute("stroke-dashoffset", String(connectorLength));

  const newNode = createSvgEl(svg, "circle", {
    cx: targetPoint.x,
    cy: targetPoint.y,
    r: Math.max(6.5, parentRadius + 0.5),
    fill: "var(--bg-surface)",
    stroke: branchStroke,
    "stroke-width": 2.4,
    opacity: 1,
  });
  const ripple = createSvgEl(svg, "circle", {
    cx: targetPoint.x,
    cy: targetPoint.y,
    r: Math.max(8, parentRadius + 2),
    fill: "none",
    stroke: branchStroke,
    "stroke-width": 1.7,
    opacity: 0,
  });

  const shortHash = newHash.slice(0, 7);
  const hashLabel = createSvgEl(svg, "text", {
    x: targetPoint.x + 14,
    y: targetPoint.y + 4,
    fill: "var(--text-secondary)",
    "font-family": "var(--font-mono)",
    "font-size": 11,
    opacity: 0,
  });
  hashLabel.textContent = shortHash;

  const labelWidth = Math.max(38, branch.length * 7 + 14);
  const labelBg = createSvgEl(svg, "rect", {
    x: targetPoint.x + 88,
    y: targetPoint.y - 11,
    rx: 8,
    ry: 8,
    width: labelWidth,
    height: 16,
    fill: branchFill,
    stroke: branchStroke,
    "stroke-width": 1,
    opacity: 0,
  });
  const labelText = createSvgEl(svg, "text", {
    x: targetPoint.x + 95,
    y: targetPoint.y,
    fill: branchStroke,
    "font-family": "var(--font-mono)",
    "font-size": 10,
    "font-weight": 600,
    opacity: 0,
  });
  labelText.textContent = branch;

  const oldHeadRing = getHeadRing(svg, fromHash);
  const headToken = createSvgEl(svg, "circle", {
    cx: String(parentPoint.x),
    cy: String(parentPoint.y),
    r: 10,
    fill: "none",
    stroke: branchStroke,
    "stroke-width": 2,
    opacity: 0,
  });

  layer.append(
    revertedOverlay,
    revertedStrike,
    connector,
    newNode,
    ripple,
    hashLabel,
    labelBg,
    labelText,
    headToken,
  );

  gsap.set(newNode, { scale: 0, transformOrigin: "50% 50%" });
  gsap.set(ripple, { scale: 0.7, transformOrigin: "50% 50%" });

  const timeline = gsap.timeline();

  timeline.to(
    revertedOverlay,
    { duration: 0.24, opacity: 1, ease: "sine.out" },
    0,
  );
  timeline.to(
    revertedStrike,
    {
      duration: 0.28,
      ease: "power1.out",
      attr: { "stroke-dashoffset": 0 },
      opacity: 1,
    },
    0.06,
  );

  timeline.to(
    newNode,
    {
      duration: 0.8,
      scale: 1,
      ease: "elastic.out(1, 0.5)",
    },
    0.2,
  );
  timeline.to(
    headToken,
    { duration: 0.1, opacity: 1, ease: "power1.out" },
    0.22,
  );
  timeline.to(
    ripple,
    {
      duration: 0.34,
      scale: 1.75,
      opacity: 0,
      ease: "sine.out",
    },
    0.34,
  );

  timeline.to(
    connector,
    {
      duration: 0.7,
      ease: "power2.out",
      attr: { "stroke-dashoffset": 0 },
    },
    0.36,
  );

  timeline.to(
    headToken,
    {
      duration: 0.6,
      ease: "power2.inOut",
      motionPath: {
        path: connector,
        align: connector,
        autoRotate: false,
        start: 0,
        end: 1,
      },
    },
    0.48,
  );
  timeline.to(
    hashLabel,
    { duration: 0.24, opacity: 1, y: -2, ease: "power1.out" },
    0.7,
  );
  timeline.to(
    [labelBg, labelText],
    { duration: 0.24, opacity: 1, y: -2, ease: "power1.out" },
    0.76,
  );

  timeline.add(() => {
    if (oldHeadRing) {
      oldHeadRing.setAttribute("opacity", "0.25");
    }
    headToken.setAttribute("opacity", "0");
  });
  timeline.to(
    newNode,
    { duration: 0.14, scale: 0.94, ease: "power1.out" },
    "<",
  );
  timeline.to(newNode, { duration: 0.18, scale: 1, ease: "power1.out" });
  timeline.to(layer, { duration: 0.24, opacity: 0.96, ease: "none" });
  timeline.add(() => {
    layer.remove();
  });

  storeTimeline(newHash, timeline);
  if (typeof options.storeTimeline === "function") {
    options.storeTimeline(newHash, timeline);
    if (
      typeof options.command === "string" &&
      options.command.trim().length > 0
    ) {
      options.storeTimeline(options.command.trim(), timeline);
    }
  }

  return timeline;
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

  const travelPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  travelPath.setAttribute("d", travelD);
  travelPath.setAttribute("fill", "none");
  travelPath.setAttribute("stroke", "transparent");
  svg.appendChild(travelPath);

  const token = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
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
  const existing = workingBody.querySelectorAll(
    '.zone-file-card[data-zone="workingDirectory"]',
  ).length;
  const gap = 8;
  const insetX = 10;
  const insetY = 8;

  const projectedTop =
    workingRect.top + insetY + (existing + index) * (sourceRect.height + gap);
  const maxTop = Math.max(
    workingRect.top + insetY,
    workingRect.bottom - sourceRect.height - insetY,
  );

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
      {
        boxShadow:
          "0 0 0 1px rgba(255, 179, 71, 0.35), 0 0 18px rgba(255, 179, 71, 0.2)",
      },
      {
        duration: 0.34,
        yoyo: true,
        repeat: 1,
        ease: "sine.inOut",
        boxShadow:
          "0 0 0 1px rgba(255, 179, 71, 0.52), 0 0 26px rgba(255, 179, 71, 0.3)",
      },
    );
  }, "-=0.2");

  return timeline;
}

/**
 * @param {HTMLElement} stagingZone
 * @param {HTMLElement} workingZone
 * @param {HTMLElement} stagingBody
 * @param {HTMLElement} workingBody
 * @returns {void}
 */
function setZonesToEmptyState(
  stagingZone,
  workingZone,
  stagingBody,
  workingBody,
) {
  stagingZone.classList.remove("has-files");
  stagingBody.classList.add("is-empty");
  workingBody.classList.add("is-empty");
  stagingBody.innerHTML = '<p class="zone-placeholder">nothing staged</p>';
  workingBody.innerHTML = '<p class="zone-placeholder">working tree clean</p>';
}

/**
 * @param {typeof import("gsap").gsap} gsap
 * @param {ParentNode | Document | null | undefined} zonesRoot
 * @returns {import("gsap").GSAPTimeline | null}
 */
function createHardImplosionTimeline(gsap, zonesRoot) {
  const zones = resolveZones(zonesRoot);
  if (!zones) {
    return null;
  }

  const { stagingZone, workingZone, stagingBody, workingBody } = zones;
  const cards = [
    ...stagingBody.querySelectorAll('.zone-file-card[data-zone="stagingArea"]'),
    ...workingBody.querySelectorAll(
      '.zone-file-card[data-zone="workingDirectory"]',
    ),
  ].filter((el) => el instanceof HTMLElement);

  if (cards.length === 0) {
    setZonesToEmptyState(stagingZone, workingZone, stagingBody, workingBody);
    return null;
  }

  const timeline = gsap.timeline();
  timeline.to(cards, {
    duration: 0.22,
    scale: 0,
    opacity: 0,
    ease: "power3.in",
    transformOrigin: "50% 50%",
  });
  timeline.add(() => {
    setZonesToEmptyState(stagingZone, workingZone, stagingBody, workingBody);
  });

  return timeline;
}

/**
 * @param {unknown} timeline
 * @returns {Promise<boolean>}
 */
function reverseStoredTimeline(timeline) {
  if (!timeline || typeof timeline.reverse !== "function") {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve(true);
    };

    const fallbackTimer = window.setTimeout(finish, 1400);
    try {
      if (typeof timeline.eventCallback === "function") {
        timeline.eventCallback("onReverseComplete", () => {
          window.clearTimeout(fallbackTimer);
          finish();
        });
      }

      if (typeof timeline.progress === "function") {
        timeline.progress(1);
      }
      if (typeof timeline.paused === "function" && timeline.paused()) {
        timeline.paused(false);
      }
      timeline.reverse();

      if (typeof timeline.eventCallback !== "function") {
        window.clearTimeout(fallbackTimer);
        finish();
      }
    } catch {
      window.clearTimeout(fallbackTimer);
      resolve(false);
    }
  });
}

/**
 * Animate reset hints with focused soft/mixed behavior.
 * @param {UndoHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   zonesRoot?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   getTimeline?: (key: string) => unknown,
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
  if (
    !resetHint ||
    (resetHint.mode !== "soft" &&
      resetHint.mode !== "mixed" &&
      resetHint.mode !== "hard")
  ) {
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

  const headTimeline = createHeadRollbackTimeline(gsap, svg, fromHash, toHash);
  if (!headTimeline) {
    return null;
  }

  if (resetHint.mode === "hard") {
    const { chain } = buildFirstParentPath(svg, fromHash, toHash);
    const abandonedHashes = chain.slice(0, -1);
    const timelineLookup =
      typeof options.getTimeline === "function"
        ? options.getTimeline
        : getTimeline;
    const reversibleTimelines = abandonedHashes
      .map((hash) => timelineLookup(hash))
      .filter((timeline) => timeline && typeof timeline.reverse === "function");

    if (reversibleTimelines.length > 0) {
      return Promise.all(
        reversibleTimelines.map((timeline) => reverseStoredTimeline(timeline)),
      ).then(
        () =>
          new Promise((resolve) => {
            if (typeof headTimeline.eventCallback === "function") {
              headTimeline.eventCallback("onComplete", () => resolve());
            } else {
              resolve();
            }
            if (typeof headTimeline.play === "function") {
              headTimeline.play();
            }
          }),
      );
    }

    const hardTimeline = gsap.timeline();
    const implosionTimeline = createHardImplosionTimeline(
      gsap,
      options.zonesRoot ?? document,
    );
    if (implosionTimeline) {
      hardTimeline.add(implosionTimeline);
    }
    hardTimeline.add(headTimeline);

    const targetHash =
      typeof resetHint.targetHash === "string" ? resetHint.targetHash : toHash;
    storeTimeline(targetHash, hardTimeline);
    if (typeof options.storeTimeline === "function") {
      options.storeTimeline(targetHash, hardTimeline);
      if (
        typeof options.command === "string" &&
        options.command.trim().length > 0
      ) {
        options.storeTimeline(options.command.trim(), hardTimeline);
      }
    }
    return hardTimeline;
  }

  const timeline = gsap.timeline();
  timeline.add(headTimeline);

  if (resetHint.mode === "mixed") {
    const filesFromReset = Array.isArray(resetHint.filesReturned)
      ? resetHint.filesReturned.filter(
          (name) => typeof name === "string" && name.trim().length > 0,
        )
      : [];
    const filesHint = hints.find((hint) => hint?.type === "FILES_RETURNED");
    const filesFromHint = Array.isArray(filesHint?.files)
      ? filesHint.files.filter(
          (name) => typeof name === "string" && name.trim().length > 0,
        )
      : [];
    const fileNames =
      filesFromReset.length > 0 ? filesFromReset : filesFromHint;

    const mixedTimeline = createMixedReturnTimeline(
      gsap,
      options.zonesRoot ?? document,
      fileNames,
    );
    if (mixedTimeline) {
      timeline.add(mixedTimeline);
    }
  }

  const targetHash =
    typeof resetHint.targetHash === "string" ? resetHint.targetHash : toHash;
  storeTimeline(targetHash, timeline);
  if (typeof options.storeTimeline === "function") {
    options.storeTimeline(targetHash, timeline);
    if (
      typeof options.command === "string" &&
      options.command.trim().length > 0
    ) {
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
