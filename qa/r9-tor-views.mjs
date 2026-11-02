// P0 probe: the native view stack (what sits above the tab strip) with an ordinary tab current vs a Tor tab current.
// Playwright/CDP clicks go straight into the chrome page, so a native view covering the × is only visible this way.
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const stack = app => app.main(async ({BaseWindow}) => {
  const out = [];
  for (const win of BaseWindow.getAllWindows()) {
    const walk = (view, depth) => { for (const child of view.children || []) { let url = ''; try { url = child.webContents?.getURL?.() || ''; } catch {}
      out.push({depth, visible: child.getVisible?.(), bounds: child.getBounds(), url: url.slice(0, 80), kind: child.constructor?.name}); walk(child, depth + 1); } };
    out.push({window: win.id, bounds: win.getContentBounds()}); walk(win.contentView, 0);
  }
  return out;
});
await withSlot('r9-tor-views', async () => {
  const app = await startApp({root: path.resolve('.qa-profiles/r9-tor-views-' + Date.now())});
  try {
    for (const vertical of [true, false]) {
      await app.act({type: 'settings.update', patch: {verticalTabs: vertical}}); await sleep(500);
      await app.act({type: 'tab.new', url: 'about:blank'}); await sleep(1200);
      console.log(`--- ${vertical ? 'sidebar' : 'strip'} · ordinary tab current`); for (const v of await stack(app)) console.log(JSON.stringify(v));
      await app.act({type: 'tab.new', privacy: 'tor', url: process.argv[2] || 'https://check.torproject.org/'}); await sleep(2500);
      console.log(`--- ${vertical ? 'sidebar' : 'strip'} · Tor tab current`); for (const v of await stack(app)) console.log(JSON.stringify(v));
      const s = await app.state(); console.log('active', s.activeTabId, s.tabs.map(t => [t.id.slice(0, 6), t.privacy || '-', t.url.slice(0, 40)]));
    }
  } finally { await app.close(); }
});
