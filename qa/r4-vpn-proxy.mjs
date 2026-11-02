// Round 4 (vpn-proxy) R4-06 / R4-08 / R4-08b / R4-09: every Connection control, clicked with real input, in setup AND in Settings,
// against a fake provider boundary (VPN) and real local proxies (qa/r3-proxy-servers.cjs). One native slot, one app, closed in finally.
//   node qa/r4-vpn-proxy.mjs [--tone=dark|light] [--zoom=1|1.5] [--setup-only]
// Evidence: C:\ae\r4\vpn-proxy\evidence\<tag>-*.png and results-<tag>.json (control | surface | result | evidence).
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, sleep, poll, finaleEnded} from './d-harness.mjs';
import {EVIDENCE, results, shot, strip, takeSlot, installFakeVpn, reachPrivacy, answerConfirm} from './r4-lib.mjs';
const require = createRequire(import.meta.url);
const S = require('./r3-proxy-servers.cjs');
const arg = (name, fallback) => { const hit = process.argv.find(item => item.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : process.argv.includes('--' + name) ? true : fallback; };
const tone = arg('tone', 'dark'), zoom = Number(arg('zoom', 1)), setupOnly = Boolean(arg('setup-only', false)), settingsOnly = Boolean(arg('settings-only', false));
const tag = `${tone}${Math.round(zoom * 100)}${process.env.R4_TAG || ""}`;
const {row, finish} = results(`results-${tag}.json`);
const release = await takeSlot('vpn-proxy-r4-' + tag);
const ROOT = `.qa-profiles/r4-ui-${tag}-${Date.now()}`;
let app, origin, http1, httpAuth, socksOpen, socksAuth;
// Hard cap: a stuck step must not hold a native slot or leave the app running.
const watchdog = setTimeout(async () => { console.log('WATCHDOG: run exceeded 7 minutes'); row('script', 'harness', false, 'watchdog'); await finish().catch(() => {}); try { app?.process().kill(); } catch {} await release().catch(() => {}); process.exit(2); }, 7 * 60 * 1000);
const vpnModule = path.resolve('desktop/browser-services/vpn-control.cjs');
let counter = 0;
const ipOf = r => /^ip (\S+)/.exec(r?.title || '')?.[1] || null;
const snap = name => shot(app, `${tag}-${name}`);

try {
  origin = await S.startOrigin();
  const names = {'echo.acira.test': origin.port};
  http1 = await S.startHttpProxy({names});
  httpAuth = await S.startHttpProxy({names, auth: {user: 'tester', pass: 'correct-horse'}});
  socksOpen = await S.startSocks5({names});
  socksAuth = await S.startSocks5({names, auth: {user: 'tester', pass: 'correct-horse'}});
  app = await startApp({root: ROOT, skipSetup: settingsOnly, args: ['--host-resolver-rules=MAP direct.acira.test 127.0.0.1']});
  const ui = app.ui;
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setSkipTaskbar(true); w.setBounds({x: 60, y: 30, width: 1440, height: 900}); });
  if (zoom !== 1) await app.main(({webContents}, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === 'acira-browser-ui://ui/index.html') c.setZoomFactor(f); }, zoom);
  // The proxy change is confirmed in a native message box (an OS dialog input cannot drive); record it and accept.
  await app.main(({dialog}) => { globalThis.__dialogs = []; dialog.showMessageBox = async (...args) => { const o = args.at(-1); globalThis.__dialogs.push({message: o.message, buttons: o.buttons}); return {response: globalThis.__answer ?? 1, checkboxChecked: false}; }; });
  await installFakeVpn(app, vpnModule);
  // Other agents' windows share this machine and can hold the foreground. Log whether ours has it when Apply is pressed; R4_FOCUS=1 takes it first.
  const beforeApply = async label => {
    if (process.env.R4_FOCUS) await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setAlwaysOnTop(true); w.moveTop(); w.focus(); });
    console.log('FOCUS at Apply', label, JSON.stringify(await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({focused: w.isFocused(), visible: w.isVisible()})))));
    // Arm the native-box fallback for this Apply: the answer it gives (Cancel = 0) and the count to beat (taken before the click).
    armed.baseline = await app.main((_e, answer) => { globalThis.__answer = answer; return globalThis.__dialogs.length; }, /cancel/.test(label) ? 0 : 1);
  };
  // Acira's own confirm window answers first; the native-box stub above is the fallback when no window can host it.
  const armed = {baseline: undefined};
  const confirmChange = (buttonName, within = 10000) => answerConfirm(app, buttonName, {within, baseline: armed.baseline, evidence: path.join(EVIDENCE, `${tag}-confirm-${buttonName.replace(/W+/g, '-')}.png`)});

  let proxyStatus;
  if (!settingsOnly) {
  // ───────────────────────── SETUP ─────────────────────────
  await ui.waitForSelector('.setup-dialog', {timeout: 30000}); await sleep(2500);
  const connectionRow = await reachPrivacy(ui, {light: tone === 'light'});
  await snap('s01-privacy-step');
  row('Privacy step reaches the Connection row', 'setup', true, await connectionRow.innerText().then(s => s.replace(/\s+/g, ' ')));
  const base = await app.state(), tabs0 = base.tabs.length, active0 = base.activeTabId;

  await connectionRow.click();
  const sheet = ui.locator('.fr-sheet').first();
  await sheet.waitFor(); await sleep(600);
  await snap('s02-connection-sheet-vpn');
  const fit = await sheet.evaluate(node => { const main = node.querySelector('.fr-sheet-main'), foot = node.querySelector('.fr-foot').getBoundingClientRect(), list = node.querySelector('.fr-vpn').getBoundingClientRect(), back = node.querySelector('.fr-sheet-back').getBoundingClientRect(), card = node.getBoundingClientRect(); return {overflow: main.scrollHeight - main.clientHeight, listAboveFoot: Math.round(foot.top - list.bottom), backLeft: Math.round(back.left - card.left), backTop: Math.round(back.top - card.top)}; });
  row('Sheet fits above its footer; Back arrow sits inside the card', 'setup', fit.overflow <= 0 && fit.listAboveFoot >= 8 && fit.backLeft >= 8 && fit.backTop >= 8, JSON.stringify(fit));
  row('Back arrow (top-left) present, tooltip shows Esc', 'setup', await sheet.locator('.fr-sheet-back').count() === 1 && (await sheet.locator('.fr-sheet-back').getAttribute('title') || await sheet.locator('.fr-sheet-back').getAttribute('data-tip-title')) === 'Back · Esc', 'Back · Esc');
  row('Back text button on the footer next to Done', 'setup', await sheet.locator('.fr-foot-start').getByRole('button', {name: 'Back'}).count() === 1 && await sheet.locator('.fr-foot-end').getByRole('button', {name: 'Done'}).count() === 1, 'Back | Done');
  const rowsText = await sheet.locator('.fr-vpn [data-provider]').evaluateAll(nodes => nodes.map(n => n.dataset.provider + ':' + n.dataset.state));
  row('VPN list reads the provider boundary', 'setup', rowsText.join(',') === 'mullvad:disconnected,proton:absent,ivpn:disconnected', rowsText.join(','));

  await sheet.getByRole('button', {name: 'Refresh status', exact: true}).click(); await sleep(400);
  row('Refresh status', 'setup', (await sheet.locator('.fr-vpn [data-provider]').count()) === 3, 'list re-read, 3 providers');

  const mullvad = sheet.locator('.fr-vpn [data-provider="mullvad"]');
  await mullvad.getByRole('button', {name: 'Connect', exact: true}).click();
  await poll(() => mullvad.innerText(), t => /Connected/.test(t), 'mullvad connected', 6000).then(t => row('Connect (Mullvad)', 'setup', true, t.replace(/\s+/g, ' ')), e => row('Connect (Mullvad)', 'setup', false, e.message));
  await snap('s03-mullvad-connected');
  await mullvad.getByRole('button', {name: 'Disconnect', exact: true}).click();
  await poll(() => mullvad.innerText(), t => /Not connected/.test(t), 'mullvad disconnected', 6000).then(t => row('Disconnect (Mullvad)', 'setup', true, t.replace(/\s+/g, ' ')), e => row('Disconnect (Mullvad)', 'setup', false, e.message));
  const calls = await app.main(() => globalThis.__vpn.calls.map(c => c.provider + ' ' + c.args));
  row('Provider CLI received connect and disconnect', 'setup', calls.includes('mullvad connect') && calls.includes('mullvad disconnect'), calls.filter(c => !/status/.test(c)).join(' | '));

  // Get it (Proton): loading → check + Added, pop-up, background tab. A 60Hz-ish frame strip of the button while it happens.
  const proton = sheet.locator('.fr-vpn [data-provider="proton"]');
  const rect = await proton.locator('.fr-get').boundingBox();
  const pad = 8, clip = {x: Math.floor(rect.x - pad), y: Math.floor(rect.y - pad), width: Math.ceil(rect.width + 2 * pad), height: Math.ceil(rect.height + 2 * pad)};
  const seen = [];
  const run = await strip(app, ui, clip, `${tag}-get-it-strip`, async () => {
    await proton.getByRole('button', {name: /Get it/}).click();
    const phases = await ui.evaluate(() => new Promise(resolve => {
      const button = document.querySelector('.fr-vpn [data-provider="proton"] .fr-get'), out = [];
      const tick = () => { const phase = button.dataset.phase; if (out[out.length - 1] !== phase) out.push(phase); if (phase === 'added' || out.length > 6) return setTimeout(() => resolve(out), 700); setTimeout(tick, 16); };
      tick();
    }));
    seen.push(...phases);
  });
  row('Get it → loading → Added', 'setup', seen.join('>') === 'loading>added', `phases ${seen.join('>')}; strip ${run.times.length} frames over ${run.times.at(-1)} ms`);
  await sleep(600);
  await snap('s04-get-it-added');
  const added = await proton.locator('.fr-get').innerText();
  row('Added label and dot-matrix check', 'setup', /Added/.test(added) && await proton.locator('.fr-get canvas[data-preset="check"]').count() === 1, added.replace(/\s+/g, ' '));
  const toastText = await poll(() => ui.evaluate(() => document.querySelector('.setup-toast-host .t-text')?.textContent || ''), Boolean, 'toast', 4000).catch(() => '');
  row('Status pop-up names the page and when you will see it', 'setup', /Proton VPN.s download page is waiting in a new tab — you.ll see it when setup finishes/.test(toastText), toastText);
  const state1 = await app.state(), protonTab = state1.tabs.find(t => /protonvpn\.com/.test(t.url));
  row('Provider page opened as a BACKGROUND tab (setup stays in front)', 'setup', Boolean(protonTab) && state1.activeTabId === active0 && state1.tabs.length === tabs0 + 1, `tabs ${tabs0}→${state1.tabs.length}, active unchanged=${state1.activeTabId === active0}, url=${protonTab?.url}`);
  { const box = await proton.locator('.fr-get').boundingBox(); await ui.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(300); }
  row('Second click on Added opens no second tab', 'setup', (await app.state()).tabs.filter(t => /protonvpn\.com/.test(t.url)).length === 1, 'one proton tab');
  const toastBox = await ui.evaluate(() => { const e = document.querySelector('.setup-toast-host .t-toast'); const r = e?.getBoundingClientRect(); return r ? {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight} : null; });
  row('Pop-up sits bottom-centre inside the window', 'setup', Boolean(toastBox) && Math.abs(toastBox.x + toastBox.w / 2 - toastBox.vw / 2) < 4 && toastBox.y + toastBox.h < toastBox.vh && toastBox.x >= 8, JSON.stringify(toastBox));
  await poll(() => ui.evaluate(() => !document.querySelector('.setup-toast-host .t-toast')), Boolean, 'toast auto-dismisses', 9000).then(() => row('Pop-up auto-dismisses', 'setup', true, 'gone within 9 s'), e => row('Pop-up auto-dismisses', 'setup', false, e.message));

  await app.main(() => { globalThis.__vpn.files.add('C:\\Program Files\\Proton\\VPN\\4.10.1\\ProtonVPN.Launcher.exe'); });
  await sheet.getByRole('button', {name: 'Refresh status', exact: true}).click();
  await poll(() => proton.innerText(), t => /Installed/.test(t), 'proton detected', 6000).then(t => row('Refresh status detects the app once installed', 'setup', true, t.replace(/\s+/g, ' ')), e => row('Refresh status detects the app once installed', 'setup', false, e.message));
  await snap('s05-proton-detected');
  await proton.getByRole('button', {name: 'Open app', exact: true}).click(); await sleep(500);
  const opened = await app.main(() => globalThis.__vpn.opened);
  row('Open app (Proton)', 'setup', opened.length === 1 && /ProtonVPN\.Launcher\.exe$/.test(opened[0]), JSON.stringify(opened));

  await ui.keyboard.press('Escape'); await sleep(500);
  row('Esc goes back to Privacy (VPN tab)', 'setup', await ui.locator('.fr-sheet').count() === 0 && await connectionRow.count() === 1, 'sheet closed, Connection row visible');
  await connectionRow.click(); await sheet.waitFor(); await sleep(400);
  await sheet.locator('.fr-sheet-back').click(); await sleep(500);
  row('Back arrow goes back (VPN tab)', 'setup', await ui.locator('.fr-sheet').count() === 0, 'sheet closed');
  await connectionRow.click(); await sheet.waitFor(); await sleep(400);
  await sheet.locator('.fr-foot-start').getByRole('button', {name: 'Back'}).click(); await sleep(500);
  row('Footer Back goes back (VPN tab)', 'setup', await ui.locator('.fr-sheet').count() === 0, 'sheet closed');

  await connectionRow.click(); await sheet.waitFor(); await sleep(400);
  await sheet.getByRole('radio', {name: 'Set up a proxy'}).click(); await sleep(500);
  await snap('s06-proxy-tab');
  const hostField = sheet.locator('.fr-sheet-input').first(), portField = sheet.locator('.fr-sheet-port');
  const testStatus = sheet.locator('.fr-row small[role="status"]');
  await hostField.fill('127.0.0.1'); await portField.fill('1');
  await sheet.getByRole('button', {name: 'Test proxy', exact: true}).click();
  const refused = await poll(() => testStatus.innerText(), t => /Problem|Works/.test(t), 'refused message', 8000).catch(e => e.message);
  row('Proxy Test: unreachable proxy → clear message', 'setup', /Nothing is listening at 127\.0\.0\.1:1/.test(refused), refused);
  await snap('s07-proxy-unreachable');
  await portField.fill(String(http1.port));
  await sheet.getByRole('button', {name: 'Test proxy', exact: true}).click();
  const worked = await poll(() => testStatus.innerText(), t => /Works/.test(t), 'ok message', 8000).catch(e => e.message);
  row('Proxy Test: working HTTP proxy', 'setup', /Works: 127\.0\.0\.1:\d+ is an HTTP proxy/.test(worked), worked);
  await snap('s08-proxy-test-ok');
  await sheet.locator('.fr-sheet-back').click(); await sleep(600);
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  const dialogs0 = await app.main(() => globalThis.__dialogs.length);
  row('Back with unsaved proxy edits applies nothing', 'setup', proxyStatus.choice.mode === 'system' && dialogs0 === 0, `choice=${proxyStatus.choice.mode}, confirm dialogs=${dialogs0}`);
  await connectionRow.click(); await sheet.waitFor(); await sleep(500);
  const mode = await sheet.locator('.acira-seg [role="radio"][aria-checked="true"]').first().innerText();
  row('Reopened sheet starts from the saved choice, not the abandoned edit', 'setup', /VPN/i.test(mode), 'segment=' + mode);
  await sheet.getByRole('radio', {name: 'Set up a proxy'}).click(); await sleep(300);
  row('Abandoned host/port are gone', 'setup', await hostField.inputValue() === '' && await portField.inputValue() === '', `host='${await hostField.inputValue()}' port='${await portField.inputValue()}'`);
  await hostField.fill('127.0.0.1'); await portField.fill(String(http1.port));
  // Apply asks first, in Acira's own confirm window (a native box when no window can host it). Answer it with a real click.
  const applyStart = Date.now();
  await beforeApply('setup-proxy');
  await sheet.getByRole('button', {name: 'Apply', exact: true}).click();
  const asked1 = await confirmChange('Use this proxy');
  await poll(() => ui.locator('.fr-sheet').count(), n => n === 0, 'sheet closes after Apply', 20000).then(() => row('Apply (proxy) asks, applies and closes the sheet', 'setup', Boolean(asked1), `confirm via ${asked1?.kind}, sheet closed ${Date.now() - applyStart} ms after the click`), e => row('Apply (proxy)', 'setup', false, e.message));
  row('Confirm named the proxy and what it does', 'setup', Boolean(asked1) && asked1.text.includes(`http://127.0.0.1:${http1.port}`) && /Every website you open/.test(asked1.text), String(asked1?.text).replace(/\s+/g, ' ').slice(0, 220));
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  row('Saved proxy is the one typed', 'setup', proxyStatus.choice.mode === 'fixed_servers' && proxyStatus.applied === true, JSON.stringify(proxyStatus.choice));
  await snap('s09-privacy-after-apply');
  row('Connection row now shows the proxy', 'setup', /127\.0\.0\.1/.test(await connectionRow.innerText()), (await connectionRow.innerText()).replace(/\s+/g, ' '));
  // --setup-only (the visible run, real pixels): stop here. A second in-app confirm in the same visible run wedged the harness (see report).
  if (setupOnly) { console.log('SETUP only:', (await finish()) ? 'ALL PASS' : 'SOME FAIL'); throw 'done'; }
  // Back to "Use my VPN app" through the sheet; this time Cancel the confirm first: nothing may change.
  await connectionRow.click(); await sheet.waitFor(); await sleep(400);
  await sheet.getByRole('radio', {name: 'Use my VPN app'}).click(); await sleep(300);
  await beforeApply('setup-cancel');
  await sheet.getByRole('button', {name: 'Apply', exact: true}).click();
  console.log('MARK clicked Apply (cancel path), waiting for confirm'); const asked2 = await confirmChange('Cancel'); console.log('MARK confirm answered', asked2?.kind); await sleep(600);
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  row('Cancel at the confirm leaves the proxy as it was', 'setup', proxyStatus.choice.mode === 'fixed_servers' && await ui.locator('.fr-sheet').count() === 1, `confirm via ${asked2?.kind}; choice=${proxyStatus.choice.mode}; sheet still open`);
  await beforeApply('setup-vpn');
  await sheet.getByRole('button', {name: 'Apply', exact: true}).click();
  await confirmChange('Use this proxy');
  await poll(() => ui.locator('.fr-sheet').count(), n => n === 0, 'closes after Apply', 15000).catch(() => {});
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  row('Apply (Use my VPN app) returns to the computer connection', 'setup', proxyStatus.choice.mode === 'system', JSON.stringify(proxyStatus.choice));

  if (setupOnly) { console.log('SETUP only:', (await finish()) ? 'ALL PASS' : 'SOME FAIL'); throw 'done'; }
  }

  // ───────────────────────── SETTINGS ─────────────────────────
  for (let step = 0; step < 6 && await ui.locator('.setup-dialog').count(); step++) {
    const next = ui.locator('[data-onboarding-next]').filter({visible: true}).first();
    if (!await next.count()) break;
    const label = (await next.innerText()).trim(); await next.click(); await sleep(900);
    if (/Start browsing/i.test(label)) break;
  }
  await finaleEnded(ui);
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500); const settingsTab = (await app.state()).activeTabId;
  // The "Make it yours" panel that follows setup sits over the page: Done dismisses it, like a person would.
  if (await ui.locator('.fr-yours').count()) { await ui.locator('.fr-yours').getByRole('button', {name: 'Done'}).click(); await sleep(700); }
  await ui.getByRole('button', {name: 'Connection', exact: true}).click(); await sleep(800);
  await snap('t01-settings-connection');
  await app.main(() => { globalThis.__vpn.files.delete('C:\\Program Files\\Proton\\VPN\\4.10.1\\ProtonVPN.Launcher.exe'); });
  const panel = ui.locator('.vpn-panel').first();
  await panel.getByRole('button', {name: 'Refresh status', exact: true}).click(); await sleep(800);
  const pRow = id => panel.locator(`.vpn-provider[data-provider="${id}"]`);
  row('Settings › Connection lists the providers', 'settings', await panel.locator('.vpn-provider').count() === 3, (await panel.locator('.vpn-provider').evaluateAll(n => n.map(x => x.dataset.provider + ':' + (x.querySelector('.vpn-state')?.textContent || '')))).join(', '));
  await pRow('mullvad').getByRole('button', {name: 'Connect', exact: true}).click();
  await poll(() => pRow('mullvad').innerText(), t => /reports connected/.test(t), 'settings mullvad connected', 7000).then(t => row('Connect (Mullvad)', 'settings', true, t.replace(/\s+/g, ' ').slice(0, 120)), e => row('Connect (Mullvad)', 'settings', false, e.message));
  await snap('t02-settings-connected');
  await pRow('mullvad').getByRole('button', {name: 'Disconnect', exact: true}).click();
  await poll(() => pRow('mullvad').innerText(), t => /^Mullvad VPN\s+Disconnected/.test(t), 'settings mullvad disconnected', 7000).then(t => row('Disconnect (Mullvad)', 'settings', true, t.replace(/\s+/g, ' ').slice(0, 120)), e => row('Disconnect (Mullvad)', 'settings', false, e.message));
  await pRow('ivpn').getByRole('button', {name: /Configure|Open/}).first().click(); await sleep(500);
  row('Open app / Configure (IVPN)', 'settings', (await app.main(() => globalThis.__vpn.opened)).some(f => /IVPN Client\.exe$/.test(f)), JSON.stringify(await app.main(() => globalThis.__vpn.opened)));
  // Get it in Settings = the provider's website, in a NORMAL (foreground) tab.
  const before = await app.state();
  await pRow('proton').getByRole('button', {name: 'Get it', exact: true}).click(); await sleep(900);
  const afterSite = await app.state(), siteTab = afterSite.tabs.find(t => /protonvpn\.com/.test(t.url) && !before.tabs.some(b => b.id === t.id));
  row('Get it (Proton): opens a normal tab in front', 'settings', Boolean(siteTab) && afterSite.activeTabId === siteTab.id, `new tab ${siteTab?.url}, active=${afterSite.activeTabId === siteTab?.id}`);
  await app.act({type: 'tab.select', id: before.activeTabId}); await sleep(500);
  await pRow('proton').getByRole('button', {name: 'Help', exact: true}).click(); await sleep(900);
  const afterHelp = await app.state();
  row('Help (Proton): opens a tab', 'settings', afterHelp.tabs.length === afterSite.tabs.length + 1 && /protonvpn\.com\/support/.test(afterHelp.tabs.find(t => !afterSite.tabs.some(b => b.id === t.id))?.url || ''), afterHelp.tabs.find(t => !afterSite.tabs.some(b => b.id === t.id))?.url);
  await app.act({type: 'tab.select', id: before.activeTabId}); await sleep(500);
  await app.main(() => { globalThis.__vpn.files.add('C:\\Program Files\\Proton\\VPN\\4.10.1\\ProtonVPN.Launcher.exe'); });
  await panel.getByRole('button', {name: 'Refresh status', exact: true}).click();
  await poll(() => pRow('proton').innerText(), t => /Configure|Open/.test(t), 'settings proton detected', 7000).then(t => row('Refresh status detects the app once installed', 'settings', true, t.replace(/\s+/g, ' ').slice(0, 140)), e => row('Refresh status detects the app once installed', 'settings', false, e.message));
  await snap('t03-settings-proton-detected');
  const openedBefore = (await app.main(() => globalThis.__vpn.opened)).length;
  await pRow('proton').getByRole('button', {name: /Configure/}).click(); await sleep(500);
  row('Configure (Proton): opens the installed app', 'settings', (await app.main(() => globalThis.__vpn.opened)).length === openedBefore + 1, 'app launched');

  // Settings › Connection › proxy form
  const trigger = ui.locator('.st-select-trigger[aria-label^="Connection"]').first();
  await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await sleep(300);
  await ui.getByRole('option', {name: 'Set up a proxy'}).click(); await sleep(500);
  const sHost = ui.getByLabel('Proxy host'), sPort = ui.getByLabel('Proxy port');
  await sHost.fill('127.0.0.1'); await sPort.fill('1');
  await ui.getByRole('button', {name: 'Test proxy', exact: true}).click(); await sleep(1200);
  const refused2 = await ui.locator('.st-note, [data-note]').filter({hasText: /listening/}).first().innerText().catch(() => '');
  row('Proxy Test: unreachable proxy → clear message', 'settings', /Nothing is listening at 127\.0\.0\.1:1/.test(refused2), refused2);
  await snap('t04-settings-proxy-unreachable');
  await sPort.fill(String(http1.port));
  await ui.getByRole('button', {name: 'Test proxy', exact: true}).click(); await sleep(1200);
  const ok2 = await ui.locator('.st-note, [data-note]').filter({hasText: /HTTP proxy/}).first().innerText().catch(() => '');
  row('Proxy Test: working HTTP proxy', 'settings', /is an HTTP proxy/.test(ok2), ok2);
  const settingsApply = async label => {
    const t0 = Date.now();
    await beforeApply('settings-' + label);
    await ui.getByRole('button', {name: 'Apply…', exact: true}).last().click();
    const asked = await confirmChange(label === 'cancel' ? 'Cancel' : 'Use this proxy');
    await sleep(1200); return {asked, ms: Date.now() - t0};
  };
  // Cancel at the confirm first: nothing may change; then really apply.
  const cancelled = await settingsApply('cancel');
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  row('Apply… then Cancel at the confirm leaves the connection as it was', 'settings', Boolean(cancelled.asked) && proxyStatus.choice.mode === 'system', `confirm via ${cancelled.asked?.kind}; choice=${proxyStatus.choice.mode}`);
  const applied = await settingsApply('http');
  proxyStatus = (await app.svc({type: 'proxy.status'})).proxy;
  row('Apply… (HTTP proxy) asks, then applies', 'settings', Boolean(applied.asked) && proxyStatus.choice.mode === 'fixed_servers' && proxyStatus.applied, `confirm via ${applied.asked?.kind}: ${String(applied.asked?.text).replace(/\s+/g, ' ').slice(0, 110)} | ${JSON.stringify(proxyStatus.choice)}`);
  await snap('t05-settings-proxy-applied');
  const visit = async (target, timeout = 20000) => {
    await app.act({type: 'tab.navigate', url: target});
    return poll(async () => { const s = await app.state(), t = s.tabs.find(x => x.id === s.activeTabId); return t && t.url === target && !t.loading ? {title: t.title, error: t.error || null} : null; }, Boolean, 'visit ' + target, timeout);
  };
  const url = (host, p = '/') => `http://${host}:${origin.port}${p}?n=${++counter}`;
  await app.act({type: 'tab.new', url: 'about:blank'}); await sleep(400);
  let r = await visit(url('echo.acira.test'));
  row('Exit address through the HTTP proxy (page sees the proxy side, 127.0.0.2)', 'settings', ipOf(r) === '127.0.0.2', 'ip=' + ipOf(r));
  // back to system through the form (the Settings tab again)
  // (a service call: the form control was clicked above; a second pass through the same select could not be driven after switching tabs in a hidden window)
  await app.main(() => { globalThis.__answer = 1; });
  await app.svc({type: 'proxy.set', choice: {mode: 'system'}});
  r = await visit(url('direct.acira.test'));
  row('Back to Use my VPN app is direct again (127.0.0.1) [service call]', 'settings', ipOf(r) === '127.0.0.1', 'ip=' + ipOf(r));

  console.log('ALL parts:', (await finish()) ? 'ALL PASS' : 'SOME FAIL');
} catch (error) {
  if (error !== 'done') { row('script', 'harness', false, error.stack || error.message); await finish(); process.exitCode = 1; }
} finally {
  clearTimeout(watchdog);
  await Promise.allSettled([app?.close(), origin?.close(), http1?.close(), httpAuth?.close(), socksOpen?.close(), socksAuth?.close()]);
  await release();
}
