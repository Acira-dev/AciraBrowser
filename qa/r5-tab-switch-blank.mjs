// R5 (founder: "when I switch between tabs the page becomes completely empty even though YouTube is open and playing; it only
// appears after I open and close the sidebar"). Real window pixels (desktopCapturer) after every tab switch: a page playing audio,
// a second website and the new tab page, switched in every order, many times. A switch counts as blank when the middle of the
// page area shows the interface's own background instead of the website.
// Usage (repo root): node qa/r5-tab-switch-blank.mjs [rounds=6] [tag]
// One native slot (C:\ae\slot-N.lock, wx), isolated profile under .qa-profiles, evidence under C:\ae\r5\blank\<tag>. No real cursor.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rounds = Number(process.argv[2] || 6), tag = process.argv[3] || 'run';
const OUT = path.join('C:/ae/r5/blank', tag); await fs.mkdir(OUT, { recursive: true });
const log = (...a) => console.log(`[blank ${tag}]`, ...a);

async function takeSlot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`r5-blank ${new Date().toISOString()}\n`); await h.close(); return f; } catch {} }
    log('all slots busy, waiting 30s'); await sleep(30000);
  }
  throw Error('no slot');
}

// A one-second 440 Hz tone, looped by the page (a stand-in for YouTube playing music in the background).
function tone() {
  const rate = 22050, n = rate, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 3000), 44 + i * 2);
  return data;
}
const wav = tone();
// R5_VIDEO: a looping test video (ffmpeg testsrc2 + a tone, VP9/Opus) instead of the bare tone, like YouTube playing music.
const video = process.env.R5_VIDEO ? await fs.readFile(process.env.R5_VIDEO) : null;
const page = (title, bg, audio = false) => `<!doctype html><title>${title}</title><body style="margin:0;font:16px system-ui;background:${bg}"><div style="padding:24px 32px"><h1>${title}</h1>${audio && video ? '<video src="/test.webm" autoplay loop style="width:480px;display:block"></video>' : ''}${audio && !video ? '<audio src="/tone.wav" autoplay loop></audio><p id="state">audio</p><script>setInterval(()=>{document.getElementById("state").textContent="playing "+!document.querySelector("audio,video").paused+" t="+document.querySelector("audio,video").currentTime.toFixed(1)},250)</script>' : ''}${Array.from({ length: 30 }, (_, i) => `<p>Line ${i + 1}</p>`).join('')}</div>`;
const COLORS = { music: [0xd8, 0xf0, 0xd8], two: [0xe3, 0xed, 0xf7] };
const server = http.createServer((req, res) => {
  if (req.url === '/tone.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(wav); }
  if (req.url === '/test.webm') { res.setHeader('content-type', 'video/webm'); return res.end(video); }
  const k = req.url.slice(1); res.setHeader('content-type', 'text/html');
  res.end(k === 'music' ? page('Music', '#d8f0d8', true) : page('Website Two', '#e3edf7'));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let app, lock;
const results = [];
try {
  lock = await takeSlot(); log('slot', lock);
  const profile = path.resolve(`.qa-profiles/r5-blank-${tag}-${Date.now()}`);
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs')],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_BROWSER_TEST_HIDDEN: '' },
    timeout: 60000,
  });
  const pickUi = async () => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
  let ui = await pickUi();
  await app.evaluate(({ BaseWindow }, max) => { const w = BaseWindow.getAllWindows().sort((a, b) => b.getBounds().width - a.getBounds().width)[0]; w.setBounds({ x: 80, y: 60, width: 1280, height: 820 }); if (max) w.maximize(); w.show(); w.focus(); }, !!process.env.R5_MAX);
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
  await sleep(1200); ui = await pickUi();
  try { await ui.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2500 }); } catch {}
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  // The founder's setup: dark, Burgundy, sidebar tabs with the sidebar closed, Full view.
  await act({ type: 'settings.update', patch: { appearance: 'dark', colorPreset: 'Burgundy', accentColor: '#4d1821', browserTint: '#4d1821', verticalTabs: true, windowView: 'full', reducedMotion: false } });
  await act({ type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } });
  await sleep(800);
  await act({ type: 'tab.new', url: base + 'music' }); await sleep(1800);
  let s = await snap(); const musicId = s.activeTabId;
  await act({ type: 'tab.new', url: base + 'two' }); await sleep(1500);
  s = await snap(); const twoId = s.activeTabId;
  await act({ type: 'tab.new', url: 'acira://new' }); await sleep(1500);
  s = await snap(); const newId = s.activeTabId;

  const frame = async () => {
    const out = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => {
      const w = BaseWindow.getAllWindows().find(x => x.isVisible()), [cw, ch] = w.getSize();
      const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } })).find(x => x.id === w.getMediaSourceId());
      if (!src) return null;
      const img = src.thumbnail, size = img.getSize(), bmp = img.toBitmap();   // BGRA
      const px = (x, y) => { const i = (Math.round(y) * size.width + Math.round(x)) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
      const views = w.contentView.children.map(v => ({ b: v.getBounds(), vis: v.getVisible(), url: v.webContents?.getURL?.().slice(0, 60) || '' }));
      return { png: img.toPNG().toString('base64'), mid: px(size.width * 0.6, size.height * 0.55), views };
    });
    return out;
  };
  // R5_VIA=viewer: switch the way the founder does with the sidebar closed — open the tab viewer (Alt+T) and click the tab's card.
  // R5_VIA=ctrltab: Ctrl+Tab (recent order) — not targeted, so only used with two web tabs. Default: dispatch tab.select.
  const via = process.env.R5_VIA || 'dispatch';
  const select = async id => {
    if (via === 'dispatch') return act({ type: 'tab.select', id });
    if (via === 'viewer') {
      await app.evaluate(({ webContents }) => { const uiwc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); uiwc.focus(); uiwc.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' }); uiwc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] }); uiwc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] }); uiwc.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' }); });
      let card = null;
      for (let i = 0; i < 30 && !card; i++) { await sleep(60); card = await app.evaluate(async ({ webContents }, id) => { const ov = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); return ov ? ov.executeJavaScript(`(()=>{const e=document.querySelector('.popup-contents:not([data-vapor-layer]) .tab-result[data-tab-id="${id}"]');const r=e?.getBoundingClientRect();return r&&r.width?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null})()`) : null; }, id); }
      if (!card) { log('no card for', id); return act({ type: 'tab.select', id }); }
      await sleep(250);
      return app.evaluate(({ webContents }, c) => { const ov = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); ov.focus(); ov.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y }); ov.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 }); ov.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1 }); }, card);
    }
    throw Error('unknown R5_VIA ' + via);
  };
  const near = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30;
  const order = [musicId, twoId, musicId, newId, musicId, twoId, newId, twoId, musicId];
  const name = { [musicId]: 'music', [twoId]: 'two', [newId]: 'newtab' };
  let n = 0, blanks = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < order.length; i++) {
      const from = order[(i + order.length - 1) % order.length], to = order[i];
      const delay = [700, 250, 1200][(r + i) % 3];
      await select(to); await sleep(delay);
      if (to === newId) continue;
      const f = await frame(); n++;
      const ok = f && near(f.mid, COLORS[name[to]]);
      results.push({ r, from: name[from], to: name[to], delay, ok, mid: f?.mid });
      if (!ok) {
        blanks++;
        log('BLANK', name[from], '->', name[to], 'after', delay, 'ms, mid', JSON.stringify(f?.mid), 'views', JSON.stringify(f?.views));
        if (f) await fs.writeFile(path.join(OUT, `blank-${blanks}-${name[from]}-to-${name[to]}.png`), Buffer.from(f.png, 'base64'));
        // Does it come back by itself?
        await sleep(1500); const later = await frame(); log('  1.5 s later', near(later?.mid, COLORS[name[to]]) ? 'shown' : 'still blank', JSON.stringify(later?.mid));
      }
    }
  }
  log(`switches checked ${n}, blank ${blanks}`);
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
} finally {
  try { await app?.close(); } catch {}
  server.close();
  if (lock) { try { await fs.unlink(lock); log('released', lock); } catch {} }
}
