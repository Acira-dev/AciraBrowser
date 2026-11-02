// Runs with "Passkeys and security keys" turned ON (it is off by default, 28 Oct: then nothing reaches Windows at all; qa/passkey-setting-proof.mjs proves that side).
// P0 28 Oct: Windows' passkey dialog ("Choose a passkey", Windows Security) must never open unless the person pressed something asking for it.
//   node qa/passkey-dialog-guard.mjs [--google]     (cwd = worktree root; one native slot; isolated profile under .qa-profiles; build first)
// A local page on http://localhost (a valid passkey site) starts what Google's sign-in page starts: passkey autofill (conditional get) at
// load, plain passkey requests at load / on a timer / on focus / on tab switch, and a passkey creation nudge; a same-origin iframe does
// the same and the page reaches into a script-made about:blank frame. It is opened in a normal tab, two split panes, a private tab and
// Peek. Then a real click (Playwright input, never the real mouse) on "Sign in with a passkey" must still go through.
// Never reaches Windows: the app runs with ACIRA_TEST_PASSKEY_STUB=1, so passkey-test-stub-preload.cjs records the calls the guard lets
// through (below the guard) instead of webauthn.dll, and the page makes no passkey call at all if that stub is missing. The script-made
// about:blank frame (no preload, so no stub) is only asked isConditionalMediationAvailable(). Any Windows passkey dialog = failure.
// The dialog is detected by enumerating top-level windows (qa/passkey-dialog-watch.ps1, no screen capture) and cancelled through UI
// Automation. --google then loads the real accounts.google.com sign-in page twice in split panes plus YouTube (load only, never types):
// no dialog may appear within 30 s, including after clicking the email field and switching tabs. Exit code 1 on any failure.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const google = process.argv.includes('--google');
const evidenceDir = 'C:/ae/r3/passkey/evidence';
const PROBE = (label, inner) => `<!doctype html><title>passkey probe ${label}</title><style>body{font:14px sans-serif;margin:16px}button,input{font-size:16px;padding:8px;margin:6px 0;display:block}iframe{width:420px;height:150px}</style>
<script>
window.results = {label: ${JSON.stringify(label)}};
const rec = (k, v) => { results[k] = v; };
const key = () => ({challenge: crypto.getRandomValues(new Uint8Array(16)), rpId: 'localhost', timeout: 30000, userVerification: 'preferred'});
results.stubCalls = window.__passkeyStubCalls || null;
const note = (k, run) => { if (!window.__passkeyStubCalls) { rec('stubMissing', true); return; } try { run().then(() => rec(k, 'resolved'), e => rec(k, e.name)); } catch (e) { rec(k, 'threw ' + e.name); } };
PublicKeyCredential.isConditionalMediationAvailable().then(v => rec('available', v));
if (PublicKeyCredential.getClientCapabilities) PublicKeyCredential.getClientCapabilities().then(c => rec('conditionalGetCapability', c.conditionalGet));
window.cc = new AbortController();
note('conditional', () => navigator.credentials.get({mediation: 'conditional', publicKey: key(), signal: cc.signal}));
note('loadGet', () => navigator.credentials.get({publicKey: key()}));
setTimeout(() => note('timerGet', () => navigator.credentials.get({publicKey: key()})), 400);
setTimeout(() => note('timerCreate', () => navigator.credentials.create({publicKey: {challenge: new Uint8Array(16), rp: {id: 'localhost', name: 'probe'}, user: {id: new Uint8Array(8), name: 'probe', displayName: 'probe'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]}})), 600);
let focusCount = 0, visibleCount = 0;
addEventListener('focus', () => note('focusGet' + (++focusCount), () => navigator.credentials.get({publicKey: key()})));
document.addEventListener('visibilitychange', () => note('visibilityGet' + (++visibleCount), () => navigator.credentials.get({publicKey: key()})));
const press = () => { window.gc = new AbortController(); note('gestureGet', () => navigator.credentials.get({publicKey: key(), signal: gc.signal})); };
</script>
<input id="email" autocomplete="username webauthn" placeholder="Email">
<button id="passkey" onclick="press()">Sign in with a passkey</button>${inner}`;
const TOP = label => PROBE(label, `<iframe id="child" src="/child?${label}"></iframe>
<script>
addEventListener('message', e => { if (e.data && e.data.child) results.child = e.data.child; });
const blank = document.createElement('iframe'); document.body.appendChild(blank);
const bw = blank.contentWindow;
bw.PublicKeyCredential.isConditionalMediationAvailable().then(v => rec('blankAvailable', v));
</script>`);
const CHILD = label => PROBE('child-' + label, `<script>setInterval(() => parent.postMessage({child: results}, '*'), 300);</script>`);

