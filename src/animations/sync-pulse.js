const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @typedef {{type?: string, direction?: string, newHash?: string, toHash?: string, to?: string, branch?: string} & Record<string, unknown>} SyncHint
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
 * @returns {{
 *   container: HTMLElement,
 *   localZone: HTMLElement,
 *   remoteZone: HTMLElement,
 *   svg: SVGSVGElement,
 *   track: SVGPathElement,
 *   pulseMain: SVGCircleElement,
 *   pulseMerge: SVGCircleElement,
 *   midpoint: HTMLElement,
 * } | null}
 */
function ensureOverlay(root) {
  if (!root) {
    return null;
  }

  const containerCandidate =
    root.querySelector?.('[data-role="zones-root"]') ??
    (root instanceof HTMLElement && root.matches('[data-role="zones-root"]') ? root : null);
  if (!(containerCandidate instanceof HTMLElement)) {
    return null;
  }

  const localZone = containerCandidate.querySelector('[data-zone="localRepository"]');
  const remoteZone = containerCandidate.querySelector('[data-zone="remoteRepository"]');
  if (!(localZone instanceof HTMLElement) || !(remoteZone instanceof HTMLElement)) {
    return null;
  }

  containerCandidate.classList.add("zones-sync-host");

  let svg = containerCandidate.querySelector('[data-role="zones-sync-overlay"]');
  if (!(svg instanceof SVGSVGElement)) {
    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("data-role", "zones-sync-overlay");
    svg.classList.add("zones-sync-overlay");
    createSvgEl(svg, "path", {
      "data-role": "zones-sync-track",
      class: "zones-sync-track",
      fill: "none",
    });
    createSvgEl(svg, "circle", {
      "data-role": "zones-sync-pulse-main",
      class: "zones-sync-pulse",
      r: 5.5,
    });
    createSvgEl(svg, "circle", {
      "data-role": "zones-sync-pulse-merge",
      class: "zones-sync-pulse zones-sync-pulse-merge",
      r: 4.5,
    });
    containerCandidate.appendChild(svg);
  }

  let midpoint = containerCandidate.querySelector('[data-role="zones-sync-midpoint"]');
  if (!(midpoint instanceof HTMLElement)) {
    midpoint = document.createElement("div");
    midpoint.className = "zones-sync-midpoint";
    midpoint.setAttribute("data-role", "zones-sync-midpoint");
    midpoint.textContent = "tracking ref updated";
    containerCandidate.appendChild(midpoint);
  }

  const track = svg.querySelector('[data-role="zones-sync-track"]');
  const pulseMain = svg.querySelector('[data-role="zones-sync-pulse-main"]');
  const pulseMerge = svg.querySelector('[data-role="zones-sync-pulse-merge"]');
  if (
    !(track instanceof SVGPathElement) ||
    !(pulseMain instanceof SVGCircleElement) ||
    !(pulseMerge instanceof SVGCircleElement)
  ) {
    return null;
  }

  return {
    container: containerCandidate,
    localZone,
    remoteZone,
    svg,
    track,
    pulseMain,
    pulseMerge,
    midpoint,
  };
}

/**
 * @param {ReturnType<typeof ensureOverlay>} overlay
 * @returns {void}
 */
function layoutOverlay(overlay) {
  if (!overlay) {
    return;
  }

  const { container, localZone, remoteZone, svg, track, midpoint } = overlay;
  const containerRect = container.getBoundingClientRect();
  const localRect = localZone.getBoundingClientRect();
  const remoteRect = remoteZone.getBoundingClientRect();

  const width = containerRect.width;
  const height = containerRect.height;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);

  const startX = localRect.left - containerRect.left + localRect.width / 2;
  const startY = localRect.top - containerRect.top + localRect.height / 2;
  const endX = remoteRect.left - containerRect.left + remoteRect.width / 2;
  const endY = remoteRect.top - containerRect.top + remoteRect.height / 2;
  const controlY = Math.min(startY, endY) - 26;
  const midX = startX + (endX - startX) * 0.5;

  const d = `M ${startX} ${startY} C ${startX + (endX - startX) * 0.3} ${controlY}, ${startX + (endX - startX) * 0.7} ${controlY}, ${endX} ${endY}`;
  track.setAttribute("d", d);

  midpoint.style.left = `${midX}px`;
  midpoint.style.top = `${controlY + 8}px`;
}

