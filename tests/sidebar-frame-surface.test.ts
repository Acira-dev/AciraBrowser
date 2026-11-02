// Founder P0, 27 Oct: "the sidebar and the toolbar don't match colors". With the sidebar standing in its column the toolbar sits
// clear on the same frame (one surface); the raised toolbar surface (--tab-surface: white .10 on dark chrome, .92 on light) is only
// for a window without the sidebar. The cause: every "sidebar on the frame" rule (frame.css, sidebar.css, toolbar-controls.css) and
// App's page card read `.ed-rail.is-expanded:not(.is-peek)`, so a sidebar peeking from the left edge in Full and Compact (which takes
// the docked column) kept the raised toolbar beside it: a lighter, greyer band, ΔE ≈ 7 on real pixels. In Seamless the floating
// toolbar slab stacked the same raised layer over its own finish while the floating sidebar card did not.
// Real-pixel check: node qa/colour-frame-match.mjs <label> [100|150] [founder|states|matrix].
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sidebarOnFrame } from '../src/ui/layoutMode';
import type { BrowserSnapshot } from '../src/runtime/types';

const css = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** [selector, declarations] for every style rule (at-rule preludes and nesting are not used in these files' relevant rules). */
const rules = (file: string) => [...css(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]] as const);
/** Top-level comma split (commas inside :is()/:not()/:has() stay). */
function splitList(list: string): string[] {
  const out: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) { const c = list[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) { out.push(list.slice(start, i).trim()); start = i + 1; } }
  out.push(list.slice(start).trim()); return out;
}
/** Selectors Level 4 specificity [ids, classes/attributes/pseudo-classes, types]; :is/:not/:has take their most specific argument, :where none. */
function specificity(selector: string): [number, number, number] {
  let a = 0, b = 0, c = 0, i = 0;
  const s = selector;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else if (ch === '.') { b++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else if (ch === '[') { b++; i = s.indexOf(']', i) + 1; }
    else if (ch === ':' && s[i + 1] === ':') { c++; i += 2; while (i < s.length && /[\w-]/.test(s[i])) i++; if (s[i] === '(') { let d = 1; i++; while (i < s.length && d) { if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; } } }
    else if (ch === ':') {
      i++; let name = ''; while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
      if (s[i] === '(') {
        let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
        const inner = s.slice(i + 1, j - 1); i = j;
        if (['is', 'not', 'has'].includes(name)) { const best = splitList(inner).map(x => specificity(x.replace(/^[>+~]\s*/, ''))).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]).at(-1)!; a += best[0]; b += best[1]; c += best[2]; }
        else if (name !== 'where') b++;
      } else b++;
    }
    else if (/[a-zA-Z]/.test(ch)) { c++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else i++;
  }
  return [a, b, c];
}
const outranks = (x: [number, number, number], y: [number, number, number]) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

const frameFiles = ['styles/frame.css', 'components/sidebar/sidebar.css', 'styles/toolbar-controls.css'];

test('every "sidebar on the frame" rule counts a peek in the column and leaves a floating peek out', () => {
  let found = 0;
  for (const file of frameFiles) for (const [list] of rules(file)) for (const selector of splitList(list)) {
    if (!/:has\(\s*>\s*\.ed-rail\.is-expanded/.test(selector)) continue;
    found++;
    assert.doesNotMatch(selector, /\.is-expanded:not\(\.is-peek\)/, `${file}: a peeking sidebar takes the docked column in Full and Compact, so it is on the frame too:\n  ${selector}`);
    const root = selector.split(' .app')[0];
    assert.ok(/^(?::root|html)/.test(root) && root.includes(':not([data-edge-float])'), `${file}: only a floating peek (Seamless, [data-edge-float]) is a card of its own; guard the root:\n  ${selector}`);
  }
  assert.ok(found >= 10, `expected the frame, toolbar, bookmarks row and page card rules (found ${found})`);
});

test('with the sidebar on the frame the toolbar is clear, and that rule outranks the raised toolbar surface', () => {
  const raised = rules('styles/toolbar-controls.css').filter(([list, body]) => /background:\s*var\(--tab-surface\)/.test(body) && splitList(list).some(s => /\.browser-shell\s*>\s*\.browser-toolbar\.acira-persistent-toolbar$/.test(s)));
  assert.ok(raised.length, 'the raised toolbar rule exists');
  const clear = rules('components/sidebar/sidebar.css').filter(([list, body]) => /background:\s*transparent/.test(body) && /\.ed-rail\.is-expanded/.test(list) && /\.browser-toolbar\.acira-persistent-toolbar/.test(list));
  assert.equal(clear.length, 1, 'one rule clears the toolbar in sidebar mode');
  const top = raised.flatMap(([list]) => splitList(list).map(specificity)).sort(outranks).at(-1)!;
  for (const s of splitList(clear[0][0])) assert.ok(outranks(specificity(s), top) > 0, `sidebar-mode clear toolbar ${specificity(s)} must outrank the raised surface ${top}`);
  // The bookmarks row joins the frame the same way.
  assert.ok(rules('styles/toolbar-controls.css').some(([list, body]) => /\.acira-bookmarks-row/.test(list) && /\.ed-rail\.is-expanded\)/.test(list) && /background:\s*transparent/.test(body)));
});

