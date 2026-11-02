// R3-44: one repeatable feature-proof suite. Runs the real app, one native slot at a time, and writes docs/launch/FEATURE_PROOF.md:
// a plain table  Feature | What we checked | Result (PASS/FAIL) | Evidence.   Every row is a real run, never a unit test of a service on its own.
//
//   node qa/r3-feature-proof.mjs                    run every row (about an hour; needs internet for the real-site, Tor and store rows)
//   node qa/r3-feature-proof.mjs --list             list the rows and the steps behind them
//   node qa/r3-feature-proof.mjs --only tor,vpn     run only these rows (ids from --list); the report still shows every row's latest result
//   node qa/r3-feature-proof.mjs --report           rebuild the report from the saved results without running anything
//   node qa/r3-feature-proof.mjs --packaged <folder with AciraBrowser.exe>   the auto-update row runs against a copy of this packaged build (default C:/ae/rel5/win-unpacked)
//
// Rules this suite keeps (docs/launch/ROUND3_BRIEF.md): isolated profiles under .qa-profiles (the harness refuses anything else), at most one Electron
// at a time, one slot file C:\ae\slot-N.lock held per step and released in finally, a step is killed with its whole process tree after its time limit.
// It never calls the real Windows Hello / PIN prompt: every child runs with the vault's explicit test substitute (ACIRA_PASSWORDS_TEST_GATE=allow,
// only honoured by an unpackaged run in a test profile). Real Hello is a founder hand check (listed in the report).
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASE = 'C:/ae/r3/proof';
const EVIDENCE = path.join(BASE, 'evidence');
const RESULTS = path.join(BASE, 'results.json');
const REPORT = path.resolve('docs/launch/FEATURE_PROOF.md');
fs.mkdirSync(EVIDENCE, {recursive: true});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const PACKAGED = (() => { const i = process.argv.indexOf('--packaged'); return path.resolve(i > 0 ? process.argv[i + 1] : (process.env.PROOF_PACKAGED_SOURCE || 'C:/ae/rel5/win-unpacked')); })();
process.env.PROOF_PACKAGED_SOURCE = PACKAGED;
const FEED = 'C:/ae/r3/proof/feed';

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The rows. A row passes only when every step behind it passes. A step is a script that exits 0 (and, when it writes a result file, has no failed check).
//   ownSlot: the script takes its own native slot (the r3-* scripts); otherwise this suite holds one around it.
//   verify(ctx): extra judgement for scripts that report instead of failing (reads their saved files).
// ---------------------------------------------------------------------------------------------------------------------------------------------
const dnsVerify = label => ctx => {
  const doc = readJson(`C:/ae/r3/network/evidence/dns-${label}.json`);
  if (!doc) return {ok: false, detail: 'no result file'};
  const ok = !doc.error && doc.proxySaw === true && doc.echoLookups === 0;
  return {ok, detail: `${label}: page loaded "${doc.title}", proxy saw the name=${doc.proxySaw}, local lookups of the site name=${doc.echoLookups}${doc.error ? ', error ' + String(doc.error).slice(0, 120) : ''}`, files: [`C:/ae/r3/network/evidence/dns-${label}.json`]};
};

/** The privacy-plus scripts print what they saw and always exit 0, so the suite judges their saved JSON itself (and copies their screenshots as evidence). */
const artifactJudge = (jsonFile, pngs, rules) => ctx => {
  const file = path.resolve(jsonFile), fresh = fs.existsSync(file) && fs.statSync(file).mtimeMs >= ctx.startedAt - 1000;
  const doc = fresh ? readJson(file) : null;
  if (!doc) return {ok: false, detail: 'the script saved no fresh result (' + jsonFile + ')'};
  const failed = rules.filter(([, test]) => { try { return !test(doc); } catch { return true; } }).map(([label]) => label);
  const files = [];
  for (const png of pngs) { const from = path.resolve(png); if (fs.existsSync(from)) { const to = path.join(ctx.dir, path.basename(png)); fs.copyFileSync(from, to); files.push(to); } }
  fs.copyFileSync(file, path.join(ctx.dir, path.basename(file)));
  return {ok: failed.length === 0 && !doc.error, detail: failed.length ? 'failed: ' + failed.join('; ') : (doc.error ? String(doc.error).slice(0, 200) : rules.map(([label]) => label).join('; ')), files: [...files, path.join(ctx.dir, path.basename(file))], summary: failed.length ? [] : rules.map(([label]) => label)};
};
const threatVerify = artifactJudge('qa/artifacts/threat-warning-app.json', ['qa/artifacts/threat-warning-1.png', 'qa/artifacts/threat-warning-2.png'], [
  ['a listed phishing address gets the warning page ERR_BLOCKED_BY_CLIENT with Go back and Continue anyway', j => /BLOCKED_BY_CLIENT/.test(j.phish.tab.error) && j.phish.title === 'Acira blocked a dangerous page' && j.phish.buttons.includes('Continue anyway (unsafe)') && /phishing/.test(j.phish.message)],
  ['Continue anyway (after a second confirmation) lets that one site through', j => j.afterContinue.tab.error === null && j.afterContinue.title === 'phish page'],
  ['a clean page of the same site loads and a listed script inside it is blocked (clean script ran)', j => j.ok.tab.error === null && j.ok.payloadRan === false && j.ok.cleanScriptRan === true],
  ['an address that only looks similar to a listed one is not blocked', j => j.boundary.tab.error === null && j.boundary.title === 'phishing2 page'],
  ['a listed malware address gets the malware warning', j => /BLOCKED_BY_CLIENT/.test(j.malware.tab.error) && /malware/.test(j.malware.message)]]);
