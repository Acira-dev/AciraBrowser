// Stream D: each window keeps its own saved bounds across a restart; a new window cascades (+24/+24) instead of covering the current one.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-window-bounds'; await fs.rm(root, {recursive: true, force: true});
const report = [];
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>' + req.url + '</title>x'); });
const base = 'http://127.0.0.1:' + fx.port;
const boxes = app => app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.getBounds()).sort((a, b) => a.x - b.x || a.y - b.y));
const pick = ({x, y, width, height}) => ({x, y, width, height});
// Windows converts DIP bounds through physical pixels at fractional display
// scale. Permit one DIP of rounding, while still checking every coordinate.
const near = (actual, expected, label) => {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) <= 1, `${label}: ${key} ${actual[key]} != ${expected[key]}`);
};
let savedBounds;

let app = await startApp({root});
const pid = await app.main(() => process.pid);
try {
  // Window 1 at a known place.
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setBounds({x: 100, y: 80, width: 1100, height: 760}));
  await sleep(500);
  const first = pick((await boxes(app))[0]);
  near(first, {x: 100, y: 80, width: 1100, height: 760}, 'initial bounds');
  // Two more windows: each moves 24 px right and down from the one before it, same size.
  await app.ui.evaluate(() => window.acira.openWindow('normal'));
  await poll(async () => (await boxes(app)).length === 2, Boolean, 'second window', 20000);
  await sleep(800);
  await app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').at(-1).evaluate(url => window.acira.dispatch({type: 'tab.new', url}), base + '/two');
  const second = (await boxes(app))[1];
  near(second, {...first, x: first.x + 24, y: first.y + 24}, 'second window cascades from the first');
  const third = await (async () => {
    const page = app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').at(-1);
    await page.evaluate(() => window.acira.openWindow('normal'));
    await poll(async () => (await boxes(app)).length === 3, Boolean, 'third window', 20000);
    await sleep(800);
    await app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').at(-1).evaluate(url => window.acira.dispatch({type: 'tab.new', url}), base + '/three');
    return (await boxes(app))[2];
  })();
  near(third, {...second, x: second.x + 24, y: second.y + 24}, 'third window cascades from the second (the one used last)');
  report.push('new windows cascade by 24 px');
  // Give each window its own, different place and size.
  await app.main(({BaseWindow}) => {
    const wins = BaseWindow.getAllWindows().sort((a, b) => a.getBounds().x - b.getBounds().x);
    wins[0].setBounds({x: 40, y: 50, width: 1000, height: 700}); wins[1].setBounds({x: 300, y: 200, width: 1150, height: 780}); wins[2].setBounds({x: 520, y: 90, width: 980, height: 690});
  });
  await sleep(900);
  savedBounds = (await boxes(app)).map(pick);
  [{x: 40, y: 50, width: 1000, height: 700}, {x: 300, y: 200, width: 1150, height: 780}, {x: 520, y: 90, width: 980, height: 690}].forEach((expected, i) => near(savedBounds[i], expected, `positioned window ${i}`));
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']);
} catch (error) { try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); } catch {} throw error; }
await sleep(1500);

app = await startApp({root, skipSetup: false});
try {
  await poll(async () => (await boxes(app)).length === 3, Boolean, 'three windows restored', 30000);
  await sleep(600);
  const got = (await boxes(app)).map(pick);
  got.forEach((actual, i) => near(actual, savedBounds[i], `restored window ${i}`));
  report.push('restored windows keep their own bounds');
  const disk = JSON.parse(await fs.readFile(`${root}/window-state.json`, 'utf8'));
  assert.equal(Object.keys(disk.windows).length, 3, 'one saved entry per window');
} finally { await app.close(); }
await fx.close();
console.log(JSON.stringify({ok: true, report}, null, 1));
