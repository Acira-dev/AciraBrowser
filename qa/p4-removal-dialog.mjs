// chrome.management uninstall confirmation (ext-api/management.cjs) in Acira's own dialog page (public/native-dialog.html): renders the
// exact payload app-dialog.cjs builds, in English and German, light and dark, at 100% and 150% display scale, for the caller removing itself,
// another extension removing it, and very long names; scans every element for clipping (outside the card, overflow) and saves PNGs.
// Nothing is shown on screen: the page is loaded in a hidden window of the real app (same preload and page) and captured with capturePage().
//   cd C:/ae/p4w; node qa/p4-removal-dialog.mjs        (cwd must be the repo; takes a native slot; two short app launches)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const OUT = path.resolve('qa/artifacts/p4-removal-dialog', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(OUT, {recursive: true});
const catalog = async locale => JSON.parse(await fs.readFile(path.resolve('src/i18n', locale + '.json'), 'utf8'));
const fill = (text, params) => text.replace(/\{(\w+)\}/g, (_, key) => params[key]);
const LONG = 'A Remarkably Long Extension Name That Keeps Going And Going Beyond One Single Line Of The Card';
const WORD = 'Supercalifragilisticexpialidocious'.repeat(2);
const CASES = {
  self: {name: 'Dark Reader', caller: 'Dark Reader', self: true},
  other: {name: 'Dark Reader', caller: 'Extension Manager Pro', self: false},
  long: {name: LONG, caller: LONG, self: false},
  word: {name: WORD, caller: WORD, self: false}
};

const render = async ({BrowserWindow, ipcMain}, {preload, url, payload}) => {
  let w = globalThis.__p4dialog;
  if (!w || w.isDestroyed()) {
    w = new BrowserWindow({show: false, width: 400, height: 220, frame: false, resizable: false, webPreferences: {preload, sandbox: true, contextIsolation: true}});
    globalThis.__p4dialog = w;
    await w.loadURL(url);
  }
  w.setBackgroundColor(payload.dark ? '#232428' : '#ffffff');
  const height = await new Promise(resolve => {
    const on = (event, value) => { if (event.sender === w.webContents) { ipcMain.removeListener('acira:dialog-ready', on); resolve(value); } };
    ipcMain.on('acira:dialog-ready', on);
    w.webContents.send('acira:dialog-init', payload);
  });
  const h = Math.max(120, Math.min(520, Math.round(Number(height) || 220)));
  w.setContentSize(400, h);
  await new Promise(resolve => setTimeout(resolve, 350));
  const scan = await w.webContents.executeJavaScript(`(() => {
    const bad = [], vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (el.hidden || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!r.width && !r.height) continue;
      const tag = el.id || el.tagName.toLowerCase() + (el.dataset && el.dataset.index !== undefined ? '[' + el.dataset.index + ']' : '');
      if (r.left < -0.5 || r.right > vw + 0.5) bad.push(['outside-x', tag, Math.round(r.left), Math.round(r.right), vw]);
      if (r.top < -0.5 || r.bottom > vh + 0.5) bad.push(['outside-y', tag, Math.round(r.top), Math.round(r.bottom), vh]);
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (style.overflowX !== 'visible' || style.textOverflow === 'ellipsis')) bad.push(['clipped-x', tag, el.scrollWidth, el.clientWidth]);
      if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && style.overflowY !== 'visible') bad.push(['clipped-y', tag, el.scrollHeight, el.clientHeight]);
      if (el.matches('button') && el.scrollWidth > el.clientWidth + 1) bad.push(['button-text', tag, el.scrollWidth, el.clientWidth]);
    }
    if (document.documentElement.scrollHeight > vh + 1) bad.push(['page-scroll-y', document.documentElement.scrollHeight, vh]);
    if (document.documentElement.scrollWidth > vw + 1) bad.push(['page-scroll-x', document.documentElement.scrollWidth, vw]);
    return bad;
  })()`);
  const image = await w.webContents.capturePage();
  return {png: image.toPNG().toString('base64'), size: image.getSize(), reportedHeight: h, scan};
};

const slot = await takeSlot('p4-removal-dialog');
const summary = [];
try {
  for (const scale of [1, 1.5]) {
    const app = await startApp({root: path.resolve('.qa-profiles', `p4d${String(scale).replace('.', '')}${Date.now().toString(36).slice(-4)}`), args: scale === 1 ? [] : [`--force-device-scale-factor=${scale}`], env: {ACIRA_DEV: '0'}});
    try {
      const dpr = await app.main(({screen}) => screen.getPrimaryDisplay().scaleFactor);
      for (const locale of ['en', 'de']) {
        const strings = await catalog(locale);
        for (const dark of [false, true]) {
          for (const [name, c] of Object.entries(CASES)) {
            const payload = {kicker: strings['ext.removeTitle'], title: fill(strings['ext.removeMessage'], {name: c.name}),
              detail: c.self ? strings['ext.removeSelfDetail'] : fill(strings['ext.removeByDetail'], {caller: c.caller}),
              buttons: [strings['dialog.cancel'], strings['ext.remove']], defaultId: 0, cancelId: 0, dark, warning: true, popover: false, items: []};
            const result = await app.main(render, {preload: path.resolve('desktop/dialog-preload.cjs'), url: 'acira-browser-ui://ui/native-dialog.html', payload});
            const file = `${locale}-${dark ? 'dark' : 'light'}-${scale * 100}-${name}.png`;
            await fs.writeFile(path.join(OUT, file), Buffer.from(result.png, 'base64'));
            summary.push({file, scale, dpr, locale, dark, case: name, size: result.size, hits: result.scan});
            console.log(file, JSON.stringify(result.size), 'hits', result.scan.length, result.scan.length ? JSON.stringify(result.scan) : '');
          }
        }
      }
    } finally {
      try { await app.main(() => { try { globalThis.__p4dialog && globalThis.__p4dialog.destroy(); } catch {} }); } catch {}
      await app.close();
    }
  }
} finally {
  await releaseSlot(slot);
}
await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
const hits = summary.reduce((sum, item) => sum + item.hits.length, 0);
console.log(`captures: ${summary.length}, clip hits: ${hits}`);
console.log('wrote', OUT);
process.exitCode = hits ? 1 : 0;
