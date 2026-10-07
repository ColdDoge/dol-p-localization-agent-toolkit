/*
 * Minimal, dependency-free reader for a compiled Twine/SugarCube + ModLoader
 * HTML build (the form produced by an "unpacked" modded build).
 *
 * It extracts:
 *   - <tw-storydata> attributes
 *   - every <tw-passagedata> passage (name, tags, decoded content, byte offset)
 *   - every embedded JS/CSS source *file*: the build concatenates all game JS
 *     into one <script> (and all CSS into one <style>), delimiting each source
 *     file with a `/* twine-user-script #N: "path" *\/` header. We split on
 *     those headers so downstream tools can talk about individual files, which
 *     is also the unit the SC2 ModLoader / ModI18N use (`fileName`).
 *
 * It is read-only: it never writes to the file it parses.
 */

import fs from 'node:fs';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

export function decodeEntities(text) {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

function parseAttributes(tagText) {
  const attrs = {};
  for (const m of tagText.matchAll(/([A-Za-z_][\w:.-]*)="([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

const FILE_HEADER_RE = /\/\*\s*twine-user-(?:script|stylesheet)\s*#\d+:\s*"([^"]+)"\s*\*\//g;

/**
 * Split one bundled <script>/<style> block into per-source-file units using the
 * build's header comments. Returns [{ file, content, offset }].
 */
function splitBundledBlock(inner, blockOffset) {
  const marks = [];
  let m;
  FILE_HEADER_RE.lastIndex = 0;
  while ((m = FILE_HEADER_RE.exec(inner)) !== null) {
    marks.push({ file: m[1], start: m.index, headerEnd: FILE_HEADER_RE.lastIndex });
  }
  if (marks.length === 0) {
    return [{ file: undefined, content: inner, offset: blockOffset }];
  }
  const units = [];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].start : inner.length;
    units.push({
      file: marks[i].file,
      content: inner.slice(marks[i].start, end),
      offset: blockOffset + marks[i].start,
    });
  }
  return units;
}

export function parseStory(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');

  const storyStart = html.indexOf('<tw-storydata name=');
  if (storyStart < 0) {
    throw new Error(`No <tw-storydata> element found in ${htmlPath} (not a compiled Twine/SugarCube build?)`);
  }
  const openEnd = html.indexOf('>', storyStart);
  const storyOpenTag = html.slice(storyStart, openEnd + 1);
  const storyAttrs = parseAttributes(storyOpenTag);

  const storyEnd = html.indexOf('</tw-storydata>', openEnd);
  const bodyStart = openEnd + 1;
  const bodyEnd = storyEnd < 0 ? html.length : storyEnd;
  const body = html.slice(bodyStart, bodyEnd);

  // 1) Locate embedded script/style blocks first, so passage parsing can skip
  //    any `<tw-passagedata>`-looking text that lives inside JS/CSS source.
  const scripts = [];
  const styles = [];
  const blockRanges = [];
  const blockRe = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let bm;
  while ((bm = blockRe.exec(body)) !== null) {
    const attrs = parseAttributes(bm[2]);
    const isScript = attrs.type === 'text/twine-javascript' || attrs.id === 'twine-user-script';
    const isStyle = attrs.type === 'text/twine-css' || attrs.id === 'twine-user-stylesheet';
    if (!isScript && !isStyle) continue;
    const blockOffset = bodyStart + bm.index;
    blockRanges.push([bm.index, blockRe.lastIndex]);
    for (const unit of splitBundledBlock(bm[3], blockOffset)) {
      const record = {
        kind: bm[1],
        id: attrs.id,
        type: attrs.type,
        role: attrs.role,
        file: unit.file,
        content: unit.content,
        offset: unit.offset,
      };
      (isScript ? scripts : styles).push(record);
    }
  }
  const inBlock = (offsetInBody) => blockRanges.some(([a, b]) => offsetInBody >= a && offsetInBody < b);

  // 2) Passages.
  const passages = [];
  const passageRe = /<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/g;
  let pm;
  while ((pm = passageRe.exec(body)) !== null) {
    if (inBlock(pm.index)) continue;
    const attrs = parseAttributes(pm[1]);
    passages.push({
      pid: attrs.pid !== undefined ? Number(attrs.pid) : undefined,
      name: attrs.name || '',
      tags: (attrs.tags || '').split(/\s+/).filter(Boolean),
      position: attrs.position,
      size: attrs.size,
      raw: pm[2],
      content: decodeEntities(pm[2]),
      offset: bodyStart + pm.index,
    });
  }

  return {
    path: htmlPath,
    size: Buffer.byteLength(html, 'utf8'),
    storyAttrs,
    storyStart,
    passages,
    scripts,
    styles,
  };
}

/** Fast name -> passage lookup plus tag index for a parsed story. */
export function indexStory(story) {
  const byName = new Map();
  const byTag = new Map();
  for (const p of story.passages) {
    byName.set(p.name, p);
    for (const t of p.tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(p);
    }
  }
  return { byName, byTag };
}
