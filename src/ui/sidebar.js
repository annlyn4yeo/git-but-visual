import { on, off } from "../utils/events.js";

const SIDEBAR_SECTIONS = [
  {
    title: "Concepts",
    items: [
      { number: "01", label: "The Four Zones", sectionId: "the-four-zones" },
      { number: "02", label: "Saving Changes", sectionId: "saving-changes" },
      { number: "03", label: "Branching", sectionId: "branching" },
      { number: "04", label: "Merging", sectionId: "merging" },
    ],
  },
  {
    title: "Remote",
    items: [
      { number: "05", label: "Syncing Remote", sectionId: "syncing-remote" },
    ],
  },
  {
    title: "Undo",
    items: [
      { number: "06", label: "Undoing Changes", sectionId: "undoing-changes" },
      { number: "07", label: "Stashing", sectionId: "stashing" },
    ],
  },
];

const PLAYGROUND_ITEM = {
  sectionId: "playground",
  label: "Playground (free sandbox)",
};
const COMPLETION_STORAGE_KEY = "gitvisual:section-completions:v1";
let completionListener = null;

function renderSidebarMarkup() {
  const sectionGroups = SIDEBAR_SECTIONS.map((group) => {
    const itemsMarkup = group.items
      .map(
        (item) => `
          <button class="sidebar-nav-item" data-role="sidebar-nav-item" data-section="${item.sectionId}" type="button">
            <span class="sidebar-nav-number">${item.number}</span>
            <span class="sidebar-nav-label">${item.label}</span>
          </button>
        `,
      )
      .join("");

    return `
      <section class="sidebar-group" aria-label="${group.title}">
        <h3 class="sidebar-group-title">${group.title}</h3>
        <div class="sidebar-group-items">
          ${itemsMarkup}
        </div>
      </section>
    `;
  }).join("");

  return `
    <div class="sidebar-shell">
      <span class="sidebar-active-rail" data-role="sidebar-active-rail" aria-hidden="true"></span>
      <header class="sidebar-logo-block">
        <h1 class="sidebar-logo">
          Git<span class="sidebar-logo-accent"><em>Visual</em></span>
        </h1>
        <p class="sidebar-logo-short" aria-hidden="true">GV</p>
        <p class="sidebar-tagline">Learn git by seeing it</p>
      </header>

      <nav class="sidebar-nav" aria-label="Learning navigation">
        ${sectionGroups}
      </nav>

      <button class="sidebar-playground" data-role="sidebar-nav-item" data-section="${PLAYGROUND_ITEM.sectionId}" type="button">
        <span class="sidebar-playground-icon">⚡</span>
        <span class="sidebar-playground-label">${PLAYGROUND_ITEM.label}</span>
      </button>
    </div>
  `;
}

function getMainContentPanel() {
  return document.getElementById("main-content");
}

function scrollToSection(sectionId) {
  const mainPanel = getMainContentPanel();
  if (!mainPanel) {
    return;
  }

  const targetEl =
    mainPanel.querySelector(`[data-section="${sectionId}"]`) ||
    mainPanel.querySelector(`#${sectionId}`);

  if (!targetEl) {
    return;
  }

  const panelRect = mainPanel.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const top = mainPanel.scrollTop + (targetRect.top - panelRect.top);

  mainPanel.scrollTo({ top, behavior: "smooth" });
}

/**
 * @param {HTMLElement | null} sidebar
 * @param {HTMLElement | null} targetItem
 * @returns {void}
 */
function moveActiveRail(sidebar, targetItem) {
  if (!sidebar || !targetItem) {
    return;
  }

  const shell = sidebar.querySelector(".sidebar-shell");
  const rail = sidebar.querySelector('[data-role="sidebar-active-rail"]');
  if (!(shell instanceof HTMLElement) || !(rail instanceof HTMLElement)) {
    return;
  }

  const shellRect = shell.getBoundingClientRect();
  const itemRect = targetItem.getBoundingClientRect();
  const top = itemRect.top - shellRect.top;
  rail.style.top = `${Math.max(0, top)}px`;
  rail.style.height = `${Math.max(0, itemRect.height)}px`;
  rail.style.opacity = "1";
}

function readCompletionSet() {
  if (typeof window === "undefined" || !window.localStorage) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(COMPLETION_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((item) => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function applyCompletionState(sidebarEl) {
  const completed = readCompletionSet();
  const navItems = sidebarEl.querySelectorAll(
    '[data-role="sidebar-nav-item"][data-section]',
  );
  navItems.forEach((itemEl) => {
    const sectionId = itemEl.getAttribute("data-section");
    const isComplete = Boolean(
      sectionId && sectionId !== "playground" && completed.has(sectionId),
    );
    itemEl.classList.toggle("is-complete", isComplete);
  });
}

/**
 * Initialize sidebar UI.
 * @param {Element | null} [containerEl]
 * @returns {void}
 */
export function initSidebar(containerEl) {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedContainer = containerEl ?? document.getElementById("sidebar");
  if (!resolvedContainer) {
    return;
  }

  resolvedContainer.innerHTML = renderSidebarMarkup();
  applyCompletionState(resolvedContainer);

  if (completionListener) {
    off("section:completed", completionListener);
    completionListener = null;
  }

  completionListener = (payload) => {
    const sectionId =
      typeof payload?.sectionId === "string" ? payload.sectionId : "";
    if (!sectionId || sectionId === "playground") {
      return;
    }
    const navItem = resolvedContainer.querySelector(
      `[data-role="sidebar-nav-item"][data-section="${sectionId}"]`,
    );
    if (navItem instanceof HTMLElement) {
      navItem.classList.add("is-complete");
    }
  };
  on("section:completed", completionListener);

  const navItems = resolvedContainer.querySelectorAll(
    '[data-role="sidebar-nav-item"][data-section]',
  );
  navItems.forEach((itemEl) => {
    itemEl.addEventListener("click", () => {
      const sectionId = itemEl.getAttribute("data-section");
      if (!sectionId) {
        return;
      }

      setActiveSection(sectionId);
      scrollToSection(sectionId);
    });
  });

  const initialId = SIDEBAR_SECTIONS[0].items[0].sectionId;
  setActiveSection(initialId);
}

/**
 * Set active sidebar section.
 * @param {string} sectionId
 * @returns {void}
 */
export function setActiveSection(sectionId) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) {
    return;
  }

  const navItems = sidebar.querySelectorAll(
    '[data-role="sidebar-nav-item"][data-section]',
  );
  navItems.forEach((itemEl) => {
    const isActive = itemEl.getAttribute("data-section") === sectionId;
    itemEl.classList.toggle("is-active", isActive);
    itemEl.setAttribute("aria-current", isActive ? "true" : "false");
  });

  const activeItem = sidebar.querySelector(
    `[data-role="sidebar-nav-item"][data-section="${sectionId}"]`,
  );
  moveActiveRail(
    sidebar,
    activeItem instanceof HTMLElement ? activeItem : null,
  );
}
