// Stream D: right-click menus offer the right items per target and their handlers act on the right page.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-context'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title><a id=l href="/linked">a link</a><input id=t value="teh quik"><p id=p>selected words here</p>`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
try {
  await app.act({type: 'tab.new', url: base + '/one'}); const page = await app.waitWeb(base + '/one'); await sleep(800);
  // The page menu is Acira's own (round 9: the menu material over the page, kind 'page-context'); the native Menu.popup is
  // only the fallback without a chrome view. Open it from the page's own context-menu event, read the items main sent to
  // the chrome, and run an item the way the overlay does (context-run by id).
  await app.main(({clipboard}) => clipboard.writeText(''));
  if (process.env.D_DEBUG) await app.ui.evaluate(() => { window.__pc = []; window.acira.subscribeBrowser(e => { if (e.action === 'page-context' || e.type === 'overlay-dismissed') window.__pc.push((e.type === 'overlay-dismissed' ? 'dismissed ' + e.id : 'menu ' + e.items?.length) + ' @' + Math.round(performance.now())); }); window.acira.subscribeLayout?.(l => window.__pc.push('layout ' + (l.overlay ? l.overlay.kind + ':' + l.overlay.id : '-') + ' @' + Math.round(performance.now()))); });
  const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
  let shown = null;
  const open = async (params) => {
    const overlayPage = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await (process.env.D_RUNTIME_CLOSE ? app.ui.evaluate(id => window.acira.closeOverlay(id), (await layout()).overlay.id) : overlayPage()?.keyboard.press('Escape')); await sleep(200); }
    await sleep(400); // the chrome hears the dismissal; open() toggles an already-open menu kind
    await app.main(({webContents}, [url, params]) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === url); wc.emit('context-menu', {preventDefault() {}}, {x: 10, y: 10, mediaType: 'none', mediaFlags: {}, editFlags: {canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canUndo: true, canRedo: false}, selectionText: '', linkURL: '', srcURL: '', isEditable: false, frame: wc.mainFrame, ...params}); }, [base + '/one', params]);
    const o = await poll(async () => { const l = await layout(); return l?.overlay?.kind === 'page-context' ? l.overlay : null; }, Boolean, 'page menu', 4000).catch(() => null);
    if (!o && process.env.D_DEBUG) console.log('main errors', JSON.stringify([...new Set(app.logs.join('').split('\n').filter(l => /rror|nvalid/.test(l)).map(l => l.slice(0, 200)))].slice(0, 6)), 'page-context events', JSON.stringify(await app.ui.evaluate(() => window.__pc)), 'no page menu; overlay now', JSON.stringify((await layout())?.overlay?.kind), 'tabs', JSON.stringify((await app.state()).tabs.map(t => t.url)), 'active', (await app.state()).activeTabId);
    shown = o ? {tabId: o.context?.tabId || o.tabId || (await app.state()).tabs.find(t => t.url.startsWith(base + '/one'))?.id, items: o.context?.items || []} : null;
    return shown ? shown.items.map(i => i.label || '—') : null;
  };
  const click = async label => { const item = shown?.items.find(i => i.label === label); if (!item) throw new Error('no item ' + label + ' in ' + shown?.items.map(i => i.label)); await app.ui.evaluate(([tabId, id]) => window.acira.browserCommand({type: 'context-run', tabId, id}), [shown.tabId, item.id]); };
  // Page: navigation, print and inspect are present.
  let labels = await open({}); assert.ok(labels, 'a page menu is shown'); for (const wanted of ['Back', 'Print…', 'Save page as…', 'Save as PDF…', 'Inspect element']) assert.ok(labels.includes(wanted), `${wanted} in ${labels}`); report.push('page menu: ' + labels.filter(l => l !== '—').length + ' items incl. Print, Save as PDF, Inspect');
  // Link: open in tab acts on this profile/window and copies the exact address.
  labels = await open({linkURL: base + '/linked'}); for (const wanted of ['Open link in new tab', 'Open link in new window']) assert.ok(labels.includes(wanted), `${wanted} in ${labels}`);
  const before = (await app.state()).tabs.length; await click('Open link in new tab'); await poll(async () => (await app.state()).tabs.length, n => n === before + 1, 'link opens in a tab'); assert.ok((await app.state()).tabs.some(t => t.url === base + '/linked')); report.push('Open link in new tab opens it as a tab');
  // Preflight: a direct write and read in the main process. When even that comes back empty, the machine's clipboard is locked (another program holds it, or no interactive desktop) and no copy command can be proved here: say so instead of blaming the menu.
  { const sentinel = 'acira-clipboard-preflight-' + Date.now(); const got = await app.main(async ({clipboard}, text) => { await clipboard.writeText(text); return String(await clipboard.readText()); }, sentinel); assert.equal(got, sentinel, 'the OS clipboard is not usable on this machine (a direct write and read in main fails); close programs that hold the clipboard and run again'); }
  labels = await open({linkURL: base + '/linked'}); const copy = labels.find(l => /^Copy link/.test(l)); assert.ok(copy, labels.join('|')); await click(copy); assert.equal(await app.main(({clipboard}) => clipboard.readText()), base + '/linked'); report.push('Copy link address copies the link');
  // Selection: copy + search.
  labels = await open({selectionText: 'selected words'}); assert.ok(labels.includes('Copy') && labels.some(l => /^Search/.test(l)), labels.join('|')); await click('Copy'); assert.equal(await app.main(({clipboard}) => clipboard.readText()), 'selected words'); report.push('selection menu copies and offers search');
  // Editable field with a misspelling shows suggestions + Add to dictionary.
  labels = await open({isEditable: true, misspelledWord: 'quik', dictionarySuggestions: ['quick', 'quirk'], formControlType: 'text-area'}); for (const wanted of ['quick', 'Add to dictionary', 'Undo', 'Cut', 'Copy', 'Paste']) assert.ok(labels.includes(wanted), `${wanted} in ${labels}`); report.push('editable menu: suggestions, dictionary, edit commands');
  // Image: copy address, open in tab.
  labels = await open({mediaType: 'image', srcURL: base + '/pic.png', hasImageContents: false}); for (const wanted of ['Open image in new tab', 'Copy image address']) assert.ok(labels.includes(wanted), `${wanted} in ${labels}`); report.push('image menu: open and copy address');
  // A stale menu does not act after the page moved on.
  labels = await open({linkURL: base + '/stale'}); const tabsBefore = (await app.state()).tabs.length;
  await app.act({type: 'tab.navigate', url: base + '/two', tabId: (await app.state()).tabs.find(t => t.url === base + '/one').id}); await sleep(1500);
  await click('Open link in new tab').catch(() => {}); await sleep(600); assert.equal((await app.state()).tabs.length, tabsBefore, 'a stale menu must not act on the replacement document'); report.push('stale menu is ignored after navigation');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
