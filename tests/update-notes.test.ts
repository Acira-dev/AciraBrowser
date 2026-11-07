import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// "What's new" in the update popups (beta.12): the items have room around them, and the whole list is shown (it was cut at 1000 characters;
// beta.11's notes were 1528), scrolling inside the popup when it is long.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const { NoteList, noteBlocks } = await import('../src/features/updates/NoteList');
const require = createRequire(import.meta.url);
const { notesText, NOTES_MAX } = require('../desktop/browser-services/app-updater.cjs');
const publish = require('../packaging/update-publish.cjs');
const read = (file: string) => readFileSync(file, 'utf8');

const beta11 = read('docs/launch/notes/0.1.0-beta.11.md');

test('each bullet is its own item; a wrapped line hangs under the words; a blank line leaves a little more room', () => {
  const blocks = noteBlocks('Heading line\n• One\n• Two\n\n• Three\nA closing sentence.');
  assert.deepEqual(blocks, [
    { kind: 'text', text: 'Heading line', gap: false },
    { kind: 'list', items: ['One', 'Two'], gap: false },
    { kind: 'list', items: ['Three'], gap: true },
    { kind: 'text', text: 'A closing sentence.', gap: false },
  ]);
  assert.deepEqual(noteBlocks(''), []);
  assert.deepEqual(noteBlocks('\n\n  \n'), []);
  assert.deepEqual(noteBlocks('•\n• Real'), [{ kind: 'list', items: ['Real'], gap: false }], 'an empty bullet is dropped');
});

test('notes are only ever rendered as text: markup in a note stays text', () => {
  const html = renderToStaticMarkup(createElement(NoteList, { notes: '• <b>bold</b> & <img src=x onerror=alert(1)>' }));
  assert.match(html, /<ul class="update-pop-list"><li>&lt;b&gt;bold&lt;\/b&gt; &amp; &lt;img src=x onerror=alert\(1\)&gt;<\/li><\/ul>/);
  assert.doesNotMatch(html, /<b>|<img/);
});

test('the whole of beta.11\'s notes (1528 characters) reach the popup: every bullet, nothing cut', () => {
  const plain = publish.releaseNotes(beta11).plain as string;
  assert.ok(plain.length > 1500, 'the notes that were cut at 1000: ' + plain.length);
  const shown = notesText(plain) as string;
  assert.ok(!shown.endsWith('…'), 'the list is not cut');
  const bullets = plain.split('\n').length;
  assert.equal(bullets, 13);
  const html = renderToStaticMarkup(createElement(NoteList, { notes: shown }));
  assert.equal((html.match(/<li>/g) || []).length, bullets, 'one list item for every note');
  assert.match(html, /Linux: Acira can match your system theme\. Plus smoother view switching and many smaller fixes\./, 'the last item is there');
});

test('the limit is one number in the app and in the publisher, far above a normal list; copies up to beta.11 are warned about', () => {
  assert.equal(publish.NOTES_MAX, NOTES_MAX);
  assert.ok(NOTES_MAX >= 4000, 'room for a long list: ' + NOTES_MAX);
  assert.equal(publish.NOTES_OLD_MAX, 1000, 'what the installed beta.11 shows');
  const script = read('scripts/publish-update.mjs');
  assert.match(script, /NOTES_OLD_MAX/);
  assert.match(script, /Copies of Acira up to beta\.11 show only the first/);
});

test('the notes box has room: items 8px apart, a hanging dot, 260px under the toolbar and up to 360px (half the window) when centred', () => {
  const css = read('src/features/updates/update-pill.css');
  assert.match(css, /\.update-pop-notes > :is\(ul, p\) \+ :is\(ul, p\) \{ margin-top: 8px; \}/);
  assert.match(css, /\.update-pop-list \{ list-style: none; display: grid; row-gap: 8px; \}/);
  assert.match(css, /\.update-pop-list > li::before \{ content: '•'; position: absolute; inset-inline-start: 0; \}/);
  assert.match(css, /\.update-popover \{ --notes-max: 260px; \}/);
  assert.match(css, /\.update-whatsnew \{ --notes-max: min\(360px, 56vh\); \}/);
  assert.match(css, /overflow-y: auto; max-height: var\(--notes-max\)/, 'a longer list scrolls inside the popup');
  assert.doesNotMatch(css, /white-space: pre-wrap/, 'the notes are items now, not one block of pre-wrapped text');
});
