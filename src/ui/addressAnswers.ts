import { currentLocale,t } from '../i18n';

/** Answers the address list can give without leaving the device: a calculation, a unit conversion, the time in a city. Everything
 * here is computed from the typed text and the clock; nothing is sent anywhere, and nothing needs a rate table (so no currencies). */
export interface AddressAnswer { /** What the row shows large: "168", "3.107 mi", "21:42". */ value: string; /** The small line: the expression, the amount, "Time in Tokyo". */ detail: string; /** What choosing the row copies. */ copy: string }
export interface AnswerOptions { now?: Date; locale?: string; /** The IANA zone this device is in, to say "tomorrow" or "yesterday" for a city whose date differs. */ localZone?: string }

const MAX_LENGTH = 120;
const latin = (locale: string) => { try { return new Intl.NumberFormat(`${locale}-u-nu-latn`).resolvedOptions().locale; } catch { return 'en'; } };
/** Twelve significant digits hides 0.1 + 0.2 = 0.30000000000000004 and keeps every honest result. */
const settle = (value: number) => Number(value.toPrecision(12));

/* ---------- calculations ---------- */
class Parser {
  private at = 0;
  constructor(private readonly text: string) {}
  parse(): number | null { try { const value = this.sum(); return this.at === this.text.length && Number.isFinite(value) ? value : null; } catch { return null; } }
  private eat(char: string) { if (this.text[this.at] === char) { this.at++; return true; } return false; }
  private number(): number {
    if (this.eat('(')) { const inner = this.sum(); if (!this.eat(')')) throw 0; return inner; }
    const match = /^(?:\d+\.?\d*|\.\d+)/.exec(this.text.slice(this.at));
    if (!match) throw 0;
    this.at += match[0].length;
    return parseFloat(match[0]);
  }
  /** A leading minus binds looser than a power: -2^2 is -4. */
  private unary(): number { if (this.eat('-')) return -this.unary(); if (this.eat('+')) return this.unary(); return this.power(); }
  /** 2^3^2 is 2^(3^2); the exponent may carry a sign. */
  private power(): number { const base = this.number(); return this.eat('^') ? base ** this.unary() : base; }
  private product(): number {
    let value = this.unary();
    for (;;) {
      if (this.eat('*')) value *= this.unary();
      else if (this.eat('/')) value /= this.unary();
      else if (this.eat('%')) value %= this.unary();
      else return value;
    }
  }
  private sum(): number {
    let value = this.product();
    for (;;) {
      if (this.eat('+')) value += this.product();
      else if (this.eat('-')) value -= this.product();
      else return value;
    }
  }
}

/** The calculation a typed text is, or null. Strict on purpose: a date ("1/2/2024"), a phone number ("555-1234"), a version ("1.2.3") or a
 * lone number is not one, so those still search as they always did. */
export function evaluate(source: string): number | null {
  if (!source || source.length > MAX_LENGTH) return null;
  let text = source.trim().toLowerCase().replace(/\s+/g, ' ');
  // "15% of 80"
  const percent = /^(\d+(?:\.\d+)?|\.\d+) ?% ?of ?(\d+(?:\.\d+)?|\.\d+)$/.exec(text);
  if (percent) return settle(parseFloat(percent[1]) * parseFloat(percent[2]) / 100);
  // 1,000 + 2 (thousands commas); any other comma is not a calculation.
  text = text.replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, group => group.replace(/,/g, ''));
  if (text.includes(',')) return null;
  text = text.replace(/(?<=[\d)]) ?× ?(?=[\d(.])/g, '*').replace(/(?<=[\d)]) x (?=[\d(.])/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  if (!/^[\d .+\-*/^%()]+$/.test(text) || !/\d/.test(text)) return null;
  const compact = text.replace(/ /g, '');
  // Dates and ranges typed without spaces ("2024-11-06", "1/2/2024", "10.0.0.1", "555-1234") are not sums.
  if (!text.includes(' ') && /^\d[\d.]*([-/.]\d[\d.]*)+$/.test(compact) && !/[+*^%()]/.test(compact) && !/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(compact)) return null;
  // Something must actually be calculated: an operator between values, not a leading sign or a lone bracketed number.
  if (!/[\d)] ?[-+*/^%] ?[-+]?[\d(.]/.test(text)) return null;
  const value = new Parser(compact).parse();
  return value === null ? null : settle(value);
}

