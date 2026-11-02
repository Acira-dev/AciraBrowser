// R3-45/R3-46 in the real isolated app: AI-free mode on a Google-shaped page (tests/fixtures/ai-pages/google-2026.html served as www.google.com).
//   node qa/r3-ai-free.mjs   (cwd = worktree root)   Evidence PNGs go to C:\ae\r3\privacy\evidence
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const results = [];
const note = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };
async function withSlot(name, fn) {
  const until = Date.now() + 20 * 60 * 1000; let held = null;
  while (!held && Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `${name} ${new Date().toISOString()}`); fs.closeSync(fd); held = file; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!held) await sleep(30000);
  }
  if (!held) throw new Error('No native slot became free in 20 minutes.');
  try { return await fn(); } finally { try { fs.unlinkSync(held); } catch {} }
}
const root = path.resolve('.qa-profiles/r3-ai-free');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const evidence = 'C:/ae/r3/privacy/evidence'; fs.mkdirSync(evidence, {recursive: true});
const fixture = fs.readFileSync(path.resolve('tests/fixtures/ai-pages/google-2026.html'));
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fixture); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

await withSlot('privacy-r3-ai-free', async () => {
  const app = await startApp({root, args: ['--host-resolver-rules=MAP www.google.com 127.0.0.1']});
  try {
    const url = (mode, theme) => `http://www.google.com:${PORT}/?measure=1&mode=${mode}&theme=${theme}`;
    const measure = page => page.evaluate(() => {
      const frames = window.__frames || [], line = document.querySelector('[data-acira-filter-control]'), link = document.querySelector('#rso a h3');
      let textLeft = null; if (line && line.firstChild) { const r = document.createRange(); r.setStart(line.firstChild, 0); r.setEnd(line.firstChild, 1); textLeft = Math.round(r.getBoundingClientRect().left * 10) / 10; }
      return {frames: frames.length, framesWithAi: frames.filter(([t, v]) => t > 0 && v > 0).length, line: line ? line.innerText.trim() : null, textLeft, resultsLeft: link ? Math.round(link.getBoundingClientRect().left * 10) / 10 : null, organic: [...document.querySelectorAll('#rso .g')].filter(e => e.getClientRects().length).length};
    });
    const tabId = async () => (await app.state()).activeTabId;
    await app.svc({type: 'filters.profile-set', patch: {aiContent: true}});
    let first = true;
    for (const [mode, theme] of [['sync', 'light'], ['late', 'dark'], ['stream', 'light']]) {
      if (first) { await app.act({type: 'tab.new', url: url(mode, theme)}); first = false; } else await app.cmd({type: 'navigate', tabId: await tabId(), url: url(mode, theme)});
      const page = await app.waitWeb(u => u.startsWith(`http://www.google.com:${PORT}`), 'fixture page');
      await poll(() => measure(page).then(m => m.frames > 40 ? m : null), Boolean, 'frames', 15000);
      await sleep(900);
      const m = await measure(page);
      note(`${mode}/${theme}: no frame showed an AI element`, m.framesWithAi === 0 && m.frames > 40, JSON.stringify(m));
      note(`${mode}/${theme}: quiet line starts at the results column`, m.line === 'AI answer hidden · Show' && Math.abs(m.textLeft - m.resultsLeft) <= 1 && m.organic === 5, `text ${m.textLeft} results ${m.resultsLeft}`);
      await page.screenshot({path: `${evidence}/app-ai-free-${mode}-${theme}.png`});
    }
    // switched off for this site: nothing is hidden
    const id = await tabId();
    await app.svc({type: 'filters.set', tabId: id, scope: 'site', patch: {aiContent: false}});
    await app.cmd({type: 'navigate', tabId: id, url: url('sync', 'light')});
    const page = await app.waitWeb(u => u.startsWith(`http://www.google.com:${PORT}`), 'fixture page');
    await poll(() => measure(page).then(m => m.frames > 40 ? m : null), Boolean, 'frames', 15000);
    const control = await measure(page);
    note('AI-free mode off for the site: the AI block paints (control)', control.framesWithAi > 20 && control.line === null, JSON.stringify(control));
  } finally {
    await app.close();
  }
});
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
