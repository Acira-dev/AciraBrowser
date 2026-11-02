// Runs every stream D native QA script in sequence and prints a one-line verdict each.
import {spawnSync} from 'node:child_process';
const scripts = ['profiles', 'private', 'permissions', 'shortcuts', 'zoom', 'downloads', 'restore', 'output', 'certs', 'spellcheck', 'tabs', 'popups', 'crash', 'windows', 'dialog', 'screenshare', 'context', 'unload', 'download-folder', 'settings-ui', 'sleep', 'sleep-raw', 'proxy', 'download-restart', 'capture', 'opener-history', 'sidebar-key', 'e2e'];
let failed = 0;
for (const name of scripts) {
  const run = spawnSync(process.execPath, [`qa/d-${name}.mjs`], {encoding: 'utf8', timeout: 400000});
  const ok = run.status === 0; if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  d-${name}`); if (!ok) console.log((run.stdout + run.stderr).split('\n').slice(-12).join('\n'));
}
process.exit(failed ? 1 : 0);
