import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 13.5 (hunt-c H, 9): popups were laid out with physical left and right, so in Arabic (a right-to-left interface) a row's text started at the left edge
// while its icon sat on the right, notes were indented on the wrong side, and the library's bookmark folders nested towards the wrong edge. The popup,
// Tor panel, update pill, library and downloads/update panel rules now say start and end. In English every one of them computes to what it did before
// (the pictures in the 13.5 interface report are the proof); this test keeps a physical side from creeping back into these files.
const FILES = ['../src/styles/panels.css', '../src/features/tor/tor.css', '../src/features/updates/update-pill.css', '../src/features/library.css', '../src/features/downloads-panel.css'];
// What stays physical on purpose: the Tor chip and the onion chip are toolbar items (not panel rows), and the caret is a centred rotated square.
const ALLOWED: [file: string, selector: string, property: string][] = [
  ['panels.css', '.popup-content-menu::after', 'margin-left'], // the menu's scroll cue: `left: 50%; margin-left: -3px`, centred on a rotated square
  ['tor.css', '.tor-chip', 'margin'], ['tor.css', '.tor-chip', 'padding'], ['tor.css', '.tor-chip[data-matrix=off]', 'padding-left'], ['tor.css', '.tor-chip-mark', 'margin-right'],
  ['tor.css', '.tor-onion-chip', 'margin'], ['tor.css', '.tor-onion-chip', 'padding'],
];
function rules(css: string) {
  const found: { selector: string; decl: [string, string][] }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const decl = m[2].split(';').map(part => part.trim()).filter(Boolean).map(part => { const at = part.indexOf(':'); return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()] as [string, string]; });
    found.push({ selector, decl });
  }
  return found;
}
const values = (value: string) => value.replace(/\([^)]*\)/g, match => match.replace(/\s+/g, '')).split(/\s+/);
function physical(file: string, css: string): string[] {
  const bad: string[] = [];
  for (const { selector, decl } of rules(css)) for (const [property, value] of decl) {
    const allowed = ALLOWED.some(([f, s, p]) => file.endsWith(f) && selector.includes(s) && p === property);
    if (allowed) continue;
    if (property === 'text-align' && /^(left|right)$/i.test(value)) bad.push(`${selector} { ${property}: ${value} }`);
    else if (/^(margin|padding)-(left|right)$/.test(property)) bad.push(`${selector} { ${property}: ${value} }`);
    else if ((property === 'margin' || property === 'padding') && values(value).length === 4 && values(value)[1] !== values(value)[3]) bad.push(`${selector} { ${property}: ${value} }`);
    else if (/^border-(left|right)(-|$)/.test(property) && !(selector.includes('.popup-content-menu::after') && property === 'border-right')) bad.push(`${selector} { ${property}: ${value} }`);
  }
  return bad;
}

test('popup, Tor panel, update pill, library and downloads/update panel rules use start and end, not left and right', () => {
  for (const file of FILES) assert.deepEqual(physical(file, readFileSync(new URL(file, import.meta.url), 'utf8')), [], file);
});

test('every popup menu row starts its text at the interface’s start edge', () => {
  const panels = rules(readFileSync(new URL('../src/styles/panels.css', import.meta.url), 'utf8'));
  const row = panels.find(rule => rule.selector === '.acira-menu-row')!;
  assert.deepEqual(row.decl.find(([property]) => property === 'text-align'), ['text-align', 'start']);
});

test('the places a bookmark folder indents and the update pill’s two paddings follow the reading direction', () => {
  const library = readFileSync(new URL('../src/features/library.css', import.meta.url), 'utf8');
  assert.match(library, /\.bm-node \{[^}]*padding-inline-start: calc\(8px \+ var\(--depth, 0\) \* 14px\)/);
  assert.match(library, /\.bm-edit-option \{[^}]*padding-inline-start: calc\(8px \+ var\(--depth, 0\) \* 14px\)/);
  const pill = readFileSync(new URL('../src/features/updates/update-pill.css', import.meta.url), 'utf8');
  assert.match(pill, /\.app \.update-pill \{[^}]*margin-inline: 2px 4px;[^}]*padding-inline: 7px 10px;/);
  const tor = readFileSync(new URL('../src/features/tor/tor.css', import.meta.url), 'utf8');
  assert.match(tor, /\.tor-hop:not\(:last-child\)::after\{[^}]*inset-inline-start:7\.25px/);
});
