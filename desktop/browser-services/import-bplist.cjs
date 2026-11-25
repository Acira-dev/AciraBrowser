'use strict';
// Apple property lists, read without any native code. Safari keeps its bookmarks in Bookmarks.plist, which is almost always the
// binary format ("bplist00"); older or converted copies (plutil -convert xml1) are XML. Both are handled here, plus a writer for
// the binary format so tests can build fixtures in the real shape.
//
// Binary layout (Apple's CFBinaryPList.c, mirrored by Python's plistlib): the 8-byte header "bplist00", the objects, an offset
// table (one big-endian integer per object, giving where it starts), and a 32-byte trailer:
//   5 unused bytes, 1 sort-version byte, offsetIntSize, objectRefSize, numObjects (u64), topObject (u64), offsetTableOffset (u64).
// Each object starts with a marker byte: high nibble = type, low nibble = size (0xF means "the real size follows as an int").
//   0x00 null, 0x08 false, 0x09 true, 0x0F fill | 0x1n int (2^n bytes) | 0x22/0x23 real (4/8 bytes) | 0x33 date (8-byte float,
//   seconds since 2001-01-01) | 0x4n data | 0x5n ASCII | 0x6n UTF-16BE (n = code units) | 0x8n UID (n+1 bytes) | 0xAn array |
//   0xBn ordered set | 0xCn set | 0xDn dict (key refs, then value refs).
//
// Everything read here comes from another program's file, so every size is checked before it is used: the file is capped
// (64 MB), the object count is capped (2,000,000), containers may nest 64 deep, and an object that points back at itself is
// refused. Shared objects are decoded once, so a file that reuses one object many times cannot make the reader do exponential work.
// Anything wrong throws a plain Error; nothing here reads from or writes to disk.

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_OBJECTS = 2_000_000;
const MAX_ENTRIES = 4_000_000; // all array / set / dict entries together; each costs at least one byte in the file
const MAX_DEPTH = 64; // containers inside containers
const APPLE_EPOCH_SECONDS = 978307200; // 2001-01-01T00:00:00Z in Unix seconds

/** A UID object (used by NSKeyedArchiver files). Safari's lists never contain one; it is kept so any file round-trips. */
class PlistUID {
  constructor(value) {
    this.value = value;
  }
}

/** The Error every reader below throws. */
function fail(message) {
  throw new Error('Invalid property list: ' + message);
}

/** A Buffer over `input` (a Buffer, Uint8Array or other typed-array view) without copying. */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('A property list must be given as a Buffer');
}

/** Big-endian unsigned integer of `size` bytes (1 to 8) at `position`; throws when it does not fit a safe JS integer. */
function readUnsigned(buffer, position, size) {
  let value = 0;
  for (let index = 0; index < size; index++) value = value * 256 + buffer[position + index];
  if (!Number.isSafeInteger(value)) fail('a number is too large');
  return value;
}