const fixture = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); const [route, label = ''] = q.url.split('?'); r.end(route === '/child' ? CHILD(label) : TOP(label)); });
const base = `http://localhost:${fixture.port}`;
const root = '.qa-profiles/passkey-dialog-guard';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(evidenceDir, {recursive: true});
const report = {surfaces: {}, gesture: {}, dialogs: [], failures: []};
const fail = text => report.failures.push(text);
const events = [];
let app, watch, slot;
const startWatch = (ownerPid, site, seconds) => {
  const child = spawn('powershell', ['-NoProfile', '-File', path.resolve('qa/passkey-dialog-watch.ps1'), '-Seconds', String(seconds), '-OwnerPid', String(ownerPid), '-Site', site], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let buffer = '';
  child.stdout.on('data', data => { buffer += data; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (line) try { events.push(JSON.parse(line)); } catch { events.push({raw: line}); } } });
  child.stderr.on('data', data => events.push({stderr: String(data).slice(0, 300)}));
  return child;
};
const dialogsSince = t => events.filter(e => e.event === 'dialog' && e.t >= t);
try {
  slot = await takeSlot('passkey-dialog-guard');
  app = await startApp({root, env: {ACIRA_TEST_PASSKEY_STUB: '1'}});
  if ((await app.svc({type: 'antitracking.set', patch: {passkeys: true}})).antiTracking.settings.passkeys !== true) throw new Error('could not turn passkeys on');
  watch = startWatch(app.app.process().pid, 'localhost', google ? 420 : 300);
  // Where PowerShell script execution is disabled by policy the watcher cannot start: it is skipped, never bypassed (the test stub still keeps every request away from Windows).
  report.windowWatcher = await poll(() => events.find(e => e.event === 'ready'), Boolean, 'watcher ready', 8000).then(() => true, () => false);
  const openTab = async (url, privacy) => { const before = new Set((await app.state()).tabs.map(t => t.id)); await app.act({type: 'tab.new', url, ...(privacy ? {privacy} : {})}); return poll(async () => (await app.state()).tabs.find(t => !before.has(t.id)), Boolean, 'tab ' + url); };
  const pageOf = label => app.waitWeb(u => u.startsWith(`${base}/?${label}`), 'page ' + label);

  // --- Background phase: nobody presses anything. ---
  const backgroundStart = Date.now();
  const normal = await openTab(`${base}/?normal`);
  const splitA = await openTab(`${base}/?splitA`), splitB = await openTab(`${base}/?splitB`);
  await app.act({type: 'split.open', tabIds: [splitA.id, splitB.id]});
  await openTab(`${base}/?private`, 'private');
  // Tab switches fire focus / visibility changes, which Google uses to re-arm its passkey request.
  for (const id of [normal.id, splitA.id, normal.id]) { await app.act({type: 'tab.select', id}); await sleep(700); }
  // Peek closes on a tab switch, so it opens last (over the normal tab) and stays open through the gesture phase's first click.
  report.peekOpen = await app.ui.evaluate(url => window.acira.peek({type: 'peek.open', url}), `${base}/?peek`);
  const labels = ['normal', 'splitA', 'splitB', 'private', 'peek'];
  const pages = {};
  for (const label of labels) pages[label] = await pageOf(label);
  await sleep(4000);
  for (const label of labels) {
    const results = await poll(() => pages[label].evaluate(() => window.results.child && 'blankAvailable' in window.results ? window.results : null), Boolean, 'results ' + label, 15000);
    report.surfaces[label] = results;
    for (const [where, r] of [['top', results], ['child iframe', results.child]]) {
      if (r.available !== false) fail(`${label} ${where}: isConditionalMediationAvailable() = ${r.available}`);
      if (r.conditionalGetCapability === true) fail(`${label} ${where}: getClientCapabilities().conditionalGet = true`);
      if ('conditional' in r) fail(`${label} ${where}: the conditional request settled (${r.conditional}) instead of waiting`);
      for (const k of Object.keys(r).filter(k => /^(loadGet|timerGet|timerCreate|focusGet\d+|visibilityGet\d+)$/.test(k))) if (r[k] !== 'NotAllowedError') fail(`${label} ${where}: background ${k} = ${r[k]}`);
      if (!r.loadGet || !r.timerGet || !r.timerCreate) fail(`${label} ${where}: a background request never answered`);
      if (r.stubMissing || !Array.isArray(r.stubCalls)) fail(`${label} ${where}: the test stub was not in place (no request was made)`);
      else if (r.stubCalls.length) fail(`${label} ${where}: the guard let ${r.stubCalls.join(', ')} through without a press`);
    }
    if (results.blankAvailable !== false) fail(`${label} about:blank frame: isConditionalMediationAvailable() = ${results.blankAvailable}`);
    // The page gives up on autofill: Chrome answers with the page's own abort reason.
    await pages[label].evaluate(() => window.cc.abort());
    const aborted = await poll(() => pages[label].evaluate(() => window.results.conditional), Boolean, 'abort ' + label, 5000);
    if (aborted !== 'AbortError') fail(`${label}: aborted conditional request answered ${aborted}`);
  }
  report.backgroundDialogs = dialogsSince(backgroundStart).length;
  

  // --- Gesture phase: a real click on "Sign in with a passkey" still opens Windows' dialog (cancelled at once). ---
  const surfaces = [['peek', p => p.mainFrame()], ['normal', p => p.mainFrame()], ['child iframe', p => p.frames().find(f => f.url().includes('/child?normal'))], ['splitB', p => p.mainFrame()], ['private', p => p.mainFrame()]];
  for (const [name, frameOf] of surfaces) {
    const label = name === 'child iframe' ? 'normal' : name;
    if (label === 'normal' || label === 'splitB' || label === 'private') { const tab = (await app.state()).tabs.find(t => t.url.startsWith(`${base}/?${label}`)); if (tab) await app.act({type: 'tab.select', id: tab.id}); await sleep(500); }
    const frame = frameOf(pages[label]);
    const t = Date.now();
    await frame.click('#passkey', {force: true, timeout: 5000});
    const answer = await poll(() => frame.evaluate(() => window.results.gestureGet), Boolean, 'gesture answer ' + name, 10000).catch(() => null);
    const reached = await frame.evaluate(() => (window.__passkeyStubCalls || []).slice()).catch(() => null);
    report.gesture[name] = {pageAnswer: answer, reachedBrowser: reached, dialogs: dialogsSince(t).length};
    if (answer !== 'resolved' || !reached || !reached.includes('get')) fail(`${name}: a real click on "Sign in with a passkey" did not reach the browser (${answer}, ${JSON.stringify(reached)})`);
    await sleep(800);
  }

  // --- Real Google sign-in (load only, never types). ---
  if (google) {
    const googleStart = Date.now();
    const a = await openTab('https://accounts.google.com/');
    const b = await openTab('https://accounts.google.com/signin');
    await app.act({type: 'split.open', tabIds: [a.id, b.id]});
    const yt = await openTab('https://www.youtube.com/');
    const signIn = await app.waitWeb(u => u.startsWith('https://accounts.google.com/'), 'google sign-in page');
    await sleep(6000);
    const field = 'input[type=email], input[name=identifier]';
    const g = {};
    try { g.available = await signIn.evaluate(() => PublicKeyCredential.isConditionalMediationAvailable()); } catch (e) { g.available = 'error ' + e.message; }
    for (const id of [a.id, yt.id, b.id, a.id]) { await app.act({type: 'tab.select', id}); await sleep(1500); }
    try { await signIn.click(field, {force: true, timeout: 5000}); g.clickedEmail = true; } catch (e) { g.clickedEmail = 'not found: ' + e.message.split('\n')[0]; }
    await sleep(3000);
    try { await signIn.focus(field); } catch {}
    for (const id of [yt.id, a.id]) { await app.act({type: 'tab.select', id}); await sleep(1500); }
    while (Date.now() - googleStart < 32000) { if (dialogsSince(googleStart).length) break; await sleep(500); }
    g.urls = app.context.pages().map(p => { try { return p.url(); } catch { return ''; } }).filter(u => /google|youtube/.test(u)).map(u => u.split('?')[0]);
    g.dialogs = dialogsSince(googleStart).map(d => ({title: d.title, class: d.class, process: d.process, texts: d.texts}));
    g.watchedMs = Date.now() - googleStart;
    report.google = g;
    if (g.dialogs.length) fail(`Google sign-in opened ${g.dialogs.length} passkey dialog(s)`);
    if (g.available !== false) fail(`Google page: isConditionalMediationAvailable() = ${g.available}`);
  }
} catch (error) { report.error = error.stack || String(error); fail('run error'); }
finally {
  try { await app?.close(); } catch {}
  try { watch?.kill(); } catch {}
  if (slot) await releaseSlot(slot);
  await fixture.close();
}
report.dialogs = events.filter(e => e.event === 'dialog' || e.event === 'cancelled');
if (report.dialogs.length) fail(`${report.dialogs.length} Windows passkey dialog event(s) during a stubbed run`);
report.pass = report.failures.length === 0;
await fs.writeFile(path.join(evidenceDir, google ? 'passkey-dialog-guard-google.json' : 'passkey-dialog-guard.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({pass: report.pass, failures: report.failures, gesture: report.gesture, google: report.google, backgroundDialogs: report.backgroundDialogs, dialogs: report.dialogs.length, error: report.error}, null, 1));
if (!report.pass) process.exitCode = 1;
