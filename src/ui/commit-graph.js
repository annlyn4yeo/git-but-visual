const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @typedef {import("../simulator/state.js").GitState} GitState
 */

/**
 * @param {string} branchName
 * @returns {string}
 */
function getBranchColor(branchName) {
  if (branchName === "main") {
    return "var(--color-green)";
  }

  return "var(--color-purple)";
}

/**
 * @param {string} branchName
 * @returns {string}
 */
function getBranchMutedColor(branchName) {
  if (branchName === "main") {
    return "var(--color-green-border)";
  }

  return "var(--color-purple-border)";
}

/**
 * @param {string} branchName
 * @returns {string}
 */
function getBranchDimColor(branchName) {
  if (branchName === "main") {
    return "var(--color-green-dim)";
  }

  return "var(--color-purple-dim)";
}

/**
 * @param {GitState} state
 * @returns {Array<import("../simulator/state.js").CommitObject>}
 */
function getSortedCommits(state) {
  return Object.values(state.commits).sort((a, b) => {
    if (b.timestamp !== a.timestamp) {
      return b.timestamp - a.timestamp;
    }
    return b.hash.localeCompare(a.hash);
  });
}

/**
 * @param {GitState} state
 * @returns {string}
 */
function getHeadHash(state) {
  return state.detached ? state.HEAD : state.branches[state.HEAD];
}

/**
 * @param {GitState} state
 * @returns {Map<string, string[]>}
 */
function getBranchesByHash(state) {
  /** @type {Map<string, string[]>} */
  const branchesByHash = new Map();

  for (const [branchName, hash] of Object.entries(state.branches)) {
    const list = branchesByHash.get(hash) ?? [];
    list.push(branchName);
    branchesByHash.set(hash, list);
  }

  return branchesByHash;
}

/**
 * @param {GitState} state
 * @returns {Set<string>}
 */
