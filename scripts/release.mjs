// One-command release: committed source -> build -> Tor -> sign helpers -> installer + portable (signed when configured) -> assets in one folder
// -> a GitHub DRAFT release. Nothing is uploaded unless --publish is passed; the default is a dry run that builds locally and prints what it would publish.
//   node scripts/release.mjs                       dry run, channel from the version (0.1.0-beta.N = beta, otherwise stable)
//   node scripts/release.mjs --publish             also creates the draft release with `gh` (founder go only; needs `gh auth login`)
//   --channel stable|beta   override the channel      --out <folder>   output folder (default release/round/<version>)
//   --skip-tests            skip `npm test`            --allow-dirty    build a working tree with uncommitted changes (never for a real release)
//   --allow-private-target  publish even though the release target (packaging/release-target.json) is not reachable without logging in
//   --qa-identity           a QA candidate: "Acira Browser QA" with its own app id, uninstall entry, registration, shortcut, install and data
//                           folders (packaging/signing-config.cjs), so installing or removing it never touches the real Acira; never published
// Signing is configured by environment variables only (docs/launch/CODE_SIGNING.md); with none set the build is unsigned and says so.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { signFiles, signingMode, signatureStatus } from './release-sign.mjs';
import { withInstallerHelpers } from './release-helpers.mjs';
import { reportTarget } from './check-release-target.mjs';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = name => args.includes(name), value = name => args[args.indexOf(name) + 1];
const { loadReleaseTarget, repoSlug, describeTarget, checkReleaseTarget } = require('../packaging/release-target.cjs');
const target = loadReleaseTarget(), REPO = repoSlug(target); // where releases live: packaging/release-target.json (null for a generic target)
const say = message => console.log(`[release] ${message}`);
const fail = message => { console.error(`[release] ${message}`); process.exit(1); };
const run = (command, argv, options = {}) => { const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.cmd$/i.test(command), ...options }); if (result.status !== 0) throw new Error(`${command} ${argv.slice(0, 2).join(' ')} failed (exit ${result.status}).`); return result; };
const sha = (file, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), version = pkg.version, tag = `v${version}`;
const channel = flag('--channel') ? value('--channel') : /-/.test(version) ? 'beta' : 'stable';
if (!['stable', 'beta'].includes(channel)) fail('--channel must be stable or beta.');
if (channel === 'stable' && /-/.test(version)) fail(`Version ${version} is a pre-release; use --channel beta or change the version.`);
const publish = flag('--publish'), out = path.resolve(flag('--out') ? value('--out') : path.join(root, 'release', 'round', version));
const assetsDir = path.join(out, 'assets'), builderOut = path.join(out, 'builder');
const mode = signingMode(process.env);
say(`${publish ? 'PUBLISH' : 'DRY RUN'} ${tag} channel=${channel} signing=${mode} out=${out}`);

// 0. can people who are not logged in reach the release target? (read-only requests; a dry run only warns, --publish refuses)
const reach = await checkReleaseTarget(target);
reportTarget(target, reach, say);
if (publish && !reach.ok && !flag('--allow-private-target')) fail(`Refusing to publish: users could not reach ${describeTarget(target)}. Make it public (docs/launch/RELEASING.md > Going public) or pass --allow-private-target.`);

// 1. committed source
const dirty = git('status', '--porcelain', '--untracked-files=no');
const commit = git('rev-parse', 'HEAD');
if (dirty && !flag('--allow-dirty')) fail('The working tree has uncommitted changes; commit them first (or --allow-dirty for a throwaway build).\n' + dirty);
if (publish && flag('--allow-dirty')) fail('--allow-dirty cannot be combined with --publish.');
const qaIdentity = flag('--qa-identity');
if (publish && qaIdentity) fail('--qa-identity builds are for QA only and cannot be published.');
if (qaIdentity) say('identity: QA ("Acira Browser QA": its own app id, uninstall entry, registration and data folder)');
say(`source: ${commit.slice(0, 8)}${dirty ? ' (DIRTY, allowed)' : ' (clean)'}`);

