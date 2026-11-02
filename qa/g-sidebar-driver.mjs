// Stream G QA driver: launches the real app on a disposable profile and exposes a tiny local
// control endpoint (127.0.0.1 only) so sidebar checks can run step by step without relaunching.
//   node qa/g-sidebar-driver.mjs [port] [outDir]
//   POST /eval  body = JS expression evaluated in the chrome UI page (JSON result)
//   POST /main  body = JS function source `({app,BaseWindow})=>…` run in the main process
//   GET  /shot?name=x[&clip=x,y,w,h]  screenshot of the chrome UI page into outDir
//   GET  /reload   reloads the chrome UI page (after `vite build`)
//   GET  /quit
//   G_PROFILE=<.qa-profiles dir> reuses a profile; G_ARGS='[...]' replaces the main-script argument (e.g. a web app
//   shortcut's own arguments, so a launch can be checked exactly as Start would run it, on a test profile).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const port = Number(process.argv[2] || 47811), out = path.resolve(process.argv[3] || '.qa-profiles/g-shots');
const data = path.resolve(process.env.G_PROFILE || '.qa-profiles/g-sidebar-' + Date.now());
await fs.mkdir(out, { recursive: true });
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  // Keep painting while the window sits behind other windows, so motion can be sampled frame by frame.
  args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', ...(process.env.G_ARGS ? JSON.parse(process.env.G_ARGS) : [path.resolve('desktop/main.cjs')])],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data },
  timeout: 30000,
});
const ui = async () => {
  for (let i = 0; i < 200; i++) {
    const page = app.windows().find(p => p.url().startsWith('acira-browser-ui://ui/index.html') && !p.url().includes('view='));
    if (page) return page;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('UI page not found');
};
let page = await ui();
// G_LOG=<file>: the app's own output and the UI page's console errors, for a hang or a crash that leaves no trace.
if (process.env.G_LOG) {
  const log = line => fs.appendFile(process.env.G_LOG, new Date().toISOString().slice(11, 23) + ' ' + String(line).trimEnd() + '\n').catch(() => {});
  app.process().stdout?.on('data', d => log('[main] ' + d)); app.process().stderr?.on('data', d => log('[main!] ' + d));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log('[ui ' + m.type() + '] ' + m.text().slice(0, 600)); });
  page.on('pageerror', e => log('[ui pageerror] ' + (e.stack || e).toString().slice(0, 800)));
}
try { await page.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    let result;
    if (url.pathname === '/eval') { page = await ui(); result = await page.evaluate(new Function('return (async()=>(' + await body(req) + '))()')); }
    else if (url.pathname === '/main') result = await app.evaluate(eval(await body(req)));
    else if (url.pathname === '/shot') {
      page = await ui();
      const clip = url.searchParams.get('clip')?.split(',').map(Number);
      const file = path.join(out, (url.searchParams.get('name') || 'shot') + '.png');
      await page.screenshot({ path: file, ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) });
      result = file;
    } else if (url.pathname === '/hover') { page = await ui(); await page.hover(url.searchParams.get('sel')); result = 'ok'; }
    else if (url.pathname === '/key') { page = await ui(); await page.keyboard.press(url.searchParams.get('k')); result = 'ok'; }
    else if (url.pathname === '/mouse') {
      // body: [{move:[x,y],steps?}|{down:true}|{up:true}|{wait:ms}|{key:'Escape'}] — real input events, not synthetic DOM events
      page = await ui();
      for (const step of JSON.parse(await body(req))) {
        if (step.move) await page.mouse.move(step.move[0], step.move[1], { steps: step.steps || 1 });
        else if (step.down) await page.mouse.down();
        else if (step.up) await page.mouse.up();
        else if (step.wait) await new Promise(r => setTimeout(r, step.wait));
        else if (step.key) await page.keyboard.press(step.key);
      }
      result = 'ok';
    }
    else if (url.pathname === '/profile') {
      // body: an expression run in the UI page under the CPU profiler (100µs samples); returns the top functions by self
      // time and the profile file. Build with `vite build --minify false` first so the names mean something.
      page = await ui();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
      const value = await page.evaluate(new Function('return (async()=>(' + await body(req) + '))()'));
      const { profile } = await cdp.send('Profiler.stop'); await cdp.detach();
      const file = path.join(out, 'profile-' + Date.now() + '.cpuprofile'); await fs.writeFile(file, JSON.stringify(profile));
      const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])), step = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000;
      const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const name = f => `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`, total = new Map();
      for (const id of profile.samples) {
        self.set(name(byId.get(id).callFrame), (self.get(name(byId.get(id).callFrame)) || 0) + step);
        const seen = new Set(); for (let at = id, guard = 0; at !== undefined && guard < 400; at = parent.get(at), guard++) seen.add(name(byId.get(at).callFrame));
        for (const key of seen) total.set(key, (total.get(key) || 0) + step);
      }
      const rank = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, Number(url.searchParams.get('top') || 25)).map(([k, ms]) => [k, Math.round(ms * 10) / 10]);
      result = { value, file, self: rank(self), total: rank(total) };
    }
    else if (url.pathname === '/reload') { page = await ui(); await page.reload(); result = 'ok'; }
    else if (url.pathname === '/quit') { res.end('bye'); await app.close(); process.exit(0); }
    res.end(JSON.stringify(result ?? null));
  } catch (error) { res.statusCode = 500; res.end(String(error?.stack || error)); }
}).listen(port, '127.0.0.1', () => console.log('g-sidebar driver ready on ' + port + ' profile ' + data));