const pageRiskVerify = artifactJudge('qa/artifacts/page-risk-app.json', ['qa/artifacts/page-risk-lookalike.png'], [
  ['an ordinary sign-in page raises no warning (control)', j => j.ok.risk === null],
  ['a page that presents itself as PayPal on another address is flagged as a look-alike sign-in', j => j.login.risk?.kind === 'lookalike' && /PayPal/.test(j.login.risk.title)],
  ['a ClickFix page that copies a command is stopped and flagged', j => j.lureRiskAfterClick?.kind === 'clickfix'],
  ['the look-alike address paypa1.com is stopped with the warning page', j => /BLOCKED_BY_CLIENT/.test(j.lookalike.error) && j.lookalikeTitle === 'Acira blocked a look-alike address'],
  ['with the switch off the look-alike sign-in is not flagged', j => j.switchedOff.risk === null]]);
const ROWS = [
  {id: 'ads-trackers', feature: 'Ad and tracker blocking on real ad-heavy sites',
    checked: 'Loads real, ad-heavy public sites. Each ad request the page makes is watched from outside the blocker; the blocked count in the protection popup must equal the count the blocker keeps and match the blocked requests we saw; with the site switch off the same ad hosts load and the count stays 0; back on, blocked again. One fully measured site gates the row (several ad sites serve this automated rig few ads, or never let the popup settle); the others are tried while the time budget lasts.',
    steps: [{name: 'live-blocking', script: 'qa/r3-proof/live-blocking.mjs', timeout: 540, needsNet: true}]},
  {id: 'popup-ads', feature: 'Pop-up and pop-under ad blocking',
    checked: 'Script-opened windows to listed ad networks, fake Ctrl+click, bridge pages and unlisted pop-unders are refused or closed with a notice; sign-in windows, links the person clicked and the site\'s own pop-outs still open; the per-site switch turns it off and on.',
    steps: [{name: 'r3-popup-ads', script: 'qa/r3-popup-ads.mjs', ownSlot: true, timeout: 420, env: {D_VISIBLE: '1'}, /* the pop-under check needs a real, focusable window */ evidenceFiles: ['.qa-profiles/r3-popup-ads/results.json']}]},
  {id: 'cookie-banners', feature: 'Cookie-banner hiding',
    checked: 'A consent banner (reviewed consent-manager markup, as on real sites) is hidden in the real app and the page under it stays clickable; real consent sites are measured with the setting off (control) and on; the per-site switch brings it back and hides it again.',
    steps: [{name: 'cookie-banners', script: 'qa/r3-proof/cookie-banners.mjs', timeout: 540, needsNet: true}]},
  {id: 'ai-free-bing', feature: 'AI-free mode on Bing (real page)',
    checked: 'A real Bing results page is loaded with AI-free mode off (control) and on, each in a fresh profile; the Copilot answer block visible in the control is hidden with it on, the quiet "AI answer hidden - Show" line appears, the organic results stay and Show brings the block back.',
    steps: [{name: 'ai-free-bing', script: 'qa/r3-proof/live-ai-free.mjs', env: {PROOF_ENGINES: 'bing'}, timeout: 300, needsNet: true}]},
  {id: 'ai-free-duckduckgo', feature: 'AI-free mode on DuckDuckGo (real page)',
    checked: 'A real DuckDuckGo results page is loaded with AI-free mode off (control) and on, each in a fresh profile; the Search Assist answer visible in the control is hidden with it on, the quiet line appears, the organic results stay and Show brings the block back.',
    steps: [{name: 'ai-free-duckduckgo', script: 'qa/r3-proof/live-ai-free.mjs', env: {PROOF_ENGINES: 'duckduckgo'}, timeout: 300, needsNet: true}]},
  {id: 'ai-free-google', feature: 'AI-free mode on Google (real page and a Google-shaped test page)',
    checked: 'A Google-shaped page (served as www.google.com, three load styles, frame by frame) never paints an AI element and shows the quiet line aligned with the results column; with the site switch off the block paints (control). The real google.com results page is tried too: Google answers automated browsers from some networks with a human check, which is reported as not proven, never as a pass.',
    steps: [{name: 'r3-ai-free', script: 'qa/r3-ai-free.mjs', ownSlot: true, timeout: 300, evidenceFiles: ['C:/ae/r3/privacy/evidence/app-ai-free-sync-light.png']}, {name: 'ai-free-google', script: 'qa/r3-proof/live-ai-free.mjs', env: {PROOF_ENGINES: 'google'}, timeout: 300, needsNet: true}]},
  {id: 'chrome-promo', feature: 'Google "Choose Chrome" promo hidden',
    checked: 'google.com is opened in the real app; the page sees a Chrome identity (so Google has no reason to show the promo) and no "Switch to Chrome / Get Chrome" banner or dialog is on screen; a Google-shaped page carrying the promo markup is hidden by the filter and shown again when the filter is off.',
    steps: [{name: 'chrome-promo', script: 'qa/r3-proof/chrome-promo.mjs', timeout: 420, needsNet: true}]},
  {id: 'phishing', feature: 'Phishing / look-alike warning',
    checked: 'A listed phishing host gets the warning page (the rest of the site loads, "Continue anyway" lets it through); a look-alike sign-in address and a ClickFix page are flagged; the switch turns the check off. All on local test pages.',
    steps: [{name: 'threat-warning', script: 'qa/privacy-plus/threat-warning-app.mjs', timeout: 300, verify: threatVerify}, {name: 'page-risk', script: 'qa/privacy-plus/page-risk-app.mjs', timeout: 300, verify: pageRiskVerify}]},
  {id: 'https-only', feature: 'HTTPS-only upgrade',
    checked: 'With HTTPS-only on, an http:// address is upgraded to https:// before any request goes out (a TLS-only server only answers the upgraded request) and a real public site typed with http:// ends on https://; a site that cannot do HTTPS is not silently downgraded (no http request is sent) and the person is offered Allow HTTP, which loads that one site after the review; off by default, and off again after.',
    steps: [{name: 'https-only', script: 'qa/r3-proof/local-privacy.mjs', env: {PROOF_PART: 'https'}, timeout: 300, needsNet: true}]},
  {id: 'third-party-cookies', feature: 'Third-party cookies blocked',
    checked: 'The engine reports third-party cookies blocked; a site opened on its own sets a cookie; the same site inside another site\'s iframe is neither sent that cookie nor able to read it, and the cookie the iframe tried to set is refused; the first-party cookie of the page works; the iframe really loaded (control).',
    steps: [{name: 'third-party-cookies', script: 'qa/r3-proof/local-privacy.mjs', env: {PROOF_PART: 'cookies'}, timeout: 300}]},
  {id: 'farbling', feature: 'Fingerprint farbling present',
    checked: 'The same canvas drawing reads differently with fingerprint protection Standard than Off (and the hardware values are set), and the setting reaches the next tab; hidden-tracker (CNAME) blocking and tracking-redirect skipping answer the same way.',
    steps: [{name: 'privacy-plus-app-check', script: 'qa/privacy-plus/app-check.mjs', timeout: 300, needsNet: true}]},
  {id: 'link-cleaning', feature: 'Link cleaning and de-AMP',
    checked: 'Tracking parameters leave cross-site navigations before the request is sent (same-site keeps them; the switch turns it off); an AMP page is replaced by its canonical page with no history entry; spelling dictionaries come from the Acira location with no Google dictionary host.',
    steps: [{name: 'k-privacy-nav', script: 'qa/k-privacy-nav.mjs', timeout: 300}]},
  {id: 'tor', feature: 'Tor tabs and windows',
    checked: 'Real bootstrap (PROOF_TOR_FRESH=1 starts from an empty Tor folder: on a slow network its descriptor download can pass the 5 minute connect limit); check.torproject.org says "Congratulations"; a second Tor tab, a Tor window and a third tab never start a second tor.exe or a second bootstrap; New Tor identity leaves one fresh tab and the exit address changes (retried; Tor may reuse an exit); no local DNS lookup of the sites a Tor tab opens, and WebRTC gathers nothing; tor.exe ends with Acira.',
    steps: [{name: 'n-tor-session', script: 'qa/n-tor-session.mjs', args: process.env.PROOF_TOR_FRESH === '1' ? ['--fresh'] : [], timeout: 540, needsNet: true}, {name: 'tor-identity', script: 'qa/r3-proof/tor-identity.mjs', timeout: 420, needsNet: true}, {name: 'n-tor-window', script: 'qa/n-tor-window.mjs', timeout: 420, needsNet: true, artifacts: ['n-tor']}]},
  {id: 'private-tabs', feature: 'Private tabs leave nothing on disk',
    checked: 'A marker only the private tabs know is searched for in every file of the profile folder after a normal quit and after a hard kill (an ordinary-tab marker is the control); each private tab is its own empty session; a private tab\'s New tab page shows nothing from the profile\'s history.',
    steps: [{name: 'd-private-tabs', script: 'qa/d-private-tabs.mjs', timeout: 420}, {name: 'd-private-newtab', script: 'qa/d-private-newtab.mjs', timeout: 240}]},
  {id: 'proxy', feature: 'Proxy routing (HTTP and SOCKS5)',
    checked: 'Real HTTP and SOCKS5 proxies (with and without sign-in) run on this PC; a page served only through a proxy shows the address its connection came from: through the proxy, not direct. No local lookup of the site name goes out while a proxy is set.',
    steps: [{name: 'r3-network-proxy', script: 'qa/r3-network-proxy.mjs', ownSlot: true, timeout: 540, evidenceFiles: ['C:/ae/r3/network/evidence/results.json']}, {name: 'dns-http', script: 'qa/r3-dns-leak.mjs', args: ['http'], ownSlot: true, timeout: 240, verify: dnsVerify('http')}, {name: 'dns-socks5', script: 'qa/r3-dns-leak.mjs', args: ['socks5'], ownSlot: true, timeout: 240, verify: dnsVerify('socks5')}]},
  {id: 'vpn', feature: 'VPN app control (fake client)',
    checked: 'Mullvad / IVPN / Proton controls through a stand-in client: Connect and Disconnect call only the allowed commands, state and failures show in the toolbar popup and in Settings, unsupported providers/actions are refused, and no account text ever reaches the interface. No real VPN program or network setting is touched.',
    steps: [{name: 'vpn-controls', script: 'qa/vpn-controls.mjs', timeout: 480, artifacts: ['vpn-controls-']}]},
  {id: 'peek', feature: 'Peek (page preview)',
    checked: 'Shift+click opens a floating preview, Esc closes it, "Open as tab" keeps the same page and its history, "Open in split" works, downloads are blocked inside it, and a private tab\'s Peek stays in the private session.',
    steps: [{name: 'h-peek', script: 'qa/h-peek.mjs', args: ['--shots', '{evidence}'], timeout: 300, env: {D_VISIBLE: '1'} /* press-and-hold needs a window that really paints: a hidden one defers pointer-move events to the next frame */}]},
  {id: 'split', feature: 'Split view: open and unsplit',
    checked: 'Two tabs are opened side by side (both pages live), the layout changes, the split is renamed, then Unsplit returns both tabs to ordinary tabs with their pages and history intact and Close split closes the pair; Ctrl+Shift+S and Alt+click open one too.',
    steps: [{name: 'split-unsplit', script: 'qa/r3-proof/split-unsplit.mjs', timeout: 300}, {name: 'h-split', script: 'qa/h-split.mjs', args: ['--shots', '{evidence}'], timeout: 300}]},
  {id: 'rewind', feature: 'Rewind: restore a closed tab',
    checked: 'Closed tabs are captured, the Rewind page lists them, a chosen tab is restored (additive, the rest untouched), history deletion and a restart keep the timeline; Ctrl+Shift+T undo-close brings the last tab back.',
    steps: [{name: 'h-rewind', script: 'qa/h-rewind.mjs', args: ['--shots', '{evidence}'], timeout: 360}, {name: 'h-undo', script: 'qa/h-undo.mjs', args: ['--shots', '{evidence}'], timeout: 300}]},
  {id: 'bookmarks', feature: 'Bookmarks: star save and edit',
    checked: 'The address-bar star is disabled on a non-website page; on a page it saves, opens the editor (rename, Enter), Ctrl+D edits without duplicating, the saved bookmark and its selected star survive a restart, Remove clears it. The same run drives the Ads-and-trackers popup (switch for the site, state returned) in light and dark at 100% and 150%.',
    steps: [{name: 'quick-protection-bookmark', script: 'qa/quick-protection-bookmark.mjs', timeout: 540, artifacts: ['quick-protection-bookmark']}]},
  {id: 'import', feature: 'Import from Chrome and Firefox (synthetic profiles)',
    checked: 'Fixture Chrome (two profiles) and Firefox profiles are built under .qa-profiles with a redirected LOCALAPPDATA/APPDATA (no real browser is ever read): Acira finds them, previews, imports bookmarks and history with the right counts, a second import adds nothing twice, extensions are listed as inventory only. Undo removes exactly what an import added.',
    steps: [{name: 'import-fixtures', script: 'qa/r3-proof/import-fixtures.mjs', timeout: 300}]},
  {id: 'passwords', feature: 'Passwords vault: save and fill',
    checked: 'On local fake sites with credentials generated by the test, the in-page prompt saves a sign-in, the vault holds it encrypted, the saved login fills the form, Settings lists, edits, exports and deletes it. The Windows check is replaced by the vault\'s explicit test substitute: the real Windows Hello / PIN prompt is a founder hand check.',
    steps: [{name: 'h-passwords-pages', script: 'qa/h-passwords-pages.mjs', args: ['--shots', '{evidence}'], timeout: 420}, {name: 'h-passwords-settings', script: 'qa/h-passwords-settings.mjs', args: ['--shots', '{evidence}'], timeout: 420}],
    handCheck: 'Real Windows Hello / PIN prompt when unlocking the vault (never triggered by QA).'},
  {id: 'extensions', feature: 'Chrome Web Store: extension install',
    checked: 'uBlock Origin Lite is downloaded from the real Chrome Web Store through Acira\'s install path (CRX verified, permission review shown, loaded into the isolated profile), appears in the extension list and works on a page; Dark Reader installs the same way.',
    steps: [{name: 'cws-install', script: 'qa/r3-proof/cws-install.mjs', timeout: 480, needsNet: true}]},
  {id: 'update-feed', feature: 'Auto-update feed',
    checked: 'The packaged (installed-style) app, older than the feed, checks a local feed with a newer version, downloads the installer, verifies its SHA-512 and reaches "ready"; the Stable/Beta channel switch works. Packaged build: ' + PACKAGED.replace(/\\/g, '/'),
    steps: [{name: 'update-feed', script: 'qa/r3-proof/update-feed.mjs', args: [FEED], timeout: 480}]},
  {id: 'usage-metrics', feature: 'Usage metrics payload ("See what\'s sent")',
    checked: 'The usage message is built from real state; "See what\'s sent" shows exactly that payload; counters count only while the setting is on; nothing is counted while off; no endpoint is configured in this build, so nothing is sent (a local test endpoint receives the preview payload only after opt-in, and nothing before).',
    steps: [{name: 'r3-metrics-smoke', script: 'qa/r3-metrics-smoke.mjs', ownSlot: true, timeout: 240}, {name: 'usage-consent', script: 'qa/usage-consent.mjs', timeout: 360, artifacts: ['usage-consent-']}, {name: 'metrics-app', script: 'qa/privacy-plus/metrics-app.mjs', timeout: 240}]},
];

