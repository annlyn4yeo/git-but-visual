const listeners = new Map();

/**
 * Emit an event to registered listeners.
 * @param {string} eventName Event name.
 * @param {unknown} data Event payload.
 * @returns {void}
 */
export function emit(eventName, data) {}

/**
 * Register an event listener.
 * @param {string} eventName Event name.
 * @param {(data: unknown) => void} callback Listener callback.
 * @returns {void}
 */
export function on(eventName, callback) {}

/**
 * Unregister an event listener.
 * @param {string} eventName Event name.
 * @param {(data: unknown) => void} callback Listener callback.
 * @returns {void}
 */
export function off(eventName, callback) {}

