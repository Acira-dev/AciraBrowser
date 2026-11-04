'use strict';
// weather.com's empty grey "Advertisement" cards (content-blocking.cjs AD_SLOT_LEFTOVERS, mirrored in helium-annoyances.txt). The lists' only rule for them is
// procedural (weather.com#?#.bg-gray-100:has-text(Advertisement)), which Acira's engine leaves out, so every ad slot left a 90-650 px grey card on the page.
// The rule is plain CSS that the frame preload puts in before the page lays out: the fixture (weather.com's card markup read live on 4 Nov 2026, the real
// scriptlet-preload.cjs) checks it hides exactly the empty cards, keeps a card whose ad did load (also late), never draws an empty card, and moves nothing.
const { test } = require('node:test'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
const made = source.match(/^const AD_SLOT_LEFTOVERS=.*\r?\nconst adSlotStyles=.*$/m);
const { AD_SLOT_LEFTOVERS, adSlotStyles } = made ? new Function(made[0] + ';return {AD_SLOT_LEFTOVERS,adSlotStyles};')() : {};
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();

test('the weather.com rule applies on weather.com only', () => {
  assert.ok(made, 'content-blocking.cjs defines AD_SLOT_LEFTOVERS and adSlotStyles');
  for (const host of ['weather.com', 'www.weather.com', 'WEATHER.COM']) assert.match(adSlotStyles(host), /^section\[aria-label="Advertisement"\]:has\(div\[id\^="WX_"\]\):not\(:has\(iframe\)\) \{ display: none !important; \}$/, host);
  for (const host of ['accuweather.com', 'notweather.com', 'weather.com.evil.test', 'weather.co', 'example.com', '']) assert.equal(adSlotStyles(host), '', host);
});

test('it is put in by the frame preload before the page lays out, only where ad blocking is on for the page, and the own list says the same', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'scriptlet-preload.cjs'), 'utf8');
  const asks = preload.match(/if\((\/.*?\/i)\.test\(location\.hostname\)\)try\{const css=ipcRenderer\.sendSync\('acira:ad-slot-styles',location\.href\);if\(typeof css==='string'&&css\)webFrame\.insertCSS\(css,\{cssOrigin:'user'\}\);\}/);
  assert.ok(asks, 'scriptlet-preload.cjs asks synchronously and inserts a user style sheet at once');
  assert.equal(asks[1], String(AD_SLOT_LEFTOVERS.map(([host]) => host)[0]), 'the preload asks on the same hosts the rules are for');
  assert.ok(preload.indexOf("ipcRenderer.sendSync('acira:ad-slot-styles'") > preload.indexOf('if(process.isMainFrame&&'), 'top-level pages only');
  const handler = source.slice(source.indexOf("ipcMain.on('acira:ad-slot-styles'"), source.indexOf("ipcMain.on('acira:scriptlets'"));
  assert.match(handler, /frame===wc\.mainFrame&&\/\^https\?:\/\.test\(url\|\|''\)&&getOwner\(wc\)&&enabled\(wc\.session,wc,wc\.getURL\(\)\)/, 'the lists\' gate: a tab of Acira with ad blocking on for this site');
  assert.match(handler, /\.active!==false\)css=own/, 'a list exception for the site turns it off too');
  assert.match(handler, /event\.returnValue=css/);
  assert.doesNotMatch(source.slice(source.indexOf("ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters'"), source.indexOf("ipcMain.on('acira:ad-slot-styles'")), /adSlotStyles/, 'not also through the later, asynchronous path');
  const list = ElectronBlocker.parse(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'helium-annoyances.txt'), 'utf8'), { loadNetworkFilters: true, loadCosmeticFilters: true });
  const styles = url => { const u = new URL(url); return list.getCosmeticsFilters({ url, hostname: u.hostname, domain: require('tldts').getDomain(u.hostname), getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromHostname: true, getRulesFromDOM: false }).styles; };
  assert.ok(styles('https://weather.com/').includes(adSlotStyles('weather.com')), 'helium-annoyances.txt carries the same rule');
  assert.doesNotMatch(styles('https://accuweather.com/'), /WX_/);
});

let result = null, problem = '';
if (electron && made) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-adslot-css-')), file = path.join(folder, 'rule.css');
  fs.writeFileSync(file, adSlotStyles('weather.com'));
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron, ['--use-mock-keychain', path.join(__dirname, 'fixtures', 'ad-slot-leftovers', 'run.cjs'), file], { encoding: 'utf8', timeout: 60000, env });
  const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
  if (line) result = JSON.parse(line.slice(7)); else problem = ((run.stdout || '') + (run.stderr || '')).split(/\r?\n/).filter(text => !/^\[\d+:/.test(text)).join('\n').slice(0, 600);
  fs.rmSync(folder, { recursive: true, force: true });
}
const skip = !electron ? 'electron binary not available' : false;

test('the fixture run finished', { skip }, () => { assert.ok(result, problem || 'no result'); });

test('control, without the rule: every empty card takes space on the page', { skip }, () => {
  for (const { before } of result.control) {
    assert.equal(before.host, 'weather.com');
    assert.deepEqual(before.cards, { top: true, swapped: true, filled: true, late: true, noslot: true, news: true });
    assert.ok(before.framesWithEmptyCard > 0);
  }
});

test('with the rule: the empty cards (also with the class swapped) are never drawn, nothing moves, a card with an ad stays, a late ad shows', { skip }, () => {
  assert.equal(result.rule.length, 3);
  for (const [load, { before, after }] of result.rule.entries()) {
    const control = result.control[load].before;
    assert.deepEqual(before.cards, { top: false, swapped: false, filled: true, late: false, noslot: true, news: true }, 'load ' + load);
    assert.ok(before.frames > 10, 'the recorder ran: ' + before.frames);
    assert.equal(before.framesWithEmptyCard, 0, `load ${load}: no frame drew an empty card`);
    assert.equal(before.shifts, 0, `load ${load}: no layout shift`);
    assert.ok(before.forecast.top < control.forecast.top, `the forecast sits where the card was: ${control.forecast.top} → ${before.forecast.top}`);
    assert.equal(after.cards.late, true, 'an ad that arrives late shows its card');
    assert.equal(after.cards.filled, true);
  }
});
