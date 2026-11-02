// Cloudflare Turnstile through the content blocker, with Cloudflare's own documented TEST site keys (developers.cloudflare.com/turnstile/troubleshooting/testing):
//   1x00000000000000000000AA  always passes (visible)      -> the widget must load and hand the page a token
//   1x00000000000000000000BB  always passes (invisible)    -> a token with no visible widget
//   3x00000000000000000000FF  forces an interactive check  -> the widget must render (nobody clicks it: no challenge is ever solved here)
// A local page (http://127.0.0.1) loads https://challenges.cloudflare.com/turnstile/v0/api.js and renders the widget. Each key runs in a normal tab, a private
// tab and a window.open pop-up of the real app (isolated profile under .qa-profiles/, window hidden until shown off-screen without focus).
// Every request that failed is listed with its error; a challenges.cloudflare.com request that failed with ERR_BLOCKED_BY_CLIENT fails the run.
//   node qa/native-slot.mjs turnstile -- node qa/turnstile-check.mjs [outDir]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const KEYS = {pass: '1x00000000000000000000AA', invisible: '1x00000000000000000000BB', managed: '3x00000000000000000000FF'};
const outDir = path.resolve(process.argv[2] || 'qa/artifacts/turnstile');
fs.mkdirSync(outDir, {recursive: true});

const PAGE = key => `<!doctype html><meta charset="utf-8"><title>turnstile ${key}</title><body style="font:16px sans-serif;margin:24px;background:#fff;color:#111"><h3>Turnstile test key ${key}</h3><div id="w" style="min-height:70px"></div>
<script>
window.__ts = {events: [], token: null, error: null};
const ev = (...a) => window.__ts.events.push(a.join(' ').slice(0, 160));
window.onloadTurnstile = () => { ev('api loaded');
  try { turnstile.render('#w', {sitekey: ${JSON.stringify(key)}, callback: t => { window.__ts.token = t; ev('token', t.length); }, 'error-callback': c => { window.__ts.error = String(c); ev('error', c); }, 'expired-callback': () => ev('expired'),
    'before-interactive-callback': () => ev('interactive'), 'after-interactive-callback': () => ev('after-interactive'), 'unsupported-callback': () => ev('unsupported')}); ev('rendered'); }
  catch (error) { window.__ts.error = 'render threw ' + error.message; } };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstile&render=explicit" async defer onerror="window.__ts.error = 'api.js failed to load'"></script>`;

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/ts') { res.end(PAGE(url.searchParams.get('key'))); return; }
    if (url.pathname === '/opener') { res.end(`<!doctype html><title>opener</title><button id="go" style="font-size:22px;padding:14px">open pop-up</button><script>document.getElementById('go').addEventListener('click', () => { window.__popup = window.open(${JSON.stringify(url.searchParams.get('target'))}, 'ts', 'popup=yes,width=640,height=760'); });</script>`); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}

const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
const rows = [];
let blockedCloudflare = 0;
await withSlot('turnstile', async () => {
  const server = await startServer(), data = path.resolve('.qa-profiles/turnstile-' + Date.now());
  const app = await launchPreparedNative({executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
  try {
    let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
    if (!ui) throw Error('UI page not found');
    try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* past setup */ }
    const isUi = p => /^acira-browser-ui:/.test(p.url()), known = new Set(app.windows());
    const failures = new Map();
    app.on('window', page => { if (isUi(page)) return; failures.set(page, []); page.on('requestfailed', request => { const error = request.failure()?.errorText || ''; if (!/ABORTED|abort/i.test(error)) failures.get(page).push({type: request.resourceType(), url: request.url().replace(/[?#].*/, '').slice(0, 130), error}); }); });
    await app.evaluate(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; if (win) { win.setBounds({x: -3200, y: 0, width: 1280, height: 900}); win.showInactive(); } });
    const fresh = async before => { for (let i = 0; i < 300; i++) { const p = app.windows().find(q => !before.has(q) && !isUi(q) && !known.has(q)); if (p) { known.add(p); return p; } await wait(100); } throw Error('no new page'); };
    const openTab = async (url, privacy) => { const before = new Set(app.windows()); await ui.evaluate(([u, privacy]) => window.acira.dispatch({type: 'tab.new', url: u, ...(privacy ? {privacy} : {})}), [url, privacy]); return fresh(before); };
    const settle = async (page, kind) => {
      for (let i = 0; i < 70; i++) {                                    // up to ~35 s
        const s = await page.evaluate(() => ({token: !!window.__ts?.token, error: window.__ts?.error, events: window.__ts?.events || [], frame: (() => { const f = document.querySelector('#w > *'), r = f?.getBoundingClientRect(); return !!f && r.height > 30 && r.width > 150; })()})).catch(() => null);
        if (s && (s.error || (kind === 'managed' ? s.frame && s.events.includes('interactive') : s.token))) break;
        await wait(500);
      }
      await wait(1500);
      return page.evaluate(() => { const f = document.querySelector('#w > *'), r = f?.getBoundingClientRect(); return {token: window.__ts?.token ? window.__ts.token.length : 0, error: window.__ts?.error || null, events: window.__ts?.events || [], api: typeof window.turnstile, iframe: f ? {tag: f.tagName.toLowerCase(), shadow: !!f.shadowRoot, w: Math.round(r.width), h: Math.round(r.height)} : null}; }).catch(error => ({error: 'evaluate failed ' + String(error).slice(0, 100)}));
    };
    for (const [kind, key] of Object.entries(KEYS)) for (const where of ['tab', 'private', 'popup']) {
      let page, opener;
      if (where === 'popup') { opener = await openTab(`${server.base}/opener?target=${encodeURIComponent(`${server.base}/ts?key=${key}`)}`); const popup = opener.waitForEvent('popup', {timeout: 25000}); await opener.click('#go'); page = await popup; known.add(page); }
      else page = await openTab(`${server.base}/ts?key=${key}`, where === 'private' ? 'private' : undefined);
      await page.waitForLoadState('load', {timeout: 20000}).catch(() => {});
      const state = await settle(page, kind);
      if (where === 'popup') state.opener = await page.evaluate(() => window.opener !== null).catch(() => null);
      const failed = (failures.get(page) || []).slice(0, 20), cf = failed.filter(f => /challenges\.cloudflare\.com/.test(f.url));
      const blocked = cf.filter(f => /BLOCKED_BY_CLIENT/.test(f.error)); blockedCloudflare += blocked.length;
      const ok = kind === 'managed' ? !!state.iframe && state.iframe.h > 30 && state.iframe.w > 150 && (state.events || []).includes('interactive') && !state.error : state.token > 0 && !state.error;
      await page.screenshot({path: path.join(outDir, `${kind}-${where}.png`), timeout: 15000}).catch(() => {});
      rows.push({kind, where, ok, state, failed});
      console.log(`${kind.padEnd(9)} ${where.padEnd(8)} ${ok ? 'OK  ' : 'FAIL'} token=${state.token} error=${state.error} iframe=${JSON.stringify(state.iframe)} events=[${(state.events || []).join('; ')}]${state.opener === undefined ? '' : ' opener=' + state.opener}`);
      for (const f of failed) console.log(`            failed: ${f.type} ${f.url} ${f.error}`);
    }
  } finally { await app.close().catch(() => {}); await server.close(); }
});
fs.writeFileSync(path.join(outDir, 'turnstile.json'), JSON.stringify(rows, null, 1));
const bad = rows.filter(r => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} scenarios ok; challenges.cloudflare.com requests blocked by the client: ${blockedCloudflare}`);
process.exit(bad.length || blockedCloudflare ? 1 : 0);
