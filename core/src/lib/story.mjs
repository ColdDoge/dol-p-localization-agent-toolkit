/*
 * Compiled-story reader.
 *
 * Reads a compiled SugarCube `assets/www/index.html` (the runtime truth) and
 * returns:
 *   - <tw-storydata> attributes (version identity evidence)
 *   - every <tw-passagedata> passage with decoded content + absolute file offset
 *   - every bundled JS/CSS source *file* split on the build's
 *     `/* twine-user-script #N: "path" *\/` headers (the `fileName` unit the
 *     SC2 ModLoader / ModI18N use)
 *
 * Read-only. No external dependencies.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

export function decodeEntities(text) {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code)) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

export function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseAttributes(tagText) {
  const attrs = {};
  for (const m of tagText.matchAll(/([A-Za-z_][\w:.-]*)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

const FILE_HEADER_RE = /\/\*\s*twine-user-(?:script|stylesheet)\s*#\d+:\s*"([^"]+)"\s*\*\//g;

function splitBundledBlock(inner, blockOffset) {
  const marks = [];
  let m;
  FILE_HEADER_RE.lastIndex = 0;
  while ((m = FILE_HEADER_RE.exec(inner)) !== null) {
    marks.push({ file: m[1], start: m.index, headerEnd: FILE_HEADER_RE.lastIndex });
  }
  if (marks.length === 0) return [{ file: undefined, content: inner, offset: blockOffset, headerEnd: blockOffset }];
  const units = [];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].start : inner.length;
    units.push({
      file: marks[i].file,
      content: inner.slice(marks[i].start, end),
      bodyStart: blockOffset + marks[i].headerEnd,
      offset: blockOffset + marks[i].start,
    });
  }
  return units;
}

export function parseStory(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const storyStart = html.indexOf('<tw-storydata name=');
  if (storyStart < 0) throw new Error(`No <tw-storydata> found in ${htmlPath}`);
  const openEnd = html.indexOf('>', storyStart);
  const storyAttrs = parseAttributes(html.slice(storyStart, openEnd + 1));
  const storyEnd = html.indexOf('</tw-storydata>', openEnd);
  const bodyStart = openEnd + 1;
  const bodyEnd = storyEnd < 0 ? html.length : storyEnd;
  const body = html.slice(bodyStart, bodyEnd);

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
      const rec = {
        kind: bm[1], file: unit.file, content: unit.content,
        offset: unit.offset, bodyStart: unit.bodyStart,
        absoluteBodyStart: bodyStart + (unit.bodyStart - blockOffset),
      };
      (isScript ? scripts : styles).push(rec);
    }
  }
  const inBlock = (o) => blockRanges.some(([a, b]) => o >= a && o < b);

  const passages = [];
  const passageRe = /<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/g;
  let pm;
  while ((pm = passageRe.exec(body)) !== null) {
    if (inBlock(pm.index)) continue;
    const attrs = parseAttributes(pm[1]);
    const content = decodeEntities(pm[2]);
    const contentOffset = bodyStart + pm.index + pm[0].indexOf('>') + 1;
    passages.push({
      pid: attrs.pid !== undefined ? Number(attrs.pid) : undefined,
      name: attrs.name || '',
      tags: (attrs.tags || '').split(/\s+/).filter(Boolean),
      position: attrs.position,
      raw: pm[2],
      content,
      contentOffset,
      offset: bodyStart + pm.index,
    });
  }

  return {
    path: htmlPath,
    size: Buffer.byteLength(html, 'utf8'),
    sha256: crypto.createHash('sha256').update(html).digest('hex'),
    storyAttrs, storyStart, passages, scripts, styles,
  };
}

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
