// Coordinator native lease required except --plan. One extension/app at a time.
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {CATALOG} from './catalog.mjs';
import {RUN, sha, verifyQualificationManifest} from './run-context.mjs';

const args = process.argv.slice(2), manifestIndex = args.indexOf('--manifest');
const manifest = manifestIndex >= 0 ? args[manifestIndex + 1] : null;
if (args.some((arg, index) => !(manifestIndex >= 0 && index === manifestIndex + 1) && !['--manifest', '--plan', '--phase1-only'].includes(arg)))
  throw Error('Usage: run-current.mjs --manifest FILE [--phase1-only] [--plan]');
const plan = CATALOG.map(item => ({slug: item.slug, phase: '1'}));
if (!args.includes('--phase1-only')) for (const slug of ['bitwarden', 'dark-reader', 'vimium']) plan.push({slug, phase: '2'});
if (args.includes('--plan')) {
  console.log(JSON.stringify({runId: RUN.id, manifest, plan, sourceOrPackaged: process.env.D_APP_EXE ? 'explicit packaged target' : 'built source',
    nativeStarted: false, scope: '15 phase-1 observations, optionally three restart/idle/sleep follow-ups; review every column'}, null, 2));
  process.exit(0);
}
if (!manifest) throw Error('An exact source/build qualification manifest is required.');
const before = await verifyQualificationManifest(manifest);
await fs.mkdir(RUN.output, {recursive: true});
if ((await fs.realpath(RUN.output)).toLowerCase() !== RUN.output.toLowerCase()) throw Error('Redirected evidence directory.');
const reportFile = path.join(RUN.output, 'summary.json');
const fixtureNames = ['qa/extension-matrix/run-current.mjs', 'qa/extension-matrix/run-context.mjs', 'qa/extension-matrix/probe.mjs',
  'qa/extension-matrix/lib.mjs', 'qa/extension-matrix/catalog.mjs', 'qa/extension-matrix/specific.mjs',
  'qa/d-harness.mjs', 'qa/prepared-native.mjs', 'qa/prepare-native-profile.cjs'];
const fixtures = await Promise.all(fixtureNames.map(async file => ({file, sha256: sha(await fs.readFile(file))})));
const report = {runId: RUN.id, status: 'running', started: new Date().toISOString(), manifest: before, fixtures, plan, rows: [],
  limitations: ['Completion is not compatibility PASS. Every observed column retains pass/partial/fail/error/unverified.',
    'Known DNR, DevTools panels, userScripts, New Tab override, Proton Pass and native vault/desktop limits remain explicit.',
    'Only the three named extensions get restart/45-second-idle/sleep observations; other phase-2 columns are not rerun.',
    'No account/vault login, biometric or real installed native-host probe; extension permission review uses the QA adapter.',
    'No product compatibility labels are regenerated. Earlier complete matrices remain historical.']};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2), {flag: 'wx'});
try {
  for (const item of plan) {
    await verifyQualificationManifest(manifest);
    const log = path.join(RUN.output, `${item.slug}-phase-${item.phase}.log`), output = createWriteStream(log, {flags: 'wx'});
    const env = {...process.env, ACIRA_EXT_MATRIX_RUN: RUN.id, PHASES: item.phase, REUSE: item.phase === '2' ? '1' : '0', IDLE: '1', ACIRA_DEV: '0'};
    delete env.ELECTRON_RUN_AS_NODE;
    let launchError;
    const child = spawn(process.execPath, [path.resolve('qa/extension-matrix/probe.mjs'), item.slug], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.pipe(output, {end: false}); child.stderr.pipe(output, {end: false});
    child.on('error', error => { launchError = String(error.message || error); });
    const exitCode = await new Promise(resolve => child.on('close', resolve));
    await new Promise((resolve, reject) => { output.once('error', reject); output.end(resolve); });
    const resultFile = path.join(RUN.output, 'phase-' + item.phase, item.slug + '.json');
    let result, resultSha256;
    try { const bytes = await fs.readFile(resultFile); resultSha256 = sha(bytes); result = JSON.parse(bytes); } catch {}
    const row = {...item, exitCode, log, resultFile, resultSha256, status: result?.status || 'missing-result',
      columns: Object.fromEntries(Object.entries(result?.steps || {}).map(([key, value]) => [key, value.status])),
      ...(launchError ? {launchError} : {}), ...(result?.fatal ? {fatal: result.fatal} : {})};
    report.rows.push(row);
    await verifyQualificationManifest(manifest);
    console.log(`${item.slug} phase ${item.phase}: ${row.status}; inspect column verdicts`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    if (launchError || exitCode !== 0 || result?.runId !== RUN.id || result?.status !== 'completed-with-per-column-verdicts')
      throw Error('Extension probe failed; retained evidence: ' + resultFile);
  }
  report.after = await verifyQualificationManifest(manifest);
  for (const item of fixtures) if (sha(await fs.readFile(item.file)) !== item.sha256) throw Error('Qualification harness changed: ' + item.file);
  report.status = 'completed-requires-column-review';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({reportFile, status: report.status, observations: report.rows.length}));
}
