// Round 6 · updates: the "What's new" popup after a restart into a new version. A profile that last ran 0.1.0-beta.5 and has the notes of 0.1.0-beta.6 is started
// as 0.1.0-beta.6 (ACIRA_UPDATE_TEST_VERSION), exactly what the first launch after an update sees. Isolated profile, LOCALAPPDATA redirected by d-harness.
//   node qa/native-slot.mjs r6-whatsnew -- node qa/r6-whatsnew-proof.mjs [--theme=light|dark] [--scale=1.5] [--sidebar] [--notes=none] [--width=1280 --height=800] [--lang=de]
// Checks that it opens by itself, once, centred in the window, with the real notes as plain text; that without notes there is no popup (a quiet toast); captures it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const arg = (name, fallback) => { const hit = process.argv.find(item => item.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const theme = arg('theme', 'light'), scale = arg('scale', ''), sidebar = process.argv.includes('--sidebar'), noNotes = arg('notes', '') === 'none', lang = arg('lang', 'en');
const ui = Number(arg('ui', 0)), width = Number(arg('width', 1280)), height = Number(arg('height', 800));
const tag = `${noNotes ? 'nonotes-' : ''}${theme}${scale ? '-x' + scale : ''}${sidebar ? '-sidebar' : ''}${ui ? '-ui' + ui : ''}${lang !== 'en' ? '-' + lang : ''}${arg('width', '') ? '-' + width + 'x' + height : ''}`;
const out = path.resolve(arg('out', 'qa/artifacts/r6-whatsnew')), root = path.resolve(`.qa-profiles/r6-whatsnew-${Date.now()}`);
await fs.mkdir(out, {recursive: true}); await fs.mkdir(root, {recursive: true});
process.env.D_VISIBLE = '1';

