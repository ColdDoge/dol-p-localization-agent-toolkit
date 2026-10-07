/*
 * Read-only localization snapshot probe.
 *
 * Reports what the *currently displayed* passage renders: the text sample, the
 * size, structural leaks (unresolved macro / placeholder / link markup /
 * escaped-entity noise), the game's own error counter, and language-neutral
 * diagnostics (non-ASCII ratio, word count). It never navigates, never writes
 * storage and never touches game state, so it is safe to run at any time with
 * runtime/android/run-probe.mjs.
 *
 * For the full fixed-scenario smoke run use:
 *   node runtime/android/test-localization-runtime.mjs --level smoke
 * (after runtime/localization_smoke_build.mjs).
 */
(() => {
  const passageNodes = document.querySelectorAll('#passages .passage');
  const el = passageNodes.length ? passageNodes[passageNodes.length - 1] : document.querySelector('#passages');
  const text = (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const errors = [...document.querySelectorAll('.error')]
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').slice(0, 120));
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return {
    passage: window.State ? String(State.passage) : null,
    title: document.title,
    textLength: text.length,
    nonAsciiChars: nonAscii,
    nonAsciiRatio: text.length ? Number((nonAscii / text.length).toFixed(3)) : 0,
    words: text.split(/\s+/).filter(Boolean).length,
    textSample: text.slice(0, 300),
    leaks: {
      rawMacro: /<<[^>]*?>>/.test(text),
      placeholder: /\u27E6\d+\u27E7/.test(text),
      unresolvedLink: /\[\[|\]\]/.test(text),
      entityNoise: /&lt;&lt;|&amp;lt;|&amp;gt;/.test(text),
      templateLiteral: /\$\{[^}]*\}/.test(text),
    },
    bodyErrors: errors.length,
    errorTexts: errors,
  };
})()
