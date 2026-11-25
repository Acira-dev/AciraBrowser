'use strict';
// Mozilla's jsonlz4 container, the compression Firefox and Zen put on session files (sessionstore.jsonlz4,
// sessionstore-backups/recovery.jsonlz4, zen-sessions.jsonlz4). A file is the 8-byte magic "mozLz40\0", a uint32
// little-endian decompressed size, then ONE raw LZ4 block (not an LZ4 frame). The block decoder is written here because
// the app carries no LZ4 library; it checks every read and write against the buffers' ends, so a damaged or hostile file
// can only make it throw. The block format is the one in lz4/doc/lz4_Block_format.md (github.com/lz4/lz4): a sequence is a
// token (literal length in the high nibble, match length minus 4 in the low nibble), optional length-extension bytes
// (255 repeats), the literals, then for every sequence but the last a 2-byte little-endian match offset.
const fs = require('node:fs'), path = require('node:path');

const MAGIC = Buffer.from('mozLz40\0', 'latin1');
const HEADER_BYTES = MAGIC.length + 4;
const MAX_OUTPUT = 256 * 1024 * 1024;
const MIN_MATCH = 4;
const HASH_BITS = 14;

/** Input as a Buffer without copying (a Buffer, or any other Uint8Array / ArrayBuffer view). Anything else throws. */
function asBuffer(value, what) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(what + ' must be a Buffer.');
}

/** A length that continues in extension bytes: reads bytes, each added to `length`, until one is not 255.
 *  Returns [length, next position]; throws when the input ends first or the length could not fit in the output. */
function readExtendedLength(input, position, length, limit) {
  let byte;
  do {
    if (position >= input.length) throw new Error('LZ4 data is truncated.');
    byte = input[position++];
    length += byte;
    if (length > limit) throw new Error('LZ4 data is longer than its stated size.');
  } while (byte === 255);
  return [length, position];
}

/** Decompresses one raw LZ4 block into exactly `outputSize` bytes. Throws an Error for anything malformed: a size over
 *  256 MB or more than LZ4 can produce from this input, truncated or overlong data, a zero offset, an offset that reaches
 *  before the start of the output, or output that does not come to exactly `outputSize`. */
function decompressLz4Block(input, outputSize) {
  const source = asBuffer(input, 'LZ4 input');
  if (!Number.isInteger(outputSize) || outputSize < 0) throw new Error('LZ4 output size is not valid.');
  if (outputSize > MAX_OUTPUT) throw new Error('LZ4 output is too large.');
  // One input byte can stand for at most 255 output bytes (a length-extension byte), so a stated size above that is a lie
  // and is refused before anything is allocated.
  if (outputSize > source.length * 255) throw new Error('LZ4 data is shorter than its stated size allows.');
  const output = Buffer.alloc(outputSize);
  let read = 0, written = 0;
  while (read < source.length) {
    const token = source[read++];
    let literals = token >> 4;
    if (literals === 15) [literals, read] = readExtendedLength(source, read, literals, outputSize);
    if (read + literals > source.length) throw new Error('LZ4 data is truncated.');
    if (written + literals > outputSize) throw new Error('LZ4 data is longer than its stated size.');
    source.copy(output, written, read, read + literals);
    read += literals;
    written += literals;
    // The last sequence holds literals only: the input simply ends after them.
    if (read === source.length) break;
    if (read + 2 > source.length) throw new Error('LZ4 data is truncated.');
    const offset = source[read] | (source[read + 1] << 8);
    read += 2;
    if (offset === 0 || offset > written) throw new Error('LZ4 data points before its own start.');
    let length = token & 15;
    if (length === 15) [length, read] = readExtendedLength(source, read, length, outputSize);
    length += MIN_MATCH;
    if (written + length > outputSize) throw new Error('LZ4 data is longer than its stated size.');
    if (offset >= length) {
      // Source and destination do not overlap: one block copy.
      output.copy(output, written, written - offset, written - offset + length);
      written += length;
    } else {
      // Overlapping match (offset 1 repeats a byte, and so on): bytes just written are read again, so copy one by one.
      for (let end = written + length; written < end; written++) output[written] = output[written - offset];
    }
  }
  if (written !== outputSize) throw new Error('LZ4 data is shorter than its stated size.');
  return output;
}

/** Appends `value - 15` as length-extension bytes (255s, then the remainder) at `at`; returns the next position. */
function writeExtendedLength(target, at, value) {
  let rest = value - 15;
  while (rest >= 255) {
    target[at++] = 255;
    rest -= 255;
  }
  target[at++] = rest;
  return at;
}

