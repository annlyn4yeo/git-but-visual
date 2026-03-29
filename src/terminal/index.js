import { emit } from "../utils/events.js";
import { parseCommand } from "./parser.js";

/** @type {null | { print: (text: string, type?: string) => void, printCommand: (input: string) => void, clear: () => void, focus: () => void }} */
let terminalApi = null;

/** @type {string[]} */
let commandHistory = [];
let historyIndex = -1;

/**
 * @param {HTMLElement} outputEl
 * @param {HTMLElement} lineEl
 * @returns {void}
 */
function appendLine(outputEl, lineEl) {
  outputEl.appendChild(lineEl);
  outputEl.scrollTop = outputEl.scrollHeight;
}

/**
 * @param {string} text
 * @param {string} type
 * @returns {HTMLElement}
 */
function createOutputLine(text, type) {
  const line = document.createElement("div");
  line.className = `terminal-line terminal-line-${type}`;
  line.textContent = text;
  return line;
}

/**
 * Initialize terminal UI.
 * @param {Element} containerEl
 * @returns {{
 *   print: (text: string, type?: string) => void,
 *   printCommand: (input: string) => void,
 *   clear: () => void,
 *   focus: () => void
 * }}
 */
export function initTerminal(containerEl) {
  if (!containerEl || typeof document === "undefined") {
    return {
      print() {},
      printCommand() {},
      clear() {},
      focus() {},
    };
  }

  const existing = containerEl.querySelector(".terminal-shell");
  if (existing) {
    existing.remove();
  }

  const shell = document.createElement("section");
  shell.className = "terminal-shell";
  shell.id = "saving-changes";
  shell.setAttribute("data-section", "saving-changes");

  shell.innerHTML = `
    <header class="terminal-header">
      <div class="terminal-controls" aria-hidden="true">
        <span class="terminal-dot dot-red"></span>
        <span class="terminal-dot dot-yellow"></span>
        <span class="terminal-dot dot-green"></span>
      </div>
      <p class="terminal-path">gitvisual ~/my-project</p>
    </header>
    <div class="terminal-output" data-role="terminal-output"></div>
    <div class="terminal-input-row">
      <span class="terminal-prefix">git</span>
      <span class="terminal-caret" aria-hidden="true">?</span>
      <input class="terminal-input" data-role="terminal-input" type="text" spellcheck="false" autocomplete="off" />
    </div>
  `;

  containerEl.appendChild(shell);

  const outputEl = /** @type {HTMLElement} */ (shell.querySelector('[data-role="terminal-output"]'));
  const inputEl = /** @type {HTMLInputElement} */ (shell.querySelector('[data-role="terminal-input"]'));

  const api = {
    /**
     * @param {string} text
     * @param {string} [type="info"]
     */
    print(text, type = "info") {
      appendLine(outputEl, createOutputLine(text, type));
    },

    /**
     * @param {string} input
     */
    printCommand(input) {
      const line = document.createElement("div");
      line.className = "terminal-line terminal-line-command";
      line.innerHTML = `<span class="terminal-command-prompt">?</span><span class="terminal-command-text">${input}</span>`;
      appendLine(outputEl, line);
    },

    clear() {
      outputEl.innerHTML = "";
    },

    focus() {
      inputEl.focus();
    },
  };

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const raw = inputEl.value.trim();
      if (!raw) {
        return;
      }

      api.printCommand(raw);

      commandHistory.push(raw);
      if (commandHistory.length > 50) {
        commandHistory = commandHistory.slice(commandHistory.length - 50);
      }
      historyIndex = commandHistory.length;

      const parsed = parseCommand(raw);
      emit("command:submit", {
        rawInput: raw,
        parsed,
      });

      if ("message" in parsed) {
        api.print(parsed.message, "error");
      }

      inputEl.value = "";
      api.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (commandHistory.length === 0) {
        return;
      }

      historyIndex = Math.max(0, historyIndex - 1);
      inputEl.value = commandHistory[historyIndex] ?? "";
      requestAnimationFrame(() => {
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (commandHistory.length === 0) {
        return;
      }

      historyIndex = Math.min(commandHistory.length, historyIndex + 1);
      inputEl.value = historyIndex === commandHistory.length ? "" : commandHistory[historyIndex] ?? "";
      requestAnimationFrame(() => {
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      });
    }
  });

  shell.addEventListener("click", () => {
    api.focus();
  });

  inputEl.addEventListener("blur", () => {
    requestAnimationFrame(() => {
      api.focus();
    });
  });

  api.focus();
  terminalApi = api;
  return api;
}

/**
 * Print a terminal output line.
 * @param {string} line
 * @param {string} [type="info"]
 * @returns {void}
 */
export function printOutput(line, type = "info") {
  terminalApi?.print(line, type);
}

/**
 * Clear terminal output.
 * @returns {void}
 */
export function clearOutput() {
  terminalApi?.clear();
}
