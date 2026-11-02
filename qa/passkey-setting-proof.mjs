// "Passkeys and security keys" (28 Oct): off by default, live switch, proved in the real app. One Electron, an isolated profile under .qa-profiles, a native slot,
// closed in finally, the window off-screen and never focused. NEVER reaches Windows: the app runs with ACIRA_TEST_PASSKEY_STUB=1, so passkey-test-stub-preload.cjs
// records what gets through below the guard instead of calling webauthn.dll, and the probe page makes no passkey call at all when the stub is missing.
// qa/passkey-dialog-watch.ps1 (top-level window enumeration, -NoCancel, no screen capture) watches for a Windows credential dialog the whole time.
//   node qa/passkey-setting-proof.mjs            (cwd = worktree root; build first: vite build + npm run build:runtime)
// Part 1: default off. Part 2: turn it on without reloading. Part 3: off again. Part 4: the Settings row in English and German, light and dark, 100% and 150%.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const results = [];
const check = (ok, label, detail) => { results.push({ok: Boolean(ok), label, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
const root = '.qa-profiles/passkey-setting-proof';
const scanner = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
const catalog = async name => JSON.parse(await fs.readFile(path.resolve('src/i18n', name + '.json'), 'utf8'));

// The page a site would serve: a sign-in button asking for a passkey, a create button, capability checks, and a same-origin child frame doing the same.
const SCRIPT = `<script>
const key = () => ({challenge: crypto.getRandomValues(new Uint8Array(16)), rpId: 'localhost', timeout: 30000, userVerification: 'preferred'});
const make = () => ({challenge: new Uint8Array(16), rp: {id: 'localhost', name: 'probe'}, user: {id: new Uint8Array(8), name: 'probe', displayName: 'probe'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]});
window.results = {};
// No stub, no request: nothing here may ever reach Windows' passkey dialog.
const attempt = async (name, run) => {
  if (!window.__passkeyStubCalls) { results[name] = {outcome: 'NOT CALLED (no test stub)', ms: 0}; return results[name]; }
  const started = performance.now();
  try { await run(); results[name] = {outcome: 'resolved', ms: Math.round(performance.now() - started)}; } catch (error) { results[name] = {outcome: error.name, ms: Math.round(performance.now() - started)}; }
  return results[name];
};
window.runGet = name => attempt(name, () => navigator.credentials.get({publicKey: key()}));
window.runCreate = name => attempt(name, () => navigator.credentials.create({publicKey: make()}));
window.startConditional = () => { window.cc = new AbortController(); results.conditional = 'pending'; attempt('conditionalSettled', () => navigator.credentials.get({mediation: 'conditional', publicKey: key(), signal: cc.signal})); };
window.probe = async () => ({
  stub: Array.isArray(window.__passkeyStubCalls),
  uvpaa: await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
  conditional: await PublicKeyCredential.isConditionalMediationAvailable(),
  caps: PublicKeyCredential.getClientCapabilities ? await PublicKeyCredential.getClientCapabilities() : null,
  policyGet: (document.permissionsPolicy || document.featurePolicy).allowsFeature('publickey-credentials-get'),
  policyCreate: (document.permissionsPolicy || document.featurePolicy).allowsFeature('publickey-credentials-create'),
});
</script>
<button id="get" onclick="runGet('clickGet')">Sign in with a passkey</button>
<button id="create" onclick="runCreate('clickCreate')">Create a passkey</button>`;
const TOP = label => `<!doctype html><title>passkey setting ${label}</title><style>body{font:14px sans-serif;margin:16px}button{font-size:16px;padding:8px;margin:6px 0;display:block}iframe{width:420px;height:150px}</style>${SCRIPT}<iframe id="child" src="/child?${label}"></iframe>`;
const CHILD = label => `<!doctype html><title>passkey setting child ${label}</title>${SCRIPT}`;

const fixture = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); const [route, label = ''] = q.url.split('?'); r.end(route === '/child' ? CHILD(label) : TOP(label)); });
const base = `http://localhost:${fixture.port}`;
await fs.rm(root, {recursive: true, force: true});
const events = [];
let watch;
const startWatch = ownerPid => {
  const child = spawn('powershell', ['-NoProfile', '-File', path.resolve('qa/passkey-dialog-watch.ps1'), '-Seconds', '400', '-OwnerPid', String(ownerPid), '-Site', 'localhost', '-NoCancel'], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let buffer = '';
  child.stdout.on('data', data => { buffer += data; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (line) try { events.push(JSON.parse(line)); } catch { events.push({raw: line}); } } });
  child.stderr.on('data', data => events.push({stderr: String(data).slice(0, 300)}));
  return child;
};

