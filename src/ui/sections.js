import { emit } from "../utils/events.js";

/** @type {Map<string, {el: HTMLElement, demoEl: HTMLElement}>} */
const sectionRefs = new Map();

const SECTIONS = [
  {
    id: "the-four-zones",
    number: "01",
    heading: "The Four Zones",
    copy: [
      "All git operations move files or pointers between these four zones.",
      "Every command you learn is just moving something from one zone to another.",
    ],
    chips: [],
  },
  {
    id: "saving-changes",
    number: "02",
    heading: "Saving Changes",
    copy: [
      "The add to commit to push workflow is the core save loop in git.",
      "Stage the right files, snapshot with a commit, then sync upstream.",
    ],
    chips: [
      { command: "git add", tone: "staging" },
      { command: "git commit", tone: "history" },
      { command: "git push", tone: "remote" },
    ],
  },
  {
    id: "branching",
    number: "03",
    heading: "Branching",
    copy: [
      "Branches are lightweight named pointers to commits.",
      "Creating a branch is instant, so branching early is almost always free.",
    ],
    chips: [
      { command: "git branch", tone: "history" },
      { command: "git checkout", tone: "history" },
      { command: "git switch", tone: "history" },
    ],
  },
  {
    id: "merging",
    number: "04",
    heading: "Merging",
    copy: [
      "Fast-forward merges move a pointer with no new commit.",
      "Diverged histories create a merge commit with two parents.",
    ],
    chips: [{ command: "git merge", tone: "history" }],
  },
  {
    id: "syncing-remote",
    number: "05",
    heading: "Syncing with Remote",
    copy: [
      "Fetch is always safe and updates your view of remote refs.",
      "Pull is fetch plus merge, so it changes your local branch too.",
    ],
    chips: [
      { command: "git fetch", tone: "remote" },
      { command: "git pull", tone: "remote" },
      { command: "git push", tone: "remote" },
    ],
  },
  {
    id: "undoing-changes",
    number: "06",
    heading: "Undoing Changes",
    copy: [
      "Reset rewrites pointers and can discard local state if used hard.",
      "Revert is history-safe for shared branches because it adds a new commit.",
    ],
    chips: [
      { command: "git reset", tone: "destructive" },
      { command: "git revert", tone: "history" },
    ],
  },
  {
    id: "stashing",
    number: "07",
    heading: "Stashing",
    copy: [
      "Stash acts like a clipboard for incomplete work.",
      "Save in-progress changes, switch context, then apply or pop later.",
    ],
    chips: [
      { command: "git stash", tone: "staging" },
      { command: "git stash pop", tone: "staging" },
      { command: "git stash apply", tone: "staging" },
    ],
  },
  {
    id: "playground",
    number: "08",
    heading: "Playground",
    copy: ["A blank repo. Type any command. Watch what happens."],
    chips: [],
  },
];

/**
 * @param {string} tone
 * @returns {string}
 */
function chipToneClass(tone) {
  return `chip-tone-${tone}`;
}

/**
 * Initialize sections.
 * @returns {Map<string, {el: HTMLElement, demoEl: HTMLElement}>}
 */
export function initSections() {
  if (typeof document === "undefined") {
    return new Map();
  }

  const mainContent = document.getElementById("main-content");
  if (!mainContent) {
    return new Map();
  }

  mainContent.innerHTML = "";
  sectionRefs.clear();

  const fragment = document.createDocumentFragment();

  for (const section of SECTIONS) {
    const sectionEl = document.createElement("section");
    sectionEl.className = "lesson-section";
    sectionEl.id = section.id;
    sectionEl.setAttribute("data-section", section.id);

    const chipsMarkup =
      section.chips.length === 0
        ? ""
        : `<div class="command-chip-row">${section.chips
            .map(
              (chip) =>
                `<button class="command-chip ${chipToneClass(chip.tone)}" type="button" data-command="${chip.command}">${chip.command}</button>`,
            )
            .join("")}</div>`;

    const bodyMarkup = section.copy.map((line) => `<p class="lesson-copy">${line}</p>`).join("");

    sectionEl.innerHTML = `
      <header class="lesson-header">
        <p class="lesson-number">${section.number}</p>
        <h2 class="lesson-title">${section.heading}</h2>
      </header>
      <div class="lesson-body">
        ${bodyMarkup}
      </div>
      ${chipsMarkup}
      <div class="lesson-demo" data-role="demo-area">
        <p class="lesson-demo-placeholder">Loading demo...</p>
      </div>
    `;

    const demoEl = /** @type {HTMLElement} */ (sectionEl.querySelector('[data-role="demo-area"]'));
    sectionRefs.set(section.id, { el: sectionEl, demoEl });

    const chips = sectionEl.querySelectorAll(".command-chip[data-command]");
    chips.forEach((chipEl) => {
      chipEl.addEventListener("click", () => {
        const command = chipEl.getAttribute("data-command");
        if (!command) {
          return;
        }

        emit("chip:clicked", { command, sectionId: section.id });
      });
    });

    fragment.appendChild(sectionEl);
  }

  mainContent.appendChild(fragment);
  return new Map(sectionRefs);
}

/**
 * Reset a specific section.
 * @param {string} sectionId
 * @returns {void}
 */
export function resetSection(sectionId) {
  const refs = sectionRefs.get(sectionId);
  if (!refs) {
    return;
  }

  refs.demoEl.innerHTML = '<p class="lesson-demo-placeholder">Loading demo...</p>';
}
