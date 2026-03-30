import { parseCommand } from "../terminal/parser.js";
import {
  add,
  checkout,
  clone,
  commit,
  createBranch,
  fetch,
  merge,
  pull,
  push,
  reset,
  revert,
  stash,
  stashApply,
  stashList,
  stashPop,
  switchBranch,
} from "./commands.js";
import { GitSimulatorError } from "./errors.js";
import { buildResult } from "./result.js";

export { createInitialState } from "./state.js";

/**
 * Run a raw command against simulator state.
 * @param {import("./state.js").GitState} state
 * @param {string} rawInput
 * @returns {import("./commands.js").CommandResult}
 */
export function runCommand(state, rawInput) {
  const parsed = parseCommand(rawInput);

  if (!parsed.ok) {
    const error = new GitSimulatorError(
      parsed.reason ?? "Unable to parse command.",
      "PARSE_ERROR",
      {
        rawInput,
      },
    );
    return buildResult({
      prevState: state,
      nextState: state,
      error,
      hints: [],
    });
  }

  const { command, args, flags } = parsed;

  switch (command) {
    case "add":
      return add(state, args);
    case "commit": {
      const message = typeof flags.m === "string" ? flags.m : args.join(" ");
      return commit(state, message);
    }
    case "branch":
      return createBranch(state, args[0]);
    case "checkout":
      return checkout(state, args[0]);
    case "switch":
      return switchBranch(state, args[0]);
    case "merge":
      return merge(state, args[0]);
    case "push":
      return push(state);
    case "fetch":
      return fetch(state);
    case "pull":
      return pull(state);
    case "reset": {
      /** @type {"soft" | "mixed" | "hard" | undefined} */
      let mode;
      let target;

      if (flags.soft === true) {
        mode = "soft";
      } else if (flags.mixed === true) {
        mode = "mixed";
      } else if (flags.hard === true) {
        mode = "hard";
      }

      if (args[0] === "soft" || args[0] === "mixed" || args[0] === "hard") {
        mode = args[0];
        target = args[1];
      } else {
        target = args[0];
      }

      return reset(state, mode, target);
    }
    case "revert":
      return revert(state, args[0]);
    case "stash":
      return stash(state);
    case "stash:pop":
      return stashPop(state);
    case "stash:apply":
      return stashApply(state);
    case "stash:list":
      return stashList(state);
    case "clone":
      return clone(state, ...args);
    default: {
      const error = new GitSimulatorError(
        `Unknown command: ${command}`,
        "UNKNOWN_COMMAND",
        {
          command,
          rawInput,
        },
      );
      return buildResult({
        prevState: state,
        nextState: state,
        error,
        hints: [],
      });
    }
  }
}
