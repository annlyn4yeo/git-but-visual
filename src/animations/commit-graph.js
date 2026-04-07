const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @typedef {{type?: string, hash?: string, parentHash?: string, message?: string, mode?: string, branch?: string, branchName?: string, atHash?: string, from?: string, to?: string, detached?: boolean} & Record<string, unknown>} CommitHint
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
 * @param {SVGSVGElement} svg
 * @param {string} hash
 * @returns {{x: number, y: number} | null}
 */
function getNodePointByHash(svg, hash) {
  if (!hash) {
    return null;
  }
  const node = svg.querySelector(`[data-role="commit-node"][data-commit-hash="${CSS.escape(hash)}"]`);
  if (!(node instanceof SVGCircleElement)) {
    return null;
  }
  return {
    x: Number(node.getAttribute("cx") ?? "0"),
    y: Number(node.getAttribute("cy") ?? "0"),
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} branchName
 * @returns {{x: number, y: number} | null}
 */
function getTipPointByBranch(svg, branchName) {
  if (!branchName) {
    return null;
  }
  const label = svg.querySelector(`[data-role="branch-label-bg"][data-branch-name="${CSS.escape(branchName)}"]`);
  if (!(label instanceof SVGRectElement)) {
    return null;
  }
  const commitHash = label.getAttribute("data-commit-hash");
  if (!commitHash) {
    return null;
  }
  return getNodePointByHash(svg, commitHash);
}

/**
 * @param {SVGSVGElement} svg
 * @returns {{x: number, y: number} | null}
 */
function getCurrentHeadPoint(svg) {
  const ring = svg.querySelector('[data-role="head-ring"]');
  if (!(ring instanceof SVGCircleElement)) {
    return null;
  }
  return {
    x: Number(ring.getAttribute("cx") ?? "0"),
    y: Number(ring.getAttribute("cy") ?? "0"),
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} ref
 * @returns {{x: number, y: number} | null}
 */
function resolvePointByRef(svg, ref) {
  if (!ref) {
    return null;
  }
  return getNodePointByHash(svg, ref) ?? getTipPointByBranch(svg, ref) ?? null;
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
 * Animate BRANCH_CREATED and BRANCH_SWITCHED/HEAD_MOVED hints.
 * @param {CommitHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   command?: string,
 * }} [options]
 * @returns {unknown}
 */
export function animateBranchingSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const root = options.root ?? document;
  const svg = resolveGraphSvg(root);
  if (!svg) {
    return null;
  }

  const branchCreated = hints.find((hint) => hint?.type === "BRANCH_CREATED");
  const branchSwitched = hints.find((hint) => hint?.type === "BRANCH_SWITCHED");
  const headMoved = hints.find((hint) => hint?.type === "HEAD_MOVED");
  if (!branchCreated && !branchSwitched) {
    return null;
  }

  const timeline = gsap.timeline();

  if (branchCreated && typeof branchCreated.branchName === "string") {
    const atHash = typeof branchCreated.atHash === "string" ? branchCreated.atHash : "";
    const base = getNodePointByHash(svg, atHash) ?? getCurrentHeadPoint(svg);
    if (base) {
      const viewBox = svg.viewBox.baseVal;
      const outward = base.x < viewBox.width * 0.58 ? 72 : -72;
      const end = {
        x: base.x + outward,
        y: base.y - 26,
      };

      const potentialTrack = createSvgEl(svg, "path", {
        d: `M ${base.x} ${base.y} C ${base.x + outward * 0.45} ${base.y - 8}, ${base.x + outward * 0.72} ${base.y - 20}, ${end.x} ${end.y}`,
        stroke: "var(--color-purple-border)",
        "stroke-width": 1.6,
        opacity: 0.52,
        fill: "none",
        "stroke-linecap": "round",
      });
      const len = potentialTrack.getTotalLength();
      potentialTrack.setAttribute("stroke-dasharray", String(len));
      potentialTrack.setAttribute("stroke-dashoffset", String(len));

      const badgeWidth = Math.max(54, branchCreated.branchName.length * 8 + 16);
      const badgeX = end.x + (outward >= 0 ? 8 : -badgeWidth - 8);
      const badgeY = end.y - 12;
      const badgeBg = createSvgEl(svg, "rect", {
        x: badgeX,
        y: badgeY,
        width: badgeWidth,
        height: 20,
        rx: 10,
        ry: 10,
        fill: "var(--bg-hover)",
        stroke: "var(--color-purple-border)",
        "stroke-width": 1,
        opacity: 0,
      });
      const badgeText = createSvgEl(svg, "text", {
        x: badgeX + 8,
        y: badgeY + 14,
        fill: "var(--color-purple)",
        "font-family": "var(--font-mono)",
        "font-size": 12,
        "font-weight": 700,
        opacity: 0,
      });
      badgeText.textContent = branchCreated.branchName;

      timeline.to(potentialTrack, {
        duration: 0.7,
        ease: "power2.out",
        attr: { "stroke-dashoffset": 0 },
      });
      timeline.fromTo(
        [badgeBg, badgeText],
        { opacity: 0, y: 5 },
        { duration: 0.26, opacity: 1, y: 0, ease: "power2.out" },
        "-=0.12",
      );

      if (typeof options.storeTimeline === "function") {
        options.storeTimeline(`branch:${branchCreated.branchName}`, timeline);
      }
    }
  }

  if (branchSwitched) {
    const fromRef = typeof branchSwitched.from === "string" ? branchSwitched.from : "";
    const toRef = typeof branchSwitched.to === "string" ? branchSwitched.to : "";
    const source = resolvePointByRef(svg, fromRef) ?? getCurrentHeadPoint(svg);
    const target = resolvePointByRef(svg, toRef);

    if (source && target) {
      const bridgeY = Math.max(source.y, target.y) + 20;
      const travelPath = createSvgEl(svg, "path", {
        d: `M ${source.x} ${source.y} L ${source.x} ${bridgeY} L ${target.x} ${bridgeY} L ${target.x} ${target.y}`,
        fill: "none",
        stroke: "transparent",
      });
      const headToken = createSvgEl(svg, "circle", {
        cx: source.x,
        cy: source.y,
        r: 10,
        fill: "none",
        stroke: "var(--color-green)",
        "stroke-width": 2,
        opacity: 0,
      });
      const existingHead = svg.querySelector('[data-role="head-ring"]');

      const distance =
        Math.abs(source.y - bridgeY) + Math.abs(source.x - target.x) + Math.abs(bridgeY - target.y);
      const duration = clamp(distance / 420, 0.28, 1.05);
      const detached = branchSwitched.detached === true;
      if (detached) {
        headToken.setAttribute("stroke-dasharray", "4 3");
      }

      timeline.add(() => {
        if (existingHead instanceof SVGCircleElement) {
          existingHead.setAttribute("opacity", "0.2");
        }
      });
      timeline.to(headToken, { duration: 0.08, opacity: 1, ease: "power1.out" }, "<");
      timeline.to(
        headToken,
        {
          duration,
          ease: "power2.inOut",
          motionPath: { path: travelPath, align: travelPath, autoRotate: false, start: 0, end: 1 },
        },
        "<",
      );

      const branchLabelEl = document.querySelector(".current-branch-label");
      const branchSubEl = document.querySelector('[data-role="branch-pill-sub"]');
      timeline.add(() => {
        if (branchLabelEl instanceof HTMLElement) {
          if (detached) {
            const hashLike =
              (typeof headMoved?.to === "string" && headMoved.to) || (typeof toRef === "string" ? toRef : "");
            branchLabelEl.textContent = String(hashLike).slice(0, 7);
          } else {
            branchLabelEl.textContent = toRef;
          }
        }

        if (branchSubEl instanceof HTMLElement) {
          if (detached) {
            branchSubEl.textContent = "detached HEAD";
            branchSubEl.classList.add("is-detached");
          } else {
            branchSubEl.textContent = "";
            branchSubEl.classList.remove("is-detached");
          }
        }
      }, duration * 0.52);

      if (detached) {
        const detachedTag = createSvgEl(svg, "text", {
          x: target.x + 14,
          y: target.y - 14,
          fill: "var(--text-secondary)",
          "font-family": "var(--font-mono)",
          "font-size": 10,
          opacity: 0,
        });
        detachedTag.textContent = "detached";
        timeline.fromTo(
          detachedTag,
          { opacity: 0, y: 4 },
          { duration: 0.22, opacity: 1, y: 0, ease: "power2.out" },
          "-=0.18",
        );
      }

      timeline.to(headToken, { duration: 0.12, opacity: 0, ease: "power1.out" });
      timeline.add(() => {
        travelPath.remove();
        headToken.remove();
      });

      if (typeof options.storeTimeline === "function") {
        const key =
          typeof options.command === "string" && options.command.trim().length > 0
            ? options.command.trim()
            : "branch-switch";
        options.storeTimeline(key, timeline);
      }
    }
  }

  return timeline;
}

/**
 * @param {SVGSVGElement} svg
 * @returns {Map<string, SVGPathElement[]>}
 */
function collectEdgesByChild(svg) {
  const map = new Map();
  const edges = svg.querySelectorAll('[data-role="commit-edge"][data-child-hash][data-parent-hash]');
  edges.forEach((edge) => {
    if (!(edge instanceof SVGPathElement)) {
      return;
    }
    const child = edge.getAttribute("data-child-hash");
    if (!child) {
      return;
    }
    const list = map.get(child) ?? [];
    list.push(edge);
    map.set(child, list);
  });
  return map;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} childHash
 * @param {string} parentHash
 * @returns {SVGPathElement | null}
 */
function findEdge(svg, childHash, parentHash) {
  const selector = `[data-role="commit-edge"][data-child-hash="${CSS.escape(childHash)}"][data-parent-hash="${CSS.escape(parentHash)}"]`;
  const edge = svg.querySelector(selector);
  return edge instanceof SVGPathElement ? edge : null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} branchName
 * @returns {{bg: SVGRectElement | null, text: SVGTextElement | null}}
 */
function getBranchBadge(svg, branchName) {
  const bg = svg.querySelector(
    `[data-role="branch-label-bg"][data-branch-name="${CSS.escape(branchName)}"]`,
  );
  const text = svg.querySelector(
    `[data-role="branch-label-text"][data-branch-name="${CSS.escape(branchName)}"]`,
  );
  return {
    bg: bg instanceof SVGRectElement ? bg : null,
    text: text instanceof SVGTextElement ? text : null,
  };
}

/**
 * Animate FAST_FORWARD and MERGE_COMMIT hints.
 * @param {CommitHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   command?: string,
 * }} [options]
 * @returns {unknown}
 */
export function animateMergeSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const root = options.root ?? document;
  const svg = resolveGraphSvg(root);
  if (!svg) {
    return null;
  }

  const fastForward = hints.find((hint) => hint?.type === "FAST_FORWARD");
  const mergeCommit = hints.find((hint) => hint?.type === "MERGE_COMMIT");
  if (!fastForward && !mergeCommit) {
    return null;
  }

  const timeline = gsap.timeline();

  if (fastForward) {
    const branchName = typeof fastForward.branch === "string" ? fastForward.branch : "main";
    const fromHash = typeof fastForward.fromHash === "string" ? fastForward.fromHash : "";
    const toHash = typeof fastForward.toHash === "string" ? fastForward.toHash : "";
    const fromPoint = getNodePointByHash(svg, fromHash);
    const toPoint = getNodePointByHash(svg, toHash);
    const badge = getBranchBadge(svg, branchName);

    if (fromPoint && toPoint && badge.bg && badge.text) {
      const trace = createSvgEl(svg, "path", {
        d: `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`,
        stroke: branchName === "main" ? "var(--color-green)" : "var(--color-purple)",
        "stroke-width": 3,
        fill: "none",
        "stroke-linecap": "round",
        opacity: 0,
      });

      const badgeX = Number(badge.bg.getAttribute("x") ?? "0");
      const badgeY = Number(badge.bg.getAttribute("y") ?? "0");
      const badgeW = Number(badge.bg.getAttribute("width") ?? "56");
      const badgeH = Number(badge.bg.getAttribute("height") ?? "20");
      const targetX = toPoint.x + 96;
      const targetY = toPoint.y - 13;
      const dx = targetX - badgeX;
      const dy = targetY - badgeY;

      const ghostBg = createSvgEl(svg, "rect", {
        x: badgeX,
        y: badgeY,
        width: badgeW,
        height: badgeH,
        rx: 10,
        ry: 10,
        fill: badge.bg.getAttribute("fill") ?? "var(--bg-hover)",
        stroke: badge.bg.getAttribute("stroke") ?? "var(--color-green-border)",
        "stroke-width": badge.bg.getAttribute("stroke-width") ?? 1.5,
      });
      const ghostText = createSvgEl(svg, "text", {
        x: Number(badge.text.getAttribute("x") ?? String(badgeX + 8)),
        y: Number(badge.text.getAttribute("y") ?? String(badgeY + 14)),
        fill: badge.text.getAttribute("fill") ?? "var(--color-green)",
        "font-family": "var(--font-mono)",
        "font-size": 12,
        "font-weight": 700,
      });
      ghostText.textContent = branchName;

      badge.bg.setAttribute("opacity", "0");
      badge.text.setAttribute("opacity", "0");

      timeline.to(trace, { duration: 0.12, opacity: 0.78, ease: "power1.out" }, 0);
      timeline.to(
        [ghostBg, ghostText],
        {
          duration: 0.4,
          x: dx,
          y: dy,
          ease: "power2.inOut",
        },
        0,
      );
      timeline.to(trace, { duration: 0.2, opacity: 0, ease: "power1.out" }, 0.28);
      timeline.add(() => {
        trace.remove();
        ghostBg.remove();
        ghostText.remove();
        badge.bg?.setAttribute("opacity", "1");
        badge.text?.setAttribute("opacity", "1");
      });
    }
  }

  if (mergeCommit) {
    const parents = Array.isArray(mergeCommit.parents) ? mergeCommit.parents.filter(Boolean) : [];
    if (parents.length >= 2) {
      const parentA = getNodePointByHash(svg, parents[0]);
      const parentB = getNodePointByHash(svg, parents[1]);
      if (parentA && parentB) {
        const headPoint = getCurrentHeadPoint(svg) ?? parentA;
        const mergePoint = {
          x: headPoint.x,
          y: Math.max(22, headPoint.y - 54),
        };

        const trackPulseA = createSvgEl(svg, "path", {
          d: `M ${parentA.x} ${parentA.y + 4} L ${parentA.x} ${Math.max(parentA.y - 58, 14)}`,
          stroke: "var(--color-green)",
          "stroke-width": 3,
          fill: "none",
          opacity: 0,
        });
        const trackPulseB = createSvgEl(svg, "path", {
          d: `M ${parentB.x} ${parentB.y + 4} L ${parentB.x} ${Math.max(parentB.y - 58, 14)}`,
          stroke: "var(--color-purple)",
          "stroke-width": 3,
          fill: "none",
          opacity: 0,
        });

        const mergeNode = createSvgEl(svg, "circle", {
          cx: mergePoint.x,
          cy: mergePoint.y,
          r: 8.6,
          fill: "var(--bg-surface)",
          stroke: "var(--color-blue)",
          "stroke-width": 2.8,
          opacity: 0,
        });
        const mergeNodeInner = createSvgEl(svg, "circle", {
          cx: mergePoint.x,
          cy: mergePoint.y,
          r: 3.2,
          fill: "var(--color-blue)",
          opacity: 0,
        });

        const toParentA = createSvgEl(svg, "path", {
          d: `M ${mergePoint.x} ${mergePoint.y} L ${parentA.x} ${parentA.y}`,
          stroke: "var(--color-green-border)",
          "stroke-width": 2.2,
          fill: "none",
          opacity: 0.95,
          "stroke-linecap": "round",
        });
        const toParentB = createSvgEl(svg, "path", {
          d: `M ${mergePoint.x} ${mergePoint.y} C ${mergePoint.x} ${mergePoint.y + 24}, ${parentB.x} ${parentB.y - 20}, ${parentB.x} ${parentB.y}`,
          stroke: "var(--color-purple-border)",
          "stroke-width": 2.2,
          fill: "none",
          opacity: 0.95,
          "stroke-linecap": "round",
        });
        const lenA = toParentA.getTotalLength();
        const lenB = toParentB.getTotalLength();
        toParentA.setAttribute("stroke-dasharray", String(lenA));
        toParentA.setAttribute("stroke-dashoffset", String(lenA));
        toParentB.setAttribute("stroke-dasharray", String(lenB));
        toParentB.setAttribute("stroke-dashoffset", String(lenB));

        timeline.to([trackPulseA, trackPulseB], { duration: 0.16, opacity: 0.62, ease: "power1.out" });
        timeline.to([trackPulseA, trackPulseB], { duration: 0.18, opacity: 0, ease: "power1.out" });
        timeline.fromTo(
          [mergeNode, mergeNodeInner],
          { opacity: 0, scale: 0, transformOrigin: "50% 50%" },
          { duration: 0.46, opacity: 1, scale: 1, ease: "back.out(1.6)" },
          "-=0.05",
        );
        timeline.to(
          [toParentA, toParentB],
          {
            duration: 0.7,
            attr: { "stroke-dashoffset": 0 },
            ease: "power2.out",
          },
          "-=0.02",
        );

        const sourceBranch =
          typeof mergeCommit.sourceBranch === "string"
            ? mergeCommit.sourceBranch.includes("/")
              ? mergeCommit.sourceBranch.split("/").at(-1) ?? mergeCommit.sourceBranch
              : mergeCommit.sourceBranch
            : "";
        const sourceBadge = sourceBranch ? getBranchBadge(svg, sourceBranch) : { bg: null, text: null };
        if (sourceBadge.bg && sourceBadge.text) {
          timeline.to(
            [sourceBadge.bg, sourceBadge.text],
            {
              duration: 0.24,
              opacity: 0.5,
              ease: "power1.out",
            },
            "-=0.22",
          );
        }

        const headRing = svg.querySelector('[data-role="head-ring"]');
        if (headRing instanceof SVGCircleElement) {
          timeline.to(
            headRing,
            {
              duration: 0.28,
              attr: { cx: mergePoint.x, cy: mergePoint.y },
              ease: "power2.inOut",
            },
            "-=0.24",
          );
        }

        timeline.add(() => {
          trackPulseA.remove();
          trackPulseB.remove();
          mergeNode.remove();
          mergeNodeInner.remove();
          toParentA.remove();
          toParentB.remove();
        });
      }
    }
  }

  if (typeof options.storeTimeline === "function") {
    const commitHash = typeof mergeCommit?.hash === "string" ? mergeCommit.hash : "";
    if (commitHash) {
      options.storeTimeline(commitHash, timeline);
    } else if (typeof options.command === "string" && options.command.trim()) {
      options.storeTimeline(options.command.trim(), timeline);
    }
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
