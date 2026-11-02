// Preparation only: no installer/uninstaller/process/UI/registry operations.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const root = process.cwd(), releaseRoot = path.resolve('release');
const config = JSON.parse(await fs.readFile('packaging/electron-builder.json', 'utf8'));
const strings = JSON.parse(await fs.readFile('packaging/installer/strings.json', 'utf8'));
const codes = {en_US: 'en', es_ES: 'es', fr_FR: 'fr', de_DE: 'de', pt_BR: 'pt', it_IT: 'it', ja_JP: 'ja', zh_CN: 'zh'};
const locales = config.nsis.installerLanguages.map(locale => {
  const code = codes[locale];
  if (!code || !strings[code]?.uninstall?.q || strings[code].labels.length !== 3) throw Error('Installer locale/text contract changed.');
  return {locale, code, question: strings[code].uninstall.q, buttons: strings[code].labels};
});
const runId = `installer-data-${Date.now()}-${randomUUID().slice(0, 8)}`;
const fixture = path.resolve('.qa-profiles', runId);
const report = {schema: 1, runId, nativeStarted: false, status: 'PREPARED_ONLY', root,
  fixture, installRoot: path.join(fixture, 'installation'), locales,
  unsupportedInstallerLocales: ['ar', 'tr', 'ru', 'ko', 'hi'],
  fixtureEnvironment: {APPDATA: path.join(fixture, 'roaming'), LOCALAPPDATA: path.join(fixture, 'local'),
    ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.join(fixture, 'roaming', 'AciraBrowser'), ACIRA_DEV: '0'},
  visualQueue: locales.map(({locale, code}) => ({locale, env: {ACIRA_INSTALLER_LANG: code},
    helper: 'Capture exact installed branded question; check title, wrapping, all three buttons, keyboard/default focus; Cancel.',
    rawNsis: 'Capture exact owned NSIS data question after fixture uninstall; choose No to retain data. Never Yes on this user account.'})),
  functionalQueue: ['Create synthetic marker data through the isolated fixture; record its exact path/hash.',
    'Use exact installed branded helper: keep-data, reinstall same exact installer, verify fixture data survives.',
    'Use exact helper delete-data with both redirected environment roots verified under the fixture; verify both AciraBrowser directories disappear.',
    'Verify only owned registrations/shortcut/install files are removed. Retain before/after evidence and failures.'],
  admission: ['Coordinator native/install lease and exact current installer/helper identity required.',
    'Preserve any existing Acira installation/registration/shortcut; use the existing coord-packaged guard or equivalent before installation.',
    'Check resolved absolute paths and reparse points before any fixture deletion or move.',
    'Never select raw NSIS Yes: shell $APPDATA isolation is not established by process environment redirection.',
    'Use computer-use skill for own application dialog inspection; stop at OS/security/elevation prompts.',
    'No force-closing the user browser; normal review refresh requires its separate coordinator checkpoint.'],
  limitations: ['Plan only; no installed functional or pixel check has passed.',
    'Eight installer locales are separate from thirteen browser catalogs.',
    'Native-speaker wording acceptance and other machines/DPI remain separate.']};
async function identify(filename) {
  if (!path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== '.exe') throw Error('Use an absolute candidate .exe path.');
  const actual = await fs.realpath(filename), release = await fs.realpath(releaseRoot);
  if (!actual.toLowerCase().startsWith(release.toLowerCase() + path.sep)) throw Error('Candidate must be inside this workspace release directory.');
  const bytes = await fs.readFile(actual);
  if (!bytes.length) throw Error('Empty installer/helper.');
  return {file: actual, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}
if (!args.includes('--plan')) {
  const installer = value('--installer'), helper = value('--helper');
  if (!installer || !helper) throw Error('Usage: installer-data-plan.mjs --plan OR --installer ABS_EXE --helper ABS_EXE');
  report.installer = await identify(installer); report.helper = await identify(helper);
  const directory = path.resolve('qa/artifacts/installer-data', runId);
  await fs.mkdir(directory, {recursive: true});
  report.reportFile = path.join(directory, 'plan.json');
  await fs.writeFile(report.reportFile, JSON.stringify(report, null, 2), {flag: 'wx'});
}
console.log(JSON.stringify(report, null, 2));