/** One sequence: the literals source[from, to) and, unless `matchLength` is 0, a match of that length at `offset`. */
function writeSequence(target, at, source, from, to, offset, matchLength) {
  const literals = to - from;
  const matchPart = matchLength ? matchLength - MIN_MATCH : 0;
  target[at++] = (Math.min(literals, 15) << 4) | Math.min(matchPart, 15);
  if (literals >= 15) at = writeExtendedLength(target, at, literals);
  source.copy(target, at, from, to);
  at += literals;
  if (!matchLength) return at;
  target[at++] = offset & 255;
  target[at++] = offset >> 8;
  if (matchPart >= 15) at = writeExtendedLength(target, at, matchPart);
  return at;
}

/** Compresses `input` into one raw LZ4 block. A small greedy matcher (one 4-byte hash table, no chains): the output is valid
 *  for any LZ4 decoder, not tuned for size. It follows the block format's end rules (the last match starts at least 12 bytes
 *  before the end and the last 5 bytes are literals), so inputs under 13 bytes come out as literals only. */
function compressLz4Block(input) {
  const source = asBuffer(input, 'LZ4 input');
  if (source.length > MAX_OUTPUT) throw new Error('LZ4 input is too large.');
  // The format's worst case (LZ4_compressBound): incompressible data costs one extension byte per 255 literals plus a token.
  const target = Buffer.allocUnsafe(source.length + Math.floor(source.length / 255) + 16);
  let at = 0, anchor = 0;
  if (source.length >= 13) {
    const table = new Int32Array(1 << HASH_BITS).fill(-1);
    const lastStart = source.length - 12, matchEnd = source.length - 5;
    let position = 0;
    while (position <= lastStart) {
      const word = source.readUInt32LE(position);
      const slot = Math.imul(word, 2654435761) >>> (32 - HASH_BITS);
      const candidate = table[slot];
      table[slot] = position;
      if (candidate >= 0 && position - candidate <= 65535 && source.readUInt32LE(candidate) === word) {
        let length = MIN_MATCH;
        while (position + length < matchEnd && source[candidate + length] === source[position + length]) length++;
        at = writeSequence(target, at, source, anchor, position, position - candidate, length);
        position += length;
        anchor = position;
      } else {
        position++;
      }
    }
  }
  at = writeSequence(target, at, source, anchor, source.length, 0, 0);
  return Buffer.from(target.subarray(0, at));
}

/** A jsonlz4 file's bytes -> the decompressed bytes. Checks the magic and the size field, then decodes the block.
 *  `maxOutput` (default 256 MB) caps the size the header may claim. */
function decodeMozLz4(buffer, maxOutput = MAX_OUTPUT) {
  const data = asBuffer(buffer, 'jsonlz4 data');
  if (data.length < HEADER_BYTES) throw new Error('Not a jsonlz4 file (too short).');
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a jsonlz4 file (wrong header).');
  const size = data.readUInt32LE(MAGIC.length);
  if (size > Math.min(maxOutput, MAX_OUTPUT)) throw new Error('The jsonlz4 file claims more data than is allowed.');
  return decompressLz4Block(data.subarray(HEADER_BYTES), size);
}

/** Bytes -> a jsonlz4 file's bytes (magic, size, LZ4 block). Used to write fixtures for tests. */
function encodeMozLz4(buffer) {
  const data = asBuffer(buffer, 'jsonlz4 data');
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  header.writeUInt32LE(data.length, MAGIC.length);
  return Buffer.concat([header, compressLz4Block(data)]);
}

/** Reads a jsonlz4 file and parses the JSON inside. Throws a plain Error (callers catch) when the file is missing, larger
 *  than `maxBytes` (on disk or once decompressed), not jsonlz4, or does not hold JSON. */
function readJsonLz4(file, maxBytes = 64e6) {
  const name = path.basename(String(file));
  let bytes;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('is not a file');
    if (stat.size > maxBytes) throw new Error('is too large to read');
    bytes = fs.readFileSync(file);
  } catch (error) {
    throw new Error(name + (error && error.code === 'ENOENT' ? ' is missing.' : ' cannot be read (' + (error && error.code ? error.code : error && error.message ? error.message : 'unknown') + ').'));
  }
  let text;
  try {
    text = decodeMozLz4(bytes, maxBytes).toString('utf8');
  } catch (error) {
    throw new Error(name + ' is damaged (' + (error && error.message ? error.message : 'unreadable') + ').');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(name + ' does not hold valid JSON.');
  }
}

module.exports = { decompressLz4Block, compressLz4Block, decodeMozLz4, encodeMozLz4, readJsonLz4 };
