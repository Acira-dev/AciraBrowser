import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { selectStripTab, toggleSolo } from '../src/ui/splitPaneSelect';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

/** 29 Oct, founder: in a split card a click on a pane row must show that pane's split focused on it, and a click on the card header (or on the pane's
 *  Show split view button) must bring a split back that was opened alone. The model half of qa/split-pane-click.mjs (real native input) and
 *  qa/split-dead-pane.mjs (the pane whose page was gone). docs/launch/SPLIT_IN_GROUPS.md, "One tab by itself". */
const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
/** What the sidebar does for a click on a pane row: the dispatches of selectStripTab applied one after the other. */
const click = (state: BrowserSnapshot, tabId: string, splitId: string) => { let s = state; selectStripTab(s, action => { s = reduceBrowser(s, action); }, tabId, { id: splitId }); return s; };
const solo = (state: BrowserSnapshot, tabId: string, splitId: string) => { let s = state; toggleSolo(s, action => { s = reduceBrowser(s, action); }, tabId, { id: splitId }); return s; };
const shown = (s: BrowserSnapshot, splitId: string) => s.windowUi.split?.groupId === splitId;

function world() {
  let s = createInitialState();
  for (const url of ['https://mail.test/', 'https://yt.test/', 'https://maps.test/', 'https://news.test/']) s = reduceBrowser(s, { type: 'tab.new', url, background: true });
  const [home, mail, yt, maps, news] = s.tabs.map(tab => tab.id);
  return { s, home, mail, yt, maps, news };
}

for (const kind of ['loose', 'in a tab group', 'with a linked copy'] as const) {
  test(`split card (${kind}): a pane row, the header and Show split view all bring the split back after a pane was opened alone`, () => {
    const { s: start, home, mail, yt, maps, news } = world();
    let s = start, a = mail, b = yt;
    if (kind === 'in a tab group') {
      s = run(s, { type: 'tab.group.create', tabId: mail, name: 'Research', color: 'blue' });
      s = run(s, { type: 'tab.group.assign', tabIds: [yt], groupId: s.tabGroups[0].id });
    }
    s = run(s, { type: 'tab.select', id: a }, { type: 'split.open', tabIds: [a, b] });
    const split = s.windowUi.splitGroups!.find(group => group.tabIds.includes(a))!.id;
    if (kind === 'with a linked copy') {
      s = run(s, { type: 'tab.group.create', tabId: news, name: 'Leisure', color: 'green' }, { type: 'split.group.add', id: split, tabId: news });
      assert.ok(s.windowUi.splitGroups!.find(group => group.id === split)!.linked?.includes(news), 'News is a linked copy of the split');
      b = news;
    }
    // Plain: each pane row shows the split focused on that pane.
    for (const id of [b, a, b]) { s = click(s, id, split); assert.ok(shown(s, split) && s.activeTabId === id, `a click on ${id} keeps the split on screen, focused on it`); }
    // A pane opened alone, then the other pane's row.
    s = run(s, { type: 'tab.select', id: b, individual: true });
    assert.equal(s.windowUi.split, null); assert.equal(s.activeTabId, b);
    s = click(s, a, split);
    assert.ok(shown(s, split) && s.activeTabId === a, 'alone, then the other pane row brings the split back, focused on it');
    // A pane opened alone, then the card header (split.group.select).
    s = run(s, { type: 'tab.select', id: b, individual: true });
    s = run(s, { type: 'split.group.select', id: split });
    assert.ok(shown(s, split) && s.activeTabId === b, 'alone, then the header brings the split back (the pane stays current)');
    // Open alone ⇄ Show split view, and the pane's own row.
    s = solo(s, b, split); assert.equal(s.windowUi.split, null);
    s = solo(s, b, split); assert.ok(shown(s, split), 'Show split view');
    s = solo(s, b, split); s = click(s, b, split); assert.ok(shown(s, split) && s.activeTabId === b, 'the pane\'s own row');
    void home; void maps;
  });
}

test('seeded walk: after any mix of splits, groups, closes, Undo and Open alone, every pane row and every header still works', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
  let checked = 0;
  for (let round = 0; round < 60; round++) {
    let s = createInitialState();
    for (let i = 0; i < 5; i++) s = reduceBrowser(s, { type: 'tab.new', url: `https://t${i}.test/`, background: true });
    for (let step = 0; step < 22; step++) {
      const ids = s.tabs.map(tab => tab.id), splits = s.windowUi.splitGroups ?? [], op = Math.floor(rnd() * 12);
      if (op === 0 && ids.length > 2) { const a = pick(ids), b = pick(ids.filter(id => id !== a)); s = run(s, { type: 'tab.select', id: a }, { type: 'split.open', tabIds: [a, b] }); }
      else if (op === 1) s = run(s, { type: 'tab.select', id: pick(ids) });
      else if (op === 2) s = run(s, { type: 'tab.select', id: pick(ids), individual: true });
      else if (op === 3 && ids.length > 3) s = run(s, { type: 'tab.close', id: pick(ids) });
      else if (op === 4) s = run(s, { type: 'tab.restore' });
      else if (op === 5 && splits.length) { const g = pick(splits), t = pick(ids.filter(id => !g.tabIds.includes(id))); if (t) s = run(s, { type: 'split.group.add', id: g.id, tabId: t }); }
      else if (op === 6 && splits.length) s = run(s, { type: 'split.separate', tabId: pick(pick(splits).tabIds) });
      else if (op === 7) s = run(s, { type: 'tab.group.create', tabId: pick(ids), name: 'G' + step, color: 'blue' });
      else if (op === 8 && s.tabGroups.length) s = run(s, { type: 'tab.group.assign', tabIds: [pick(ids)], groupId: pick(s.tabGroups).id });
      else if (op === 9) s = run(s, { type: 'tab.new', url: `https://n${step}.test/`, background: true });
      else if (op === 10 && splits.length) s = run(s, { type: 'split.group.select', id: pick(splits).id });
      else if (op === 11 && s.tabGroups.length) s = run(s, { type: 'tab.group.assign', tabIds: [pick(ids)], groupId: null });
      for (const g of s.windowUi.splitGroups ?? []) for (const id of g.tabIds) {
        checked++;
        const clicked = click(s, id, g.id);
        assert.ok(shown(clicked, g.id) && clicked.activeTabId === id, `a click on a pane row: split ${g.id} on screen, active ${id}`);
        const alone = run(s, { type: 'tab.select', id, individual: true });
        assert.ok(shown(run(alone, { type: 'split.group.select', id: g.id }), g.id), 'the header brings the split back');
        const other = g.tabIds.find(x => x !== id);
        if (other) { const back = click(alone, other, g.id); assert.ok(shown(back, g.id) && back.activeTabId === other, 'alone, then the other pane row'); }
      }
    }
  }
  assert.ok(checked > 1000, `the walk reached ${checked} split states`);
});