const NOTES = noNotes ? '' : '## What we fixed\n- Windows now updates from the public update feed.\n- Smoother tab dragging and a calmer new tab page.\n- Downloads keep going when you close the panel.\n\n## What we pushed\n- A quiet update indicator while Acira downloads.\n- One question when the update is ready: Install now or Later.';
const seedUpdate = () => fs.writeFile(path.join(root, 'updater.json'), JSON.stringify({autoDownload: true, channel: 'stable', lastRunVersion: '0.1.0-beta.5', pending: {version: '0.1.0-beta.6', notes: NOTES.replace(/^#+ */gm, '').replace(/^- /gm, '• ')}}));

const launchArgs = scale ? ['--force-device-scale-factor=' + scale] : [], launchEnv = {ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_TEST_VERSION: '0.1.0-beta.6'};
// Launch 1 is an ordinary run of 0.1.0-beta.6 (no update): it sets the look and the window size, which are kept. Launch 2 is the first run after the update.
{
  const prepare = await startApp({root, args: launchArgs, env: launchEnv});
  try {
    await prepare.act({type: 'settings.update', patch: {appearance: theme, ...(sidebar ? {verticalTabs: true} : {}), ...(lang !== 'en' ? {language: lang} : {}), ...(ui ? {interfaceScale: ui} : {})}});
    await prepare.main(({BaseWindow}, [w, h]) => { const win = BaseWindow.getAllWindows().filter(x => x.isVisible())[0]; if (win) win.setBounds({x: win.getBounds().x, y: win.getBounds().y, width: w, height: h}); }, [width, height]);
    await sleep(1800);
  } finally { await prepare.close(); }
  await sleep(1500);
}
await seedUpdate();
const app = await startApp({root, args: launchArgs, env: launchEnv, skipSetup: false}); // launch 2 has no setup; not waiting for its skip button keeps the 3-second-old quiet toast in view
const results = {tag, checks: []}, check = (name, ok, detail) => { results.checks.push({name, ok: Boolean(ok), detail}); console.log(ok ? 'ok  ' : 'FAIL', name, detail ?? ''); };
const scanner = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
const overlayPage = () => app.context.pages().find(page => { try { return page.url().includes('view=overlay'); } catch { return false; } });
const popupUp = async () => { const page = overlayPage(); return page && await page.evaluate(() => !!document.querySelector('.update-whatsnew')).catch(() => false) ? page : null; };
const capture = () => app.main(async ({BaseWindow, desktopCapturer, screen}) => {
  const win = BaseWindow.getAllWindows().filter(w => w.isVisible() && !w.isMinimized()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0];
  if (!win) return '';
  const bounds = win.getBounds(), factor = screen.getDisplayMatching(bounds).scaleFactor;
  const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(bounds.width * factor), height: Math.round(bounds.height * factor)}});
  const source = sources.find(item => item.id === win.getMediaSourceId());
  return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : '';
});
const shot = async name => { let b64 = ''; for (let i = 0; i < 12 && !b64; i++) { if (i) await sleep(300); b64 = await capture(); } await fs.writeFile(path.join(out, `${name}-${tag}.png`), b64 ? Buffer.from(b64, 'base64') : await app.ui.screenshot()); console.log('shot', name, b64 ? '' : '(page only)'); };

try {
  const status = await app.svc({type: 'update.status'}).then(r => r.update);
  check('this launch is the first on the new version', status.version === '0.1.0-beta.6' && (noNotes ? status.welcome === false : status.whatsNew?.version === '0.1.0-beta.6'), JSON.stringify({version: status.version, welcome: status.welcome, whatsNew: status.whatsNew && {version: status.whatsNew.version, lines: status.whatsNew.notes.split('\n').length}}));
  if (noNotes) {
    const toast = await poll(() => app.state().then(s => (s.toast && /0\.1\.0-beta\.6/.test(s.toast.text || '') ? s.toast : null)), Boolean, 'quiet toast', 20000).catch(() => null);
    check('no notes: a quiet toast says it, with no button', toast && !toast.action, JSON.stringify(toast && {text: toast.text, action: toast.action}));
    await sleep(600); await shot('0-quiet-toast');
    check('no notes: no popup', !(await popupUp()));
  } else {
    const popup = await poll(popupUp, Boolean, 'the popup opens by itself', 25000);
    await sleep(1000);
    const geometry = await popup.evaluate(() => { const box = document.querySelector('.browser-popup').getBoundingClientRect(), root = document.querySelector('.update-whatsnew').getBoundingClientRect(); return {x: box.x, y: box.y, w: box.width, h: box.height, vw: innerWidth, vh: innerHeight, content: document.querySelector('.popup-body-content')?.scrollHeight, title: document.querySelector('#whatsnew-title')?.textContent, notes: document.querySelector('.update-pop-notes')?.textContent, buttons: [...document.querySelectorAll('.update-pop-actions button')].map(b => b.textContent), html: document.querySelector('.update-pop-notes')?.innerHTML}; });
    const dx = geometry.x + geometry.w / 2 - geometry.vw / 2, dy = geometry.y + geometry.h / 2 - geometry.vh / 2;
    check('centred in the window (both axes, within 2px)', Math.abs(dx) <= 2 && Math.abs(dy) <= 2, JSON.stringify({dx: +dx.toFixed(1), dy: +dy.toFixed(1), popup: [geometry.w, geometry.h], window: [geometry.vw, geometry.vh], content: geometry.content}));
    check('opened by itself with the real notes as plain text', /0\.1\.0-beta\.6/.test(geometry.title) && /Windows now updates from the public update feed/.test(geometry.notes) && !/[<>]/.test(geometry.html.replace(/&lt;|&gt;/g, '')), JSON.stringify({title: geometry.title, buttons: geometry.buttons}));
    await shot('1-whats-new');
    check('clip scan', /no hits/.test(await popup.evaluate(scanner)), await popup.evaluate(scanner));
    await popup.click('.update-pop-actions button'); await sleep(900);
    check('Close closes it', !(await popupUp()));
    await sleep(2500);
    check('once only: it does not come back', !(await popupUp()));
    const again = await app.svc({type: 'update.welcome'}).then(r => r.update);
    check('a second ask is refused', again.claimed === false && again.welcome === false);
    await shot('2-closed');
  }
  await fs.writeFile(path.join(out, `results-${tag}.json`), JSON.stringify(results, null, 2));
  if (results.checks.some(item => !item.ok)) process.exitCode = 1;
} catch (error) { console.error('RIG ERROR', error); process.exitCode = 1; await shot('error').catch(() => {}); }
finally { await app.close(); console.log('out', out); }