try {
  await withSlot('passkey-setting-proof', async () => {
    const app = await startApp({root, env: {ACIRA_TEST_PASSKEY_STUB: '1'}});
    try {
      await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, width: 1440, height: 900}); w.showInactive(); });
      watch = startWatch(app.app.process().pid);
      // The watcher is a PowerShell script; where script execution is disabled by policy it cannot start and is skipped (never bypassed): the test stub is what keeps every request away from Windows.
      const watching = await poll(() => events.find(e => e.event === 'ready'), Boolean, 'watcher ready', 8000).then(() => true, () => false);
      console.log(watching ? 'INFO window watcher running' : 'INFO window watcher unavailable (PowerShell script execution is disabled here): the test stub alone keeps requests away from Windows');

      const choice = async () => (await app.svc({type: 'antitracking.status'})).antiTracking.settings.passkeys;
      const openTab = async (url, privacy) => { const before = new Set((await app.state()).tabs.map(t => t.id)); await app.act({type: 'tab.new', url, ...(privacy ? {privacy} : {})}); return poll(async () => (await app.state()).tabs.find(t => !before.has(t.id)), Boolean, 'tab ' + url); };
      const pageOf = label => app.waitWeb(u => u.startsWith(`${base}/?${label}`), 'page ' + label);
      const childOf = page => poll(() => page.frames().find(f => f.url().includes('/child?')), Boolean, 'child frame');
      const stubCalls = frame => frame.evaluate(() => (window.__passkeyStubCalls || []).slice());
      const answer = (frame, name) => poll(() => frame.evaluate(n => window.results[n] || null, name), Boolean, 'answer ' + name, 8000).catch(() => null);
      const NOT_ALLOWED = 'NotAllowedError';

      // ---------- Part 1: the default is off, for a profile that never chose ----------
      check(await choice() === false, 'default: the "passkeys" choice is off in a fresh profile');
      const shown = {};
      for (const [label, privacy] of [['normal', undefined], ['private', 'private']]) { await openTab(`${base}/?${label}`, privacy); shown[label] = await pageOf(label); }
      await sleep(1200);
      for (const label of ['normal', 'private']) {
        const top = shown[label], child = await childOf(top);
        for (const [where, frame] of [['top', top.mainFrame()], ['child frame', child]]) {
          const name = `off, ${label} ${where}`;
          const probe = await frame.evaluate(() => window.probe());
          check(probe.stub, `${name}: the test stub is in place (so nothing can reach Windows)`);
          check(probe.uvpaa === false, `${name}: isUserVerifyingPlatformAuthenticatorAvailable() = false`, probe.uvpaa);
          check(probe.conditional === false, `${name}: isConditionalMediationAvailable() = false`, probe.conditional);
          check(probe.caps && Object.values(probe.caps).length > 0 && Object.values(probe.caps).every(v => v === false), `${name}: getClientCapabilities() reports nothing supported`, probe.caps);
          check(probe.policyGet === false && probe.policyCreate === false, `${name}: the engine's Permissions-Policy denies publickey-credentials-get and -create`, [probe.policyGet, probe.policyCreate]);
          const get = await frame.evaluate(() => window.runGet('unclickedGet')), create = await frame.evaluate(() => window.runCreate('unclickedCreate'));
          check(get.outcome === NOT_ALLOWED && get.ms < 300, `${name}: get() without a click -> NotAllowedError at once (${get.ms} ms)`, get);
          check(create.outcome === NOT_ALLOWED && create.ms < 300, `${name}: create() without a click -> NotAllowedError at once (${create.ms} ms)`, create);
          await frame.evaluate(() => window.startConditional()); await sleep(250);
          check(await frame.evaluate(() => window.results.conditionalSettled === undefined && window.results.conditional === 'pending'), `${name}: an autofill (conditional) request waits like Chrome with no passkey, nothing settles it`);
          await frame.evaluate(() => window.cc.abort());
          check((await answer(frame, 'conditionalSettled'))?.outcome === 'AbortError', `${name}: ...and the page's own abort ends it`);
          await frame.click('#get', {force: true, timeout: 5000}); await frame.click('#create', {force: true, timeout: 5000});
          const clickGet = await answer(frame, 'clickGet'), clickCreate = await answer(frame, 'clickCreate');
          check(clickGet?.outcome === NOT_ALLOWED && clickCreate?.outcome === NOT_ALLOWED, `${name}: even a real click on the buttons -> NotAllowedError`, [clickGet, clickCreate]);
          const calls = await stubCalls(frame);
          check(calls.length === 0, `${name}: no request reached the browser's passkey layer`, calls);
          await frame.evaluate(() => { for (const k of ['clickGet', 'clickCreate', 'conditionalSettled', 'unclickedGet', 'unclickedCreate']) delete window.results[k]; window.results.conditional = undefined; });
        }
      }

      // ---------- Part 2: turned on while the pages are open (no reload) ----------
      const on = (await app.svc({type: 'antitracking.set', patch: {passkeys: true}})).antiTracking.settings.passkeys;
      check(on === true && await choice() === true, 'turned on through the service');
      for (const label of ['normal', 'private']) {
        const top = shown[label], child = await childOf(top);
        const frames = [['top', top.mainFrame()], ['child frame', child]];
        // Playwright's evaluate carries a user gesture and a click in one frame activates its same-origin frames, so a request the page makes by itself comes from a timer set 6 s ahead (activation lasts 5 s).
        for (const [, frame] of frames) await frame.evaluate(() => { setTimeout(() => window.runGet('timerGet'), 6000); setTimeout(() => window.runCreate('timerCreate'), 6100); });
        await sleep(7000);
        for (const [where, frame] of frames) {
          const name = `on, ${label} ${where} (page loaded while off, not reloaded)`;
          const timerGet = await answer(frame, 'timerGet'), timerCreate = await answer(frame, 'timerCreate');
          check(timerGet?.outcome === NOT_ALLOWED && timerCreate?.outcome === NOT_ALLOWED && (await stubCalls(frame)).length === 0, `${name}: requests the page makes by itself (no press) are refused and not recorded`, [timerGet, timerCreate]);
          const probe = await frame.evaluate(() => window.probe());
          check(probe.conditional === false, `${name}: autofill passkeys stay unavailable`, probe.conditional);
          check(typeof probe.uvpaa === 'boolean' && (probe.caps === null || typeof probe.caps === 'object'), `${name}: the engine's own answers are back (uvpaa=${probe.uvpaa}, capabilities ${JSON.stringify(probe.caps)})`, probe);
          check(probe.policyGet === false, `${name}: (the Permissions-Policy header from the off-time load stays until the next navigation)`, probe.policyGet);
          await frame.click('#get', {force: true, timeout: 5000});
          const clickGet = await answer(frame, 'clickGet');
          check(clickGet?.outcome === 'resolved' && JSON.stringify(await stubCalls(frame)) === '["get"]', `${name}: a real click on "Sign in with a passkey" reaches the browser's passkey layer (the stub)`, [clickGet, await stubCalls(frame)]);
          await sleep(200);
          await frame.click('#create', {force: true, timeout: 5000});
          const clickCreate = await answer(frame, 'clickCreate');
          check(clickCreate?.outcome === 'resolved' && JSON.stringify(await stubCalls(frame)) === '["get","create"]', `${name}: a real click on "Create a passkey" reaches it too`, [clickCreate, await stubCalls(frame)]);
          const again = await frame.evaluate(() => window.runGet('againGet'));
          check(again.outcome === NOT_ALLOWED && (await stubCalls(frame)).length === 2, `${name}: a request the page makes on its own afterwards is refused`, again);
        }
      }
      await openTab(`${base}/?later`);
      const later = await pageOf('later'); await sleep(800);
      const laterProbe = await later.evaluate(() => window.probe());
      check(laterProbe.policyGet === true && laterProbe.policyCreate === true, 'on: a page loaded after turning it on is not under the deny policy', laterProbe);

      // ---------- Part 3: and off again ----------
      check((await app.svc({type: 'antitracking.set', patch: {passkeys: false}})).antiTracking.settings.passkeys === false, 'turned off again');
      {
        const frame = shown.normal.mainFrame();
        const before = (await stubCalls(frame)).length;
        await frame.evaluate(() => { delete window.results.clickGet; });
        await frame.click('#get', {force: true, timeout: 5000});
        const clickGet = await answer(frame, 'clickGet');
        check(clickGet?.outcome === NOT_ALLOWED && (await stubCalls(frame)).length === before, 'off again: the open page is refused at once, a click or not, nothing new reaches the stub', [clickGet, before]);
        const probe = await frame.evaluate(() => window.probe());
        check(probe.uvpaa === false && probe.conditional === false && Object.values(probe.caps).every(v => v === false), 'off again: the capability checks answer no', probe);
      }
      const dialogs = events.filter(e => e.event === 'dialog');
      check(dialogs.length === 0, `no Windows passkey dialog appeared during the whole run (window watcher ${watching ? 'on' : 'unavailable; the stub recorded every call that got past the guard'})`, dialogs);

      // ---------- Part 4: the Settings row, English and German, light and dark, 100% and 150% ----------
      const uiPage = () => app.context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } });
      const en = await catalog('en'), de = await catalog('de');
      const expected = {en: [en['privacy.passkeysAndSecurityKeys'], en['privacy.passkeysDetail']], de: [de['privacy.passkeysAndSecurityKeys'], de['privacy.passkeysDetail']]};
      await app.svc({type: 'antitracking.set', patch: {passkeys: false}});
      let toggled = false;
      const seen = [];
      for (const language of ['en', 'de']) for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
        const tag = `${language}/${appearance}/${scale}%`;
        await app.act({type: 'settings.update', patch: {language, appearance, interfaceScale: scale}});
        await sleep(2500);
        const ui = await poll(uiPage, Boolean, 'ui page', 15000);
        const has = (await app.state()).tabs.find(t => t.url === 'acira://settings');
        if (has) await app.act({type: 'tab.select', id: has.id}); else await app.act({type: 'tab.new', url: 'acira://settings'});
        await poll(() => ui.evaluate(() => document.querySelectorAll('.bs-sidebar nav button').length), n => n > 3, 'settings nav', 15000);
        await ui.evaluate(() => { const buttons = [...document.querySelectorAll('.bs-sidebar nav button')]; const privacy = buttons.find(b => /^(Privacy|Datenschutz)/i.test((b.getAttribute('aria-label') || b.textContent || '').trim())); privacy?.click(); });
        await poll(() => ui.evaluate(() => Boolean(document.querySelector('[data-setting="passkeys"]'))), Boolean, 'passkeys row (' + tag + ')', 10000);
        await sleep(500);
        const row = await ui.evaluate(() => {
          const rowEl = document.querySelector('[data-setting="passkeys"]');
          rowEl.scrollIntoView({block: 'center'});
          const r = rowEl.getBoundingClientRect(), title = rowEl.querySelector('.st-title'), detail = rowEl.querySelector('.st-copy p'), control = rowEl.querySelector('.st-control'), sw = rowEl.querySelector('[role=switch]');
          const rect = e => e.getBoundingClientRect();
          const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
          const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
          const hits = [];
          for (const [name, el] of [['title', title], ['detail', detail], ['control', control], ['switch', sw]]) {
            if (!el) { hits.push(name + ' missing'); continue; }
            if (!inside(rect(el), r)) hits.push(name + ' outside the row');
            const cs = getComputedStyle(el);
            if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) hits.push(name + ' clipped sideways');
            if (cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1) hits.push(name + ' clipped vertically');
          }
          if (title && control && overlap(rect(title), rect(control))) hits.push('title overlaps the switch');
          if (detail && control && overlap(rect(detail), rect(control))) hits.push('description overlaps the switch');
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) hits.push('page scrolls sideways');
          return {hits, title: title?.textContent, detail: detail?.textContent, checked: sw?.getAttribute('aria-checked'), disabled: sw?.disabled, height: Math.round(r.height), width: Math.round(r.width), scale: devicePixelRatio, fontSize: parseFloat(getComputedStyle(title).fontSize), viewport: innerWidth, textLuma: (() => { const m = getComputedStyle(title).color.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; })(), htmlTheme: document.documentElement.dataset.theme || document.documentElement.className, lang: document.documentElement.lang};
        });
        const scan = String(await ui.evaluate(scanner)).split('\n').filter(line => / :: /.test(line));
        const mine = scan.filter(line => [row.title, row.detail].some(text => text && line.includes(text.slice(0, 14))));
        check(row.title === expected[language][0] && row.detail === expected[language][1], `settings row text in ${tag}`, [row.title, row.detail]);
        check(row.hits.length === 0 && mine.length === 0, `settings row clip/overlap scan in ${tag}: 0 hits (row ${row.width}x${row.height}, page-wide scanner lines ${scan.length}, on the row ${mine.length})`, {row: row.hits, scan: mine});
        seen.push({tag, appearance, scale, viewport: row.viewport, textLuma: row.textLuma});
        check((appearance === 'dark') === (row.textLuma > 0.5), `settings row in ${tag}: the ${appearance} theme is really applied (title text luminance ${row.textLuma.toFixed(2)})`, row.textLuma);
        check(row.checked === 'false' && row.disabled === false, `settings row in ${tag}: switch is off and usable`, [row.checked, row.disabled]);
        if (!toggled) {
          toggled = true;
          await ui.locator('[data-setting="passkeys"] [role=switch]').click();
          await poll(choice, v => v === true, 'ui switch turns it on', 8000);
          const note = await poll(() => ui.evaluate(() => [...document.querySelectorAll('.st-note')].map(n => n.textContent).find(t => /Reload pages/.test(t)) || null), Boolean, 'reload note', 4000).catch(() => null);
          check(note, 'the switch in the page turns it on and says to reload open pages', note);
          await ui.locator('[data-setting="passkeys"] [role=switch]').click();
          await poll(choice, v => v === false, 'ui switch turns it off', 8000);
          check(true, 'the switch in the page turns it off again');
        }
      }
      const size = (a, sc) => seen.find(x => x.appearance === a && x.scale === sc && x.tag.startsWith('en'))?.viewport;
      check(size('light', 150) < size('light', 100) * 0.75, `150% is really applied (the page is ${size('light', 100)} CSS px wide at 100%, ${size('light', 150)} at 150%)`, seen);
      await app.act({type: 'settings.update', patch: {language: 'en', appearance: 'light', interfaceScale: 100}});
    } finally { await app.close(); }
  });
} catch (error) { check(false, 'run error', String(error && error.stack || error)); }
finally { try { watch?.kill(); } catch {} await fixture.close(); }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await fs.mkdir('.qa-profiles/passkey-setting-proof-report', {recursive: true}).catch(() => {});
await fs.writeFile('.qa-profiles/passkey-setting-proof-report/report.json', JSON.stringify({results, windowEvents: events}, null, 1)).catch(() => {});
if (failed.length) process.exitCode = 1;
