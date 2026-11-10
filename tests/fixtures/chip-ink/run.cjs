'use strict';
// Electron runner for tests/chip-letter-centred.test.cjs. For every job (a static page and a device scale factor) it renders the
// page in a hidden window, takes a screenshot at that scale, and for every [data-chip] box measures where the ink of the letter
// sits (sub-pixel, read from the anti-aliased pixels) and takes a hash of the box's pixels so two renderings can be compared exactly.
// Usage: electron run.cjs <jobs.json>      jobs: [{ name, page: "/abs/page.html", dsf: 2 }]
// Writes the measurements to <jobs.json>.out.json (a pipe can lose the tail of a large write when the app exits) and prints RESULT <that path>.
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');

app.setPath('userData', path.join(os.tmpdir(), 'acira-chip-ink-' + process.pid));
app.on('window-all-closed', () => {});
const fail = error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); };
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
setTimeout(() => fail(new Error('runner timed out')), 170000).unref();

const WIDTH = 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const hashOf = (bitmap, imgW, box, scale) => {
  const hash = crypto.createHash('md5');
  const x0 = Math.floor(box.x * scale), x1 = Math.ceil((box.x + box.w) * scale), y0 = Math.floor(box.y * scale), y1 = Math.ceil((box.y + box.h) * scale);
  for (let y = y0; y < y1; y++) hash.update(bitmap.subarray((y * imgW + x0) * 4, (y * imgW + x1) * 4));
  return hash.digest('hex').slice(0, 12);
};

// Black ink on a white chip. Only the inner 64% square is read, so the edge of the circle never counts; the first and last rows
// and columns that carry ink give the ink box, each edge placed by how much of its pixel row is covered.
const measure = (bitmap, imgW, box, scale) => {
  const inset = 0.18;
  const x0 = Math.round((box.x + box.w * inset) * scale), x1 = Math.round((box.x + box.w * (1 - inset)) * scale);
  const y0 = Math.round((box.y + box.h * inset) * scale), y1 = Math.round((box.y + box.h * (1 - inset)) * scale);
  const rows = new Array(y1 - y0).fill(0), cols = new Array(x1 - x0).fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * imgW + x) * 4, coverage = (255 - (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3) / 255;
    if (coverage > rows[y - y0]) rows[y - y0] = coverage;
    if (coverage > cols[x - x0]) cols[x - x0] = coverage;
  }
  const edges = (list, base) => {
    const first = list.findIndex(value => value > 0.04);
    if (first < 0) return null;
    const last = list.length - 1 - [...list].reverse().findIndex(value => value > 0.04);
    return { lo: base + first + (1 - Math.min(1, list[first])), hi: base + last + Math.min(1, list[last]) };
  };
  const vertical = edges(rows, y0), horizontal = edges(cols, x0);
  if (!vertical || !horizontal) return { dy: null, dx: null };
  const centreY = (box.y + box.h / 2) * scale, centreX = (box.x + box.w / 2) * scale;
  return {
    dy: +(((vertical.lo + vertical.hi) / 2 - centreY) / scale).toFixed(3),
    dx: +(((horizontal.lo + horizontal.hi) / 2 - centreX) / scale).toFixed(3),
    inkHeight: +((vertical.hi - vertical.lo) / scale).toFixed(2),
  };
};

async function main() {
  const jobsPath = process.argv.find(arg => arg.endsWith('.json'));
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: WIDTH, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.setBackgroundColor('#ffffff');
  const debug = win.webContents.debugger; debug.attach('1.3');
  const results = [];
  for (const job of jobs) {
    await win.loadFile(job.page);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
    const height = await win.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight)');
    await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: job.dsf, mobile: false });
    await sleep(350);
    const boxes = await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-chip]')].map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.chip, x: r.x, y: r.y, w: r.width, h: r.height }; })`);
    const shot = await debug.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64')), size = image.getSize(), bitmap = image.toBitmap();
    const scale = size.width / WIDTH;
    results.push({ name: job.name, dsf: job.dsf, scale, chips: boxes.map(box => ({ id: box.id, hash: hashOf(bitmap, size.width, box, scale), ...measure(bitmap, size.width, box, scale) })) });
  }
  fs.writeFileSync(jobsPath + '.out.json', JSON.stringify(results));
  process.stdout.write('RESULT ' + jobsPath + '.out.json\n', () => app.exit(0));
}
main().catch(fail);