// 2. build and test
say('building the interface and runtime');
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
say('refreshing the bundled filter lists and scriptlets (a failed download keeps the committed ones)');
run(process.execPath, [path.join(root, 'scripts/fetch-baseline-filters.mjs'), path.join(root, 'resources/filters'), '--soft']);
say('checking the phishing and malware feeds for whole-host entries that block well-known sites (listed for review, never fails the build)');
run(process.execPath, [path.join(root, 'scripts/check-threat-lists.mjs'), '--soft']);
say('compiling the bundled filter engine for first-run startup');
run(process.execPath, [path.join(root, 'scripts/build-filter-engine.cjs'), path.join(root, 'resources/filters')]);
if (!flag('--skip-tests')) { say('running the test suite'); run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']); } else say('tests skipped (--skip-tests)');

// 3. Tor engine: fetched and verified against the pinned hash (and the Tor Browser Developers signature when gpg exists)
const hasGpg = spawnSync('gpg', ['--version'], { stdio: 'ignore' }).status === 0;
say(`Tor engine${hasGpg ? ' (signature required)' : ' (pinned SHA-256; gpg not found, signature not checked)'}`);
run(process.execPath, [path.join(root, 'scripts/fetch-tor.mjs'), ...(hasGpg ? ['--require-signature'] : [])]);

// 4. Rebuild helpers from C#/frames (the installer's two and the app's acira-verify.exe, which electron-builder copies into resources),
// sign only for this build and restore exact preexisting bytes (or initial absence in a fresh source checkout).
fs.rmSync(builderOut, { recursive: true, force: true }); fs.mkdirSync(builderOut, { recursive: true });
withInstallerHelpers({root, sign: helpers => {
  if (mode !== 'none') signFiles(helpers); else say('signing: not configured, installer and helpers stay UNSIGNED (Windows will warn).');
}, build: () => {
  // 5. installer + portable zip (electron-builder signs the app, its dlls, the uninstaller and the installer when signing is configured)
  say('building the installer and portable package');
  const builderPackage = require.resolve('electron-builder/package.json');
  run(process.execPath, [path.resolve(path.dirname(builderPackage), require(builderPackage).bin['electron-builder']), '--config', 'packaging/electron-builder.cjs', '--win', '--x64', '--publish', 'never', `-c.directories.output=${builderOut}`], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ACIRA_BUILD_IDENTITY: qaIdentity ? 'qa' : '' } });
}});

// 6. assets in one folder
fs.rmSync(assetsDir, { recursive: true, force: true }); fs.mkdirSync(assetsDir, { recursive: true });
const built = fs.readdirSync(builderOut);
const pick = pattern => { const hit = built.filter(name => pattern.test(name)); if (hit.length !== 1) fail(`Expected exactly one build output matching ${pattern}, found: ${hit.join(', ') || 'none'}`); return hit[0]; };
const setup = pick(/^AciraBrowser(?:QA)?Setup\.exe$/), portable = pick(/^AciraBrowser(?:QA)?-portable\.zip$/), blockmap = pick(/^AciraBrowser(?:QA)?Setup\.exe\.blockmap$/);
for (const name of [setup, portable, blockmap, 'latest.yml']) fs.copyFileSync(path.join(builderOut, name), path.join(assetsDir, name));
fs.copyFileSync(path.join(builderOut, 'latest.yml'), path.join(assetsDir, 'beta.yml')); // a Beta-channel app reads beta.yml, a Stable one latest.yml
const notes = path.join(root, 'docs/launch/RELEASE_NOTES.md');
if (fs.existsSync(notes)) fs.copyFileSync(notes, path.join(assetsDir, 'RELEASE_NOTES.md'));

