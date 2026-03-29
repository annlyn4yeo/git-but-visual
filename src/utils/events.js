const listeners = new Map();

/**
 * Emit an event to registered listeners.
 * @param {string} eventName Event name.
 * @param {unknown} data Event payload.
 * @returns {void}
 */
export function emit(eventName, data) {
  const callbacks = listeners.get(eventName);
  if (!callbacks || callbacks.size === 0) {
    return;
  }

  for (const callback of callbacks) {
    callback(data);
  }
}

/**
 * Register an event listener.
 * @param {string} eventName Event name.
 * @param {(data: unknown) => void} callback Listener callback.
 * @returns {void}
 */
export function on(eventName, callback) {
  const callbacks = listeners.get(eventName) ?? new Set();
  callbacks.add(callback);
  listeners.set(eventName, callbacks);
}

/**
 * Unregister an event listener.
 * @param {string} eventName Event name.
 * @param {(data: unknown) => void} callback Listener callback.
 * @returns {void}
 */
export function off(eventName, callback) {
  const callbacks = listeners.get(eventName);
  if (!callbacks) {
    return;
  }

  callbacks.delete(callback);
  if (callbacks.size === 0) {
    listeners.delete(eventName);
  }
}
