// Real app: Recently closed (the browser menu's list, the Rewind log) puts a closed split pane back into its split, at its slot, linked again
// when it was a linked copy. Isolated profile under .qa-profiles, one Electron, off-screen and not focusable, no real mouse.
//   node qa/rewind-reopen-split.mjs [--shots dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const root = path.resolve(`.qa-profiles/rewind-reopen-split-${Date.now()}`);
await withSlot('rewind-reopen-split', async () => {
  const site = await httpFixture((req, res) => { const n = req.url.replace(/\W/g, '') || 'root'; res.writeHead(200, {'content-type': 'text/html'}); res.end(`<!doctype html><title>${n.toUpperCase()} page</title><body style="font:20px system-ui"><p>${n}`); });
  const base = `http://127.0.0.1:${site.port}`;
  const t = await startApp({root, skipSetup: true});
  try {
    await t.ui.locator('.setup-dialog').waitFor({state: 'hidden', timeout: 5000}).catch(() => {});
    await t.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { w.setFocusable(false); w.setIgnoreMouseEvents(true); } const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -20000, y: -20000, width: 1280, height: 900}); w.showInactive(); });
    await t.act({type: 'settings.update', patch: {onboardingComplete: true, language: 'en', appearance: 'light', interfaceScale: 100, verticalTabs: true}});
    const shot = async name => { if (!shots) return; await fs.mkdir(shots, {recursive: true}); await sleep(500); await t.ui.screenshot({path: path.join(shots, `${name}.png`), scale: 'css'}); };
    const idOf = async url => (await t.state()).tabs.find(tab => tab.url === `${base}${url}`)?.id;
    const split = async id => (await t.state()).windowUi.splitGroups?.find(group => group.tabIds.includes(id));
    const names = async group => { const s = await t.state(); return group.tabIds.map(id => s.tabs.find(tab => tab.id === id)?.url.replace(base, '')); };
    const overlay = () => t.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    const layout = () => t.ui.evaluate(() => window.acira.getBrowserLayout());
    /** Clicks a row of Recently closed the way a person does: the Acira menu, Recently closed, the row. */
    const reopenFromMenu = async title => {
      await t.ui.locator('[aria-label="Acira menu"]').filter({visible: true}).first().click();
      await poll(async () => (await layout())?.overlay?.kind === 'menu', Boolean, 'menu', 8000); await sleep(300);
      await poll(overlay, Boolean, 'overlay page', 8000);
      await overlay().locator('.menu-row', {hasText: 'Recently closed'}).first().click();
      await poll(async () => (await layout())?.overlay?.kind === 'recent-closed', Boolean, 'recent-closed', 8000); await sleep(400);
      await overlay().locator('.tab-result', {hasText: title}).first().click();
      await poll(async () => !(await layout())?.overlay, Boolean, 'popup closed', 8000);
    };

    // --- A: a pane of a three-pane split inside a group (middle pane), reopened from Recently closed -------------------------------
    for (const n of ['b', 'c', 'd']) await t.act({type: 'tab.new', url: `${base}/${n}`, background: true});
    await poll(async () => (await t.state()).tabs.length === 4, Boolean, 'four tabs');
    for (const n of ['b', 'c', 'd']) await t.act({type: 'tab.select', id: await idOf(`/${n}`)});
    await poll(async () => (await t.state()).tabs.filter(tab => /page$/.test(tab.title)).length >= 3, Boolean, 'titles', 15000).catch(() => {});
    const [b, c, d] = [await idOf('/b'), await idOf('/c'), await idOf('/d')];
    await t.act({type: 'tab.group.create', tabId: b, name: 'Research', color: 'purple'});
    const groupId = (await poll(async () => (await t.state()).tabGroups[0], Boolean, 'group')).id;
    await t.act({type: 'tab.group.assign', tabIds: [c, d], groupId});
    await t.act({type: 'tab.select', id: b});
    await t.act({type: 'split.open', tabIds: [b, c, d], layout: 'three-rows'});
    const before = await poll(() => split(c), Boolean, 'split exists');
    check(JSON.stringify(await names(before)) === '["/b","/c","/d"]' && before.layout === 'three-rows', 'precondition: b | c | d in one split, three-rows');
    await shot('A-before');
    await t.act({type: 'tab.close', id: c});
    await sleep(500);
    let s = await t.state();
    check(!s.tabs.some(tab => tab.id === c) && (await split(b)).tabIds.length === 2, 'c closed: the split shrank to b | d');
    const activeBefore = (await t.state()).activeTabId;
    await reopenFromMenu('C page');
    s = await poll(t.state, x => { const tab=x.tabs.find(tab=>tab.url===`${base}/c`); return tab?.group==='Research'&&x.windowUi.splitGroups?.some(split=>split.tabIds.includes(tab.id)&&split.tabIds.length===3); }, 'c and its split group restored', 8000);
    const c2 = s.tabs.find(tab => tab.url === `${base}/c`);
    const after = await split(c2.id);
    check(!!after && JSON.stringify(await names(after)) === '["/b","/c","/d"]', 'reopened c is back in its split at its slot (b | c | d), not appended: ' + JSON.stringify(after && await names(after)));
    check(after?.layout === 'three-rows' && after.id === before.id, 'the saved split and its three-rows layout are back');
    check(c2.group === 'Research', 'and it is in its group');
    // The split was on screen: it gains the pane in place (nothing else on screen changes). The pane's page may take the focus, as any pane of a split does.
    check(JSON.stringify(s.windowUi.split?.tabIds) === JSON.stringify([b, c2.id, d]) && s.windowUi.split.tabIds.includes(s.activeTabId), `the split on screen gained the pane in place (active ${activeBefore === s.activeTabId ? 'unchanged' : 'moved to the new pane'})`);
    await shot('A-after');
    // Toast says it came back with its split.
    const toast = (await t.state()).toast;
    check(/restored with its split/i.test(toast?.text || ''), 'the toast says "Restored with its split": ' + (toast?.text || 'no toast'));

    // --- B: a linked copy (a grouped tab dropped on a loose split) --------------------------------------------------------------------
    for (const n of ['p', 'q', 'g']) await t.act({type: 'tab.new', url: `${base}/${n}`, background: true});
    await poll(async () => (await t.state()).tabs.length === 7, Boolean, 'seven tabs');
    const [p, q, g] = [await idOf('/p'), await idOf('/q'), await idOf('/g')];
    await t.act({type: 'tab.group.create', tabId: g, name: 'Docs', color: 'blue'});
    await t.act({type: 'tab.select', id: p});
    await t.act({type: 'split.open', tabIds: [p, q]});
    const loose = await poll(() => split(p), Boolean, 'loose split');
    await t.act({type: 'split.group.add', id: loose.id, tabId: g});
    const linked = await poll(async () => { const x = await split(g); return x?.linked?.includes(g) ? x : null; }, Boolean, 'g is a linked copy');
    check(JSON.stringify(await names(linked)) === '["/p","/q","/g"]', 'precondition: g is a linked copy of the loose split p | q');
    await t.act({type: 'tab.close', id: g});
    await sleep(500);
    check(!(await split(p))?.tabIds.includes(g), 'g closed: out of the split');
    await reopenFromMenu('G page');
    s = await poll(t.state, x => x.tabs.some(tab => tab.url === `${base}/g`), 'g reopened', 8000);
    // Reopen creates the tab, restores its group, then rejoins its split in separate dispatches.
    s = await poll(t.state, x => { const tab=x.tabs.find(tab=>tab.url===`${base}/g`); return tab?.group==='Docs'&&x.windowUi.splitGroups?.some(split=>split.id===loose.id&&split.linked?.includes(tab.id)); }, 'linked pane and group restored', 8000);
    const g2 = s.tabs.find(tab => tab.url === `${base}/g`), back = await split(g2.id);
    check(!!back && back.id === loose.id && back.linked?.includes(g2.id), 'reopened g is a linked copy of the loose split again');
    check(g2.group === 'Docs', 'and is still in its group Docs');
    check(!!back && JSON.stringify(await names(back)) === '["/p","/q","/g"]', 'at its slot: ' + JSON.stringify(back && await names(back)));
    await shot('B-after');

    // --- C: a partner that is gone: the tab comes back alone ---------------------------------------------------------------------------
    await t.act({type: 'tab.close', id: p});
    await t.act({type: 'tab.close', id: q});
    await t.act({type: 'tab.close', id: g2.id});
    await sleep(500);
    check(!(await t.state()).tabs.some(tab => [q, g2.id].includes(tab.id)), 'precondition: the other panes are closed too');
    await reopenFromMenu('P page');
    s = await poll(t.state, x => x.tabs.some(tab => tab.url === `${base}/p`), 'p reopened', 8000);
    check(!(await split(s.tabs.find(tab => tab.url === `${base}/p`).id)), 'p reopened alone: its partners are not open, so no split is made');
  } finally { await t.close(); await site.close(); }
});
