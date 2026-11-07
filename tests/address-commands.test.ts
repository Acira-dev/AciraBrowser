import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInitialState, makeTab } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';
import { addressCommandListed, matchCommands, type AddressCommand } from '../src/ui/addressCommands';
import { addressCompletion, rankAddressSuggestions } from '../src/ui/addressSuggestions';

// Founder (6 Nov, Zia research idea 5): the address list offers commands by strict word-start matching, also by initials, in the
// language in use and in English; the typed row stays first, so Enter on a URL or a search does what it always did.
const catalog = (lang: string) => JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const en = catalog('en');
const ids = Object.keys(en).filter(key => key.startsWith('shortcutCmd.')).map(key => key.slice('shortcutCmd.'.length)).filter(id => addressCommandListed(id) && !/\{/.test(en[`shortcutCmd.${id}`]));
/** The registry as the list sees it: every command's name in `lang` and in English. */
const registry = (lang = 'en'): AddressCommand[] => { const own = catalog(lang); return ids.map(id => ({ id, name: own[`shortcutCmd.${id}`] ?? en[`shortcutCmd.${id}`], names: [...new Set([own[`shortcutCmd.${id}`], en[`shortcutCmd.${id}`]])] })); };
const found = (query: string, lang = 'en') => matchCommands(query, registry(lang)).map(command => command.id);

test('a command is found by the start of its words, the best match first', () => {
  assert.equal(found('sett')[0], 'settings');
  assert.equal(found('Settings')[0], 'settings');
  assert.equal(found('hist')[0], 'history');
  assert.equal(found('split v')[0], 'split-view');
  assert.equal(found('reader')[0], 'reader-mode');
  assert.equal(found('clear brow')[0], 'clear-data');
  assert.deepEqual(found('reopen closed'), ['reopen-tab']);
});

test('also by initials: three letters begin them, two must be all of them', () => {
  assert.deepEqual(found('rct'), ['reopen-tab']);
  assert.ok(found('npw').includes('private-window'), 'New private window');
  assert.ok(found('cbd').includes('clear-data'), 'Clear browsing data');
  assert.deepEqual(found('rt'), [], 'two letters that only begin the initials ("Reopen closed tab") are not enough');
});

test('strict: the middle of a word, a wrong order, one letter or an address never matches', () => {
  for (const text of ['ttings', 'eload', 'window new', 'closed reopen', 's', '', ' ', 'settings.com', 'http://settings', 'history/today', 'user@history', 'sett ings']) assert.deepEqual(found(text), [], JSON.stringify(text));
});

test('at most two commands, and none of the keyboard-only or positional ones', () => {
  assert.ok(found('tab').length <= 2);
  for (const id of ['tab-switcher', 'select-tab-3', 'select-last-tab', 'next-tab', 'prev-tab', 'address', 'menu', 'command-palette', 'run-routine', 'find-next']) assert.equal(addressCommandListed(id), false, id);
  for (const id of ['settings', 'history', 'split-view', 'new-tab', 'close-tab', 'reader-mode', 'rewind']) assert.equal(addressCommandListed(id), true, id);
});

test('matched in the language in use and in English: both find the same command', () => {
  for (const lang of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const own = catalog(lang)['shortcutCmd.settings'], typed = [...own.normalize('NFKC')].slice(0, Math.min(3, [...own].length)).join('');
    assert.ok(found(typed, lang).includes('settings'), `${lang}: "${typed}" finds Settings`);
    assert.ok(found('sett', lang).includes('settings'), `${lang}: English still finds it`);
    assert.ok(registry(lang).every(command => command.name.length > 0), `${lang}: every command has a name`);
  }
});

test('every command has its name in all 13 catalogs', () => {
  for (const lang of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const own = catalog(lang);
    for (const key of Object.keys(en).filter(key => key.startsWith('shortcutCmd.'))) assert.ok(own[key], `${lang} ${key}`);
  }
});

const state = (): BrowserSnapshot => { const initial = createInitialState(); return { ...initial, tabs: [makeTab('home', 'https://start.test/', undefined, initial.activeBrowserProfileId)], activeTabId: 'home' }; };
const rows = (query: string, commands = registry()) => rankAddressSuggestions(query, state(), 8, { commands, now: new Date('2026-11-06T12:00:00Z') });

test('the typed row stays first for a command word: Enter still searches what was typed', () => {
  const list = rows('sett');
  assert.equal(list[0].kind, 'search'); assert.equal(list[0].title, 'sett');
  assert.equal(list[1].kind, 'command'); assert.equal(list[1].commandId, 'settings'); assert.equal(list[1].title, 'Settings');
  assert.equal(list[1].url, '');
});

test('an answer comes first, then the typed row (which is still what Enter opens when the person moves down)', () => {
  const list = rows('12*14');
  assert.deepEqual([list[0].kind, list[0].title, list[0].copy], ['answer', '168', '168']);
  assert.equal(list[1].kind, 'search'); assert.equal(list[1].title, '12*14');
});

test('URLs and ordinary searches get no extra rows and keep the order they had', () => {
  for (const query of ['example.com', 'https://example.com/a?b=1', 'localhost:3000', 'how to tie a tie', 'youtube', '1/2/2024', '555-1234', '2024-11-06', 'weather tomorrow', 'a.b/sett']) {
    const list = rows(query), plain = rankAddressSuggestions(query, state());
    assert.ok(list.every(row => row.kind !== 'answer' && row.kind !== 'command'), query);
    assert.deepEqual(list, plain, query + ': the same rows as without the extras');
    assert.ok(['url', 'search'].includes(list[0].kind), query);
  }
});

test('an empty field shows no extra rows, and the list never grows past eight', () => {
  assert.ok(rows('').every(row => row.kind !== 'answer' && row.kind !== 'command'));
  assert.ok(rows('tab').length <= 8);
});

test('Tab never completes an answer or a command into the field', () => {
  assert.equal(addressCompletion('12*14', rows('12*14')[0]), null);
  assert.equal(addressCompletion('sett', rows('sett')[1]), null);
});

test('the address field runs a command or copies an answer, and never navigates to one', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const chooseSuggestion = \(item: AddressSuggestion, switchToTab = false\) => \{ if \(runAddressRow\(item, dispatch\)\) \{ setOverlay\(null\); addressRef\.current\?\.blur\(\); return; \}/, 'Enter and a click in the toolbar');
  assert.match(app, /onChoose=\{\(item, switchToTab\) => \{ if \(!runAddressRow\(item, dispatch\)\)\s+dispatch\(addressSuggestionAction/, 'a click in the list the native overlay draws');
  assert.match(app, /rankAddressSuggestions\(address, state, 8, \{ commands: addressCommands \}\)/);
  assert.match(app, /rankAddressSuggestions\(query, state, 8, \{ commands \}\)/, 'the overlay ranks the same rows the field does, so the highlighted index means the same row in both');
  const rowsModule = readFileSync(new URL('../src/ui/addressRows.ts', import.meta.url), 'utf8');
  assert.match(rowsModule, /type: 'shortcuts\.run', id/, 'a command runs through the registry, as in the command bar');
  assert.match(rowsModule, /copyText\(text\)/);
});