const numberText = (value: number, locale: string, fraction = 8) => {
  if (value !== 0 && (Math.abs(value) >= 1e15 || Math.abs(value) < 1e-9)) return value.toExponential(6).replace(/\.?0+e/, 'e');
  return new Intl.NumberFormat(latin(locale), { maximumFractionDigits: fraction }).format(value);
};

/* ---------- units ---------- */
type Family = 'length' | 'mass' | 'volume' | 'speed' | 'temperature';
interface Unit { family: Family; /** How many base units one of it is (temperature is converted by formula). */ factor: number; symbol: string }
const UNITS: Record<string, Unit> = {};
const add = (family: Family, symbol: string, factor: number, names: string[]) => { const unit = { family, factor, symbol }; for (const name of [symbol, ...names]) UNITS[name.toLowerCase()] = unit; };
add('length', 'mm', .001, ['millimeter', 'millimeters', 'millimetre', 'millimetres']);
add('length', 'cm', .01, ['centimeter', 'centimeters', 'centimetre', 'centimetres']);
add('length', 'm', 1, ['meter', 'meters', 'metre', 'metres']);
add('length', 'km', 1000, ['kilometer', 'kilometers', 'kilometre', 'kilometres']);
add('length', 'in', .0254, ['inch', 'inches']);
add('length', 'ft', .3048, ['foot', 'feet']);
add('length', 'yd', .9144, ['yard', 'yards']);
add('length', 'mi', 1609.344, ['mile', 'miles']);
add('mass', 'mg', 1e-6, ['milligram', 'milligrams']);
add('mass', 'g', .001, ['gram', 'grams']);
add('mass', 'kg', 1, ['kilogram', 'kilograms', 'kilo', 'kilos']);
add('mass', 'oz', .028349523125, ['ounce', 'ounces']);
add('mass', 'lb', .45359237, ['lbs', 'pound', 'pounds']);
add('volume', 'ml', .001, ['milliliter', 'milliliters', 'millilitre', 'millilitres']);
add('volume', 'l', 1, ['liter', 'liters', 'litre', 'litres']);
add('volume', 'cup', .2365882365, ['cups']);
add('volume', 'qt', .946352946, ['quart', 'quarts']);
add('volume', 'gal', 3.785411784, ['gallon', 'gallons']);
add('speed', 'm/s', 1, ['mps']);
add('speed', 'km/h', 1000 / 3600, ['kmh', 'kph']);
add('speed', 'mph', .44704, ['mi/h']);
add('temperature', '°C', 1, ['c', 'celsius', '°c', 'degc']);
add('temperature', '°F', 1, ['f', 'fahrenheit', '°f', 'degf']);
add('temperature', 'K', 1, ['k', 'kelvin']);

const kelvin = (value: number, unit: string) => unit === '°C' ? value + 273.15 : unit === '°F' ? (value - 32) * 5 / 9 + 273.15 : value;
const fromKelvin = (value: number, unit: string) => unit === '°C' ? value - 273.15 : unit === '°F' ? (value - 273.15) * 9 / 5 + 32 : value;

function convert(amount: number, from: Unit, to: Unit): number | null {
  if (from.family !== to.family) return null;
  if (from.family === 'temperature') return fromKelvin(kelvin(amount, from.symbol), to.symbol);
  return amount * from.factor / to.factor;
}
const UNIT_QUERY = /^(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?\.\d+) ?(°?[a-z]+(?:\/[a-z]+)?) (?:in|to|as|=|->|→) ?(°?[a-z]+(?:\/[a-z]+)?)$/;
function unitAnswer(text: string, locale: string): AddressAnswer | null {
  const match = UNIT_QUERY.exec(text.toLowerCase());
  if (!match) return null;
  const from = UNITS[match[2]], to = UNITS[match[3]];
  if (!from || !to || from === to) return null;
  const amount = parseFloat(match[1].replace(/,/g, ''));
  const result = convert(amount, from, to);
  if (result === null || !Number.isFinite(result)) return null;
  const rounded = Math.abs(result) < .001 && result !== 0 ? Number(result.toPrecision(3)) : Number(result.toFixed(3));
  const space = to.symbol.startsWith('°') ? ' ' : ' ';
  const value = `${numberText(rounded, locale, 3)}${space}${to.symbol}`;
  return { value, detail: `${numberText(amount, locale, 8)}${from.symbol.startsWith('°') ? ' ' : ' '}${from.symbol}`, copy: value };
}

