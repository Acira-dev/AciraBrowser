import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addSites, hostOf, parseSites, removeSite, siteLimit } from '../src/features/settings/siteList';

// R3-56: "Never put these sites to sleep" is a list editor (add field, rows, remove ×), not a textarea.
test('a typed address, URL or wildcard all mean the host; anything else is refused', () => {
  assert.equal(hostOf('mail.example.com'), 'mail.example.com');
  assert.equal(hostOf('  HTTPS://Mail.Example.com/inbox?x=1#y '), 'mail.example.com');
  assert.equal(hostOf('*.example.com'), 'example.com');
  assert.equal(hostOf('example.com:8080/path'), 'example.com');
  assert.equal(hostOf('localhost'), 'localhost');
  for (const bad of ['', '   ', 'not a site!', 'mail', 'exa mple.com', '-bad.example', 'bad-.example', 'a..b', 'https://', 'x'.repeat(260) + '.com']) assert.equal(hostOf(bad), '', JSON.stringify(bad));
});

test('several sites can be typed or pasted at once; duplicates collapse, words that are not sites are dropped', () => {
  assert.deepEqual(parseSites('a.com, b.com\nA.COM;https://c.com/x'), ['a.com', 'b.com', 'c.com']);
  assert.deepEqual(parseSites('hello world'), [], 'a phrase is not a list of sites');
});

test('add: new sites are appended in order; duplicates and invalid input change nothing and say why', () => {
  const list = ['mail.example.com'];
  assert.deepEqual(addSites(list, 'docs.example.com'), { next: ['mail.example.com', 'docs.example.com'], result: 'added' });
  assert.deepEqual(addSites(list, 'MAIL.example.com'), { next: list, result: 'duplicate' });
  assert.deepEqual(addSites(list, 'not a site!'), { next: list, result: 'invalid' });
  assert.deepEqual(addSites(list, ''), { next: list, result: 'invalid' });
  assert.deepEqual(addSites(list, 'mail.example.com, new.example.com').next, ['mail.example.com', 'new.example.com'], 'the known one is skipped, the new one added');
  assert.equal(list.length, 1, 'the input list is never mutated');
});

test('add: the list is bounded at 100 and tells the user it is full', () => {
  const full = Array.from({ length: siteLimit }, (_, index) => `s${index}.example.com`);
  assert.deepEqual(addSites(full, 'one-more.example.com'), { next: full, result: 'full' });
  const almost = full.slice(0, siteLimit - 1);
  assert.equal(addSites(almost, 'a.com, b.com, c.com').next.length, siteLimit, 'a paste past the limit is cut at the limit');
});

test('remove drops exactly that site and keeps the order of the rest', () => {
  assert.deepEqual(removeSite(['a.com', 'b.com', 'c.com'], 'b.com'), ['a.com', 'c.com']);
  assert.deepEqual(removeSite(['a.com'], 'z.com'), ['a.com']);
});

test('the memory saver panel uses the list editor with a short helper line and the long exceptions in the (i) tooltip', () => {
  const panel = fs.readFileSync('src/features/settings/panels/memory-saver.tsx', 'utf8');
  assert.match(panel, /<SiteListEditor /);
  assert.doesNotMatch(panel, /<textarea/);
  assert.match(panel, /info=\{t\("memorySaver\.callsChatAndMusicSites"\)\}/);
  assert.doesNotMatch(panel, /<SettingNote>/, 'no wall of grey text under the control');
  const css = fs.readFileSync('src/features/settings/site-list.css', 'utf8');
  assert.doesNotMatch(css, /monospace|Geist Mono/i, 'normal UI font');
  assert.match(css, /\.sl-list > li \{[^}]*padding: 0 6px 0 12px/, 'rows keep text 12px from the edge');
});
