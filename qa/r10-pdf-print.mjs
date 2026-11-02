// Round 10: a PDF opens in the tab (not as a download), prints to a PDF file through the browser's own output path, and survives zoom and reload.
//   node qa/native-slot.mjs r10-pdf -- node qa/r10-pdf-print.mjs
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/r10-pdf'; await fs.rm(root, {recursive: true, force: true});
const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', null, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
const stream = 'BT /F1 24 Tf 40 100 Td (Acira PDF test) Tj ET'; objs[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
let pdf = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
const fx = await httpFixture((req, res) => { if (req.url === '/doc.pdf') { res.setHeader('content-type', 'application/pdf'); res.end(Buffer.from(pdf, 'latin1')); } else { res.setHeader('content-type', 'text/html'); res.end('<title>p</title><h1 style="font:24px Helvetica">Acira PDF test</h1>'); } });
const base = `http://127.0.0.1:${fx.port}`; const out = (k, v) => console.log(k.padEnd(28), typeof v === 'string' ? v : JSON.stringify(v));
const app = await startApp({root});
try {
  await app.act({type: 'tab.new', url: base + '/doc.pdf'}); await sleep(3000);
  const s = await app.state(); const tab = s.tabs.at(-1); out('tab', {url: tab.url.replace(base, ''), title: tab.title, loading: tab.loading, error: tab.error || null});
  out('downloads', s.downloads.map(d => d.filename || d.name));
  const wcs = await app.main(({webContents}) => webContents.getAllWebContents().filter(w => w.getURL().includes('/doc.pdf')).map(w => ({type: w.getType(), url: w.getURL().replace(/127.*:\d+/, ''), hasEmbed: null})));
  out('webContents for pdf', wcs);
  const ct = await app.waitWeb(base + '/doc.pdf').then(p => p.evaluate(() => document.contentType + '|' + !!document.querySelector('embed')).catch(e => 'ERR ' + e.message.slice(0, 60)));
  out('document in tab', ct);
  const saved = await app.main(async ({webContents}) => { const w = webContents.getAllWebContents().find(x => x.getURL().includes('/doc.pdf')); try { return (await w.printToPDF({})).length; } catch (e) { return 'ERR ' + e.message.slice(0, 80); } });
  out('printToPDF bytes (pdf tab)', saved);
  // What Save as PDF uses on a PDF tab (desktop/browser-services/page-output.cjs pdfDocument): the viewer says so, and the tab's session returns the real file.
  out('save-as-pdf source', await app.main(async ({webContents}) => { const w = webContents.getAllWebContents().find(x => x.getURL().includes('/doc.pdf')); const isPdf = await w.executeJavaScript("document.contentType==='application/pdf'"); const r = await w.session.fetch(w.getURL()); const b = Buffer.from(await r.arrayBuffer()); return {isPdf, ok: r.ok, bytes: b.length, magic: b.subarray(0, 5).toString()}; }), 'fixture bytes', pdf.length);
  await app.act({type: 'tab.new', url: base + '/text'}); await app.waitWeb(base + '/text'); await sleep(800);
  out('printToPDF bytes (html tab)', await app.main(async ({webContents}) => { const w = webContents.getAllWebContents().find(x => x.getURL().endsWith('/text')); return (await w.printToPDF({})).length; }));
} catch (e) { console.log('FAILED', String(e.stack || e.message).slice(0, 400)); } finally { await Promise.race([app.close(), sleep(5000)]); await fx.close(); process.exit(0); }