test('Seamless: the floating toolbar slab carries no raised layer in the vertical layout, so it matches the floating sidebar card', () => {
  const seamless = rules('styles/seamless.css');
  const slab = seamless.filter(([list, body]) => /\[data-edge-float\]/.test(list) && /\.browser-shell\[data-seamless='shown'\]$/.test(splitList(list)[0]) && /background:/.test(body));
  const card = seamless.filter(([list, body]) => /\[data-edge-float\]/.test(list) && /\.ed-rail\.is-peek$/.test(splitList(list)[0]) && /background:/.test(body));
  assert.ok(slab.length >= 2 && card.length >= 2, 'slab and card finishes for light and dark chrome');
  // Same finish recipe (sidebar colour falls back to the chrome colour; no sidebar colour = the same value).
  const recipe = (body: string) => /background:\s*([^;!]+)/.exec(body)![1].replace(/rgb\(var\(--sidebar-rgb, var\(--chrome-rgb\)\)\)/g, 'rgb(var(--chrome-rgb))').replace(/\s+/g, ' ').trim();
  assert.deepEqual(slab.map(([, body]) => recipe(body)), card.map(([, body]) => recipe(body)));
  const clear = seamless.filter(([list, body]) => /\[data-edge-float\]/.test(list) && /\.side-tabs/.test(list) && /\.browser-toolbar\.acira-persistent-toolbar/.test(list) && /background:\s*transparent/.test(body));
  assert.equal(clear.length, 1, 'one rule clears the toolbar rows on the slab');
  assert.match(clear[0][0], /:not\(\[data-toolbar-color\]\)/, 'a toolbar colour of its own still paints the toolbar');
  const raised = rules('styles/toolbar-controls.css').filter(([list, body]) => /background:\s*var\(--tab-surface\)/.test(body) && /\.browser-toolbar\.acira-persistent-toolbar$/.test(list)).flatMap(([list]) => splitList(list).map(specificity)).sort(outranks).at(-1)!;
  for (const s of splitList(clear[0][0])) assert.ok(outranks(specificity(s), raised) > 0, `slab clear ${specificity(s)} must outrank ${raised}`);
});

test('App and CSS agree on when the sidebar is on the frame (page card, caption colour)', () => {
  const state = (verticalTabs: boolean, open: boolean) => ({
    settings: { verticalTabs }, windowUi: { focusMode: false, workspaceOpen: open, webWorkspaceOpen: open, split: null },
    activeTabId: 't1', tabs: [{ id: 't1', contentKind: 'web', url: 'https://example.com/' }],
  }) as unknown as BrowserSnapshot;
  assert.equal(sidebarOnFrame(state(true, true), { side: false }, false), true, 'docked open');
  assert.equal(sidebarOnFrame(state(true, false), { side: true }, false), true, 'peeking in its column (Full, Compact, a pinned Seamless edge)');
  assert.equal(sidebarOnFrame(state(true, false), { side: true }, true), false, 'a floating peek is its own card');
  assert.equal(sidebarOnFrame(state(true, false), { side: false }, false), false, 'closed');
  assert.equal(sidebarOnFrame(state(false, false), { side: true }, false), false, 'tabs in the strip: no sidebar');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal((app.match(/sidebarOnFrame\(state, edge, false\)/g) || []).length, 3, 'card inset, page radius and caption colour retain the connected frame in every view');
  assert.doesNotMatch(app, /cardInset:[^,]*sidebarControl\(state\)\.open/, 'the card inset must not ignore a peek in the column');
});