/**
 * @param {HTMLElement} zoneEl
 * @param {"local"|"remote"} side
 * @returns {void}
 */
function pulseZone(zoneEl, side) {
  const color =
    side === "local"
      ? "0 0 0 1px rgba(155, 125, 255, 0.45), 0 0 22px rgba(155, 125, 255, 0.24)"
      : "0 0 0 1px rgba(77, 159, 255, 0.45), 0 0 22px rgba(77, 159, 255, 0.24)";
  zoneEl.style.boxShadow = color;
  window.setTimeout(() => {
    zoneEl.style.boxShadow = "";
  }, 420);
}

/**
 * @param {HTMLElement} zoneEl
 * @param {string} label
 * @param {string} hashText
 * @returns {void}
 */
function updateMetricValue(zoneEl, label, hashText) {
  const rows = zoneEl.querySelectorAll(".zone-metric-row");
  rows.forEach((row) => {
    const labelEl = row.querySelector(".zone-metric-label");
    const valueEl = row.querySelector(".zone-metric-value");
    if (!(labelEl instanceof HTMLElement) || !(valueEl instanceof HTMLElement)) {
      return;
    }
    if (labelEl.textContent?.trim() !== label) {
      return;
    }
    valueEl.textContent = hashText;
    valueEl.classList.add("zones-sync-metric-hit");
    window.setTimeout(() => valueEl.classList.remove("zones-sync-metric-hit"), 420);
  });
}

/**
 * @param {SyncHint[]} hints
 * @param {{
 *   root?: ParentNode | Document | null,
 *   zonesRoot?: ParentNode | null,
 *   gsap?: typeof import("gsap").gsap,
 *   storeTimeline?: (key: string, timeline: unknown) => void,
 *   command?: string,
 * }} [options]
 * @returns {unknown}
 */
