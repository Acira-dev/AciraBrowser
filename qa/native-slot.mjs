// Native-app slots shared by every QA session on this PC: C:\ae\slot-1..3.lock, created with flag "wx" so only one
// session holds a slot at a time (at most three real app instances run together). A slot is always released in `finally`.
//   import {withSlot} from './native-slot.mjs';  await withSlot('my-qa', async () => { ...launch one app... });
//   node qa/native-slot.mjs <name> -- <command> [args...]    waits for a slot, runs the command with inherited stdio, releases, exits with its code
import fs from 'node:fs/promises';
import {rmSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = process.platform === 'win32' ? 'C:/ae' : path.resolve('.qa-profiles/native-slots');
const LOCKS = [1, 2, 3].map(n => path.join(ROOT, `slot-${n}.lock`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Waits (up to ~25 minutes) for a free slot and returns the lock file path that is now ours. */
export async function takeSlot(name, {waitMs = 25 * 60_000} = {}) {
  await fs.mkdir(ROOT, {recursive: true});
  const until = Date.now() + waitMs;
  for (;;) {
    for (const file of LOCKS) {
      try {
        const handle = await fs.open(file, 'wx');
        await handle.write(`${name} ${new Date().toISOString()}`); await handle.close();
        return file;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (Date.now() > until) throw new Error('No native slot became free in time.');
    await sleep(15_000);
  }
}
export const releaseSlot = file => fs.rm(file, {force: true});

export async function withSlot(name, work) {
  const file = await takeSlot(name);
  // A crash that skips `finally` (an unhandled rejection ends the process at once) must not leave the lock behind for everyone else: release it synchronously on exit.
  const onExit = () => { try { rmSync(file, {force: true}); } catch { /* already gone */ } };
  process.once('exit', onExit);
  try { return await work(file); } finally { process.removeListener('exit', onExit); await releaseSlot(file); }
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  const split = process.argv.indexOf('--');
  if (split < 3 || split === process.argv.length - 1) throw new Error('Usage: node qa/native-slot.mjs <name> -- <command> [args...]');
  const name = process.argv[2], [command, ...args] = process.argv.slice(split + 1);
  const file = await takeSlot(name);
  let code = 1;
  try {
    code = await new Promise(resolve => {
      const child = spawn(command, args, {stdio: 'inherit', windowsHide: true});
      const stop = () => { if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      child.on('error', () => resolve(1));
      child.on('close', status => resolve(status ?? 1));
    });
  } finally { await releaseSlot(file); }
  process.exit(code);
}
