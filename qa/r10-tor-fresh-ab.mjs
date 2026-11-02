// R10 tor-fresh: alternate two builds on fresh profiles, pairs run side by side so both see the same network.
//   node qa/r10-tor-fresh-ab.mjs <exeA> <exeB> <pairs> <capSeconds> <outDir>
import {spawn} from 'node:child_process';
const [a, b, pairs = '5', cap = '260', out = '.qa-profiles/r10-tor-fresh-out'] = process.argv.slice(2);
const run = (exe, label) => new Promise(res => { const c = spawn('node', ['qa/native-slot.mjs', 'r10-tor-' + label, '--', 'node', 'qa/r10-tor-fresh-run.mjs', label, cap, out], {env: {...process.env, D_APP_EXE: exe}, stdio: 'inherit'}); c.on('close', res); });
for (let i = 1; i <= Number(pairs); i++) await Promise.all([run(a, 'A' + i), run(b, 'B' + i)]);