function getReachableHashes(state) {
  const reachable = new Set();
  const stack = Object.values(state.branches);

  while (stack.length > 0) {
    const hash = stack.pop();
    if (!hash || reachable.has(hash)) {
      continue;
    }

    reachable.add(hash);
    const commit = state.commits[hash];
    if (!commit || !Array.isArray(commit.parents)) {
      continue;
    }

    for (const parentHash of commit.parents) {
      if (parentHash && !reachable.has(parentHash)) {
        stack.push(parentHash);
      }
    }
  }

  return reachable;
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  const timestampMs = timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
  const diffSeconds = Math.max(1, Math.floor((Date.now() - timestampMs) / 1000));

  if (diffSeconds < 60) {
    return `${diffSeconds} second(s) ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} minute(s) ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour(s) ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day(s) ago`;
}

/**
 * @param {Element} rightPanel
 * @returns {{ svg: SVGSVGElement, branchPill: HTMLElement, branchPillSub: HTMLElement, tooltip: HTMLElement } | null}
 */
function ensureGraphShell(rightPanel) {
  if (!rightPanel) {
    return null;
  }

  rightPanel.innerHTML = `
    <div class="commit-panel">
      <header class="commit-panel-header">
        <p class="commit-panel-title">Commit Graph</p>
      </header>
      <div class="commit-panel-canvas">
        <svg class="commit-graph-svg" viewBox="0 0 280 320" preserveAspectRatio="xMidYMin meet" aria-label="Commit graph"></svg>
        <div class="commit-tooltip" data-role="commit-tooltip" hidden></div>
      </div>
      <footer class="commit-panel-footer">
        <span class="current-branch-pill" data-role="branch-pill">
          <span class="current-branch-dot" aria-hidden="true"></span>
          <span class="current-branch-label">main</span>
        </span>
        <span class="current-branch-sub" data-role="branch-pill-sub"></span>
      </footer>
    </div>
  `;

  const svg = rightPanel.querySelector(".commit-graph-svg");
  const branchPillLabel = rightPanel.querySelector(".current-branch-label");
  const branchPillSub = rightPanel.querySelector('[data-role="branch-pill-sub"]');
  const tooltip = rightPanel.querySelector('[data-role="commit-tooltip"]');
  if (!svg || !branchPillLabel || !branchPillSub || !tooltip) {
    return null;
  }

  return {
    svg,
    branchPill: branchPillLabel,
    branchPillSub,
    tooltip,
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} name
 * @param {Record<string, string | number>} attrs
 * @returns {SVGElement}
 */
function createSvgElement(svg, name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  svg.appendChild(el);
  return el;
}

/**
 * @param {HTMLElement} tooltipEl
 * @param {Element} nodeEl
 * @param {import("../simulator/state.js").CommitObject} commit
 * @returns {void}
 */
function showTooltip(tooltipEl, nodeEl, commit) {
  tooltipEl.innerHTML = `
    <div class="commit-tooltip-message">${commit.message}</div>
    <div class="commit-tooltip-meta">${commit.hash}</div>
    <div class="commit-tooltip-meta">${formatRelativeTime(commit.timestamp)}</div>
  `;
  tooltipEl.hidden = false;

  const canvasEl = tooltipEl.parentElement;
  if (!canvasEl) {
    return;
  }

  const canvasRect = canvasEl.getBoundingClientRect();
  const nodeRect = nodeEl.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();

  let left = nodeRect.left - canvasRect.left - tipRect.width - 10;
  if (left < 8) {
    left = 8;
  }

  let top = nodeRect.top - canvasRect.top - tipRect.height / 2;
  if (top < 8) {
    top = 8;
  }

  const maxTop = canvasRect.height - tipRect.height - 8;
  if (top > maxTop) {
    top = Math.max(8, maxTop);
  }

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

/**
 * Renders the commit graph for the right panel.
 * @param {GitState} state
 * @returns {void}
 */
export function renderCommitGraph(state) {
  if (typeof document === "undefined") {
    return;
  }

  const rightPanel = document.getElementById("right-panel");
  if (!rightPanel) {
    return;
  }

  const shell = ensureGraphShell(rightPanel);
  if (!shell) {
    return;
  }

  const { svg, branchPill, branchPillSub, tooltip } = shell;
  svg.innerHTML = "";
  tooltip.hidden = true;

  const commits = getSortedCommits(state);
  const headHash = getHeadHash(state);
  const branchesByHash = getBranchesByHash(state);
  const reachableHashes = getReachableHashes(state);

  const branchLanes = new Map();
  branchLanes.set("main", 0);

  for (const commit of commits) {
    if (!branchLanes.has(commit.branch)) {
      branchLanes.set(commit.branch, branchLanes.size);
    }
  }

  const baseX = 30;
  const trackOffset = 74;
  const topY = 28;
  const rowSpacing = 54;

  const positionByHash = new Map();
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const laneIndex = branchLanes.get(commit.branch) ?? 0;
    positionByHash.set(commit.hash, {
      x: baseX + laneIndex * trackOffset,
      y: topY + index * rowSpacing,
      branch: commit.branch,
    });
  }

  const width = Math.max(280, baseX + (branchLanes.size - 1) * trackOffset + 190);
  const height = Math.max(320, commits.length * rowSpacing + 36);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  for (const commit of commits) {
    const from = positionByHash.get(commit.hash);
    if (!from) {
      continue;
    }

    const isDangling = !reachableHashes.has(commit.hash);

    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parentHash = commit.parents[parentIndex];
      const to = positionByHash.get(parentHash);
      if (!to) {
        continue;
      }

      const isSecondaryParent = parentIndex === 1;
      const path = createSvgElement(svg, "path", {
        d: isSecondaryParent
          ? `M ${from.x} ${from.y} C ${from.x} ${from.y + 20}, ${to.x} ${to.y - 20}, ${to.x} ${to.y}`
          : `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        stroke: isDangling ? "var(--border-default)" : getBranchMutedColor(isSecondaryParent ? to.branch : commit.branch),
        "stroke-width": isSecondaryParent ? 1.5 : 2,
        fill: "none",
        "stroke-linecap": "round",
      });

      if (isDangling) {
        path.setAttribute("stroke-dasharray", "4 4");
        path.setAttribute("opacity", "0.7");
      }
    }
  }

  for (const commit of commits) {
    const point = positionByHash.get(commit.hash);
    if (!point) {
      continue;
    }

    const isHead = commit.hash === headHash;
    const isDangling = !reachableHashes.has(commit.hash);

    if (isHead) {
      createSvgElement(svg, "circle", {
        cx: point.x,
        cy: point.y,
        r: 10,
        fill: "none",
        stroke: isDangling ? "var(--text-muted)" : getBranchColor(commit.branch),
        "stroke-width": 2,
        opacity: isDangling ? 0.65 : 1,
      });
    }

    const node = createSvgElement(svg, "circle", {
      cx: point.x,
      cy: point.y,
      r: isHead ? 7 : 5.5,
      fill: isDangling ? "var(--bg-hover)" : "var(--bg-surface)",
      stroke: isDangling ? "var(--text-muted)" : getBranchColor(commit.branch),
      "stroke-width": isHead ? 2.5 : 2,
      opacity: isDangling ? 0.6 : 1,
      cursor: "pointer",
    });

    node.addEventListener("mouseenter", () => {
      showTooltip(tooltip, node, commit);
    });
    node.addEventListener("mousemove", () => {
      showTooltip(tooltip, node, commit);
    });
    node.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });

    createSvgElement(svg, "text", {
      x: point.x + 14,
      y: point.y + 4,
      fill: isDangling ? "var(--text-muted)" : "var(--text-secondary)",
      "font-family": "var(--font-mono)",
      "font-size": "11",
      opacity: isDangling ? 0.8 : 1,
    }).textContent = commit.hash.slice(0, 7);

    const branchNames = branchesByHash.get(commit.hash) ?? [];
    for (let i = 0; i < branchNames.length; i += 1) {
      const branchName = branchNames[i];
      const pillWidth = Math.max(38, branchName.length * 7 + 14);
      const pillX = point.x + 88 + i * (pillWidth + 6);
      const pillY = point.y - 11;

      createSvgElement(svg, "rect", {
        x: pillX,
        y: pillY,
        rx: 8,
        ry: 8,
        width: pillWidth,
        height: 16,
        fill: getBranchDimColor(branchName),
        stroke: getBranchMutedColor(branchName),
        "stroke-width": 1,
      });

      createSvgElement(svg, "text", {
        x: pillX + 7,
        y: pillY + 11,
        fill: getBranchColor(branchName),
        "font-family": "var(--font-mono)",
        "font-size": "10",
        "font-weight": "600",
      }).textContent = branchName;
    }

    if (state.detached && commit.hash === headHash) {
      const detachedLabel = "HEAD";
      const detachedWidth = 42;
      const detachedX = point.x + 88;
      const detachedY = point.y + 10;

      createSvgElement(svg, "rect", {
        x: detachedX,
        y: detachedY,
        rx: 8,
        ry: 8,
        width: detachedWidth,
        height: 16,
        fill: "var(--bg-hover)",
        stroke: "var(--text-muted)",
        "stroke-width": 1,
      });

      createSvgElement(svg, "text", {
        x: detachedX + 9,
        y: detachedY + 11,
        fill: "var(--text-secondary)",
        "font-family": "var(--font-mono)",
        "font-size": "10",
        "font-weight": "600",
      }).textContent = detachedLabel;
    }
  }

  if (state.detached) {
    branchPill.textContent = String(headHash ?? "").slice(0, 7);
    branchPillSub.textContent = "detached HEAD";
    branchPillSub.classList.add("is-detached");
  } else {
    branchPill.textContent = state.HEAD;
    branchPillSub.textContent = "";
    branchPillSub.classList.remove("is-detached");
  }
}
