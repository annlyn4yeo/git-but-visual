/**
 * Initialize zone UI elements.
 * @param {Element} containerEl
 * @param {{title?: string, showDescriptions?: boolean}} [options]
 * @returns {Element | null}
 */
export function initZones(containerEl, options = {}) {
  if (!containerEl) {
    return null;
  }

  const { title = "The Four Zones", showDescriptions = false } = options;

  containerEl.innerHTML = `
    <section class="zones-section" data-role="zones-root">
      <header class="zones-section-header">
        <h2 class="zones-title">${title}</h2>
      </header>
      <div class="zones-grid" data-role="zones-grid">
        <article class="zone-column zone-working" data-zone="workingDirectory">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">WD</span>
            <h3 class="zone-name">Working Directory</h3>
          </header>
          ${showDescriptions ? '<p class="zone-description">Your editable files before staging.</p>' : ""}
          <div class="zone-body" data-role="working-files"></div>
        </article>

        <article class="zone-column zone-staging" data-zone="stagingArea">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">ST</span>
            <h3 class="zone-name">Staging Area</h3>
          </header>
          ${showDescriptions ? '<p class="zone-description">A curated set of files for the next commit.</p>' : ""}
          <div class="zone-body" data-role="staging-files"></div>
        </article>

        <article class="zone-column zone-local" data-zone="localRepository">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">LR</span>
            <h3 class="zone-name">Local Repository</h3>
          </header>
          ${showDescriptions ? '<p class="zone-description">Commit history and branch pointers on your machine.</p>' : ""}
          <div class="zone-body zone-metrics" data-role="local-metrics"></div>
        </article>

        <article class="zone-column zone-remote" data-zone="remoteRepository">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">RR</span>
            <h3 class="zone-name">Remote Repository</h3>
          </header>
          ${showDescriptions ? '<p class="zone-description">Shared repository state on origin.</p>' : ""}
          <div class="zone-body zone-metrics" data-role="remote-metrics"></div>
        </article>
      </div>
    </section>
  `;

  return containerEl.querySelector('[data-role="zones-root"]');
}

/**
 * @param {{name: string, status: string}} file
 * @param {"workingDirectory"|"stagingArea"} zone
 * @returns {string}
 */