/** Big-endian two's-complement integer of `size` bytes (8 or 16) as a Number when it is safe, else a BigInt. */
function readSigned(buffer, position, size) {
  let value = 0n;
  for (let index = 0; index < size; index++) value = (value << 8n) | BigInt(buffer[position + index]);
  if (buffer[position] & 0x80) value -= 1n << BigInt(size * 8);
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

/** Stores `value` under `key` on `target`; a key called "__proto__" becomes an ordinary property instead of changing the prototype. */
function setKey(target, key, value) {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** Parses a binary property list ("bplist00") into plain JS values: objects for dicts, arrays, strings, numbers (BigInt when
 *  beyond 2^53), booleans, Date, Buffer for data, Set, PlistUID, null. Throws an Error for anything malformed or over the caps. */
function parseBinaryPlist(input) {
  const buffer = toBuffer(input);
  if (buffer.length > MAX_FILE_BYTES) fail('the file is too large');
  if (buffer.length < 8 + 1 + 32) fail('the file is too short');
  if (buffer.toString('latin1', 0, 8) !== 'bplist00') fail('the bplist00 header is missing');

  const trailer = buffer.length - 32;
  const offsetSize = buffer[trailer + 6];
  const refSize = buffer[trailer + 7];
  if (offsetSize < 1 || offsetSize > 8) fail('the offset size is not valid');
  if (refSize < 1 || refSize > 8) fail('the reference size is not valid');
  const objectCount = readUnsigned(buffer, trailer + 8, 8);
  const topObject = readUnsigned(buffer, trailer + 16, 8);
  const tableOffset = readUnsigned(buffer, trailer + 24, 8);
  if (objectCount < 1) fail('the file holds no objects');
  if (objectCount > MAX_OBJECTS) fail('the file holds too many objects');
  if (topObject >= objectCount) fail('the top object does not exist');
  if (tableOffset < 9 || tableOffset + objectCount * offsetSize > trailer) fail('the offset table is out of range');

  // Objects live between the header and the offset table; every offset has to point inside that area.
  const offsets = new Uint32Array(objectCount);
  for (let index = 0; index < objectCount; index++) {
    const offset = readUnsigned(buffer, tableOffset + index * offsetSize, offsetSize);
    if (offset < 8 || offset >= tableOffset) fail('an object offset is out of range');
    offsets[index] = offset;
  }

  const state = new Uint8Array(objectCount); // 0 not read yet, 1 being read (a container), 2 done
  const values = new Array(objectCount);
  let entries = 0;
  let cursor = 0; // where the bytes after a marker and its size start; set by sizeAt()

  /** Throws unless the bytes up to (not including) `end` are inside the object area. */
  const need = (end) => {
    if (end > tableOffset) fail('an object runs past the end of the object area');
  };

  /** The size an object's marker byte carries (low nibble, or the int that follows when it is 0xF); sets `cursor` after it. */
  const sizeAt = (position, low) => {
    if (low < 15) {
      cursor = position + 1;
      return low;
    }
    need(position + 2);
    const marker = buffer[position + 1];
    if (marker >> 4 !== 1 || (marker & 15) > 3) fail('an object size is not valid');
    const bytes = 1 << (marker & 15);
    need(position + 2 + bytes);
    cursor = position + 2 + bytes;
    return readUnsigned(buffer, position + 2, bytes);
  };

  const refAt = (position) => {
    const ref = readUnsigned(buffer, position, refSize);
    if (ref >= objectCount) fail('an object reference is out of range');
    return ref;
  };

  const objectAt = (ref, depth) => {
    if (state[ref] === 2) return values[ref];
    if (state[ref] === 1) fail('an object contains itself');
    const position = offsets[ref];
    const marker = buffer[position];
    const kind = marker >> 4;
    const low = marker & 15;
    let value;
    switch (kind) {
      case 0x0:
        if (low === 0 || low === 15) value = null;
        else if (low === 8) value = false;
        else if (low === 9) value = true;
        else fail('an object marker is not known');
        break;
      case 0x1: {
        if (low > 4) fail('an integer is too long');
        const bytes = 1 << low;
        need(position + 1 + bytes);
        value = low <= 2 ? buffer.readUIntBE(position + 1, bytes) : readSigned(buffer, position + 1, bytes);
        break;
      }
      case 0x2:
        if (low === 2) {
          need(position + 5);
          value = buffer.readFloatBE(position + 1);
        } else if (low === 3) {
          need(position + 9);
          value = buffer.readDoubleBE(position + 1);
        } else fail('a real number has an unknown size');
        break;
      case 0x3:
        if (low !== 3) fail('a date has an unknown size');
        need(position + 9);
        value = new Date((buffer.readDoubleBE(position + 1) + APPLE_EPOCH_SECONDS) * 1000);
        break;
      case 0x4: {
        const length = sizeAt(position, low);
        need(cursor + length);
        value = Buffer.from(buffer.subarray(cursor, cursor + length));
        break;
      }
      case 0x5: {
        const length = sizeAt(position, low);
        need(cursor + length);
        value = buffer.toString('utf8', cursor, cursor + length);
        break;
      }
      case 0x6: {
        const length = sizeAt(position, low);
        need(cursor + length * 2);
        value = Buffer.from(buffer.subarray(cursor, cursor + length * 2)).swap16().toString('utf16le');
        break;
      }
      case 0x8: {
        const bytes = low + 1;
        if (bytes > 8) fail('a UID is too long');
        need(position + 1 + bytes);
        value = new PlistUID(readUnsigned(buffer, position + 1, bytes));
        break;
      }
      case 0xa:
      case 0xb:
      case 0xc: {
        if (depth >= MAX_DEPTH) fail('objects are nested too deeply');
        const count = sizeAt(position, low);
        if (count > MAX_OBJECTS) fail('a list holds too many entries');
        need(cursor + count * refSize);
        entries += count;
        if (entries > MAX_ENTRIES) fail('the file holds too many entries');
        state[ref] = 1;
        const items = new Array(count);
        const start = cursor;
        for (let index = 0; index < count; index++) items[index] = objectAt(refAt(start + index * refSize), depth + 1);
        value = kind === 0xc ? new Set(items) : items;
        break;
      }
      case 0xd: {
        if (depth >= MAX_DEPTH) fail('objects are nested too deeply');
        const count = sizeAt(position, low);
        if (count > MAX_OBJECTS) fail('a dictionary holds too many entries');
        need(cursor + count * refSize * 2);
        entries += count * 2;
        if (entries > MAX_ENTRIES) fail('the file holds too many entries');
        state[ref] = 1;
        const keys = cursor;
        const valuesStart = cursor + count * refSize;
        value = {};
        for (let index = 0; index < count; index++) {
          const key = objectAt(refAt(keys + index * refSize), depth + 1);
          if (typeof key !== 'string') fail('a dictionary key is not a string');
          setKey(value, key, objectAt(refAt(valuesStart + index * refSize), depth + 1));
        }
        break;
      }
      default:
        fail('an object marker is not known');
    }
    state[ref] = 2;
    values[ref] = value;
    return value;
  };

  return objectAt(topObject, 0);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Writer (fixtures and tests)

/** Collects Buffers and remembers how many bytes there are so far. */
class Output {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  push(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
  bytes() {
    return Buffer.concat(this.chunks, this.length);
  }
}

/** The smallest byte count (1 to 4) that holds `value`. */
function byteSize(value) {
  return value < 0x100 ? 1 : value < 0x10000 ? 2 : value < 0x1000000 ? 3 : 4;
}

/** `value` as a big-endian unsigned integer of `size` bytes. */
function unsignedBytes(value, size) {
  const bytes = Buffer.alloc(size);
  if (size === 8) bytes.writeBigUInt64BE(BigInt(value));
  else bytes.writeUIntBE(value, 0, size);
  return bytes;
}

/** The marker byte for `kind` and `length`; lengths of 15 and more follow as an int. */
function head(kind, length) {
  if (length < 15) return Buffer.from([(kind << 4) | length]);
  const size = length < 0x100 ? 1 : length < 0x10000 ? 2 : length <= 0xffffffff ? 4 : 8;
  const code = size === 1 ? 0 : size === 2 ? 1 : size === 4 ? 2 : 3;
  const bytes = Buffer.alloc(2 + size);
  bytes[0] = (kind << 4) | 15;
  bytes[1] = 0x10 | code;
  if (size === 8) bytes.writeBigUInt64BE(BigInt(length), 2);
  else bytes.writeUIntBE(length, 2, size);
  return bytes;
}

const isPlainObject = (value) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** The bytes for an integer: 1, 2 or 4 bytes when it is not negative and fits, else 8 (signed), or 16 for a BigInt from 2^63 up. */
function integerBytes(value) {
  if (typeof value === 'number') {
    if (value >= 0 && value < 0x100) return Buffer.from([0x10, value]);
    if (value >= 0 && value < 0x10000) return Buffer.concat([Buffer.from([0x11]), unsignedBytes(value, 2)]);
    if (value >= 0 && value <= 0xffffffff) return Buffer.concat([Buffer.from([0x12]), unsignedBytes(value, 4)]);
    value = BigInt(value);
  }
  if (value >= -(1n << 63n) && value < 1n << 63n) {
    const bytes = Buffer.alloc(9);
    bytes[0] = 0x13;
    bytes.writeBigInt64BE(value, 1);
    return bytes;
  }
  if (value >= 0n && value < 1n << 64n) {
    const bytes = Buffer.alloc(17);
    bytes[0] = 0x14;
    bytes.writeBigUInt64BE(value, 9);
    return bytes;
  }
  throw new RangeError('The integer does not fit a binary property list');
}

/** Encodes `value` as a binary property list. Supports plain objects, arrays, Sets, strings (ASCII or UTF-16), integers (number or
 *  BigInt), doubles, booleans, null, Date, Buffer / Uint8Array and PlistUID. Equal strings and numbers are stored once; references
 *  are 1 to 4 bytes as the object count needs. A cycle or any other type throws. */
function writeBinaryPlist(value) {
  const objects = []; // { encode(refSize) -> Buffer, children: [index] }
  const shared = new Map();
  const open = new Set();

  const addScalar = (key, encode) => {
    if (key !== null && shared.has(key)) return shared.get(key);
    objects.push({ encode, children: [] });
    if (key !== null) shared.set(key, objects.length - 1);
    return objects.length - 1;
  };

  const addContainer = (source, kind, members, keysCount) => {
    if (open.has(source)) throw new TypeError('A property list cannot contain itself');
    open.add(source);
    const entry = { children: [], encode: null };
    objects.push(entry);
    const index = objects.length - 1;
    for (const member of members) entry.children.push(add(member));
    open.delete(source);
    entry.encode = (refSize) =>
      Buffer.concat([head(kind, keysCount === null ? entry.children.length : keysCount), ...entry.children.map((child) => unsignedBytes(child, refSize))]);
    return index;
  };

  function add(item) {
    if (item === null || item === undefined) return addScalar('null', () => Buffer.from([0x00]));
    if (typeof item === 'boolean') return addScalar(item ? 'true' : 'false', () => Buffer.from([item ? 0x09 : 0x08]));
    if (typeof item === 'bigint') return addScalar('b' + item, () => integerBytes(item));
    if (typeof item === 'number') {
      if (Number.isSafeInteger(item) && !Object.is(item, -0)) return addScalar('i' + item, () => integerBytes(item));
      return addScalar('d' + (Object.is(item, -0) ? '-0' : item), () => {
        const bytes = Buffer.alloc(9);
        bytes[0] = 0x23;
        bytes.writeDoubleBE(item, 1);
        return bytes;
      });
    }
    if (typeof item === 'string') {
      return addScalar('s' + item, () =>
        /^[\x00-\x7f]*$/.test(item)
          ? Buffer.concat([head(5, item.length), Buffer.from(item, 'latin1')])
          : Buffer.concat([head(6, item.length), Buffer.from(item, 'utf16le').swap16()]),
      );
    }
    if (item instanceof Date) {
      if (Number.isNaN(item.getTime())) throw new RangeError('An invalid Date cannot be written');
      return addScalar(null, () => {
        const bytes = Buffer.alloc(9);
        bytes[0] = 0x33;
        bytes.writeDoubleBE(item.getTime() / 1000 - APPLE_EPOCH_SECONDS, 1);
        return bytes;
      });
    }
    if (item instanceof PlistUID) {
      return addScalar(null, () => {
        const size = item.value < 0x100 ? 1 : item.value < 0x10000 ? 2 : item.value <= 0xffffffff ? 4 : 8;
        return Buffer.concat([Buffer.from([0x80 | (size - 1)]), unsignedBytes(item.value, size)]);
      });
    }
    if (item instanceof Uint8Array) {
      const data = Buffer.from(item);
      return addScalar(null, () => Buffer.concat([head(4, data.length), data]));
    }
    if (Array.isArray(item)) return addContainer(item, 0xa, item, null);
    if (item instanceof Set) return addContainer(item, 0xc, [...item], null);
    if (typeof item === 'object' && isPlainObject(item)) {
      const keys = Object.keys(item).filter((key) => item[key] !== undefined);
      return addContainer(item, 0xd, [...keys, ...keys.map((key) => item[key])], keys.length);
    }
    throw new TypeError('A value of this type cannot be written to a property list');
  }

  add(value);
  const refSize = byteSize(objects.length - 1);
  const output = new Output();
  output.push(Buffer.from('bplist00', 'latin1'));
  const offsets = [];
  for (const object of objects) {
    offsets.push(output.length);
    output.push(object.encode(refSize));
  }
  const tableOffset = output.length;
  const offsetSize = byteSize(tableOffset);
  for (const offset of offsets) output.push(unsignedBytes(offset, offsetSize));
  const trailer = Buffer.alloc(32);
  trailer[6] = offsetSize;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16); // the top object is always the first one written
  trailer.writeBigUInt64BE(BigInt(tableOffset), 24);
  output.push(trailer);
  return output.bytes();
}

// ---------------------------------------------------------------------------------------------------------------------------
// XML property lists (the plain subset: dict, array, string, integer, real, true, false, date, data)

const XML_TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)>/y;
const XML_ENTITY = /&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g;
const XML_STRAY_AMPERSAND = /&(?!(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);)/;
const XML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Parses an XML property list. No DTD is read and no entity beyond the five XML ones (and numeric character references) is
 *  expanded; anything else throws. */
function parseXmlPlist(text) {
  let position = 0;
  let nodes = 0;
  const problem = (message) => fail(message + ' (XML offset ' + position + ')');

  /** Skips white space, comments, the XML declaration and the DOCTYPE line (a DOCTYPE with an internal subset is refused). */
  const skipMisc = () => {
    for (;;) {
      while (position < text.length && /\s/.test(text[position])) position++;
      if (text.startsWith('<!--', position)) {
        const end = text.indexOf('-->', position + 4);
        if (end < 0) problem('a comment is not closed');
        position = end + 3;
      } else if (text.startsWith('<?', position)) {
        const end = text.indexOf('?>', position + 2);
        if (end < 0) problem('a processing instruction is not closed');
        position = end + 2;
      } else if (text.startsWith('<!DOCTYPE', position)) {
        const end = text.indexOf('>', position);
        if (end < 0 || text.slice(position, end).includes('[')) problem('the DOCTYPE is not supported');
        position = end + 1;
      } else return;
    }
  };

  const readTag = () => {
    XML_TAG.lastIndex = position;
    const match = XML_TAG.exec(text);
    if (!match) problem('a tag was expected');
    position = XML_TAG.lastIndex;
    return { closing: match[1] === '/', name: match[2], selfClosing: match[4] === '/' };
  };

  const expectClose = (name) => {
    const tag = readTag();
    if (!tag.closing || tag.name !== name) problem('</' + name + '> was expected');
  };

  const decode = (raw) => {
    if (XML_STRAY_AMPERSAND.test(raw)) problem('an entity is not supported');
    return raw.replace(XML_ENTITY, (_, hex, decimal, named) => {
      if (named) return XML_NAMED[named];
      const code = hex ? parseInt(hex, 16) : parseInt(decimal, 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) problem('a character reference is not valid');
      return String.fromCodePoint(code);
    });
  };

  /** The text inside the element just opened by `tag`, up to its closing tag. */
  const readText = (tag) => {
    if (tag.selfClosing) return '';
    const end = text.indexOf('<', position);
    if (end < 0) problem('<' + tag.name + '> is not closed');
    const raw = text.slice(position, end);
    position = end;
    expectClose(tag.name);
    return decode(raw);
  };

  const atClosing = () => {
    skipMisc();
    return text.startsWith('</', position);
  };

  const readValue = (depth) => {
    if (++nodes > MAX_OBJECTS) problem('the file holds too many elements');
    skipMisc();
    const tag = readTag();
    if (tag.closing) problem('a value was expected');
    switch (tag.name) {
      case 'dict': {
        if (depth >= MAX_DEPTH) problem('elements are nested too deeply');
        const result = {};
        if (tag.selfClosing) return result;
        while (!atClosing()) {
          const keyTag = readTag();
          if (keyTag.name !== 'key' || keyTag.closing) problem('<key> was expected');
          const key = readText(keyTag);
          setKey(result, key, readValue(depth + 1));
        }
        expectClose('dict');
        return result;
      }
      case 'array': {
        if (depth >= MAX_DEPTH) problem('elements are nested too deeply');
        const result = [];
        if (tag.selfClosing) return result;
        while (!atClosing()) result.push(readValue(depth + 1));
        expectClose('array');
        return result;
      }
      case 'string':
        return readText(tag);
      case 'integer': {
        const raw = readText(tag).trim();
        if (!/^[+-]?[0-9]+$/.test(raw)) problem('an integer is not valid');
        const number = BigInt(raw);
        return number >= BigInt(Number.MIN_SAFE_INTEGER) && number <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(number) : number;
      }
      case 'real': {
        const raw = readText(tag).trim().toLowerCase();
        if (raw === 'nan') return NaN;
        if (/^\+?(inf|infinity)$/.test(raw)) return Infinity;
        if (/^-(inf|infinity)$/.test(raw)) return -Infinity;
        const number = Number(raw);
        if (raw === '' || Number.isNaN(number)) problem('a real number is not valid');
        return number;
      }
      case 'true':
      case 'false':
        if (!tag.selfClosing) expectClose(tag.name);
        return tag.name === 'true';
      case 'date': {
        const raw = readText(tag).trim();
        const date = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(raw) ? new Date(raw) : new Date(NaN);
        if (Number.isNaN(date.getTime())) problem('a date is not valid');
        return date;
      }
      case 'data': {
        const raw = readText(tag).replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) problem('data is not valid base64');
        return Buffer.from(raw, 'base64');
      }
      default:
        return problem('<' + tag.name + '> is not supported');
    }
  };

  skipMisc();
  const plist = readTag();
  if (plist.closing || plist.name !== 'plist' || plist.selfClosing) problem('<plist> was expected');
  const value = readValue(0);
  skipMisc();
  expectClose('plist');
  skipMisc();
  if (position < text.length) problem('there is text after </plist>');
  return value;
}

/** Parses a property list of either kind: binary ("bplist00") or XML (starting `<?xml`, `<!DOCTYPE plist` or `<plist`).
 *  Anything else throws. */
function parsePlist(input) {
  const buffer = toBuffer(input);
  if (buffer.length > MAX_FILE_BYTES) fail('the file is too large');
  if (buffer.toString('latin1', 0, 6) === 'bplist') return parseBinaryPlist(buffer);
  const start = buffer.toString('utf8', 0, 512).replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml|<!DOCTYPE\s+plist|<plist)/i.test(start)) return parseXmlPlist(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  return fail('the file is neither a binary nor an XML property list');
}

module.exports = { parsePlist, parseBinaryPlist, parseXmlPlist, writeBinaryPlist, PlistUID, MAX_FILE_BYTES, MAX_OBJECTS, MAX_DEPTH };
