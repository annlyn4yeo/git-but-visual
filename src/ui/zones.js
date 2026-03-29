/**
 * Initialize zone UI elements.
 * @param {Element} containerEl
 * @returns {void}
 */
export function initZones(containerEl) {
  if (!containerEl) {
    return;
  }

  containerEl.innerHTML = `
    <section class="zones-section" id="the-four-zones" data-section="the-four-zones">
      <header class="zones-section-header">
        <h2 class="zones-title">The Four Zones</h2>
      </header>
      <div class="zones-grid" data-role="zones-grid">
        <article class="zone-column zone-working" data-zone="workingDirectory">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">📁</span>
            <h3 class="zone-name">Working Directory</h3>
          </header>
          <div class="zone-body" data-role="working-files"></div>
        </article>

        <article class="zone-column zone-staging" data-zone="stagingArea">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">🗂</span>
            <h3 class="zone-name">Staging Area</h3>
          </header>
          <div class="zone-body" data-role="staging-files"></div>
        </article>

        <article class="zone-column zone-local" data-zone="localRepository">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">🧬</span>
            <h3 class="zone-name">Local Repository</h3>
          </header>
          <div class="zone-body zone-metrics" data-role="local-metrics"></div>
        </article>

        <article class="zone-column zone-remote" data-zone="remoteRepository">
          <header class="zone-header">
            <span class="zone-icon" aria-hidden="true">☁</span>
            <h3 class="zone-name">Remote Repository</h3>
          </header>
          <div class="zone-body zone-metrics" data-role="remote-metrics"></div>
        </article>
      </div>
    </section>
  `;
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
 * Render zone state.
 * @param {import('../simulator/state.js').GitState} state
 * @returns {void}
 */
export function renderZones(state) {
  if (typeof document === "undefined") {
    return;
  }

  const workingEl = document.querySelector('[data-role="working-files"]');
  const stagingEl = document.querySelector('[data-role="staging-files"]');
  const localMetricsEl = document.querySelector('[data-role="local-metrics"]');
  const remoteMetricsEl = document.querySelector('[data-role="remote-metrics"]');

  if (!workingEl || !stagingEl || !localMetricsEl || !remoteMetricsEl) {
    return;
  }

  const workingMarkup = state.workingDirectory
    .map((file) => renderFileCard(file, "workingDirectory"))
    .join("");
  workingEl.innerHTML = workingMarkup;

  if (state.stagingArea.length === 0) {
    stagingEl.classList.add("is-empty");
    stagingEl.innerHTML = `<p class="zone-placeholder">nothing staged</p>`;
  } else {
    stagingEl.classList.remove("is-empty");
    stagingEl.innerHTML = state.stagingArea.map((file) => renderFileCard(file, "stagingArea")).join("");
  }

  const commitCount = Object.keys(state.commits).length;
  const headHash = state.detached ? state.HEAD : state.branches[state.HEAD];
  localMetricsEl.innerHTML = `
    <div class="zone-metric-row">
      <span class="zone-metric-label">Commits</span>
      <span class="zone-metric-value">${commitCount}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">HEAD</span>
      <span class="zone-metric-value zone-mono">${(headHash ?? "").slice(0, 7)}</span>
    </div>
  `;

  const trackedBranch = state.detached ? null : state.trackingBranches[state.HEAD];
  const remoteBranchName = trackedBranch?.split("/")[1] ?? state.HEAD;
  const remoteHash = state.remoteBranches[remoteBranchName] ?? null;
  remoteMetricsEl.innerHTML = `
    <div class="zone-metric-row">
      <span class="zone-metric-label">Tracking</span>
      <span class="zone-metric-value zone-mono">${trackedBranch ?? "detached"}</span>
    </div>
    <div class="zone-metric-row">
      <span class="zone-metric-label">Remote HEAD</span>
      <span class="zone-metric-value zone-mono">${remoteHash ? remoteHash.slice(0, 7) : "none"}</span>
    </div>
  `;
}
