'use strict';
// chrome.downloads ids are integers that stay the same across restarts; Acira's download records are named by strings ('download-<uuid>').
// This keeps the mapping in one small file in the profile folder (written when a new id is handed out, debounced).
const fs = require('node:fs');
const path = require('node:path');

function createIdStore({file, delay = 400, max = 50000} = {}) {
  let next = 1;
  const byRecord = new Map(), byId = new Map();
  let timer = null;
  try {
    if (file && fs.statSync(file).size < 8 * 1024 * 1024) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(saved.next) && saved.next > 0) next = saved.next;
      for (const [record, id] of Object.entries(saved.ids || {})) if (Number.isInteger(id) && id > 0 && typeof record === 'string') { byRecord.set(record, id); byId.set(id, record); next = Math.max(next, id + 1); }
    }
  } catch { /* first run, or a damaged file: start again from what is in memory */ }
  function write() {
    timer = null;
    if (!file) return;
    try {
      while (byRecord.size > max) { const [record, id] = byRecord.entries().next().value; byRecord.delete(record); byId.delete(id); }
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file + '.tmp', JSON.stringify({version: 1, next, ids: Object.fromEntries(byRecord)}));
      fs.renameSync(file + '.tmp', file);
    } catch { /* the ids still work in memory; the next change tries again */ }
  }
  function schedule() { if (!timer && file) { timer = setTimeout(write, delay); timer.unref?.(); } }
  return {
    /** The integer id of a record, handed out the first time it is asked for. */
    idFor(recordId) {
      let id = byRecord.get(recordId);
      if (!id) { id = next++; byRecord.set(recordId, id); byId.set(id, recordId); schedule(); }
      return id;
    },
    /** The record named by an integer id, or undefined. */
    recordFor: id => byId.get(id),
    forget(recordId) { const id = byRecord.get(recordId); if (id) { byRecord.delete(recordId); byId.delete(id); schedule(); } },
    flush() { if (timer) { clearTimeout(timer); write(); } },
    size: () => byRecord.size
  };
}

module.exports = {createIdStore};
