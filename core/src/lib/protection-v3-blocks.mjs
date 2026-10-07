// V3 block-macro classification tables (kept separate from the parser
// so the tests can import the table without pulling in the whole module).

export const CONDITIONAL_OPEN = new Set(['if', 'switch', 'unless']);
export const CONDITIONAL_BRANCH = new Set(['elseif', 'else', 'case', 'default']);
export const CONDITIONAL_CLOSE = new Set(['endif', 'endswitch', 'endunless']);

export const BLOCK_MACROS_V3 = new Map([
  ['if', 'open'], ['elseif', 'branch'], ['else', 'branch'], ['endif', 'close'],
  ['switch', 'open'], ['case', 'branch'], ['default', 'branch'], ['endswitch', 'close'],
  ['unless', 'open'], ['endunless', 'close'],
  ['for', 'open'], ['endfor', 'close'],
  ['while', 'open'], ['endwhile', 'close'],
  ['widget', 'open'], ['endwidget', 'close'],
  ['macro', 'open'], ['endmacro', 'close'],
  ['script', 'open'], ['endscript', 'close'],
  ['link', 'open'], ['endlink', 'close'],
  ['button', 'open'], ['endbutton', 'close'],
  ['replace', 'open'], ['endreplace', 'close'],
  ['append', 'open'], ['endappend', 'close'],
  ['prepend', 'open'], ['endprepend', 'close'],
  ['nobr', 'open'], ['endnobr', 'close'],
  ['silently', 'open'], ['endsilently', 'close'],
  ['timed', 'open'], ['endtimed', 'close'],
  ['repeat', 'open'], ['endrepeat', 'close'],
  ['type', 'open'], ['endtype', 'close'],
  ['css', 'open'], ['endcss', 'close'],
  ['audio', 'open'], ['endaudio', 'close'],
]);
