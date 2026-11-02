// Minimise and restore: the page view, chrome layout and traffic lights must come back as they were.
import {launch, sleep, httpFixture, solid, ghost} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'mn', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', verticalTabs: false}});
const snap = async () => {
  const w = await app.win(w => ({b: w.getBounds(), min: w.isMinimized(), vis: w.isVisible(), views: w.contentView.children.map(v => ({u: (v.webContents?.getURL() || '').slice(0, 30), b: v.getBounds(), vis: v.getVisible()}))}));
  const ui = await app.ui.evaluate(async () => { const l = await window.acira.getBrowserLayout(); return {page: l.pageBounds, cap: l.captionHeight, vis: document.visibilityState}; });
  const btn = (await app.buttons()).map(b => `${b.x},${b.y}${b.hidden ? 'H' : ''}`).join(' ');
  return {w, ui, btn};
};
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  for (const [view, tabs] of [['full', 'top'], ['compact', 'top'], ['seamless', 'top'], ['full', 'sidebar'], ['focus', 'top']]) {
    await app.act({type: 'settings.update', patch: {verticalTabs: tabs === 'sidebar'}});
    await app.act({type: 'ui.update', patch: {view, workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}}); await sleep(1200);
    const before = await snap();
    await app.win(w => w.minimize()); await sleep(1200);
    const during = await app.win(w => w.isMinimized());
    await app.win(w => w.restore()); await sleep(1500);
    const after = await snap();
    const pageBefore = before.w.views.find(v => v.u.startsWith('http')), pageAfter = after.w.views.find(v => v.u.startsWith('http'));
    const same = JSON.stringify([before.w.b, pageBefore, before.ui.page, before.btn]) === JSON.stringify([after.w.b, pageAfter, after.ui.page, after.btn]);
    console.log(view, tabs, 'minimized:', during, 'same after restore:', same, 'uiVisibility', after.ui.vis);
    if (!same) console.log(' before', JSON.stringify([before.w.b, pageBefore, before.ui.page, before.btn]), '\n after ', JSON.stringify([after.w.b, pageAfter, after.ui.page, after.btn]));
    await ghost(app);
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