// ---------------------------------------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--list')) { for (const row of ROWS) console.log(row.id.padEnd(16), row.feature, '\n'.padEnd(18) + row.steps.map(s => s.name).join(', ')); process.exit(0); }
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',').map(s => s.trim()).filter(Boolean) : null; })();
if (only && only.some(id => !ROWS.some(row => row.id === id || row.steps.some(step => step.name === id)))) throw new Error('Unknown row or step in --only (see --list).');

function withHeldSlot(name, fn) {
  return (async () => {
    const until = Date.now() + 20 * 60 * 1000; let held = null;
    while (!held && Date.now() < until) {
      for (const n of [1, 2, 3]) {
        const file = `C:\\ae\\slot-${n}.lock`;
        try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `proof-${name} ${new Date().toISOString()}`); fs.closeSync(fd); held = file; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!held) await sleep(30000);
    }
    if (!held) throw new Error('No native slot became free in 20 minutes.');
    try { return await fn(); } finally { try { fs.unlinkSync(held); } catch {} }
  })();
}

function runScript(step, dir) {
  return new Promise(resolve => {
    const log = path.join(dir, 'log.txt'); fs.writeFileSync(log, '');
    const stepArgs = (step.args || []).map(a => a === '{evidence}' ? dir : a);
    const env = {...process.env, ...(step.env || {}), PROOF_EVIDENCE: dir, PROOF_RESULT: path.join(dir, 'result.json'), PROOF_SLOT_HELD: step.ownSlot ? '0' : '1', ACIRA_PASSWORDS_TEST_GATE: 'allow', ACIRA_EXT_MATRIX_RUN: 'proof-' + Date.now().toString(36)};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.D_APP_EXE; // only the update-feed step sets it, for its own child
    const started = Date.now(); let timedOut = false, tail = '';
    const child = spawn(process.execPath, [step.script, ...stepArgs], {env, cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const append = data => { const text = String(data); fs.appendFileSync(log, text); tail = (tail + text).slice(-8000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const stop = () => { if (child.pid && child.exitCode === null) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); else child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, (step.timeout || 420) * 1000);
    child.on('error', error => append('spawn error: ' + error.message));
    child.on('close', code => { clearTimeout(timer); resolve({code, timedOut, tail, log, seconds: Math.round((Date.now() - started) / 1000)}); });
  });
}

/** Screenshots and result files a script saved under qa/artifacts/<prefix>* during this run are copied next to the log. */
function collectArtifacts(step, dir, startedAt) {
  const base = path.resolve('qa/artifacts'), out = [];
  const walk = (folder, depth) => { let names = []; try { names = fs.readdirSync(folder, {withFileTypes: true}); } catch { return; } for (const entry of names) { const full = path.join(folder, entry.name); if (entry.isDirectory() && depth < 3) walk(full, depth + 1); else if (entry.isFile() && /.(png|json)$/i.test(entry.name) && fs.statSync(full).mtimeMs >= startedAt - 1000) out.push(full); } };
  for (const prefix of step.artifacts || []) for (const name of (fs.existsSync(base) ? fs.readdirSync(base) : [])) if (name.startsWith(prefix)) walk(path.join(base, name), 0);
  const picked = [...out.filter(f => /.png$/i.test(f)).slice(0, 6), ...out.filter(f => /.json$/i.test(f)).slice(0, 2)], copied = [];
  for (const from of picked) { const to = path.join(dir, path.basename(path.dirname(from)).slice(0, 24) + '-' + path.basename(from)); try { fs.copyFileSync(from, to); copied.push(to); } catch {} }
  return copied;
}

async function runStep(row, step) {
  const dir = path.join(EVIDENCE, step.name); fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
  console.log(`\n=== [${row.id}] ${step.name}${step.ownSlot ? '' : ' (suite takes a slot)'}`);
  const startedAt = Date.now();
  const run = await (step.ownSlot ? runScript(step, dir) : withHeldSlot(step.name, () => runScript(step, dir)));
  const result = readJson(path.join(dir, 'result.json'));
  const failedChecks = result?.checks?.filter(c => !c.ok) || [];
  let ok = run.code === 0 && !run.timedOut && !(result && result.ok === false);
  const skipped = /"skipped"\s*:\s*true|\bSKIP\b/.test(run.tail) && !/PASS/.test(run.tail);
  if (skipped) ok = false;
  let detail = run.timedOut ? `Timed out after ${step.timeout || 420}s; process tree stopped.` : '';
  let files = [...(result?.files || [])], summaryFromVerify = null;
  if (step.verify) { const verdict = step.verify({run, result, dir, startedAt}); ok = ok && verdict.ok; detail = (detail ? detail + ' ' : '') + verdict.detail; files.push(...(verdict.files || [])); if (verdict.summary?.length) summaryFromVerify = verdict.summary; }
  if (!ok && !detail) detail = failedChecks.length ? failedChecks.map(c => `${c.name}${c.detail ? ' (' + c.detail + ')' : ''}`).join('; ') : run.tail.split('\n').filter(Boolean).slice(-4).join(' | ');
  if (ok && !detail) detail = (result?.summary || []).join('; ') || (run.tail.match(/\d+\/\d+ passed/) || [''])[0];
  files.push(...collectArtifacts(step, dir, startedAt));
  for (const extra of step.evidenceFiles || []) if (fs.existsSync(path.resolve(extra))) files.push(path.resolve(extra));
  const pics = fs.readdirSync(dir, {recursive: true}).filter(f => /\.(png|jpg)$/i.test(String(f))).map(f => path.join(dir, String(f)));
  return {name: step.name, ok, code: run.code, seconds: run.seconds, detail, log: run.log, files: [...new Set([...files.map(f => path.resolve(f)), ...pics])].slice(0, 12), checks: result ? {passed: result.passed, total: result.total} : null, summary: summaryFromVerify || result?.summary || []};
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
const saved = readJson(RESULTS) || {rows: {}};
const toRun = ROWS.filter(row => !only || only.includes(row.id) || row.steps.some(step => only.includes(step.name)));
if (!args.includes('--report')) {
  for (const row of toRun) {
    const previous = saved.rows[row.id]?.steps || [];
    const stepResults = [];
    for (const step of row.steps) {
      if (only && !only.includes(row.id) && !only.includes(step.name)) { const old = previous.find(s => s.name === step.name); if (old) stepResults.push(old); continue; } // a single step re-run keeps the row's other steps
      const result = await runStep(row, step).catch(error => ({name: step.name, ok: false, detail: String(error.message || error), files: [], log: null}));
      console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${row.id}/${step.name}  ${result.seconds ?? 0}s  ${result.detail ? result.detail.slice(0, 300) : ''}`);
      stepResults.push(result);
    }
    saved.rows[row.id] = {id: row.id, finishedAt: new Date().toISOString(), complete: stepResults.length === row.steps.length, ok: stepResults.length === row.steps.length && stepResults.every(s => s.ok), steps: stepResults};
    saved.commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
    fs.writeFileSync(RESULTS, JSON.stringify(saved, null, 2));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
const FINDINGS = [
  '## Findings, fixes and owners (26 Oct 2026 pass)', '',
  '**Fixed with a test**',
  '- Cookie banners: the Sourcepoint consent wall ("It\'s your choice" on theguardian.com, spiegel.de and many publishers; container id sp_message_container_<number>) stayed on screen with banner hiding ON and the page scroll-locked (screenshot C:/ae/r3/proof/evidence/cookie-banners/theguardian-on.png, measured before the fix). The lists only knew it site by site. desktop/browser-services/annoyance-rules.cjs now hides that container on every site; unit test in tests/services-annoyance-rules.test.cjs. Not yet re-measured on the live sites (the real-site half of the probe is slow and timed out in the last runs; the fixture half passes).',
  '- Stale QA scripts brought in line with the product (test side only): privacy-plus/app-check (new default settings, phishing row), r3-network-proxy (never exited), vpn-controls (setup sheet is now provider rows; Escape closes the innermost layer first), quick-protection-bookmark (native Ctrl+D; the popup briefly holds a second copy of itself), usage-consent (R3-05 tooltip replaces the info popover).', '',
  '**Open, with cause and owner**',
  '- AI-free mode on Google: Google answers this automated browser with a human check (/sorry), so the real page cannot be proven from this network. The Google-shaped page (three load styles, frame by frame) passes. Founder hand check on a normal network. Owner: privacy.',
  '- AI-free mode on DuckDuckGo: one load with the mode ON produced a completely blank page (no header, no results; C:/ae/r3/proof/evidence/live-ai-free/duckduckgo-on.png) while the mode-off control of the same query showed Search Assist and results. Later loads did not show a Search Assist block even with the mode off, so DuckDuckGo is NOT proven. Suspect: the rule button[data-testid="ask"] with unit closest form in desktop/browser-services/ai-surfaces.cjs hides the whole search form (its keep guard only protects blocks that contain results). Owner: privacy. Re-run: node qa/r3-feature-proof.mjs --only ai-free-duckduckgo.',
  '- Switch controls ignore pointer clicks in the test rig: the protection popup switch "Block ads and trackers on this site" and the setup step switch "Share anonymous usage" do not toggle on Playwright or native synthetic mouse clicks (service state stays unchanged), while a DOM click() toggles them at once. Real mouse behaviour needs a hand check on both. Owner: chrome / motion (R3-19 toggle sweep, R3-20 popup panel). This stops quick-protection-bookmark and usage-consent at those steps; the bookmark star, editor and native Ctrl+D parts run before it.',
  '- Tor from an empty folder: the first bootstrap in a fresh folder stalled at 50% (relay descriptors) and ended with "Can\'t reach the Tor network" after the 5 minute limit on this network; the next start from the partly downloaded cache connected in 136 s, and every later Tor step passes. Owner: tor (consider a longer limit or an automatic retry while descriptors are still arriving). PROOF_TOR_FRESH=1 re-runs the cold start.',
  '- Ad and tracker blocking on real sites: the mechanism is proven on real pages, but the last saved run did not measure (ad networks served this rig no ads at that moment; the repeated visits from one address may be throttled, and the step ran into its time limit). Measured earlier the same evening, two runs, logs overwritten by the later runs: cnet.com popup "7 blocked on this page" = blocker 7, 9 requests seen failing as blocked of 52, 3 ad-host loads with the site switch off vs 0 with it on, switch off gives blocker 0 and popup 0, back on gives 10 vs 10 (an earlier run: popup 9 = blocker 9, 11 seen of 143); thesun.co.uk popup 5 = blocker 5, 5 seen of 33, 1 ad-host load off vs 0 on, off gives 0, back on 8 vs 9. The probe (qa/r3-proof/live-blocking.mjs) keeps every number in its log; re-run it with node qa/r3-feature-proof.mjs --only live-blocking and keep C:/ae/r3/proof/evidence/live-blocking/ (each run overwrites it). Owner of a follow-up: whoever runs the final pass on a quiet connection.',
  '- The phishing/malware protection row says on while the lists are still downloading ("Pages are not checked yet"). Owner: privacy (the state should say updating until a list is loaded).',
  '- The cookie-banner and live-blocking real-site halves are slow on this machine (ad pages never finish loading); both have time budgets. Region matters: BBC, Le Monde, Booking and others showed no banner here, so they are not counted.',
  '- The auto-update row runs the packaged app from a copy of C:/ae/rel5/win-unpacked (25 Oct build whose updater code is identical to this tree); it is not a build of this exact commit. A packaged build of the final commit needs a real node_modules (a junction drops dependencies), so it was not rebuilt here.',
];
const cell = text => String(text ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim();
const rel = file => file.replace(/\\/g, '/');
const lines = [];
// A row where only some steps have run so far (and none failed) is shown as NOT RUN; a failed step shows FAIL at once.
const finished = ROWS.map(row => {
  const stored = saved.rows[row.id];
  if (!stored) return {row, got: undefined};
  const steps = stored.steps.filter(step => row.steps.some(s => s.name === step.name)); // steps removed from the row since the run are ignored
  const complete = row.steps.every(s => steps.some(step => step.name === s.name));
  const got = {...stored, steps, complete, ok: complete && steps.every(step => step.ok)};
  return {row, got: !complete && steps.every(s => s.ok) ? undefined : got};
});
const pass = finished.filter(r => r.got?.ok).length, fail = finished.filter(r => r.got && !r.got.ok).length, notRun = finished.filter(r => !r.got).length;
lines.push('# Feature proof (R3-44)', '',
  `Run by \`node qa/r3-feature-proof.mjs\` on the real app (Electron ${process.versions.electron || 'source tree'}, source build ${saved.commit || 'unknown'}), one isolated profile per row, at most one native app at a time. Every row is a real run with evidence; nothing here is a unit test of a service on its own.`, '',
  `**Result: ${pass} PASS, ${fail} FAIL${notRun ? `, ${notRun} NOT RUN` : ''} (of ${ROWS.length} rows).** Latest result per row; evidence paths are on the machine that ran the suite (\`C:/ae/r3/proof/evidence/<step>/\`, \`log.txt\` is the full output).`, '',
  '| Feature | What we checked | Result | Evidence |', '|---|---|---|---|');
for (const {row, got} of finished) {
  const verdict = got ? (got.ok ? 'PASS' : 'FAIL') : 'NOT RUN';
  const evidence = got ? got.steps.flatMap(step => [step.log && rel(step.log), ...(step.files || []).map(rel)]).filter(Boolean) : [];
  const unique = [...new Set(evidence)];
  const shown = unique.slice(0, 5).map(f => '`' + f + '`').join('<br>') + (unique.length > 5 ? `<br>(+${unique.length - 5} more in the same folders)` : '');
  const measured = got ? got.steps.map(step => step.summary?.length ? step.summary.join('; ') : (step.ok ? step.detail : '')).filter(Boolean).join(' / ') : '';
  lines.push(`| ${cell(row.feature)} | ${cell(row.checked)}${measured ? ' **Measured:** ' + cell(measured).slice(0, 700) : ''} | **${verdict}** | ${shown || '-'} |`);
}
const failures = finished.filter(r => r.got && !r.got.ok);
if (failures.length) {
  lines.push('', '## Failures', '');
  for (const {row, got} of failures) for (const step of got.steps.filter(s => !s.ok)) lines.push(`- **${row.feature}** / \`${step.name}\`: ${cell(step.detail).slice(0, 600)}`);
}
// Findings from the last full pass (causes, owners, what was fixed): written by hand after reading the logs, kept beside the suite.
lines.push('', ...FINDINGS);
const hand = ROWS.filter(row => row.handCheck);
lines.push('', '## Founder hand checks (never done by QA)', '', ...hand.map(row => `- ${row.feature}: ${row.handCheck}`),
  '- Packaged installer on a clean Windows user (install, first run, uninstall) is covered by the packaging runs, not by this suite.');
lines.push('', '## Re-running', '', '`node qa/r3-feature-proof.mjs --only <row id>` re-runs one row (ids: `--list`); `--report` rebuilds this file from the saved results. Time limit per step 4-9 minutes; a step holds one native slot while it runs.', '');
fs.writeFileSync(REPORT, lines.join('\n'));
console.log(`\nReport: ${REPORT}\n${pass} PASS, ${fail} FAIL, ${notRun} NOT RUN`);
process.exit(fail || notRun ? 1 : 0);
