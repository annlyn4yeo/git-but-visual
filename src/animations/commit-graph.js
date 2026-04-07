const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @typedef {{type?: string, hash?: string, parentHash?: string, message?: string, mode?: string, branch?: string, from?: string, to?: string} & Record<string, unknown>} CommitHint
 */

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
  svg.appendChild(el);
  return el;
}

/**
 * @param {ParentNode | Document | null | undefined} root
 * @returns {SVGSVGElement | null}
 */
function resolveGraphSvg(root) {
  if (!root) {
    return null;
  }
  const svg = root.querySelector(".commit-graph-svg, .graph-focus-svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string | undefined} parentHash
 * @returns {{x: number, y: number} | null}
 */
function resolveParentPoint(svg, parentHash) {
  if (parentHash) {
    const byHash = svg.querySelector(`[data-role="commit-node"][data-commit-hash="${CSS.escape(parentHash)}"]`);
    if (byHash instanceof SVGCircleElement) {
      return {
        x: Number(byHash.getAttribute("cx") ?? "0"),
        y: Number(byHash.getAttribute("cy") ?? "0"),
      };
    }
  }

  const fallback = svg.querySelector('[data-role="commit-node"]');
  if (fallback instanceof SVGCircleElement) {
    return {
      x: Number(fallback.getAttribute("cx") ?? "0"),
      y: Number(fallback.getAttribute("cy") ?? "0"),
    };
  }

  return null;
}

/**
 * @param {Element | null | undefined} el
 * @returns {number}
 */
function safeHeight(el) {
  if (!(el instanceof Element)) {
    return 0;
  }
  return el.getBoundingClientRect().height || 0;
}

/**
 * Animate COMMIT_CREATED + STAGING_CLEARED as one sequence.
 * @param {CommitHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   zonesRoot?: ParentNode | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 * }} [options]
 * @returns {unknown}
 */
export function animateCommitSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const root = options.root ?? document;
  const zonesRoot = options.zonesRoot ?? root;
  const commitHint = hints.find((hint) => hint?.type === "COMMIT_CREATED");
  if (!commitHint || typeof commitHint.hash !== "string") {
    return null;
  }

  const headMovedHint = hints.find((hint) => hint?.type === "HEAD_MOVED" && hint.to === commitHint.hash);
  const targetBranch = typeof headMovedHint?.branch === "string" ? headMovedHint.branch : "main";

  const stagingBodyEl = zonesRoot?.querySelector?.('[data-role="staging-files"]') ?? null;
  const stagingZoneEl = zonesRoot?.querySelector?.('[data-zone="stagingArea"]') ?? null;
  const stagedCards = Array.from(
    (stagingBodyEl instanceof Element ? stagingBodyEl.querySelectorAll('.zone-file-card[data-zone="stagingArea"]') : []),
  ).filter((el) => el instanceof HTMLElement);

  const svg = resolveGraphSvg(root);
  if (!svg) {
    if (stagingZoneEl instanceof HTMLElement) {
      return gsap.to(stagingZoneEl, { duration: 0.2, boxShadow: "none", ease: "power1.out" });
    }
    return null;
  }

  const parentPoint = resolveParentPoint(svg, typeof commitHint.parentHash === "string" ? commitHint.parentHash : undefined);
  if (!parentPoint) {
    return null;
  }

  const targetPoint = {
    x: parentPoint.x,
    y: Math.max(22, parentPoint.y - 54),
  };

  const layer = createSvgEl(svg, "g", { "data-role": "commit-birth-layer" });
  const edgePath = createSvgEl(svg, "path", {
    d: `M ${parentPoint.x} ${parentPoint.y} L ${targetPoint.x} ${targetPoint.y}`,
    stroke: targetBranch === "main" ? "var(--color-green-border)" : "var(--color-purple-border)",
    "stroke-width": 2,
    fill: "none",
    "stroke-linecap": "round",
    opacity: 0.95,
  });
  const lineLength = edgePath.getTotalLength();
  edgePath.setAttribute("stroke-dasharray", String(lineLength));
  edgePath.setAttribute("stroke-dashoffset", String(lineLength));

  const node = createSvgEl(svg, "circle", {
    cx: targetPoint.x,
    cy: targetPoint.y,
    r: 7,
    fill: "var(--bg-surface)",
    stroke: targetBranch === "main" ? "var(--color-green)" : "var(--color-purple)",
    "stroke-width": 2.4,
    opacity: 1,
  });
  const ripple = createSvgEl(svg, "circle", {
    cx: targetPoint.x,
    cy: targetPoint.y,
    r: 8,
    fill: "none",
    stroke: targetBranch === "main" ? "var(--color-green)" : "var(--color-purple)",
    "stroke-width": 1.8,
    opacity: 0,
  });

  const labelBg = createSvgEl(svg, "rect", {
    x: targetPoint.x + 88,
    y: targetPoint.y - 11,
    rx: 8,
    ry: 8,
    width: Math.max(38, targetBranch.length * 7 + 14),
    height: 16,
    fill: targetBranch === "main" ? "var(--color-green-dim)" : "var(--color-purple-dim)",
    stroke: targetBranch === "main" ? "var(--color-green-border)" : "var(--color-purple-border)",
    "stroke-width": 1,
    opacity: 0,
  });
  const labelText = createSvgEl(svg, "text", {
    x: targetPoint.x + 95,
    y: targetPoint.y,
    fill: targetBranch === "main" ? "var(--color-green)" : "var(--color-purple)",
    "font-family": "var(--font-mono)",
    "font-size": 10,
    "font-weight": 600,
    opacity: 0,
  });
  labelText.textContent = targetBranch;

  const existingHeadRing = svg.querySelector('[data-role="head-ring"]');
  const headToken = createSvgEl(svg, "circle", {
    cx:
      existingHeadRing instanceof SVGCircleElement
        ? Number(existingHeadRing.getAttribute("cx") ?? parentPoint.x)
        : parentPoint.x,
    cy:
      existingHeadRing instanceof SVGCircleElement
        ? Number(existingHeadRing.getAttribute("cy") ?? parentPoint.y)
        : parentPoint.y,
    r: 10,
    fill: "none",
    stroke: targetBranch === "main" ? "var(--color-green)" : "var(--color-purple)",
    "stroke-width": 2,
    opacity: 0,
  });

  // Keep transients above existing graph primitives.
  layer.append(edgePath, node, ripple, labelBg, labelText, headToken);

  const ghosts = [];
  stagedCards.forEach((cardEl) => {
    const rect = cardEl.getBoundingClientRect();
    const ghost = /** @type {HTMLElement} */ (cardEl.cloneNode(true));
    ghost.classList.add("commit-collect-ghost");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    ghosts.push({ source: cardEl, ghost, rect });
  });

  gsap.set(node, { scale: 0, transformOrigin: "50% 50%" });
  gsap.set(ripple, { scale: 0.6, transformOrigin: "50% 50%" });

  const timeline = gsap.timeline();

  // Act 1: Collection + staging consumed.
  if (stagingZoneEl instanceof HTMLElement) {
    timeline.to(
      stagingZoneEl,
      {
        duration: 0.2,
        boxShadow: "none",
        ease: "power1.out",
      },
      0,
    );
  }

  ghosts.forEach(({ source, ghost, rect }, index) => {
    const graphRect = svg.getBoundingClientRect();
    const targetX = graphRect.left + targetPoint.x - rect.left;
    const targetY = graphRect.top + targetPoint.y - rect.top - safeHeight(source) * 0.2;
    const arcLift = 24 + index * 5;

    timeline.to(
      source,
      {
        duration: 0.2,
        opacity: 0.08,
        ease: "power1.out",
      },
      index * 0.05,
    );

    timeline.to(
      ghost,
      {
        duration: 0.52,
        ease: "power2.inOut",
        motionPath: {
          path: [
            { x: 0, y: 0 },
            { x: targetX * 0.55, y: targetY - arcLift },
            { x: targetX, y: targetY },
          ],
          curviness: 1.2,
        },
        scale: 0.38,
        rotation: 4,
      },
      index * 0.05,
    );

    timeline.to(
      ghost,
      {
        duration: 0.1,
        opacity: 0,
        ease: "power1.out",
      },
      index * 0.05 + 0.46,
    );
  });

  timeline.add(() => {
    ghosts.forEach(({ ghost }) => ghost.remove());
  });

  // Act 2: Node birth + ripple.
  timeline.to(node, {
    duration: 0.8,
    scale: 1,
    ease: "elastic.out(1, 0.5)",
  });

  timeline.fromTo(
    ripple,
    {
      opacity: 0.65,
      scale: 0.72,
    },
    {
      duration: 0.34,
      opacity: 0,
      scale: 2.05,
      ease: "power2.out",
    },
    "<",
  );

  // Act 3: line draw.
  timeline.to(edgePath, {
    duration: 0.7,
    ease: "power2.out",
    attr: { "stroke-dashoffset": 0 },
  });

  // Act 4: branch label + HEAD move.
  timeline.to(
    [labelBg, labelText],
    {
      duration: 0.24,
      opacity: 1,
      y: -4,
      ease: "power2.out",
    },
    "-=0.08",
  );

  timeline.to(
    headToken,
    {
      duration: 0.34,
      opacity: 1,
      attr: { cx: targetPoint.x, cy: targetPoint.y },
      ease: "power2.inOut",
    },
    "<",
  );

  timeline.to(headToken, {
    duration: 0.12,
    opacity: 0,
    ease: "power1.out",
  });

  timeline.add(() => {
    layer.remove();
  });

  if (typeof options.storeTimeline === "function") {
    options.storeTimeline(commitHint.hash, timeline);
  }

  return timeline;
}

/**
 * Backward-compatible single-hint entry point.
 * @param {object} commitData
 * @param {Element | null} prevCommitEl
 * @returns {null}
 */
export function animateNewCommit(commitData, prevCommitEl) {
  void commitData;
  void prevCommitEl;
  return null;
}
