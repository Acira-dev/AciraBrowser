// Run one native QA script under a native slot (C:\ae\slot-N.lock, flag wx), released in finally; the script is killed after 9 minutes.
//   node qa/r4-slot-run.mjs qa/privacy-plus/threat-warning-app.mjs [args...]
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function takeSlot() {
  for (let round = 0; round < 40; round++) {
    for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-perf ${process.argv[2]} ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
const slot = await takeSlot();
try {
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, process.argv.slice(2), {stdio: 'inherit'});
    const timer = setTimeout(() => child.kill(), 9 * 60 * 1000);
    child.on('close', c => { clearTimeout(timer); resolve(c); });
  });
  process.exitCode = code ?? 1;
} finally { await fs.rm(slot, {force: true}); }
