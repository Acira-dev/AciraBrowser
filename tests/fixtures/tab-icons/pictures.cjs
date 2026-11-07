'use strict';
// Icon files built byte by byte for the icon tests: a PNG with a real header (no pixels needed), an .ico of PNG or BMP pictures, an SVG,
// and a stand-in for Electron's nativeImage that only knows sizes.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (width, height = width) => { const out = Buffer.alloc(33); SIGNATURE.copy(out); out.writeUInt32BE(13, 8); out.write('IHDR', 12, 'latin1'); out.writeUInt32BE(width, 16); out.writeUInt32BE(height, 20); out[24] = 8; out[25] = 6; return out; };
const dib = (size) => { const out = Buffer.alloc(40 + size * size * 4 + size * Math.ceil(size / 32) * 4); out.writeUInt32LE(40, 0); out.writeInt32LE(size, 4); out.writeInt32LE(size * 2, 8); out.writeUInt16LE(1, 12); out.writeUInt16LE(32, 14); return out; };
/** An .ico with one picture per entry: a number is a BMP picture of that size, {png: n} a PNG picture. */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length), parts = [];
  head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((entry, index) => {
    const size = typeof entry === 'number' ? entry : entry.png, body = typeof entry === 'number' ? dib(size) : png(size), at = 6 + 16 * index;
    head[at] = size >= 256 ? 0 : size; head[at + 1] = size >= 256 ? 0 : size; head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(body.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += body.length; parts.push(body);
  });
  return Buffer.concat([head, ...parts]);
}
const svg = () => Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#e00"/></svg>');
/** A nativeImage that reads a PNG header and resizes to a header (no pixels): enough to see what the code asks for. */
const nativeImage = { createFromBuffer: (bytes) => ({ isEmpty: () => bytes.length < 24, getSize: () => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }),
  resize: (to) => { const side = to.width || to.height; return { getSize: () => ({ width: side, height: side }), toPNG: () => png(side) }; } }) };
const response = (body, type) => ({ ok: true, headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
const missing = { ok: false, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
module.exports = { png, ico, svg, nativeImage, response, missing };
