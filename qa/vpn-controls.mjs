import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, poll, sleep, httpFixture, finaleEnded } from './d-harness.mjs';

const stamp = Date.now(), root = `.qa-profiles/vpn-controls-${stamp}`, out = path.resolve(`qa/artifacts/vpn-controls-${stamp}`);
await fs.mkdir(out, { recursive: true });
const checks = [], geometry = []; let status = 'FAIL', failure;
let app, site;
const overlay = () => app.context.pages().find(page => page.url().includes('view=overlay'));
const fixture = update => app.main((_electron, update) => Object.assign(globalThis.__vpnFixture, update), update);
// Escape closes the innermost layer first (an open tooltip or note, then the popup), like every menu: press it until the popup is gone, at most three times.
const escapeUntilClosed = async (popup, label) => {
  for (let press = 1; press <= 3; press++) {
    await popup.keyboard.press('Escape');
    const gone = await poll(() => app.ui.evaluate(() => window.acira.getBrowserLayout()), layout => !layout.overlay, label, 2500).then(() => true, () => false);
    if (gone) { checks.push(label + ' (Escape presses: ' + press + ')'); return press; }
  }
  throw new Error(label + ': the popup did not close after three Escape presses');
};
const shot = async (page, name) => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(200);
  const data = await app.main(async ({ webContents }, url) => (await webContents.getAllWebContents().find(w => w.getURL() === url).capturePage()).toPNG().toString('base64'), page.url());
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
};
try {
  site = await httpFixture((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Ordinary VPN fixture</title><h1>Local ordinary browser session</h1>'); });
  app = await startApp({ root, skipSetup: false });
  // Inject only the provider boundary in this disposable process. No real provider binary or OS network control is called.
  await app.main(({ BaseWindow }, moduleFile) => {
    const win = BaseWindow.getAllWindows()[0]; globalThis.__vpnWindow = win.id;
    win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
    win.setBounds({ x: -20000, y: -20000, width: 1440, height: 900 });
    if (win.getBounds().x > -2000) throw Error('Fixture must stay offscreen');
    win.showInactive(); if (win.isFocused()) throw Error('Fixture stole focus');
    const module = process.getBuiltinModule('module').createRequire(moduleFile)(moduleFile);
    const root = 'C:\\Program Files', files = new Set([
      root + '\\Mullvad VPN\\resources\\mullvad.exe', root + '\\Mullvad VPN\\Mullvad VPN.exe',
      root + '\\IVPN Client\\cli\\ivpn.exe', root + '\\IVPN Client\\ui\\IVPN Client.exe', root + '\\Proton\\VPN\\4.10.1\\ProtonVPN.Launcher.exe',
    ]);
    globalThis.__vpnFixture = { states: { mullvad: 'disconnected', ivpn: 'connected' }, calls: [], opened: [], fail: false, missing: false, unsigned: false };
    const service = module.createVpnControl({
      platform: 'win32', env: { ProgramW6432: root },
      files: { readdirSync: () => ['4.10.1'], realpathSync: file => file, lstatSync: file => {
        if (!files.has(file) || globalThis.__vpnFixture.missing) throw Error('ENOENT');
        return { dev: 1, ino: 1, size: 10, mtimeMs: globalThis.__vpnFixture.unsigned ? 2 : 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false };
      } },
      verify: async () => !globalThis.__vpnFixture.unsigned,
      run: async (file, args) => {
        const fixture = globalThis.__vpnFixture;
        if (!files.has(file) || !file.endsWith('mullvad.exe') && !file.endsWith('ivpn.exe')) throw Error('Unexpected executable in fixture');
        if (!['status --json', 'status', 'connect', 'connect -last', 'disconnect'].includes(args.join(' '))) throw Error('Unexpected provider command');
        const provider = file.endsWith('mullvad.exe') ? 'mullvad' : 'ivpn';
        fixture.calls.push({ provider, args });
        if (fixture.fail) return { ok: false, stdout: 'SECRET ACCOUNT AND ADDRESS MUST NEVER REACH UI' };
        if (args[0] === 'connect') fixture.states[provider] = 'connecting';
        if (args[0] === 'disconnect') fixture.states[provider] = 'disconnected';
        return { ok: true, stdout: provider === 'mullvad' ? JSON.stringify({ state: fixture.states[provider] }) : `Account: PRIVATE\nVPN : ${fixture.states[provider].toUpperCase()}\nFirewall : Disabled\n` };
      },
      openApp: async file => { globalThis.__vpnFixture.opened.push(file); return ''; },
    });
    module.sharedVpnControl = () => service;
  // A packaged build (D_APP_EXE) keeps this module inside resources/app.asar; replacing the copy under the source tree would not reach the app.
  }, process.env.D_APP_EXE ? path.join(path.dirname(path.resolve(process.env.D_APP_EXE)), 'resources', 'app.asar', 'desktop', 'browser-services', 'vpn-control.cjs') : path.resolve('desktop/browser-services/vpn-control.cjs'));
  for (const [providerId, action] of [['mullvad & whoami', 'connect'], ['mullvad', 'login'], ['proton', 'connect']]) await assert.rejects(() => app.svc({ type: 'vpn.command', providerId, action }));
  checks.push('Provider/action enums and unsupported Proton controls reject native calls');

  // Reach setup Privacy without accepting default-browser, account or OS prompts.
  for (let step = 0; step < 8 && !await app.ui.locator('.fr-card-main .fr-row b').filter({ hasText: /^Connection$/ }).count(); step++) {
    await app.ui.locator('[data-onboarding-next]').filter({ visible: true }).first().click(); await sleep(400);
  }
  const connection = app.ui.locator('.fr-card-main button.fr-row').filter({ has: app.ui.locator('b').filter({ hasText: /^Connection$/ }) });
  await connection.click();
  const sheet = app.ui.getByRole('dialog', { name: 'Connection', exact: true });
  // R3-06 rebuilt this sheet as provider rows (.fr-vpn [data-provider]) in the setup card's own glass.
  const rows = sheet.locator('.fr-vpn [data-provider]');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3);
  const mullvad = sheet.locator('.fr-vpn [data-provider="mullvad"]');
  await mullvad.getByRole('button', { name: 'Connect', exact: true }).click();
  await poll(() => mullvad.innerText(), text => /Working/.test(text), 'provider connection is pending, never optimistic Connected');
  await fixture({ states: { mullvad: 'connected', ivpn: 'connected' } });
  await sheet.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await poll(() => mullvad.innerText(), text => /Installed · Connected/.test(text), 'authoritative provider status');
  const setupBounds = await sheet.evaluate(node => {
    const main = node.querySelector('.fr-sheet-main'), foot = node.querySelector('.fr-foot'), list = node.querySelector('.fr-vpn');
    return { mainBottom: main.getBoundingClientRect().bottom, footerTop: foot.getBoundingClientRect().top, panelBottom: list.getBoundingClientRect().bottom, panelOverflow: main.scrollHeight - main.clientHeight };
  });
  geometry.push({ surface: 'setup', ...setupBounds });
  assert.ok(setupBounds.mainBottom <= setupBounds.footerTop + 1 && setupBounds.panelBottom <= setupBounds.footerTop + 1, JSON.stringify(setupBounds));
  await shot(app.ui, 'setup-vpn');
  await app.ui.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
  checks.push('Setup offers three providers and real fixture connect/status controls; Escape stays in setup; panel fits above footer');
  await app.ui.keyboard.press('Escape'); // Setup's own documented Skip action, after its Connection sheet has closed.
  await app.ui.locator('.nt-page').waitFor();
  await finaleEnded(app.ui); // the browser arrives in a finale after setup; a click during it only skips it
  const siteUrl = `http://127.0.0.1:${site.port}/`;
  await app.act({ type: 'tab.new', url: siteUrl }); await app.waitWeb(siteUrl);
  for (let index = 1; index < 4; index++) await app.act({ type: 'tab.new', url: siteUrl + index, background: true });

  // VPN is optional and remains reachable through More tools before its toolbar button is enabled.
  assert.equal(await app.ui.getByRole('button', { name: 'VPN', exact: true }).count(), 0);
  await app.ui.getByRole('button', { name: 'Acira menu', exact: true }).click();
  let popup = await poll(overlay, Boolean, 'native overlay');
  await popup.getByRole('button', { name: 'More tools', exact: true }).click();
  await popup.getByRole('button', { name: 'VPN', exact: true }).waitFor(); await sleep(300);
  geometry.push({ surface: 'more-tools', measured: (await app.ui.evaluate(() => window.acira.getBrowserLayout())).overlay.contentHeight, rows: await popup.locator('.menu-row').evaluateAll(nodes => nodes.map(node => ({ label: node.textContent, height: node.getBoundingClientRect().height }))) });
  await popup.getByRole('button', { name: 'VPN', exact: true }).click();
  await popup.locator('.vpn-provider').first().waitFor();
  const proton = popup.getByRole('region', { name: 'Proton VPN', exact: true });
  assert.equal(await proton.getByRole('button', { name: 'Connect', exact: true }).count(), 0);
  await proton.getByRole('button', { name: 'Configure…', exact: true }).click();
  assert.equal(await app.main(() => globalThis.__vpnFixture.opened.length), 1);
  await popup.getByRole('region', { name: 'Mullvad VPN', exact: true }).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await poll(() => popup.getByRole('region', { name: 'Mullvad VPN', exact: true }).innerText(), text => /Disconnected/.test(text), 'actual fixture disconnect');
  await poll(() => popup.getByRole('dialog', { name: 'VPN', exact: true }).evaluate(node => ({ inside: node.contains(document.activeElement), active: document.activeElement?.outerHTML.slice(0, 260), buttons: [...node.querySelectorAll('button')].map(button => ({ label: button.textContent, disabled: button.disabled })) })), value => value.inside, 'command keeps focus in the VPN dialog');
  await escapeUntilClosed(popup, 'VPN exit completed');
  checks.push('Ordinary browsing More tools opens VPN; Mullvad disconnect works; Proton offers Configure without a fabricated toggle');

  const profile = (await app.state()).activeBrowserProfileId;
  await app.ui.evaluate(profile => { const key = 'acira-toolbar-items:' + profile; localStorage.setItem(key, JSON.stringify([{ id: 'vpn', visible: true }])); window.dispatchEvent(new StorageEvent('storage', { key })); }, profile);
  for (const appearance of ['light', 'dark']) for (const interfaceScale of [100, 150]) {
    await app.act({ type: 'settings.update', patch: { appearance, interfaceScale, reducedMotion: interfaceScale === 150 } });
    await app.main(({ BaseWindow }) => BaseWindow.fromId(globalThis.__vpnWindow).setSize(1200, 900));
    const button = app.ui.getByRole('button', { name: 'VPN', exact: true });
    if (await button.count()) await button.click();
    else { await app.ui.getByRole('button', { name: 'More toolbar buttons', exact: true }).click(); popup = await poll(overlay, Boolean, 'toolbar overflow'); await popup.getByRole('button', { name: 'VPN', exact: true }).click(); }
    popup = await poll(overlay, Boolean, 'VPN overlay');
    await popup.locator('.vpn-provider').first().waitFor();
    const bounds = await popup.getByRole('dialog', { name: 'VPN', exact: true }).evaluate(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, viewport: innerWidth, overflow: node.scrollWidth - node.clientWidth, actionCount: node.querySelectorAll('button').length }; });
    assert.ok(bounds.overflow <= 1 && bounds.actionCount >= 6, JSON.stringify(bounds)); geometry.push({ surface: 'popup', appearance, interfaceScale, ...bounds });
    if (interfaceScale === 100) await shot(popup, `vpn-${appearance}`);
    await escapeUntilClosed(popup, 'VPN menu exit before reopening');
  }
  checks.push('Optional toolbar VPN menu works in both themes at 100/150%, without horizontal overflow');

  await app.act({ type: 'settings.update', patch: { interfaceScale: 100 } });
  // Zoom changes emit renderer resize after dispatch resolves. Let that close/reset
  // finish before the next user action, instead of opening a menu during the resize.
  await app.ui.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(300);
  await app.cmd({ type: 'ui', action: 'open', kind: 'customize-toolbar', tabId: (await app.state()).activeTabId }); popup = await poll(overlay, Boolean, 'toolbar customizer overlay');
  await popup.locator('.toolbar-customize [data-item="vpn"]').waitFor(); await sleep(300);
  const customizer = await poll(() => app.ui.evaluate(() => window.acira.getBrowserLayout()), layout => layout.overlay?.kind === 'customize-toolbar' && layout.overlay.contentHeight > 0, 'toolbar customizer remains open after measurement');
  geometry.push({ surface: 'customize-toolbar', measured: customizer.overlay.contentHeight });
  await popup.keyboard.press('Escape');

  await app.act({ type: 'tab.navigate', url: 'acira://settings' });
  await app.ui.getByRole('button', { name: 'Connection', exact: true }).click();
  await app.ui.locator('[data-setting="vpn-controls"]').waitFor();
  await fixture({ fail: true });
  await app.ui.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await poll(() => app.ui.locator('[data-setting="vpn-controls"]').innerText(), text => /Connection unconfirmed/.test(text), 'failed provider cannot attest connection');
  assert.equal(await app.ui.locator('[data-setting="vpn-controls"]').getByRole('button', { name: 'Connect', exact: true }).count(), 0);
  assert.doesNotMatch(await app.ui.locator('[data-setting="vpn-controls"]').innerText(), /SECRET|PRIVATE/);
  checks.push('Connection settings expose VPN controls; failed status disables control and never exposes raw account/address output');
  const calls = await app.main(() => globalThis.__vpnFixture.calls);
  assert.ok(calls.some(call => call.args.join(' ') === 'connect') && calls.some(call => call.args.join(' ') === 'disconnect'));
  status = 'PASS'; console.log(JSON.stringify({ ok: true, checks, geometry, out }, null, 2));
} catch (error) {
  failure = error.stack || String(error); throw error;
} finally {
  await app?.close();
  await site?.close();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ status, checks, geometry, ...(failure ? {error: failure} : {}), limitations: ['Provider CLI, verification and app launching use injected adapters. No real VPN client or OS network setting was changed.'] }, null, 2));
}
