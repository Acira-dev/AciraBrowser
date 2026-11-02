// Fingerprint matrix: loads the lab page (qa/identity-lab.mjs) in a normal tab, a window.open popup and a target=_blank link, in either the real Acira
// app (isolated profile under .qa-profiles/) or the installed Google Chrome (fresh temp profile, fingerprint page only), and writes one JSON file.
//   node qa/native-slot.mjs identity -- node qa/identity-matrix.mjs --acira <out.json>      run from the worktree root
//   node qa/identity-matrix.mjs --chrome <out.json>                                          no Acira involved; needs Google Chrome at the standard path
//   node qa/identity-matrix.mjs --compare <chrome.json> <acira.json>                         prints the differences per surface
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {startLab, summarize, diffSummaries} from './identity-lab.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const [mode, a, b] = process.argv.slice(2);

async function runChrome(out) {
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(file => fs.existsSync(file));
  if (!exe) throw Error('Google Chrome is not installed at the standard path.');
  const lab = await startLab(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-fp-'));
  const child = spawn(exe, ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking', '--disable-sync', '--window-position=-2400,0', '--window-size=700,700', lab.base + '/fp?label=chrome&auto=1'], {stdio: 'ignore', windowsHide: false});
  try {
    const result = {version: spawnSync(exe, ['--version'], {encoding: 'utf8'}).stdout?.trim() || null, surfaces: {}};
    for (const label of ['chrome', 'chrome-popup', 'chrome-blank']) result.surfaces[label] = {report: await lab.wait(label, 30000), document: lab.documents.get(label)};
    fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log('Chrome fingerprint written:', out);
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    await lab.close(); await wait(800); fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3});
  }
}

async function runAcira(out) {
  const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
  await withSlot('identity-matrix', async () => {
    const lab = await startLab(), data = path.resolve('.qa-profiles/identity-' + Date.now());
    const app = await launchPreparedNative({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
      env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'},
    });
    try {
      let ui;
      for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
      if (!ui) throw Error('UI page not found');
      try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* already past setup */ }
      await ui.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), lab.base + '/fp?label=acira');
      const find = async part => { for (let i = 0; i < 200; i++) { const page = app.windows().find(p => p.url().includes(part)); if (page) return page; await wait(100); } throw Error('No page for ' + part); };
      const tabPage = await find('/fp?label=acira');
      await lab.wait('acira');
      await tabPage.click('#pop'); await lab.wait('acira-popup');
      await tabPage.click('#blank'); await lab.wait('acira-blank');
      const result = {version: await app.evaluate(() => process.versions.chrome), surfaces: {}};
      for (const label of ['acira', 'acira-popup', 'acira-blank']) result.surfaces[label] = {report: lab.reports.get(label), document: lab.documents.get(label)};
      fs.writeFileSync(out, JSON.stringify(result, null, 1));
      console.log('Acira fingerprint written:', out);
    } finally { await app.close().catch(() => {}); await lab.close(); }
  });
}

/** The app started the way a person starts it: no debugging port, no automation driver. The page is passed as an address on the command line. */
async function runAciraPlain(out) {
  const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
  await withSlot('identity-matrix-plain', async () => {
    const lab = await startLab(), data = path.resolve('.qa-profiles/identity-plain-' + Date.now()), electron = createRequire(import.meta.url)('electron');
    // Prepare the profile (native key) with the automation harness, close it, then start the same profile the plain way.
    const prep = await launchPreparedNative({executablePath: electron, args: [path.resolve('desktop/main.cjs')], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
    await wait(2500); await prep.close().catch(() => {}); await wait(1500);
    const env = {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1', APPDATA: path.join(data, 'fixture-roaming'), LOCALAPPDATA: path.join(data, 'fixture-local')};
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.resolve('desktop/main.cjs'), '--disable-renderer-backgrounding', lab.base + '/fp?label=plain'], {env, stdio: 'ignore', windowsHide: true});
    try {
      const report = await lab.wait('plain', 40000);
      fs.writeFileSync(out, JSON.stringify({version: 'plain', surfaces: {plain: {report, document: lab.documents.get('plain')}}}, null, 1));
      console.log('Plain Acira fingerprint written:', out, '| webdriver =', report.webdriver);
    } finally { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'}); await lab.close(); }
  });
}

function compare(chromeFile, acirFile) {
  const chrome = JSON.parse(fs.readFileSync(chromeFile, 'utf8')), acira = JSON.parse(fs.readFileSync(acirFile, 'utf8'));
  const pairs = [['tab', 'chrome', 'acira'], ['window.open popup', 'chrome-popup', 'acira-popup'], ['target=_blank', 'chrome-blank', 'acira-blank']];
  const ignore = ['outer_vs_inner', 'plugins', 'mimeTypes', 'doc.sec-fetch', 'doc.extra', 'fetch.extra'];
  for (const [title, c, x] of pairs) {
    const s = summarize(chrome.surfaces[c].report, chrome.surfaces[c].document), t = summarize(acira.surfaces[x].report, acira.surfaces[x].document);
    console.log(`\n== ${title} ==  (Chrome ${chrome.version} vs Acira Chromium ${acira.version})`);
    const diff = diffSummaries(s, t, process.env.IDENTITY_ALL ? [] : ignore);
    if (!diff.length) console.log('  identical on every compared signal'); else for (const d of diff) console.log(`  ${d.key}\n     chrome: ${d.a}\n     acira : ${d.b}`);
    // global names: what window / navigator carry that Chrome's does not, and the reverse
    const sets = (r, k) => new Set(r.report[k] || []);
    for (const key of ['windowProps', 'navigatorOwn', 'navigatorProto', 'uaDataProto']) {
      const cs = sets(chrome.surfaces[c], key), as = sets(acira.surfaces[x], key);
      const extra = [...as].filter(v => !cs.has(v)), missing = [...cs].filter(v => !as.has(v));
      if (extra.length || missing.length) console.log(`  ${key}: only in acira [${extra.join(', ')}]  only in chrome [${missing.join(', ')}]`);
    }
  }
}

/** Differences between surfaces of one file (for example the tab against its popup). */
function within(file, base, ...others) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), sum = l => summarize(j.surfaces[l].report, j.surfaces[l].document);
  for (const other of others) {
    console.log(`== ${base} vs ${other}`);
    const diff = diffSummaries(sum(base), sum(other), ['doc.sec-fetch']);
    if (!diff.length) console.log('  identical'); else for (const d of diff) console.log(`  ${d.key}\n     ${base}: ${d.a}\n     ${other}: ${d.b}`);
    for (const key of ['windowProps', 'navigatorOwn', 'navigatorProto']) {
      const s = new Set(j.surfaces[base].report[key] || []), t = new Set(j.surfaces[other].report[key] || []);
      const x = [...t].filter(v => !s.has(v)), y = [...s].filter(v => !t.has(v));
      if (x.length || y.length) console.log(`  ${key}: only in ${other} [${x.join(',')}] only in ${base} [${y.join(',')}]`);
    }
  }
}

if (mode === '--within') within(a, b, ...process.argv.slice(5));
else if (mode === '--chrome') await runChrome(path.resolve(a));
else if (mode === '--acira') await runAcira(path.resolve(a));
else if (mode === '--acira-plain') await runAciraPlain(path.resolve(a));
else if (mode === '--compare') compare(a, b);
else { console.log('usage: --chrome <out> | --acira <out> | --compare <chrome.json> <acira.json>'); process.exit(2); }
process.exit(0);
