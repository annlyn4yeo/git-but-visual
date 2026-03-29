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

  if (branchName.startsWith("feature")) {
    return "var(--color-purple)";
  }

  return "var(--color-blue)";
}

/**
 * @param {string} branchName
 * @returns {string}
 */
function getBranchMutedColor(branchName) {
  if (branchName === "main") {
    return "var(--color-green-border)";
  }

  if (branchName.startsWith("feature")) {
    return "var(--color-purple-border)";
  }

  return "var(--color-blue-border)";
}

/**
 * @param {string} branchName
 * @returns {string}
 */
function getBranchDimColor(branchName) {
  if (branchName === "main") {
    return "var(--color-green-dim)";
  }

  if (branchName.startsWith("feature")) {
    return "var(--color-purple-dim)";
  }

  return "var(--color-blue-dim)";
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
 * @param {Element} rightPanel
 * @returns {{ svg: SVGSVGElement, branchPill: HTMLElement } | null}
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
      </div>
      <footer class="commit-panel-footer">
        <span class="current-branch-pill">
          <span class="current-branch-dot" aria-hidden="true"></span>
          <span class="current-branch-label">main</span>
        </span>
      </footer>
    </div>
  `;

  const svg = rightPanel.querySelector(".commit-graph-svg");
  const branchPillLabel = rightPanel.querySelector(".current-branch-label");
  if (!svg || !branchPillLabel) {
    return null;
  }

  return { svg, branchPill: branchPillLabel };
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

  const { svg, branchPill } = shell;
  svg.innerHTML = "";

  const commits = getSortedCommits(state);
  const headHash = getHeadHash(state);
  const branchesByHash = getBranchesByHash(state);

  const branchLanes = new Map();
  branchLanes.set("main", 0);

  for (const commit of commits) {
    if (!branchLanes.has(commit.branch)) {
      branchLanes.set(commit.branch, branchLanes.size);
    }
  }

  const positionByHash = new Map();
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const laneIndex = branchLanes.get(commit.branch) ?? 0;
    const x = 28 + laneIndex * 82;
    const y = 28 + index * 54;
    positionByHash.set(commit.hash, { x, y, branch: commit.branch });
  }

  const height = Math.max(320, commits.length * 60 + 28);
  svg.setAttribute("viewBox", `0 0 280 ${height}`);

  for (const commit of commits) {
    const from = positionByHash.get(commit.hash);
    if (!from) {
      continue;
    }

    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parentHash = commit.parents[parentIndex];
      const to = positionByHash.get(parentHash);
      if (!to) {
        continue;
      }

      const isSecondaryParent = parentIndex === 1;
      createSvgElement(svg, "path", {
        d: isSecondaryParent
          ? `M ${from.x} ${from.y} C ${from.x} ${from.y + 24}, ${to.x} ${to.y - 24}, ${to.x} ${to.y}`
          : `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        stroke: getBranchMutedColor(isSecondaryParent ? to.branch : commit.branch),
        "stroke-width": isSecondaryParent ? 1.5 : 2,
        fill: "none",
        "stroke-linecap": "round",
      });
    }
  }

  for (const commit of commits) {
    const point = positionByHash.get(commit.hash);
    if (!point) {
      continue;
    }

    const isHead = commit.hash === headHash;
    createSvgElement(svg, "circle", {
      cx: point.x,
      cy: point.y,
      r: isHead ? 8 : 6,
      fill: "var(--bg-surface)",
      stroke: getBranchColor(commit.branch),
      "stroke-width": isHead ? 3 : 2,
    });

    createSvgElement(svg, "text", {
      x: point.x + 14,
      y: point.y + 4,
      fill: "var(--text-secondary)",
      "font-family": "var(--font-mono)",
      "font-size": "11",
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
  }

  branchPill.textContent = state.HEAD;
}
