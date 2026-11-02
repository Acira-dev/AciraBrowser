import {launch, sleep, httpFixture, place} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>A fairly long page title for the tab strip</title><body style="margin:0;background:#fff">x</body>'); });
const app = await launch({name: 'nr', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url);
  for (let i = 0; i < 5; i++) await app.act({type: 'tab.new', url: url + '?' + i});
  await sleep(1200); await app.ui.evaluate(() => document.activeElement?.blur());
  await place(app, {x: 20, y: 60, width: 900, height: 600});
  for (const [scale, tabs] of [[150, 'top'], [125, 'top'], [150, 'sidebar']]) for (const view of ['full', 'compact', 'focus', 'seamless']) {
    await app.act({type: 'settings.update', patch: {interfaceScale: scale, verticalTabs: tabs === 'sidebar', appearance: 'dark'}});
    await app.act({type: 'ui.update', patch: {view, workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}}); await sleep(900);
    if (view === 'seamless') { const t = (await app.state()).activeTabId; await app.cmd({type: 'edge', tabId: t, pin: {zone: 'top', on: true}}); await sleep(900); }
    await app.shot(`nr-${scale}-${tabs}-${view}`);
    if (view === 'seamless') { const t = (await app.state()).activeTabId; await app.cmd({type: 'edge', tabId: t, pin: {zone: 'top', on: false}}); }
  }
} finally { await app.close(); await fixture.close(); }