export function animateSyncSequence(hints, options = {}) {
  const gsap = options.gsap;
  if (!gsap || !Array.isArray(hints) || hints.length === 0) {
    return null;
  }

  const syncHint = hints.find((hint) => hint?.type === "SYNC_PULSE");
  if (!syncHint || typeof syncHint.direction !== "string") {
    return null;
  }

  const direction = syncHint.direction;
  const root = options.zonesRoot ?? options.root ?? document;
  const overlay = ensureOverlay(root);
  if (!overlay) {
    return null;
  }

  layoutOverlay(overlay);
  const { svg, track, pulseMain, pulseMerge, midpoint, localZone, remoteZone } = overlay;
  const trackingHint = hints.find((hint) => hint?.type === "TRACKING_UPDATED");
  const remoteUpdated = hints.find((hint) => hint?.type === "REMOTE_UPDATED");
  const headMoved = hints.find((hint) => hint?.type === "HEAD_MOVED");

  const tl = gsap.timeline({
    onStart() {
      gsap.set(svg, { autoAlpha: 1 });
      gsap.set([pulseMain, pulseMerge], { autoAlpha: 0 });
      gsap.set(midpoint, { autoAlpha: 0, scale: 0.96 });
    },
    onComplete() {
      gsap.to([pulseMain, pulseMerge, midpoint], { duration: 0.14, autoAlpha: 0, ease: "power1.out" });
    },
  });

  if (direction === "push") {
    pulseMain.classList.remove("is-pull-merge");
    pulseMain.classList.remove("is-fetch");
    pulseMain.classList.add("is-push");
    pulseMerge.classList.remove("is-pull-merge");
    tl.add(() => pulseZone(localZone, "local"), 0);
    tl.fromTo(
      pulseMain,
      { autoAlpha: 1 },
      {
        duration: 0.62,
        ease: "power2.inOut",
        motionPath: { path: track, align: track, autoRotate: false, start: 0, end: 1 },
      },
      0,
    );
    tl.add(() => {
      pulseZone(remoteZone, "remote");
      if (remoteUpdated && typeof remoteUpdated.toHash === "string") {
        updateMetricValue(remoteZone, "Remote HEAD", remoteUpdated.toHash.slice(0, 7));
      }
    }, 0.58);
  } else if (direction === "fetch") {
    pulseMain.classList.remove("is-pull-merge");
    pulseMain.classList.remove("is-push");
    pulseMain.classList.add("is-fetch");
    pulseMerge.classList.remove("is-pull-merge");
    tl.fromTo(
      pulseMain,
      { autoAlpha: 1 },
      {
        duration: 0.86,
        ease: "power1.inOut",
        motionPath: { path: track, align: track, autoRotate: false, start: 1, end: 0.5 },
      },
      0,
    );
    tl.to(
      midpoint,
      {
        duration: 0.22,
        autoAlpha: 1,
        scale: 1,
        ease: "power2.out",
      },
      0.72,
    );
    tl.add(() => {
      const hash = typeof trackingHint?.newHash === "string" ? trackingHint.newHash.slice(0, 7) : "";
      midpoint.textContent = hash ? `tracking updated ${hash}` : "tracking ref updated";
      if (trackingHint && typeof trackingHint.newHash === "string") {
        updateMetricValue(remoteZone, "Tracking", trackingHint.branch ? `origin/${trackingHint.branch}` : "origin/main");
      }
    }, 0.74);
  } else {
    // pull: act 1 fetch to midpoint, pause, act 2 merge to local.
    pulseMain.classList.remove("is-pull-merge");
    pulseMain.classList.remove("is-push");
    pulseMain.classList.add("is-fetch");
    pulseMerge.classList.remove("is-fetch", "is-push");
    pulseMerge.classList.add("is-pull-merge");

    tl.fromTo(
      pulseMain,
      { autoAlpha: 1 },
      {
        duration: 0.86,
        ease: "power1.inOut",
        motionPath: { path: track, align: track, autoRotate: false, start: 1, end: 0.5 },
      },
      0,
    );
    tl.to(
      midpoint,
      {
        duration: 0.2,
        autoAlpha: 1,
        scale: 1,
        ease: "power2.out",
      },
      0.72,
    );
    tl.add(() => {
      const hash = typeof trackingHint?.newHash === "string" ? trackingHint.newHash.slice(0, 7) : "";
      midpoint.textContent = hash ? `tracking updated ${hash}` : "tracking ref updated";
    }, 0.74);

    tl.to({}, { duration: 0.18 });

    tl.fromTo(
      pulseMerge,
      { autoAlpha: 1 },
      {
        duration: 0.46,
        ease: "power2.inOut",
        motionPath: { path: track, align: track, autoRotate: false, start: 0.5, end: 0 },
      },
      "+=0",
    );
    tl.add(() => {
      pulseZone(localZone, "local");
      if (headMoved && typeof headMoved.to === "string") {
        updateMetricValue(localZone, "HEAD", headMoved.to.slice(0, 7));
      }
    }, "-=0.08");
  }

  if (typeof options.storeTimeline === "function") {
    const key = typeof options.command === "string" && options.command.trim() ? options.command.trim() : `sync:${direction}`;
    options.storeTimeline(key, tl);
  }

  return tl;
}

/**
 * Legacy exports retained for compatibility.
 * @returns {null}
 */
export function animatePush() {
  return null;
}

/**
 * Legacy exports retained for compatibility.
 * @returns {null}
 */
export function animatePull() {
  return null;
}

/**
 * Legacy exports retained for compatibility.
 * @returns {null}
 */
export function animateFetch() {
  return null;
}
