import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrowserAction } from '../src/runtime/types';

// A toast built from catalog text in one language stayed in that language after a language change (the interface reloads and main
// shows its last toast again): the Seamless tip, written with t() and no message id, and main's own toasts written with tm(). Now
// a toast sent as text goes with the id of the message it was made from, so the reloaded interface shows it in the new language.
// And English text in an Arabic interface (a site's message, an error) read right to left: ".Example Site saved your file".
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const { createSaid, withMessageIds } = await import('../src/i18n/said');
const i18n = await import('../src/i18n');
const mainI18n = await import('../src/i18n/main');
const { createInitialState, readToastsWith, reduceBrowser } = await import('../src/runtime/core');
const { ownTextDirection } = await import('../src/i18n/direction');
const { ToastCard } = await import('../src/components/transient/Toast');
const { validateAction } = require('../desktop/validation.cjs');
type Toast = Extract<BrowserAction, { type: 'toast' }>;
const toastOf = (toast: Toast) => toast;

test('a toast the interface writes in German goes with its message id, and shows in French after the switch', async () => {
  await i18n.setLocale('de');
  const tip = i18n.t('windowview.firstRun', { shortcut: '⌃⇧L' });
  assert.match(tip, /„Nahtlos“/);
  const sent = withMessageIds(toastOf({ type: 'toast', text: tip, tone: 'info' }), i18n.saidAs);
  assert.deepEqual(sent.i18n, { id: 'windowview.firstRun', params: { shortcut: '⌃⇧L' } }, 'the Seamless tip (a message with parameters)');
  const undo = withMessageIds(toastOf({ type: 'toast', text: i18n.t('toast.bookmarkRemoved'), action: { label: i18n.t('toast.undo'), command: { type: 'bookmark.restore', nodes: [] } } }), i18n.saidAs);
  assert.deepEqual(undo.i18n, { id: 'toast.bookmarkRemoved' }, 'a message without parameters');
  assert.equal(undo.action?.labelId, 'toast.undo', 'its Undo too');
  assert.equal(withMessageIds(toastOf({ type: 'toast', text: 'Example Site saved your file.' }), i18n.saidAs).i18n, undefined, 'text that is not a message is sent as it is');
  // Main keeps the message; the interface shows it in its language (App.tsx useToasts translates `i18n`).
  const shown = reduceBrowser(createInitialState(), sent).toast!;
  assert.deepEqual(shown.i18n, { id: 'windowview.firstRun', params: { shortcut: '⌃⇧L' } });
  assert.equal(shown.tone, 'info');
  await i18n.setLocale('fr');
  assert.match(i18n.t(shown.i18n!.id as 'windowview.firstRun', shown.i18n!.params), /^«\sFluide\s» est activé/);
  await i18n.setLocale('en');
});

test('a toast main writes with tm() keeps its message id, a status pill keeps its icon', () => {
  mainI18n.setMainLocale('de', 'en');
  readToastsWith(mainI18n.saidAs);
  try {
    const moved = reduceBrowser(createInitialState(), { type: 'toast', text: mainI18n.tm('main.openAnotherTabToMove'), tone: 'info' }).toast!;
    assert.deepEqual(moved.i18n, { id: 'main.openAnotherTabToMove' });
    assert.equal(moved.text, 'Open another tab to move this one to a new window.', 'kept in English for logs, shown in the language in use');
    const circuit = reduceBrowser(createInitialState(), { type: 'toast', text: mainI18n.tm('tor.circuit.done', { site: 'example.org' }) }).toast!;
    assert.deepEqual(circuit.i18n, { id: 'tor.circuit.done', params: { site: 'example.org' } });
    const pill = reduceBrowser(createInitialState(), { type: 'toast', text: mainI18n.tm('main.aiFreeModeOn'), tone: 'status', icon: 'sparkles-off' }).toast!;
    assert.equal(pill.i18n?.id, 'main.aiFreeModeOn');
    assert.equal(pill.icon, 'sparkles-off', 'a status toast with a message id keeps its icon');
    assert.equal(reduceBrowser(createInitialState(), { type: 'toast', text: 'Example Site saved your file.' }).toast!.i18n, undefined);
  } finally { readToastsWith(() => undefined); mainI18n.setMainLocale('en', 'en'); }
  assert.match(read('desktop/main.cjs'), /require\('\.\/runtime\.cjs'\)\.readToastsWith\(require\('\.\/tm\.cjs'\)\.said\);/, 'main reads its toasts with its own messages');
  assert.match(read('desktop/tm.cjs'), /function said\(text\) \{ return inUse\(\)\.saidAs\(text\); \}/);
});