/* ---------- time in a city ---------- */
/** City names that are not an IANA zone's own city (or that people say another way). */
const CITY_ALIASES: Record<string, string> = {
  mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', bangalore: 'Asia/Kolkata', chennai: 'Asia/Kolkata', beijing: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong',
  washington: 'America/New_York', boston: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York', 'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', houston: 'America/Chicago', dallas: 'America/Chicago', 'mexico city': 'America/Mexico_City', 'rio de janeiro': 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo',
  'são paulo': 'America/Sao_Paulo', munich: 'Europe/Berlin', frankfurt: 'Europe/Berlin', hamburg: 'Europe/Berlin', milan: 'Europe/Rome', barcelona: 'Europe/Madrid', amsterdam: 'Europe/Amsterdam',
  geneva: 'Europe/Zurich', 'kyiv': 'Europe/Kyiv', kiev: 'Europe/Kyiv', 'saint petersburg': 'Europe/Moscow', 'st petersburg': 'Europe/Moscow', 'tel aviv': 'Asia/Jerusalem', riyadh: 'Asia/Riyadh',
  'abu dhabi': 'Asia/Dubai', osaka: 'Asia/Tokyo', kyoto: 'Asia/Tokyo', melbourne: 'Australia/Melbourne', 'new zealand': 'Pacific/Auckland', 'new york city': 'America/New_York', nyc: 'America/New_York', la: 'America/Los_Angeles',
};
let zoneIndex: Map<string, string> | undefined;
function zones(): Map<string, string> {
  if (zoneIndex) return zoneIndex;
  const index = new Map<string, string>();
  let names: string[] = [];
  try { names = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* no list: the aliases still work */ }
  for (const zone of names) { const city = zone.split('/').at(-1)!.replace(/_/g, ' ').toLowerCase(); if (!index.has(city)) index.set(city, zone); }
  for (const [city, zone] of Object.entries(CITY_ALIASES)) index.set(city, zone);
  return zoneIndex = index;
}
const titleCase = (text: string) => text.replace(/(^|[\s-])(\p{L})/gu, (_all, before: string, letter: string) => before + letter.toUpperCase());
const dayOf = (date: Date, zone: string) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''; return Date.UTC(+get('year'), +get('month') - 1, +get('day')) / 86400000; };

function timeAnswer(text: string, locale: string, now: Date, localZone?: string): AddressAnswer | null {
  const match = /^(?:what(?:'s| is)? the )?time (?:in|at) ([\p{L} .'-]{2,40}?)\??$/iu.exec(text.trim().replace(/\s+/g, ' '));
  if (!match) return null;
  const typed = match[1].trim().toLowerCase().replace(/\./g, '');
  const zone = zones().get(typed);
  if (!zone) return null;
  const home = localZone ?? (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
  const value = new Intl.DateTimeFormat(latin(locale), { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(now);
  const days = Math.round(dayOf(now, zone) - dayOf(now, home));
  const city = titleCase(typed);
  let detail = t('addressanswers.timeIn', { city });
  if (days) detail += `, ${new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.sign(days), 'day')}`;
  return { value, detail, copy: value };
}

/** The answer for what was typed, or null (most of the time). */
export function answerFor(query: string, options: AnswerOptions = {}): AddressAnswer | null {
  const text = query.trim();
  if (!text || text.length > MAX_LENGTH) return null;
  const locale = options.locale ?? currentLocale();
  const calculated = evaluate(text);
  if (calculated !== null) return { value: numberText(calculated, locale), detail: text.replace(/\s+/g, ' ').replace(/\*/g, '×'), copy: String(calculated) };
  return unitAnswer(text, locale) ?? timeAnswer(text, locale, options.now ?? new Date(), options.localZone);
}
