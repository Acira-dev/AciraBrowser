// Run one QA child with a wall-clock cap. Only the spawned child's process tree can be stopped.
import {spawn, execFileSync} from 'node:child_process';
const [seconds, script, ...args] = process.argv.slice(2);
if (!script || !Number.isFinite(+seconds) || +seconds < 1 || +seconds > 300) throw Error('usage: seconds(1..300) script args');
const child = spawn(process.execPath, [script, ...args], {stdio:'inherit', windowsHide:true, env:process.env});
let timedOut = false;
const stop = () => {
  if (child.exitCode !== null) return;
  timedOut = true;
  if (process.platform === 'win32') { try { execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch {} }
  else child.kill('SIGKILL');
};
const timer = setTimeout(stop, +seconds * 1000);
process.once('SIGINT',stop); process.once('SIGTERM',stop);
child.once('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});
child.once('exit',code=>{clearTimeout(timer);process.exitCode=timedOut?124:code??1;});
