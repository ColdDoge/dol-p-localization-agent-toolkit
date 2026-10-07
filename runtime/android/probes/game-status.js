/*
 * Read-only game status probe. Safe to run at any time.
 * Evaluated inside the game WebView via CDP.
 */
(() => ({
  passage: window.State?.passage ?? null,
  href: location.href,
  title: document.title,
  readyState: document.readyState,
  viewport: [innerWidth, innerHeight],
  bodyErrors: document.querySelectorAll('.error').length,
  modsLoaded: Boolean(window.modSC2DataManager),
}))()
