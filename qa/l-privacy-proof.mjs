// One authorized privacy check per invocation; no app starts until this file is explicitly run.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const limits = {'n-tor-window': 480000, 'n-tor-vault': 240000, 'd-private-tabs': 240000, 'd-private': 180000};
const name = process.argv[2];
if (!Object.hasOwn(limits, name)) throw Error('Choose n-tor-window, n-tor-vault, d-private-tabs, or d-private.');
const label = process.argv[3];
if (label && !/^[a-zA-Z0-9_-]+$/.test(label)) throw Error('Use a simple privacy report label.');
const out = path.resolve('qa/artifacts', 'l-privacy-proof' + (label ? '-' + label : ''));
fs.mkdirSync(out, {recursive: true});
const file = path.join(out, name + '.log'), log = fs.createWriteStream(file);
const started = Date.now();
const child = spawn(process.execPath, [`qa/${name}.mjs`], {env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
let timedOut = false, interrupted = false, error = null;
const stop = () => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  else child.kill('SIGKILL');
};
const interrupt = () => { interrupted = true; stop(); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const timer = setTimeout(() => { timedOut = true; stop(); }, limits[name]);
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data); });
child.on('error', err => { error = err.message; });
child.on('close', status => {
  clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); log.end();
  const result = {name, status, timedOut, interrupted, error, seconds: Math.round((Date.now() - started) / 1000), log: file};
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exitCode = status === 0 && !timedOut && !interrupted && !error ? 0 : 1;
});