// 7. verify what will be published
const problems = [];
const latest = fs.readFileSync(path.join(assetsDir, 'latest.yml'), 'utf8');
const yamlValue = key => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(latest)?.[1].trim();
if (yamlValue('version') !== version) problems.push(`latest.yml version ${yamlValue('version')} != ${version}`);
if (yamlValue('sha512') !== sha(path.join(assetsDir, setup), 'sha512', 'base64')) problems.push('latest.yml sha512 does not match the installer');
const unpackedTor = path.join(builderOut, 'win-unpacked', 'resources', 'tor', 'tor.exe');
const torPin = require(path.join(root, 'desktop/browser-services/tor-engine/tor-version.json')).files['tor.exe'].sha256;
if (!fs.existsSync(unpackedTor) || sha(unpackedTor) !== torPin) problems.push('tor.exe is missing from the package or differs from the pinned hash');
// acira-verify.exe: the Windows Hello / password check, browser icons and VPN signatures (desktop/windows-helper.cjs). Without it every secured workspace, saved Tor item and password stays locked.
const unpackedVerify = path.join(builderOut, 'win-unpacked', 'resources', 'acira-verify.exe');
if (!fs.existsSync(unpackedVerify)) problems.push('acira-verify.exe is missing from the package (resources/acira-verify.exe)');
const exe = path.join(builderOut, 'win-unpacked', 'AciraBrowser.exe');
const signature = { installer: signatureStatus(path.join(assetsDir, setup)), app: fs.existsSync(exe) ? signatureStatus(exe) : 'missing', verify: fs.existsSync(unpackedVerify) ? signatureStatus(unpackedVerify) : 'missing' };
if (fs.existsSync(exe)) { const { WINDOWS, fuseProblems, describe } = require('../packaging/fuses.cjs'), wrong = await fuseProblems(exe, WINDOWS); if (wrong.length) problems.push('the packaged app ships the wrong Electron fuses: ' + describe(wrong)); } // read back from the built program
if (mode !== 'none' && (signature.installer !== 'Valid' || signature.app !== 'Valid' || signature.verify !== 'Valid')) problems.push(`signing was configured but signatures are not valid: ${JSON.stringify(signature)}`);
if (problems.length) fail('Verification failed:\n - ' + problems.join('\n - '));

const files = fs.readdirSync(assetsDir).map(name => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size, sha256: sha(path.join(assetsDir, name)) }));
fs.writeFileSync(path.join(assetsDir, 'SHA256SUMS.txt'), files.map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify({ tag, version, channel, commit, dirty: Boolean(dirty), signing: { mode, signature }, tor: torPin, builtAt: new Date().toISOString(), files }, null, 2) + '\n');
say(`assets ready in ${assetsDir}`);
for (const f of files) say(`  ${f.name}  ${(f.bytes / 1048576).toFixed(1)} MB  ${f.sha256.slice(0, 12)}…`);
say(`signature: installer ${signature.installer}, app ${signature.app}, acira-verify ${signature.verify}${mode === 'none' ? ' (unsigned build; expected without signing)' : ''}`);

// 8. the GitHub draft release
const upload = [...fs.readdirSync(assetsDir).map(name => path.join(assetsDir, name))];
if (!REPO) { say(`release target is ${describeTarget(target)} (not GitHub): upload everything in ${assetsDir} there yourself; nothing was uploaded.`); process.exit(0); }
const ghArgs = ['release', 'create', tag, '--repo', REPO, '--draft', '--title', `Acira Browser ${version.replace(/-beta\.\d+(?:\.\d+)?$/, ' Beta')}`, '--notes-file', notes, '--target', commit, ...(channel === 'beta' ? ['--prerelease'] : []), ...upload];
if (!publish) {
  say('dry run: nothing uploaded. With --publish this would run:');
  console.log('  gh ' + ghArgs.map(a => (a.startsWith(assetsDir) ? '<assets>/' + path.basename(a) : /\s/.test(a) ? `"${a}"` : a)).join(' '));
  say('The release stays a DRAFT until you publish it on GitHub. Update feed: the app reads latest.yml (Stable) or beta.yml (Beta) from the newest matching release.');
  process.exit(0);
}
if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status !== 0) fail('The GitHub CLI (gh) is not installed or not on PATH.');
if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) fail('gh is not logged in: run `gh auth login`.');
run('gh', ghArgs);
say(`draft release ${tag} created on ${REPO}. Review it on GitHub, then publish it there.`);
