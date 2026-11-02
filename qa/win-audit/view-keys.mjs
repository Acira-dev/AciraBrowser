// View switching by key (Cmd+Shift+F Focus, Cmd+Shift+L Seamless) from the chrome and from the page; state stays in sync everywhere.
import {launch, sleep, httpFixture} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>P</title><body style="margin:0;background:#ddd"><input id=f autofocus>'); });
const app = await launch({name: 'ky', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const key = (target, k, mods) => app.main(({webContents}, a) => { const wc = webContents.getAllWebContents().find(w => a.target === 'ui' ? w.getURL() === 'acira-browser-ui://ui/index.html' : w.getURL().startsWith('http://127.0.0.1')); for (const type of ['rawKeyDown', 'char', 'keyUp']) wc.sendInputEvent({type, keyCode: a.k, modifiers: a.mods}); }, {target, k, mods});
const view = async () => { const s = await app.state(); return s.windowUi.view ?? ('default:' + (s.settings.windowView ?? 'full')); };
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(900);
  await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); }); await sleep(300);
  console.log('start', await view());
  for (const [target, k, mods, label] of [['page', 'F', ['meta', 'shift'], 'page Cmd+Shift+F'], ['page', 'F', ['meta', 'shift'], 'page Cmd+Shift+F again'], ['page', 'L', ['meta', 'shift'], 'page Cmd+Shift+L'], ['page', 'L', ['meta', 'shift'], 'page Cmd+Shift+L again'], ['ui', 'F', ['meta', 'shift'], 'chrome Cmd+Shift+F'], ['ui', 'F', ['meta', 'shift'], 'chrome again'], ['ui', 'L', ['meta', 'shift'], 'chrome Cmd+Shift+L'], ['ui', 'L', ['meta', 'shift'], 'chrome again']]) {
    await key(target, k, mods); await sleep(700);
    const s = await app.state(); const dom = await app.ui.evaluate(() => ({layout: document.querySelector('.browser-shell')?.dataset.layout, seamless: document.querySelector('.browser-shell')?.dataset.seamless}));
    console.log(label.padEnd(26), '->', await view(), JSON.stringify(dom), 'focusMode', s.windowUi.focusMode);
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