test('a pane whose tab is gone leaves its split (the reducer treats a pane without a tab as closed)', () => {
  const { s: start, mail, yt } = world();
  let s = run(start, { type: 'tab.select', id: mail }, { type: 'split.open', tabIds: [mail, yt] });
  s = run(s, { type: 'tab.close', id: yt });
  assert.equal(s.windowUi.splitGroups?.some(group => group.tabIds.includes(yt)) ?? false, false);
  assert.equal(s.windowUi.split?.tabIds.includes(yt) ?? false, false);
  assert.ok(s.tabs.some(tab => tab.id === mail));
});

test('main drops a page whose contents are gone before anything walks the pages (the dead Gmail sign-in tab in a split made every click throw)', () => {
  const main = read('desktop/main.cjs');
  const at = main.indexOf('function reapDeadPages(){');
  assert.ok(at > 0, 'reapDeadPages exists');
  const body = main.slice(at, main.indexOf('\n', at));
  assert.ok(/const wc=entry\.view\?\.webContents;if\(wc&&!wc\.isDestroyed\(\)\)continue;/.test(body), 'an entry whose view has no webContents (or destroyed ones) is the case');
  assert.ok(body.includes('entry.closing||entry.discarding'), 'a close or a sleep in progress is left to closePage');
  assert.ok(body.includes('pages.delete(id)') && body.includes('removePageView(entry)'), 'the entry and its view leave at once');
  assert.ok(body.includes("dispatch({type:'tab.close',id})"), 'and the tab is closed, so a split it was in loses the pane');
  for (const walker of ['function syncPages(){if(!mainWindow||!pagesAllowed)return;securedPages.reconcile(state);reapDeadPages();', "function applyLayout(next,opts){startupTrace.mark('first-layout');reapDeadPages();"])
    assert.ok(main.includes(walker), `${walker.slice(0, 30)}… reaps first`);
});

test('the pane ribbon Reload: command shape, markup and the hover rule', () => {
  const { validateCommand } = require('../desktop/validation.cjs') as { validateCommand: (input: unknown, snapshot?: unknown) => Record<string, unknown> };
  const { s } = world(), tabId = s.tabs[1].id;
  assert.deepEqual(validateCommand({ type: 'reload', tabId }, s), { type: 'reload', tabId });
  assert.deepEqual(validateCommand({ type: 'reload', tabId, ignoreCache: true }, s), { type: 'reload', tabId, ignoreCache: true });
  assert.throws(() => validateCommand({ type: 'reload', tabId, ignoreCache: 'yes' }, s), /boolean/);
  assert.throws(() => validateCommand({ type: 'back', tabId, ignoreCache: true }, s), /unsupported|ignoreCache/i);
  assert.ok(read('desktop/main.cjs').includes("if(c.ignoreCache)wc.reloadIgnoringCache();else wc.reload();"), 'main hard-reloads the page for ignoreCache');
  const ribbon = read('src/components/SplitRibbon.tsx');
  assert.ok(ribbon.includes("className=\"icon-button split-label-reload\"") && ribbon.includes("tab.contentKind === 'web'"), 'a Reload button on a web pane\'s ribbon');
  assert.ok(ribbon.includes("controlTitle(t('app.reloadPage'))") && ribbon.includes("event.shiftKey ? { ignoreCache: true } : {}"), "the app's Reload label with its live shortcut; Shift ignores the cache");
  assert.ok(ribbon.indexOf('split-label-reload') < ribbon.indexOf('split-label-close'), 'it sits left of the ×');
  assert.ok(read('src/App.tsx').includes("closest?.('.split-label-close,.split-label-reload')"), 'the Reload does not make its pane current first (like the ×)');
  const css = read('src/features/split/split.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.split-label>\.split-label-reload\.icon-button\{flex:0 0 20px;width:20px;min-width:20px;height:20px;[^}]*opacity:0;[^}]*transition:opacity calc\(160ms\*var\(--motion-scale,1\)\) ease-out/.test(css), 'a 20px slot that keeps its place at rest and fades on the ribbon timing');
  assert.ok(/\.split-label:is\(:hover,:focus-within\)>\.split-label-reload\.icon-button[^{]*\{opacity:1\}/.test(css), 'shown while the pointer or a key is on the ribbon');
});
