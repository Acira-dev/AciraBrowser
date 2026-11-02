import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkCaption, frequentPages, fromHistory, profileHistory, recentPages } from '../src/features/newtab/pages';
import { isAddressLike } from '../src/runtime/siteMark';

const visit = (id: string, url: string, title: string, time: string, browserProfileId = 'p1') => ({ id, url, title, time, browserProfileId }) as any;
const history = [
  visit('1', 'https://a.example/', 'A', '2026-10-24T10:00:00Z'),
  visit('2', 'https://b.example/', 'عنوان B', '2026-10-24T09:00:00Z'),
  visit('3', 'https://a.example/', 'A again', '2026-10-24T08:00:00Z'),
  visit('4', 'acira://settings', 'Settings', '2026-10-24T07:00:00Z'),
  visit('5', 'https://other.example/', 'Other profile', '2026-10-24T06:00:00Z', 'p2'),
  visit('6', 'file:///c:/secret.txt', 'File', '2026-10-24T05:00:00Z'),
];

test('history is scoped to its own profile', () => {
  assert.deepEqual(profileHistory(history, 'p1', 'p1').map((item) => item.id), ['1', '2', '3', '4', '6']);
  assert.deepEqual(profileHistory(history, 'p2', 'p1').map((item) => item.id), ['5']);
  assert.equal(profileHistory([{ ...history[0], browserProfileId: undefined }], 'p1', 'p1').length, 1, 'legacy entries belong to the first profile');
});

test('recent pages are distinct, ordinary web history, and short', () => {
  const recent = recentPages(profileHistory(history, 'p1', 'p1'));
  assert.deepEqual(recent.map((item) => item.url), ['https://a.example/', 'https://b.example/', 'file:///c:/secret.txt']);
  assert.equal(recentPages(history, 1).length, 1);
});

test('private windows never reveal ordinary history', () => {
  assert.deepEqual(recentPages(history, 4, true), []);
  assert.deepEqual(frequentPages(history, new Set(), 8, true), []);
});

test('frequent pages rank by visits, skip chosen shortcuts and non-web addresses', () => {
  const pages = frequentPages(profileHistory(history, 'p1', 'p1'), new Set(), 8);
  assert.deepEqual(pages.map((item) => item.url), ['https://a.example/', 'https://b.example/']);
  assert.equal(pages[0].count, 2);
  assert.deepEqual(frequentPages(history, new Set(['https://a.example/']), 8).map((item) => item.url), ['https://b.example/', 'https://other.example/']);
  assert.deepEqual(frequentPages(history, new Set(), 0), []);
});

test('the caption is the title, then artist and year; the museum is only a tooltip', () => {
  const caption = artworkCaption({ name: 'Wheat Field with Cypresses', artist: 'Vincent van Gogh', date: '1889', provider: 'The Metropolitan Museum of Art', rights: 'CC0 1.0' });
  assert.equal(caption.title, 'Wheat Field with Cypresses');
  assert.deepEqual(caption.byline, ['Vincent van Gogh', '1889']);
  assert.equal(caption.museum, 'The Metropolitan Museum of Art · CC0 1.0');
  assert.ok(!caption.byline.join(' ').includes('Metropolitan'), 'the museum is never part of the visible line');
});

test('a caption without provenance shows only what is known', () => {
  assert.deepEqual(artworkCaption({ name: 'Quiet dunes' }), { title: 'Quiet dunes', byline: [], museum: undefined });
  assert.deepEqual(artworkCaption({ name: ' Personal ', artist: ' ', date: '1901' }).byline, ['1901']);
  assert.equal(artworkCaption({ name: 'x', provider: 'Rijksmuseum' }).museum, 'Rijksmuseum');
});

test('the page search resolves custom engines and !keyword shortcuts the way the address bar does', async () => {
  const { resolveNavigation } = await import('../src/runtime/navigation');
  const providers = { defaultId: 'acme', engines: [{ id: 'acme', name: 'Acme', keyword: 'a', template: 'https://search.acme.test/?q=%s' }, { id: 'docs', name: 'Docs', keyword: 'docs', template: 'https://docs.acme.test/find?term=%s' }] };
  assert.equal(resolveNavigation('hello world', 'google', providers).url, 'https://search.acme.test/?q=hello%20world');
  assert.equal(resolveNavigation('!docs vapor', 'google', providers).url, 'https://docs.acme.test/find?term=vapor');
  assert.match(resolveNavigation('hello world', 'google', undefined).url, /google\.com\/search\?q=hello(%20|\+)world/, 'without custom providers the legacy engine is used');
});

test('addresses with no name to spell get a globe, real hostnames keep their letter', () => {
  for (const url of ['http://127.0.0.1:5173/', 'http://127.0.0.1/', '127.0.0.1:8080', 'http://192.168.1.20/admin', 'http://localhost:3000/', 'localhost:3000', 'http://app.localhost/', 'http://[::1]:8080/', 'file:///c:/docs/readme.txt']) assert.equal(isAddressLike(url), true, url);
  for (const url of ['https://example.com/', 'https://www.example.co.uk/path', 'https://news.ycombinator.com/', 'http://intranet/', 'https://xn--bcher-kva.example/', 'https://1password.com/']) assert.equal(isAddressLike(url), false, url);
});

test('recent pages are one pass that stops at the limit, and a list-derived result is kept for the same list', () => {
  const history = Array.from({ length: 5000 }, (_, i) => ({ id: 'v' + i, title: 'T' + i, url: 'https://site' + (i % 700) + '.example/p' + (i % 900), time: '12:00', profileId: '', browserProfileId: 'p1' }));
  const started = performance.now(), recent = recentPages(history, 7), took = performance.now() - started;
  assert.equal(recent.length, 7); assert.equal(new Set(recent.map((item) => item.url)).size, 7); assert.deepEqual(recent.map((item) => item.id), history.slice(0, 7).map((item) => item.id));
  assert.ok(took < 15, `recentPages took ${took.toFixed(1)} ms over 5000 visits`);
  let runs = 0; const compute = () => ++runs;
  assert.equal(fromHistory(history, 'k', compute), 1); assert.equal(fromHistory(history, 'k', compute), 1); assert.equal(runs, 1);
  assert.equal(fromHistory(history.slice(), 'k', compute), 2, 'another list is not served the old result');
});