test('the interface sends every toast through the lookup, and main takes the id it sends', () => {
  assert.match(read('src/runtime/client.ts'), /const dispatch=\(action:BrowserAction\)=>\{\/\*[^*]*\*\/if\(action\.type==='toast'\)action=withMessageIds\(action,saidAs\);/);
  const snapshot = createInitialState();
  const toast = (i18nField: unknown) => ({ type: 'toast', text: 'Fluide est activé.', tone: 'info', i18n: i18nField });
  assert.doesNotThrow(() => validateAction(toast({ id: 'windowview.firstRun', params: { shortcut: '⌃⇧L', count: 2 } }), snapshot));
  assert.doesNotThrow(() => validateAction(toast({ id: 'toast.bookmarkRemoved' }), snapshot));
  assert.throws(() => validateAction(toast({ id: 'x', params: { name: { nested: true } } }), snapshot));
  assert.throws(() => validateAction(toast({ id: 'x', params: { 'not a name': 'a' } }), snapshot));
  assert.throws(() => validateAction(toast({ id: '', params: {} }), snapshot));
  assert.throws(() => validateAction(toast({ id: 'x', extra: 1 }), snapshot));
  // What the interface would not send (main refuses it) goes as plain text instead, so a toast is never lost for its id.
  const said = createSaid();
  said.note('long', 'x', { name: 'a'.repeat(5000) });
  assert.equal(withMessageIds(toastOf({ type: 'toast', text: 'long' }), text => said.find(text, 'en', () => [])).i18n, undefined);
});

test('the lookup remembers the last messages made with parameters and reads plain ones from the catalog in use', () => {
  const said = createSaid(2);
  said.note('one', 'a', { n: 1 }); said.note('two', 'b', { n: 2 }); said.note('three', 'c', { n: 3 });
  assert.equal(said.find('one', 'en', () => []), undefined, 'the oldest gave way');
  assert.deepEqual(said.find('three', 'en', () => []), { id: 'c', params: { n: 3 } });
  let reads = 0;
  const plain = () => { reads++; return [['m.copied', 'Kopiert'] as const]; };
  assert.deepEqual(said.find('Kopiert', 'de', plain), { id: 'm.copied' });
  said.find('Kopiert', 'de', plain);
  assert.equal(reads, 1, 'the catalog is read once per language');
});

test('texts made with parameters are kept for a moment only: what a person browses is not held (review, 4 Nov)', async () => {
  // Main's tm() also makes the page menu's "Search for “…”" with the selected text, and titles; a private window's among them.
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const clock = { now: () => now, later: (run: () => void, ms: number) => { timers.push({ at: now + ms, run }); } };
  const advance = (ms: number) => { const end = now + ms; for (let next; (next = timers.sort((a, b) => a.at - b.at)[0]) && next.at <= end;) { timers.shift(); now = next.at; next.run(); } now = end; };
  const said = createSaid(64, 2000, clock);
  said.note('Search for “a private thing”', 'pagemenu.searchFor', { text: 'a private thing' });
  advance(1500);
  said.note('New Tor circuit for example.org', 'tor.circuit.done', { site: 'example.org' });
  assert.deepEqual(said.find('Search for “a private thing”', 'en', () => []), { id: 'pagemenu.searchFor', params: { text: 'a private thing' } }, 'a toast sent in the same moment gets its id');
  advance(600);
  assert.equal(said.find('Search for “a private thing”', 'en', () => []), undefined, 'two seconds later it is gone');
  assert.equal(said.held(), 1, 'and swept: only the newer text is held');
  advance(2000);
  assert.equal(said.held(), 0, 'nothing is held once nothing new is made');
  assert.equal(timers.length, 0, 'and no timer is left waiting');
  // The real modules, in real time.
  mainI18n.setMainLocale('fr', 'en');
  const menu = mainI18n.tm('pagemenu.searchFor', { text: 'a private thing' });
  assert.deepEqual(mainI18n.saidAs(menu), { id: 'pagemenu.searchFor', params: { text: 'a private thing' } });
  await new Promise(done => setTimeout(done, 2100));
  assert.equal(mainI18n.saidAs(menu), undefined);
  mainI18n.setMainLocale('en', 'en');
  assert.match(read('src/i18n/index.ts'), /\nconst said = createSaid\(\);\n/);
  assert.match(read('src/i18n/main.ts'), /\nconst said = createSaid\(\);\n/);
});

test('a text two messages share gets no id: it could come back meaning the other one (review, 4 Nov)', async () => {
  const said = createSaid();
  assert.equal(said.find('Annuler', 'fr', () => [['toast.undo', 'Annuler'], ['dialog.cancel', 'Annuler'], ['app.addressCopied', 'Adresse copiée']] as const), undefined);
  assert.deepEqual(said.find('Adresse copiée', 'fr', () => []), { id: 'app.addressCopied' });
  // In French "Undo" and "Cancel" are both "Annuler": a toast's Undo keeps its word rather than coming back as "Cancel".
  await i18n.setLocale('fr');
  const undo = withMessageIds(toastOf({ type: 'toast', text: i18n.t('toast.bookmarkRemoved'), action: { label: i18n.t('toast.undo'), command: { type: 'bookmark.restore', nodes: [] } } }), i18n.saidAs);
  assert.equal(undo.i18n?.id, 'toast.bookmarkRemoved');
  assert.equal(undo.action?.labelId, undefined);
  await i18n.setLocale('en');
});

test('English text in an Arabic interface reads left to right, its full stop at its end; Arabic text is left as it is', () => {
  assert.equal(ownTextDirection('Example Site saved your file.', 'rtl'), 'ltr');
  assert.equal(ownTextDirection('تم حفظ الملف.', 'rtl'), undefined);
  assert.equal(ownTextDirection('تم حفظ Example.', 'rtl'), undefined, 'an Arabic sentence with an English name in it');
  assert.equal(ownTextDirection('Example Site saved your file.', 'ltr'), undefined, 'nothing changes in a left-to-right interface');
  const globals = globalThis as { document?: unknown };
  globals.document = { documentElement: { dir: 'rtl' } };
  try {
    assert.match(renderToStaticMarkup(createElement(ToastCard, { row: { key: 1, text: 'Example Site saved your file.' } })), /<span class="t-text" title="Example Site saved your file\." dir="ltr">/);
    assert.match(renderToStaticMarkup(createElement(ToastCard, { row: { key: 1, text: 'تم حفظ الملف.' } })), /<span class="t-text" title="تم حفظ الملف\.">/);
  } finally { delete globals.document; }
  assert.match(read('src/styles/transient.css'), /:root:root:root \.t-text\[dir='ltr'\] \{\n  text-align: end;\n\}/, 'it stays by the glyph, where the text was');
});
