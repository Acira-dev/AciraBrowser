/** How an internationalised host name reads in the address field, after Chrome's IDN display rules (url_formatter's
 * IDNSpoofChecker, UTS #39 "highly restrictive"): a name that is safe to read shows in its own script (`münchen.de`, `пример.рф`,
 * `例え.jp`), and a name that mixes scripts or imitates another (`аpple.com` with a Cyrillic а, `аррӏе.com` all Cyrillic,
 * `gοοgle.com` with Greek ο, `faß.de`) stays in punycode, so a lookalike never reads as the site it imitates. One unsafe label keeps
 * the whole name in punycode. */

const BASE = 36, T_MIN = 1, T_MAX = 26, SKEW = 38, DAMP = 700;
function adapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - T_MIN));
  return Math.floor(k + (BASE - T_MIN + 1) * delta / (delta + SKEW));
}
/** RFC 3492 decoding of one label without its `xn--`; null when it is not valid punycode. */
export function decodePunycode(input: string): string | null {
  const output: number[] = [], basic = Math.max(0, input.lastIndexOf('-'));
  for (let j = 0; j < basic; j += 1) { const c = input.charCodeAt(j); if (c >= 0x80) return null; output.push(c); }
  let n = 128, bias = 72, i = 0;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length;) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (at >= input.length) return null;
      const c = input.charCodeAt(at++), digit = c >= 48 && c < 58 ? c - 22 : c >= 65 && c < 91 ? c - 65 : c >= 97 && c < 123 ? c - 97 : BASE;
      if (digit >= BASE || i + digit * w > 0x7fffffff) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - old, length, old === 0);
    n += Math.floor(i / length); i %= length;
    if (n > 0x10ffff) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

// Scripts a label may be written in. Han, Hiragana, Katakana, Hangul and Bopomofo also stand for the writing systems they make up
// (Japanese, Korean, Chinese), so 例え (Han + Hiragana) is one system; Latin may join one of those, as UTS #39 allows.
const SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Nko', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian', 'Hangul', 'Ethiopic', 'Cherokee', 'Canadian_Aboriginal', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo', 'Han', 'Yi', 'Tifinagh', 'Javanese', 'Sundanese', 'Ol_Chiki', 'Vai'];
const SCRIPT_TESTS = SCRIPTS.map(name => [name, new RegExp(`\\p{scx=${name}}`, 'u')] as const);
const WRITING: Record<string, string[]> = {Han: ['Han', 'Jpan', 'Kore', 'Hanb'], Hiragana: ['Jpan'], Katakana: ['Jpan'], Hangul: ['Kore'], Bopomofo: ['Hanb']};
const CJK = new Set(['Jpan', 'Kore', 'Hanb']);
const scriptsOf = (char: string) => new Set(SCRIPT_TESTS.filter(([, test]) => test.test(char)).flatMap(([name]) => WRITING[name] || [name]));
const intersect = (sets: Set<string>[]) => sets.reduce((all, set) => new Set([...all].filter(name => set.has(name))));