function renderFileCard(file, zone) {
  const statusClass = file.status === "modified" ? "status-modified" : "status-untracked";
  const safeId = `${zone}-${file.name}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  return `
    <article
      class="file-card zone-file-card"
      id="file-card-${safeId}"
      data-filename="${file.name}"
      data-zone="${zone}"
    >
      <span class="file-card-name">${file.name}</span>
      <span class="file-card-status ${statusClass}">${file.status}</span>
    </article>
  `;
}

/**
 * @param {Record<string, import("../simulator/state.js").CommitObject>} commits
 * @param {string | null | undefined} fromHash
 * @param {string | null | undefined} toHash
 * @returns {number | null}
 */
function countFirstParentDistance(commits, fromHash, toHash) {
  if (!fromHash || !toHash) {
    return null;
  }

  let current = fromHash;
  let distance = 0;
  const visited = new Set();

  while (current && !visited.has(current)) {
    if (current === toHash) {
      return distance;
    }

    visited.add(current);
    const commit = commits[current];
    if (!commit || !Array.isArray(commit.parents) || commit.parents.length === 0) {
      return null;
    }

    current = commit.parents[0];
    distance += 1;
  }

  return null;
}

/**
 * @param {import('../simulator/state.js').GitState} state
 * @returns {string}
 */
function getHeadHash(state) {
  return state.detached ? state.HEAD : state.branches[state.HEAD];
}

/**
 * Render zone state.
 * @param {import('../simulator/state.js').GitState} state
 * @param {ParentNode} [root=document]
 * @returns {void}
 */
export function renderZones(state, root = document) {
  if (typeof document === "undefined") {
    return;
  }

  const workingEl = root.querySelector('[data-role="working-files"]');
  const stagingEl = root.querySelector('[data-role="staging-files"]');
  const localMetricsEl = root.querySelector('[data-role="local-metrics"]');
  const remoteMetricsEl = root.querySelector('[data-role="remote-metrics"]');
  const stagingZoneEl = root.querySelector('[data-zone="stagingArea"]');

  if (!workingEl || !stagingEl || !localMetricsEl || !remoteMetricsEl || !stagingZoneEl) {
    return;
  }

  if (state.workingDirectory.length === 0) {
    workingEl.classList.add("is-empty");
    workingEl.innerHTML = `<p class="zone-placeholder">working tree clean</p>`;
  } else {
    workingEl.classList.remove("is-empty");
    const workingMarkup = state.workingDirectory
      .map((file) => renderFileCard(file, "workingDirectory"))
      .join("");
    workingEl.innerHTML = workingMarkup;
  }

  if (state.stagingArea.length === 0) {
    stagingEl.classList.add("is-empty");
    stagingZoneEl.classList.remove("has-files");
    stagingEl.innerHTML = `<p class="zone-placeholder">nothing staged</p>`;
  } else {
    stagingEl.classList.remove("is-empty");
    stagingZoneEl.classList.add("has-files");
    stagingEl.innerHTML = state.stagingArea.map((file) => renderFileCard(file, "stagingArea")).join("");
  }

  const commitCount = Object.keys(state.commits).length;
  const headHash = getHeadHash(state);
  const branchEntries = Object.entries(state.branches);
  const branchListMarkup =
    branchEntries.length > 1
      ? `<div class="zone-branch-list">${branchEntries
          .map(
            ([branchName, tipHash]) => `
              <div class="zone-branch-item">
                <span class="zone-metric-label">${branchName}</span>
                <span class="zone-metric-value zone-mono">${String(tipHash).slice(0, 7)}</span>
              </div>
            `,
          )
          .join("")}</div>`
      : "";

  localMetricsEl.innerHTML = `
    <div class="zone-metric-row">
      <span class="zone-metric-label">Commits</span>
      <span class="zone-metric-value">${commitCount}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">HEAD</span>
      <span class="zone-metric-value zone-mono">${(headHash ?? "").slice(0, 7)}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">Branch</span>
      <span class="zone-metric-value zone-mono">${state.detached ? "detached" : state.HEAD}</span>
    </div>
    ${branchListMarkup}
  `;

  if (!state.remote.connected) {
    remoteMetricsEl.innerHTML = `
      <div class="zone-remote-empty">
        <p class="zone-placeholder">no remote configured</p>
      </div>
    `;
    return;
  }

  const currentBranch = state.detached ? null : state.HEAD;
  const trackedBranch = currentBranch ? state.trackingBranches[currentBranch] : null;
  const remoteBranchName = trackedBranch?.split("/")[1] ?? currentBranch;
  const remoteHash = remoteBranchName ? state.remoteBranches[remoteBranchName] ?? null : null;
  const localHash = currentBranch ? state.branches[currentBranch] ?? null : null;

  const ahead = countFirstParentDistance(state.commits, localHash, remoteHash);
  const behind = countFirstParentDistance(state.commits, remoteHash, localHash);

  let syncText = "up to date";
  if (ahead !== null && ahead > 0) {
    syncText = `${ahead} commit(s) ahead`;
  } else if (behind !== null && behind > 0) {
    syncText = `${behind} commit(s) behind`;
  } else if (ahead === null && behind === null && remoteHash && localHash && remoteHash !== localHash) {
    syncText = "diverged";
  }

  remoteMetricsEl.innerHTML = `
    <div class="zone-metric-row">
      <span class="zone-metric-label">Remote</span>
      <span class="zone-metric-value zone-mono">${state.remote.name}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">URL</span>
      <span class="zone-metric-value zone-mono zone-url">${state.remote.url}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">Tracking</span>
      <span class="zone-metric-value zone-mono">${trackedBranch ?? "detached"}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">Sync</span>
      <span class="zone-metric-value">${syncText}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">Remote HEAD</span>
      <span class="zone-metric-value zone-mono">${remoteHash ? remoteHash.slice(0, 7) : "none"}</span>
    </div>
  `;
}
