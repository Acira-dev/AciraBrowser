'use strict';
// What was actually tested, per Chrome Web Store extension, in Acira's engine (docs/launch/EXTENSION_COMPATIBILITY.md has the matrix and the evidence).
// Shown as "works / limited / does not work" next to an extension in Settings → Extensions and on the Add to Acira bar. Unknown extensions get no label,
// never a guess. The data file is generated from the QA results by qa/extension-matrix/export-compat.mjs.
const fs = require('node:fs'), path = require('node:path');
const STATUS = new Set(['works', 'limited', 'unsupported']);
let cache = null;
function load() {
  if (cache) return cache;
  try { const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension-compat.json'), 'utf8')); cache = parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object' ? parsed : { entries: {} }; }
  catch { cache = { entries: {} }; }
  return cache;
}
/** {status, note, checked, engine} for a tested extension ID, or null. */
function lookup(id) {
  const entry = typeof id === 'string' && /^[a-p]{32}$/.test(id) ? load().entries[id] : null;
  if (!entry || !STATUS.has(entry.status)) return null;
  return { status: entry.status, note: typeof entry.note === 'string' ? entry.note.slice(0, 280) : '', checked: String(load().checked || ''), engine: String(load().engine || '') };
}
module.exports = { lookup, STATUS };