// Letters that read as Latin ones (Chrome's whole-script confusables), shown in their own script only under their own country's names.
const CYRILLIC_LATIN = /^[асԁеһіјӏорԗԛѕԝхуъьҽпгѵѡ\d-]+$/u, CYRILLIC_TLDS = new Set(['ru', 'su', 'рф', 'by', 'бел', 'kz', 'қаз', 'kg', 'mk', 'мкд', 'mn', 'мон', 'rs', 'срб', 'tj', 'ua', 'укр', 'uz', 'bg', 'бг']);
const GREEK_LATIN = /^[αικνορτυχϲ\d-]+$/u, GREEK_TLDS = new Set(['gr', 'ελ', 'cy', 'eu', 'ευ']);
// Latin letters with no accent that pass for ASCII ones (ɡ for g, ı for i, small capitals...), and IDNA's deviation letters.
const LATIN_LOOKALIKE = /[ɑɡɩɪʟɴʀʏʙɢʜꞵſĸ]/u, DEVIATION = /[ßς]/u;
// Chrome's dangerous patterns (idn_spoof_checker.cc), each a letter that passes for punctuation or a Latin letter in context.
const JAPANESE = '\\p{scx=Katakana}\\p{scx=Hiragana}\\p{scx=Han}', CJK_PUNCT = '\\u4e00\\u3127\\u4e28\\u4e5b\\u4e03\\u4e05\\u5341\\u3007\\u3112\\u311a\\u311f\\u3128\\u3129\\u3108\\u31ba\\u31b3\\u5de5\\u31b2\\u8ba0\\u4e01';
const DANGEROUS = [
  new RegExp(`[^${JAPANESE}][\\u30ce\\u30f3\\u30bd\\u30be\\u4e36\\u4e40\\u4e41\\u4e3f][^${JAPANESE}]`, 'u'), // ノ ン ソ ゾ as slashes between non-Japanese
  /^[\p{scx=Katakana}]+[へ-ぺ][\p{scx=Katakana}]+$|^[\p{scx=Hiragana}]+[ヘ-ペ][\p{scx=Hiragana}]+$/u, // へ べ ぺ hidden in the other kana
  /[^\p{scx=Katakana}][ヽヾ]|^[ヽヾ]/u, // katakana iteration marks out of place
  /^[・ー]|[^\p{scx=Katakana}\p{scx=Hiragana}]ー|ー[^\p{scx=Katakana}\p{scx=Hiragana}]/u, // ー as a dash
  new RegExp(`[^${JAPANESE}\\p{scx=Bopomofo}][${CJK_PUNCT}]|[${CJK_PUNCT}][^${JAPANESE}\\p{scx=Bopomofo}]`, 'u'), // 一 十 工 丁… beside non-CJK
  /[^\p{scx=Latin}\p{scx=Greek}\p{scx=Cyrillic}][̀-̹]/u, // an accent on a letter it does not belong to
  /ı[̀-ͯ]|゙|゚/u, // ı with an accent; detached kana voicing marks
  /[ijlı]̇/u, // i̇: a dot on a dotted letter
];

function zeroOf(code: number): number {
  let zero = code;
  while (zero > 0 && code - zero < 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return zero;
}

/** Whether one decoded label may show as Unicode. tld is the last label of the host, decoded. */
export function safeLabel(label: string, tld: string): boolean {
  if (!label || label.normalize('NFC') !== label || DEVIATION.test(label)) return false;
  const chars = [...label], letters: Set<string>[] = [], digits = new Set<number>();
  for (const char of chars) {
    if (char === '-') continue;
    if (/\p{Nd}/u.test(char)) { digits.add(zeroOf(char.codePointAt(0)!)); continue; }
    if (/\p{DI}/u.test(char) || !/[\p{L}\p{M}]/u.test(char)) return false; // symbols, punctuation, invisible joiners
    if (/\p{Lm}/u.test(char) && !/[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u.test(char)) return false; // modifier letters (ʹ ˌ) outside Japanese
    if (/\p{M}/u.test(char) && /\p{scx=Inherited}/u.test(char)) continue; // a combining accent belongs to its letter
    const scripts = scriptsOf(char);
    if (!scripts.size) return false; // a script this check does not know
    letters.push(scripts);
  }
  if (digits.size > 1) return false; // digits from two number systems
  if (letters.length && !intersect(letters).size) {
    const rest = letters.filter(set => !set.has('Latin'));
    if (!rest.length || ![...intersect(rest)].some(name => CJK.has(name))) return false; // mixed scripts
  }
  if (CYRILLIC_LATIN.test(label) && /\p{scx=Cyrillic}/u.test(label) && !CYRILLIC_TLDS.has(tld)) return false;
  if (GREEK_LATIN.test(label) && /\p{scx=Greek}/u.test(label) && !GREEK_TLDS.has(tld)) return false;
  if (/[þð]/u.test(label) && tld !== 'is') return false;
  if (/ə/u.test(label) && tld !== 'az') return false;
  if (/ı/u.test(label) && tld !== 'tr' && tld !== 'az') return false;
  if (LATIN_LOOKALIKE.test(label)) return false;
  return !DANGEROUS.some(pattern => pattern.test(label));
}

/** The host as the address field shows it: Unicode when every label is safe to read, else the punycode it came as. */
export function displayHostname(host: string): string {
  if (!/(^|\.)xn--/i.test(host)) return host;
  const labels = host.toLowerCase().split('.'), decoded = labels.map(label => label.startsWith('xn--') ? decodePunycode(label.slice(4)) : label);
  if (decoded.some(label => label === null)) return host;
  const tld = (decoded.filter(Boolean).at(-1) || '') as string;
  if (!decoded.every(label => label === '' || safeLabel(label as string, tld))) return host;
  const shown = decoded.join('.');
  // The name must read back to the same address (what the browser would actually open), or it is not shown.
  try { if (new URL(`https://${shown}/`).hostname !== host.toLowerCase()) return host; } catch { return host; }
  return shown;
}
