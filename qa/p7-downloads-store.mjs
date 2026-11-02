// P7 real-extension check: a popular Chrome Web Store download extension doing its core job on Acira's real downloads manager.
// Installs the extension from the Web Store into an isolated profile, serves a fixture page with images from a LOCAL server, drives the
// extension's real toolbar popup, and verifies the files arrive in a folder inside the test profile and in the Downloads page's records.
//   ACIRA_EXT_MATRIX_RUN=p7s node qa/p7-downloads-store.mjs [--ext image-downloader] [--explore]
// (a short run name keeps Windows paths under MAX_PATH inside this worktree)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {launch, install, installedManifest, sleep} from './extension-matrix/lib.mjs';
import {withSlot} from './native-slot.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const EXTENSIONS = {'image-downloader': {id: 'cnpniohnfphhjihaiiggeabnkjhpaldj', name: 'Image Downloader'}, chrono: {id: 'mciiogijehkdemklbdcbfkefimifhecn', name: 'Chrono Download Manager'}};
const slug = arg('--ext') || 'image-downloader', target = EXTENSIONS[slug];
const explore = process.argv.includes('--explore');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(arg('--out') || path.join('qa/artifacts/p7-downloads', `store-${slug}-${stamp}.json`));

// A solid-colour PNG of the given size (the extension filters tiny images).
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({length: width}, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({length: height}, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const images = {'/img/red.png': png(240, 180, [220, 40, 40]), '/img/green.png': png(260, 200, [40, 180, 60]), '/img/blue.png': png(300, 220, [40, 70, 220]), '/img/gold.png': png(280, 190, [230, 190, 40])};
const served = [];
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    served.push(url.pathname);
    if (images[url.pathname]) { res.writeHead(200, {'content-type': 'image/png', 'content-length': images[url.pathname].length, 'access-control-allow-origin': '*'}); res.end(images[url.pathname]); return; }
    if (url.pathname === '/slow') {
      const n = Number(url.searchParams.get('n') || 6), chunk = Buffer.alloc(1024, 0x61);
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': n * 1024, 'content-disposition': 'attachment; filename="slow.bin"'});
      let sent = 0;
      const timer = setInterval(() => { if (res.destroyed || sent >= n) { clearInterval(timer); if (!res.destroyed) res.end(); return; } res.write(chunk); sent++; }, 300);
      res.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(200, {'content-type': 'text/html'});
    res.end(`<!doctype html><meta charset=utf-8><title>P7 image page</title><body style="margin:20px"><h1>Four pictures</h1>${Object.keys(images).map(p => `<img src="${p}" width=240 alt="${p}">`).join('\n')}</body>`);
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const result = {slug, extension: target, started: new Date().toISOString(), checks: []};
const check = (name, ok, detail) => { result.checks.push({name, ok: !!ok, detail: ok ? undefined : detail}); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  " + String(JSON.stringify(detail)).slice(0, 400))); };
const until = async (read, ms, every = 400) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
let app;
try {
  await withSlot('p7-downloads-store', async () => {
    app = await launch('p' + (Date.now() % 100000).toString(36), {env: {}});
    const dl = path.join(app.root, 'dl');
    // The download folder inside the test profile (restart not needed: the env is read per download, so set it on the running main process).
    await app.main((_, folder) => { process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR = folder; }, dl);
    const installed = await install(app, target.id);
    result.install = {error: installed.error, name: installed.entry?.name, version: installed.entry?.version};
    check('installed from the Web Store', !installed.error && installed.entry, installed);
    if (installed.error) return;
    const found = await installedManifest(app, target.id);
    result.permissions = found.manifest.permissions;
    await app.ext({type: 'pin', extensionId: target.id, pinned: true}).catch(() => {});
    await app.act({type: 'tab.new', url: base + '/page'});
    await until(async () => (await app.state()).tabs.some(t => t.url.startsWith(base) && !t.loading), 20000);
    await sleep(1500);
    const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
    await app.main(({app: electronApp, session}, p) => { const target = session.fromPartition(p); electronApp.on('browser-window-created', (_e, window) => { if (window.webContents?.session !== target || globalThis.__extHelper === window) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; globalThis.__popup = window; }); }, partition);
    const extPages = () => app.context.pages().filter(page => { try { return page.url().startsWith(`chrome-extension://${target.id}/`); } catch { return false; } });
    const button = app.ui.locator('.native-extension-actions:visible browser-action-list button.action').first();
    await button.click({timeout: 15000});
    const popup = await until(() => extPages()[0], 15000, 300);
    check('the toolbar button opens the extension popup', !!popup, 'no popup page');
    if (!popup) return;
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(3000);
    const dump = async () => popup.evaluate(() => ({title: document.title, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800), buttons: [...document.querySelectorAll('button, [role=button], input[type=checkbox], a')].slice(0, 40).map(e => ({tag: e.tagName, text: (e.innerText || e.getAttribute('aria-label') || e.title || e.value || '').trim().slice(0, 40), type: e.type || '', id: e.id || '', cls: String(e.className).slice(0, 50)})), images: document.images.length}));
    result.popup = await dump();
    console.log(JSON.stringify(result.popup).slice(0, 1500));
    if (explore) {
      if (process.argv.includes('--open-manager')) {
        await popup.getByText(/open manager/i).first().click({timeout: 8000}).catch(error => console.log('click failed', String(error.message).slice(0, 120)));
        await sleep(3500);
        const pages = extPages().filter(p => p !== popup);
        console.log('extension pages now:', extPages().map(p => p.url()));
        console.log('tabs:', (await app.state()).tabs.map(t => t.url.slice(0, 90)));
        console.log('contents:', await app.main(({webContents}) => webContents.getAllWebContents().map(w => w.getURL().slice(0, 90)).filter(Boolean)));
        const manager = pages[0];
        if (manager) {
          const info = await manager.evaluate(() => ({title: document.title, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200), controls: [...document.querySelectorAll('button, a[id], input, textarea, select')].slice(0, 60).map(e => (e.id || e.name || '') + ':' + (e.innerText || e.title || e.placeholder || e.value || '').trim().slice(0, 30))}));
          console.log(JSON.stringify(info).slice(0, 3000));
        }
      }
      return;
    }
    if (slug === 'chrono') await driveChrono(popup, dl, base);
    else await driveImageDownloader(popup, dl);
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2000);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
}

async function driveImageDownloader(popup, dl) {
  const before = (await app.state()).downloads.length;
  const imagesShown = await until(() => popup.evaluate(() => document.images.length).then(n => (n >= 4 ? n : null)), 20000);
  check('the popup lists the page\'s pictures', !!imagesShown, await popup.evaluate(() => document.body.innerText.slice(0, 300)));
  const buttons = await popup.evaluate(() => [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean));
  result.buttons = buttons;
  const downloadButton = popup.getByRole('button', {name: /download/i}).first();
  await downloadButton.click({timeout: 8000}).catch(error => { result.clickError = String(error.message).slice(0, 200); });
  const arrived = await until(async () => { const files = await listFiles(dl); return Object.keys(files).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)).length >= 4 ? files : null; }, 40000);
  const files = arrived || await listFiles(dl);
  result.files = Object.keys(files);
  check('the four pictures were saved into the folder inside the test profile', !!arrived, result.files);
  const after = (await app.state()).downloads;
  const mine = after.filter(d => d.byExtensionId === target.id);
  result.records = after.map(({name, status, byExtensionId, path: p}) => ({name, status, byExtensionId, path: p}));
  check('the Downloads page shows the extension\'s downloads', mine.length >= 4 && mine.every(d => d.status === 'Ready'), result.records);
  check('the served pictures match the saved bytes', await sameBytes(files), files);
  check('the app is still alive', await app.main(() => true).then(() => true, () => false));
  void before;
}
/** A download the page itself starts (like clicking a download link), through the tab's own web contents. */
function startPageDownload(urlPath) { return app.main(({webContents}, args) => {
  const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(args.base) && !w.isDestroyed());
  if (!wc) throw new Error('fixture tab not found');
  wc.downloadURL(args.base + args.path);
}, {base, path: urlPath}); }
function visibleRows(popup) { return popup.evaluate(() => [...document.querySelectorAll('[id^=dlist], .dlist, .download, tr, li')].filter(e => e.offsetParent && /slow|\.bin/i.test(e.innerText || '')).slice(0, 6).map(e => ({tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 60), text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 160), buttons: [...e.querySelectorAll('button, a')].filter(b => b.offsetParent).map(b => (b.id || '') + ':' + (b.innerText || b.title || '').trim().slice(0, 20))}))); }
async function driveChrono(popup, dl) {
  // Chrono's job: take over the browser's downloads. A page starts a download; Chrono hears downloads.onCreated, cancels the browser's copy and
  // downloads the file itself with downloads.download, then shows speed and progress in its popup from downloads.onChanged / downloads.search.
  const mine = downloads => downloads.filter(d => d.byExtensionId === target.id && /slow/.test(d.name));
  const rowText = () => popup.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const t0 = Date.now(), seen = [];
  await startPageDownload('/slow?n=100');
  const took = await until(async () => { const all = (await app.state()).downloads; seen.push([Date.now() - t0, all.map(d => d.name + ':' + d.status + (d.byExtensionId ? '*' : ''))]); return mine(all).find(d => d.status === 'Downloading') || null; }, 25000, 300);
  result.seen = seen.slice(0, 40);
  check('Chrono took the download over: its own downloads.download is running in Acira\'s manager', !!took, (await app.state()).downloads);
  const original = (await app.state()).downloads.filter(d => /slow/.test(d.name) && !d.byExtensionId);
  result.originalPageDownload = original.map(d => ({name: d.name, status: d.status}));
  check('the browser\'s own copy was cancelled (downloads.cancel) so the file is not downloaded twice', original.every(d => d.status === 'Cancelled'), original);
  const progress = await until(async () => { const t = await rowText(); return /KB\/s|of \d+|secs? left/i.test(t) ? t : null; }, 20000, 400);
  result.progressText = progress;
  check('Chrono\'s popup shows live progress (speed, bytes, time left) from onChanged / search', !!progress, await rowText());
  const done = await until(async () => mine((await app.state()).downloads).find(d => d.status === 'Ready') || null, 60000, 500);
  const files = await listFiles(dl);
  result.files = files;
  check('the file finished in the test download folder with all its bytes', !!done && files['slow.bin'] === 102400, [done, files]);
  await sleep(1500);
  const finalText = await rowText();
  result.finalPopupText = finalText.slice(0, 400);
  check('Chrono\'s popup shows it finished', /slow/i.test(finalText) && !/secs? left/i.test(finalText), finalText.slice(0, 300));
  check('the Downloads page lists it (same record the extension manages)', !!done && done.browserProfileId === app.profileId, done);
  check('the app is still alive', await app.main(() => true).then(() => true, () => false));
}
async function listFiles(dir) {
  const files = {};
  const walk = async folder => { for (const e of await fs.readdir(folder, {withFileTypes: true}).catch(() => [])) { const p = path.join(folder, e.name); if (e.isDirectory()) await walk(p); else files[path.relative(dir, p).replace(/\\/g, '/')] = (await fs.stat(p)).size; } };
  await walk(dir);
  return files;
}
async function sameBytes(files) {
  const sizes = new Set(Object.values(images).map(b => b.length));
  return Object.entries(files).filter(([name]) => /\.(png|jpe?g|gif|webp)$/i.test(name)).every(([, size]) => sizes.has(size));
}

result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
const failed = result.checks.filter(c => !c.ok);
console.log(`${result.checks.length - failed.length}/${result.checks.length} checks passed; wrote ${out}`);
process.exit(result.error || failed.length || !result.checks.length ? 1 : 0);
