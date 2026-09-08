// Petite couche de compatibilite Chrome / Firefox / Edge.
// Chrome MV3 expose `chrome` (promises), Firefox expose `browser` (promises) + `chrome` (callbacks).
export const B = globalThis.browser ?? globalThis.chrome;

export const HAS_OFFSCREEN = !!(globalThis.chrome && chrome.offscreen);
export const IS_FIREFOX = typeof globalThis.browser !== 'undefined'
  && typeof globalThis.browser.runtime?.getBrowserInfo === 'function';

/** Certaines APIs (notifications avec boutons, requireInteraction) n'existent pas partout. */
export async function safe(fn, fallback = null) {
  try { return await fn(); } catch (e) { console.debug('[RoNote] safe():', e?.message || e); return fallback; }
}
