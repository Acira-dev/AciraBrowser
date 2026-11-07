import assert from 'node:assert/strict';
import test from 'node:test';
import { answerFor, evaluate } from '../src/ui/addressAnswers';

// Founder (6 Nov, Zia research idea 5): the address list answers a sum, a unit conversion or "time in a city" without leaving the device.
// Strict on purpose: anything that is not clearly one of those (a date, a phone number, a version, a word) still only searches.
const en = { locale: 'en-GB' };

test('sums: operators, brackets, powers, percent and the usual precedence', () => {
  const sums: [string, number][] = [['12*14', 168], ['12 x 14', 168], ['12×14', 168], ['(2+3)*4', 20], ['2^10', 1024], ['-2^2', -4], ['2^3^2', 512], ['7/2', 3.5], ['10 % 3', 1], ['1,000+250', 1250], ['15% of 80', 12], ['100 - 1', 99], ['0.1+0.2', 0.3], ['2 * -3', -6], ['9÷3', 3]];
  for (const [text, value] of sums) assert.equal(evaluate(text), value, text);
});

test('things that are not sums are left alone, so they search or open as before', () => {
  for (const text of ['', '12', '(5)', '-5', '2 +', '2024-11-06', '1/2/2024', '555-1234', '10.0.0.1', '1.2.3', '4x4', '12x14', 'hello', 'google.com', 'how to 2+2', 'https://a.com/1+1', '1/0', '2^10000', '1,5*2', '10-20', '1+'.repeat(80)]) assert.equal(evaluate(text), null, JSON.stringify(text));
  assert.equal(answerFor('4x4', en), null);
  assert.equal(answerFor('pip', en), null);
});

test('the answer row: the figure, the question under it, and what a click copies', () => {
  assert.deepEqual(answerFor('12*14', en), { value: '168', detail: '12×14', copy: '168' });
  assert.deepEqual(answerFor('1,000 + 250', en), { value: '1,250', detail: '1,000 + 250', copy: '1250' });
  assert.equal(answerFor('1/3', en)?.value, '0.33333333', 'eight places at most');
  assert.equal(answerFor('0.1+0.2', en)?.value, '0.3', 'no 0.30000000000000004');
  assert.equal(answerFor('2^100', en)?.value, '1.267651e+30', 'a very large result reads in scientific form');
});

test('numbers are written with Latin digits in every language, and with that language\'s separators', () => {
  assert.equal(answerFor('1000*1000', { locale: 'de' })?.value, '1.000.000');
  assert.equal(answerFor('1000*1000', { locale: 'en' })?.value, '1,000,000');
  assert.match(answerFor('3/2', { locale: 'ar' })?.value ?? '', /^[0-9]/, 'Arabic keeps 0-9 so the figure matches what was typed');
});

test('unit conversions: length, mass, volume, speed and temperature, all on the device', () => {
  const rows: [string, string, string][] = [
    ['5 km in miles', '3.107 mi', '5 km'], ['3 gal in l', '11.356 l', '3 gal'], ['1 kg to lb', '2.205 lb', '1 kg'], ['60 mph in km/h', '96.561 km/h', '60 mph'],
    ['100 c to f', '212 °F', '100 °C'], ['72 f in c', '22.222 °C', '72 °F'], ['0 c in k', '273.15 K', '0 °C'], ['12 in to cm', '30.48 cm', '12 in'], ['1,000 g in kg', '1 kg', '1,000 g'],
  ];
  for (const [text, value, detail] of rows) { const answer = answerFor(text, en); assert.equal(answer?.value, value, text); assert.equal(answer?.detail, detail, text); assert.equal(answer?.copy, value); }
});

test('what cannot be converted gives no answer: other kinds, unknown units, and money (no rate is ever fetched)', () => {
  for (const text of ['5 km in kg', '5 foo in bar', '100 usd in eur', '5 km in km', '5 km', 'km in miles']) assert.equal(answerFor(text, en), null, text);
});

test('time in a city: from the clock and the zone data of the device, with the day when it differs', () => {
  const now = new Date('2026-11-06T12:00:00Z'), home = { ...en, now, localZone: 'UTC' };
  assert.deepEqual(answerFor('time in tokyo', home), { value: '21:00', detail: 'Time in Tokyo', copy: '21:00' });
  assert.match(answerFor('time in new york', home)?.value ?? '', /^0?7:00$/);
  assert.equal(answerFor('what is the time in london?', home)?.value, '12:00');
  assert.equal(answerFor('time in beirut', home)?.value, '14:00');
  assert.equal(answerFor('time in mumbai', home)?.value, '17:30', 'a city that is no zone name of its own');
  assert.equal(answerFor('time in tokyo', { ...home, now: new Date('2026-11-06T20:00:00Z') })?.detail, 'Time in Tokyo, tomorrow');
  assert.equal(answerFor('time in los angeles', { ...home, now: new Date('2026-11-06T03:00:00Z') })?.detail, 'Time in Los Angeles, yesterday');
  assert.equal(answerFor('time in atlantis', home), null);
  assert.equal(answerFor('time in', home), null);
});

test('nothing here reaches the network', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/ui/addressAnswers.ts', import.meta.url), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|https?:\/\//.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the answers are computed from the typed text and the clock only');
});
