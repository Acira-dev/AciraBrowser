'use strict';
// file: URLs for an extension's own pages (main side; the `extension` package's handler 'acira.file.read', ext-api/extension.cjs): "Allow access to file URLs" (extension-file-access.cjs).
//
// Chromium (BSD-3-Clause; extensions/renderer/dispatcher.cc, extensions/browser/extension_util.cc InitializeFileSchemeAccessForExtension): "Extensions are allowed to make
// cross-origin requests to file scheme iff the user explicitly grants them access post-installation": the renderer registers file: as supporting the fetch API, the browser
// grants the extension's process the file scheme and its frames get the file URL loader factory. Electron exposes none of these (no ChildProcessSecurityPolicy, no loader
// factories): with the switch on, an extension page's fetch() and XMLHttpRequest of a file: URL fail ("Failed to fetch") even though the engine's allowFileAccess flag is
// set. So the page's fetch / XHR (the page side is in ext-api/extension-renderer.cjs) ask this handler, which reads the local file for an extension whose switch is on and for no other.
//
// What the answer is and is not, as Chrome has it: a regular file only (a folder is an error here; Chrome draws an index page for it), a local path (never a file on another
// host), a single Range (206), the Content-Type from the file's extension. Not answered: the extension's own subresource loads (an <img src="file:///">, a <script>), which
// Chromium's loader factory serves and this does not.
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

/** One read is held in memory and cloned over IPC: a file larger than this is refused rather than taking the browser down. */
const MAX_BYTES = 1024 * 1024 * 1024;

const TYPES = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.text': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.html': 'text/html', '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml', '.xml': 'text/xml', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.zip': 'application/zip'
};
const typeOf = file => TYPES[(/\.[^./\\]+$/.exec(String(file)) || [''])[0].toLowerCase()] || 'application/octet-stream';

/** The local path a file: address names, or null: another host, credentials, a malformed address. */
function localPathOf(address) {
  let url;
  try { url = new URL(String(address)); } catch { return null; }
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.username || url.password) return null;
  try { return fileURLToPath(url); } catch { return null; }
}

/** A single "bytes=a-b" / "bytes=a-" / "bytes=-n" range over `size` bytes, as {start, end} (end inclusive), 'whole' for none, or null when it cannot be satisfied. */
function rangeOf(header, size) {
  if (header === undefined || header === null || header === '') return 'whole';
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'whole';   // multiple or malformed ranges are ignored: the whole file (Chromium's FileURLLoader gives up on them too)
  let start, end;
  if (match[1] === '') { const suffix = Number(match[2]); if (!suffix) return null; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1); }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

/** The answer for one read: {status, type, size, start, end, modified, bytes} or an Error that says why. `allowed()` is the extension's switch right now. */
async function readFileFor({ allowed, address, range, fsApi = fs }) {
  if (!allowed()) throw new Error('Access to file URLs is not allowed for this extension.');
  const file = localPathOf(address);
  if (!file) throw new Error('Not a local file address.');
  let info;
  try { info = await fsApi.promises.stat(file); } catch { throw new Error('ERR_FILE_NOT_FOUND'); }
  if (!info.isFile()) throw new Error(info.isDirectory() ? 'ERR_FILE_IS_A_FOLDER' : 'ERR_FILE_NOT_FOUND');
  if (info.size > MAX_BYTES) throw new Error('ERR_FILE_TOO_LARGE');
  const wanted = rangeOf(range, info.size);
  if (wanted === null) return { status: 416, type: typeOf(file), size: info.size, start: 0, end: -1, modified: info.mtimeMs, bytes: new Uint8Array(0) };
  const whole = wanted === 'whole', start = whole ? 0 : wanted.start, end = whole ? info.size - 1 : wanted.end;
  let bytes;
  try {
    if (whole) bytes = await fsApi.promises.readFile(file);
    else {
      const handle = await fsApi.promises.open(file, 'r');
      try { const length = end - start + 1, buffer = Buffer.alloc(length), { bytesRead } = await handle.read(buffer, 0, length, start); bytes = buffer.subarray(0, bytesRead); } finally { await handle.close(); }
    }
  } catch { throw new Error('ERR_ACCESS_DENIED'); }
  return { status: whole ? 200 : 206, type: typeOf(file), size: info.size, start, end: start + bytes.length - 1, modified: info.mtimeMs, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
}

module.exports = { readFileFor, localPathOf, rangeOf, typeOf, MAX_BYTES };
