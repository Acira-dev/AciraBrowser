'use strict';
// A small local trace of what happens when an extension opens a window or its toolbar popup closes (<user data>/logs/extension-windows.log), for the one question a bug report
// about extension pop-out windows needs answered: was the window asked for, with which bounds, did it exist and show, and what closed the popup. It holds ids, numbers,
// error texts and page paths (never a query or a fragment); nothing is sent anywhere. Bounded: past MAX bytes the older half is dropped. Off until main.cjs names the file.
const fs = require('node:fs'), path = require('node:path');

const MAX = 256 * 1024;
let file = null, lines = 0;

function setFile(next) { file = typeof next === 'string' && next ? next : null; lines = 0; }
/** A value as one short piece of text: objects as JSON, an address without its query and fragment. */
function part(value) {
  if (value === undefined) return '-';
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { text = String(value); }
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/[^\s"'?#]*)[?#][^\s"']*/gi, '$1').replace(/[\r\n]+/g, ' ').slice(0, 600);
}
function trace(...parts) {
  if (!file) return;
  try {
    const text = `${new Date().toISOString()} ${parts.map(part).join(' ')}\n`;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    let size = 0; try { size = fs.statSync(file).size; } catch { /* first line */ }
    if (size + text.length > MAX) { const kept = fs.readFileSync(file, 'utf8').slice(-Math.floor(MAX / 2)); fs.writeFileSync(file, kept.slice(kept.indexOf('\n') + 1)); }
    fs.appendFileSync(file, text);
    lines++;
  } catch { /* a read-only profile keeps working */ }
}
const fileName = () => file;

module.exports = {trace, setFile, fileName, part};
