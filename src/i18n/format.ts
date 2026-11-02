import { interfaceDirection } from './direction';
/** ICU-light message formatting: {name} parameters and {count, plural, =0 {…} one {…} other {…}} with # for the number. */
export type Params = Record<string, string | number>;

// A hostname, filename or profile name must not reorder surrounding RTL copy.
// FSI chooses each string's own direction; PDI ends its isolated span. Numbers
// still use Intl and plural selection still receives the original parameters.
const stringValue = (locale: string, value: string) => interfaceDirection(locale) === 'rtl' && value ? '\u2068' + value + '\u2069' : value;

/** The index just past the brace that closes the one opened at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}

const rules = new Map<string, Intl.PluralRules>();
const category = (locale: string, count: number) => {
  let rule = rules.get(locale);
  if (!rule) { try { rule = new Intl.PluralRules(locale); } catch { rule = new Intl.PluralRules('en'); } rules.set(locale, rule); }
  return rule.select(count);
};
const number = (locale: string, value: number) => { try { return new Intl.NumberFormat(locale).format(value); } catch { return String(value); } };

/** `plural` body: pairs of `selector {text}`; `=N` wins over the plural category, which wins over `other`. */
function pick(locale: string, body: string, count: number, params: Params): string {
  const options = new Map<string, string>();
  for (let i = 0; i < body.length;) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const selector = body.slice(i, open).trim(), end = closing(body, open);
    options.set(selector, body.slice(open + 1, end));
    i = end + 1;
  }
  const text = options.get('=' + count) ?? options.get(category(locale, count)) ?? options.get('other') ?? '';
  return render(locale, text.split('#').join(number(locale, count)), params);
}

function render(locale: string, message: string, params: Params): string {
  let out = '';
  for (let i = 0; i < message.length;) {
    const open = message.indexOf('{', i);
    if (open < 0) { out += message.slice(i); break; }
    out += message.slice(i, open);
    const end = closing(message, open), inner = message.slice(open + 1, end);
    const comma = inner.indexOf(',');
    if (comma < 0) {
      const value = params[inner.trim()];
      out += value === undefined ? '{' + inner + '}' : typeof value === 'number' ? number(locale, value) : stringValue(locale, value);
    } else {
      const name = inner.slice(0, comma).trim(), rest = inner.slice(comma + 1).trim();
      if (rest.startsWith('plural,')) out += pick(locale, rest.slice(7), Number(params[name] ?? 0), params);
      else out += '{' + inner + '}';
    }
    i = end + 1;
  }
  return out;
}

export function format(locale: string, message: string, params: Params = {}): string {
  return message.includes('{') ? render(locale, message, params) : message;
}
