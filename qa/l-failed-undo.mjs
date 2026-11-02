// Stream L: M's break-it findings S03 (failed loads must not become history or bookmark suggestions) and S06 (removing a
// bookmark offers Undo), in the real app. Prints PASS/FAIL per check; exits 1 if anything fails.
//   node qa/l-failed-undo.mjs        isolated profile under .qa-profiles, one Electron instance, closed in finally.
// Caps: at most 9 tabs. Windows are off-screen and not activated unless --visible.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const visible = process.argv.includes('--visible');
const data = path.resolve('.qa-profiles/l-failed-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Fixture ' + req.url + '</title><h1>Fixture</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
// A port nothing listens on: connection refused.
const closedPort = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const refused = 'http://127.0.0.1:' + closedPort + '/never';
const dns = 'http://nonexistent-acira-qa.invalid/';

const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const find = async test => { for (let i = 0; i < 300; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } throw Error('page not found'); };
const rows = [];
const record = (name, ok, detail = '') => { rows.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
async function check(name, fn) { try { const r = await fn(); record(name, r.ok, r.detail); } catch (e) { record(name, false, 'threw: ' + String(e.message).slice(0, 200)); } }
let exitCode = 1;
try {
  const ui = await find(u => u === 'acira-browser-ui://ui/index.html');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1440, height: 900 }); if (visible) w.show(); else w.showInactive(); }, visible);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  const MAX_TABS = 9;
  const open = async url => { const n = (await snap()).tabs.length; if (n >= MAX_TABS) throw Error('tab cap'); await act({ type: 'tab.new', url }); for (let i = 0; i < 40; i++) { await wait(250); const s = await snap(); if (s.tabs.length === n + 1 && !s.tabs.find(t => t.id === s.activeTabId).loading) return s; } throw Error('tab did not settle: ' + url); };
  const visits = async () => (await snap()).browsingHistory.map(v => v.url);

  // ---- S03
  await open(base + '/good');
  await check('S03: a page that loads is a visit', async () => { const v = await visits(); return { ok: v.some(u => u.endsWith('/good')), detail: v.join(' ') }; });
  await open(dns);
  await check('S03: a DNS failure shows the error and is not a visit', async () => {
    const s = await snap(), tab = s.tabs.find(t => t.id === s.activeTabId), v = await visits();
    return { ok: !!tab.error && !v.some(u => u.includes('nonexistent-acira-qa')), detail: `error: ${tab.error}; visits: ${v.length}` };
  });
  await open(refused);
  await check('S03: a refused connection is not a visit', async () => {
    const s = await snap(), tab = s.tabs.find(t => t.id === s.activeTabId), v = await visits();
    return { ok: !!tab.error && !v.some(u => u.includes(':' + closedPort)), detail: `error: ${tab.error}` };
  });
  // The Bookmarks page "From your history" (shown once something is saved) offers an unsaved page that loaded, and neither failure.
  await open(base + '/second');
  await act({ type: 'bookmark.add', url: base + '/good', parentId: null, index: 0 }); await wait(300);
  await open('acira://bookmarks');
  await wait(1200);
  await check('S03: "From your history" offers a page that loaded, and neither failed page', async () => {
    // Only the suggestion section: the tab strip around it carries the failed tabs' own titles.
    const text = await ui.evaluate(() => document.querySelector('section[aria-label="From your history"]')?.textContent || '');
    return { ok: /Fixture \/second/.test(text) && !/nonexistent-acira-qa/.test(text) && !text.includes(':' + closedPort + '/'), detail: text ? 'suggestions: ' + text.replace(/\s+/g, ' ').slice(0, 200) : 'no suggestion section' };
  });

  // ---- S06
  const page = (await open(base + '/starred')).tabs.find(t => t.url.endsWith('/starred'));
  await act({ type: 'bookmark.toggle', url: page.url }); await wait(300);
  await check('S06: starring a page says "Bookmark added" with no Undo', async () => { const s = await snap(); return { ok: s.toast?.text === 'Bookmark added' && !s.toast.action && s.bookmarkNodes.some(b => b.url === page.url), detail: s.toast?.text }; });
  await act({ type: 'bookmark.toggle', url: page.url }); await wait(300);
  await check('S06: un-starring a page raises "Bookmark removed · Undo"', async () => { const s = await snap(); return { ok: s.toast?.text === 'Bookmark removed' && s.toast.action?.label === 'Undo' && !s.bookmarkNodes.some(b => b.url === page.url), detail: JSON.stringify(s.toast?.action?.command?.type) }; });
  await check('S06: the Undo command (through validation) brings the bookmark back', async () => {
    const command = (await snap()).toast.action.command;
    await act(command); await wait(400);
    const s = await snap();
    return { ok: s.bookmarkNodes.some(b => b.url === page.url), detail: 'bookmarks: ' + s.bookmarkNodes.filter(b => b.url).length };
  });
  // The Bookmarks page: a real click on the remove button, then the Undo in its notice.
  const tabs = (await snap()).tabs, bm = tabs.find(t => t.url === 'acira://bookmarks');
  await act({ type: 'tab.select', id: bm.id }); await wait(900);
  await check('S06: the Bookmarks page removes with a click and offers Undo', async () => {
    const s0 = await snap(), before = s0.bookmarkNodes.filter(b => b.url).length;
    const row = ui.locator('.lib-row', { has: ui.locator('button[data-danger]') }).first(); await row.hover();
    await row.locator('button[data-danger]').click({ timeout: 5000 });
    await wait(500);
    const s = await snap(), after = s.bookmarkNodes.filter(b => b.url).length;
    const notice = await ui.locator('.lib-undo').innerText({ timeout: 3000 }).catch(() => '');
    await ui.locator('.lib-undo button', { hasText: 'Undo' }).click({ timeout: 3000 });
    await wait(500);
    const back = (await snap()).bookmarkNodes.filter(b => b.url).length;
    return { ok: after === before - 1 && /Undo/.test(notice) && back === before && (s.toast?.id ?? 0) === (s0.toast?.id ?? 0), detail: `bookmarks ${before} -> ${after} -> ${back}; notice: ${notice.replace(/\s+/g, ' ')}; new toast raised: ${(s.toast?.id ?? 0) !== (s0.toast?.id ?? 0)}` };
  });
  const failed = rows.filter(r => !r.ok).length;
  console.log(failed ? `${failed} of ${rows.length} checks FAILED` : `${rows.length}/${rows.length} checks pass`);
  exitCode = failed ? 1 : 0;
} catch (error) {
  console.log('ABORTED: ' + String(error.message).slice(0, 300));
} finally {
  await app.close().catch(() => {});
  server.close();
}
process.exit(exitCode);
