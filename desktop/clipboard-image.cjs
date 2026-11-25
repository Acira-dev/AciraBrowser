'use strict';
/* Putting a picture on the clipboard. Electron 44's main-process clipboard has only the asynchronous, W3C-style API (write(ClipboardItem[]), writeText, readText, read, has): there is
   no writeImage, no readImage, no readHTML. The picture goes in as one image/png item. The call is awaited and a failure is thrown to the caller (never swallowed here); the callers report it. */
const PNG_TYPE = 'image/png';

function electronClipboardItem() {
  try { const found = require('electron').ClipboardItem; return typeof found === 'function' ? found : null; } catch { return null; }
}

/** Writes a nativeImage as image/png. `ClipboardItem` is Electron's (taken from require('electron') when not given: a unit test passes its own). */
async function writeImageToClipboard(clipboard, image, ClipboardItem = electronClipboardItem()) {
  if (!clipboard || typeof clipboard.write !== 'function') throw new Error('the clipboard has no write()');
  if (typeof ClipboardItem !== 'function') throw new Error('ClipboardItem is not available');
  if (!image || typeof image.toPNG !== 'function') throw new Error('not a picture');
  const png = image.toPNG();
  if (!png || !png.length) throw new Error('the picture has no pixels to copy');
  await clipboard.write([new ClipboardItem({ [PNG_TYPE]: new Blob([png], { type: PNG_TYPE }) })]);
}

/** Width and height from a PNG's IHDR, or null: for the test stand-in, which records what it was given. */
function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The test stand-in for Electron 44's clipboard: only the asynchronous API (write, writeText, readText, clear), no writeImage. Each item type is recorded in the log as
    { types, type, bytes, width, height } (width and height for image/png). `log` is an array or a function giving it (a rig may replace the array between runs). */
function createRecordingClipboard(log) {
  const sink = () => (typeof log === 'function' ? log() : log);
  return {
    async write(items) {
      if (!Array.isArray(items)) throw new TypeError('write() takes an array of ClipboardItem');
      for (const item of items) {
        const types = Array.from(item.types || []);
        for (const type of types) {
          const blob = await item.getType(type);
          if (type !== PNG_TYPE) { sink().push({ types, type, bytes: blob && blob.size || 0 }); continue; }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          sink().push({ types, type, bytes: bytes.length, ...(pngSize(bytes) || { width: 0, height: 0 }) });
        }
      }
    },
    async writeText(text) { sink().push({ types: ['text/plain'], type: 'text/plain', bytes: String(text).length }); },
    async readText() { return ''; },
    clear() {},
  };
}

module.exports = { writeImageToClipboard, createRecordingClipboard, pngSize, PNG_TYPE };
