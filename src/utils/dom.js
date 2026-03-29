/**
 * Query a single element.
 * @param {string} selector CSS selector.
 * @param {ParentNode} [parent=document] Parent container.
 * @returns {Element | null}
 */
export function qs(selector, parent = document) {}

/**
 * Query multiple elements.
 * @param {string} selector CSS selector.
 * @param {ParentNode} [parent=document] Parent container.
 * @returns {Element[]}
 */
export function qsa(selector, parent = document) {}

/**
 * Create an element with attributes and children.
 * @param {string} tag HTML tag name.
 * @param {Record<string, string>} attrs Element attributes.
 * @param {(Node | string)[]} [children=[]] Child nodes.
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs, children = []) {}

