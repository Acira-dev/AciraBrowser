'use strict';
// 13.8 build-side fix (the Windows laptop's find): the extracted Widevine runtime of a release build (release/runtime-cache/widevine/win32-x64-XXXXXX, about 370 MB, one new folder per build) was
// removed only when a Windows build got through packaging, and never on the Mac, so every stopped or failed build left one behind (22 folders, about 8 GB, on the laptop; 7, 2.4 GB, on a Mac).
// Now: the build that made a folder removes it however it ends (a throwing step leaves none), and the next fetch sweeps what a killed build left, never a folder whose build is still running
// (an owner file beside it), never an archive or a download in progress, and nothing outside the cache (the Mac build templates, release/mac-widevine-*.noindex, are not in it).
// No Windows, no Mac and no Electron needed: the fetch runs on a small archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const read = file => require('node:fs').readFileSync(path.join(root, file), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cacheModule = () => import('../scripts/runtime-cache.mjs');
const windowsModule = () => import('../scripts/fetch-windows-widevine.mjs');
async function temp(t, prefix) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; }
async function fixtureArchive(dir) {
  const zip = new AdmZip();
  zip.addFile('electron.exe', Buffer.from('MZ ECS program')); zip.addFile('version', Buffer.from('44.9.3+wvcus\n')); zip.addFile('locales/en-US.pak', Buffer.from('pak'));
  const file = path.join(dir, 'fixture.zip'); zip.writeZip(file);
  const bytes = await fs.readFile(file);
  return {bytes, pin: {electron: '44.9.3', release: '44.9.3+wvcus', repository: 'castlabs/electron-releases', platforms: {x64: {sha256: sha(bytes), bytes: bytes.length}}}};
}
const fetchOptions = (fixture, cache, extra = {}) => ({platform: 'win32', pin: fixture.pin, electron: '44.9.3', cache, fetchImpl: async () => new Response(fixture.bytes, {headers: {'content-length': String(fixture.bytes.length)}}), log: () => {}, ...extra});
const names = async cache => (await fs.readdir(cache)).sort();
const HOUR = 3600 * 1000;
async function folder(cache, name, {owner, ageHours = 0} = {}) {
  const dir = path.join(cache, name);
  await fs.mkdir(path.join(dir, 'locales'), {recursive: true});
  await fs.writeFile(path.join(dir, 'electron.exe'), 'MZ');
  if (owner) await fs.writeFile(dir + '.owner', JSON.stringify(owner));
  if (ageHours) { const when = new Date(Date.now() - ageHours * HOUR); await fs.utimes(dir, when, when); }
  return dir;
}

test('a build whose steps throw after the runtime was extracted leaves no runtime folder, and no owner file (before: 370 MB per stopped or failed build)', async t => {
  const {guardWindowsWidevineRuntime, fetchWindowsWidevineRuntime} = await windowsModule();
  const dir = await temp(t, 'acira-leftovers-'), cache = path.join(dir, 'cache'), fixture = await fixtureArchive(dir);
  const runtime = await fetchWindowsWidevineRuntime(fetchOptions(fixture, cache));
  assert.ok((await names(cache)).some(name => /^win32-x64-[A-Za-z0-9]{6}$/.test(name)), 'extracted');
  await assert.rejects(guardWindowsWidevineRuntime(runtime, async held => {
    assert.equal(held, runtime, 'the work is given the runtime');
    assert.equal(await fs.readFile(path.join(held.runtime, 'electron.exe'), 'utf8'), 'MZ ECS program', 'and it is there while the work runs');
    throw new Error('Stopped at node qa/release-profile-cleanup.mjs (exit 1). No installer was published.');   // a failed check
  }), /Stopped at node qa\/release-profile-cleanup\.mjs/);
  const left = await names(cache);
  assert.deepEqual(left, ['electron-44.9.3+wvcus-win32-x64.zip'], 'only the verified archive stays in the cache: ' + left.join(', '));
});

test('a build that finishes removes it too, a Widevine-less build (no runtime) just runs, and removing twice is no error (the early removal after packaging, then the guard)', async t => {
  const {guardWindowsWidevineRuntime, removeWindowsWidevineRuntime, fetchWindowsWidevineRuntime} = await windowsModule();
  const dir = await temp(t, 'acira-leftovers-'), cache = path.join(dir, 'cache'), fixture = await fixtureArchive(dir);
  const runtime = await fetchWindowsWidevineRuntime(fetchOptions(fixture, cache));
  assert.equal(await guardWindowsWidevineRuntime(runtime, async () => { await removeWindowsWidevineRuntime(runtime); return 'built'; }), 'built');
  assert.deepEqual(await names(cache), ['electron-44.9.3+wvcus-win32-x64.zip']);
  assert.equal(await guardWindowsWidevineRuntime(null, async held => { assert.equal(held, null); return 'plain build'; }), 'plain build');
  await removeWindowsWidevineRuntime(null);
  await removeWindowsWidevineRuntime(runtime);
});

test('a refused or failed extraction leaves neither the folder nor its owner file', async t => {
  const {fetchWindowsWidevineRuntime} = await windowsModule();
  const dir = await temp(t, 'acira-leftovers-'), cache = path.join(dir, 'cache'), fixture = await fixtureArchive(dir);
  const wrong = {...fixture.pin, release: '44.9.2+wvcus', platforms: fixture.pin.platforms};   // the archive says 44.9.3+wvcus: refused after extraction
  await assert.rejects(fetchWindowsWidevineRuntime(fetchOptions(fixture, cache, {pin: wrong})), /says it is 44\.9\.3\+wvcus/);
  assert.deepEqual((await names(cache)).filter(name => name.startsWith('win32-')), [], 'no folder and no .owner file');
});

test('the sweep: a folder whose build is gone is removed, one whose build is running is kept, one with no owner file only when 12 hours old; archives, downloads and everything else are never touched', async t => {
  const {sweepRuntimeCache, WINDOWS_RUNTIME_FOLDER, MAX_BUILD_MS} = await cacheModule();
  const cache = await temp(t, 'acira-sweep-');
  const now = Date.now(), alive = new Set([4242]);
  await folder(cache, 'win32-x64-aaaaaa', {owner: {pid: 1111, startedAt: now - 5 * HOUR}});                       // its build is gone
  await folder(cache, 'win32-x64-bbbbbb', {owner: {pid: 4242, startedAt: now - 1 * HOUR}});                       // running
  await folder(cache, 'win32-x64-cccccc', {owner: {pid: 4242, startedAt: now - MAX_BUILD_MS - HOUR}});            // "running" for over a day: the process id was reused
  await folder(cache, 'win32-x64-dddddd', {ageHours: 40});                                                        // made by an older script, long ago
  await folder(cache, 'win32-x64-eeeeee', {ageHours: 1});                                                         // no owner file, young: maybe an older script's build that runs now
  await folder(cache, 'win32-x64-ffffff', {});                                                                    // just made
  await fs.mkdir(path.join(cache, 'win32-x64-gggggg'), {recursive: true}); await fs.writeFile(path.join(cache, 'win32-x64-gggggg.owner'), 'not json'); await fs.utimes(path.join(cache, 'win32-x64-gggggg'), new Date(now - 30 * HOUR), new Date(now - 30 * HOUR));   // unreadable owner file, old
  await fs.writeFile(path.join(cache, 'win32-x64-hhhhhh.owner'), JSON.stringify({pid: 1111, startedAt: now}));    // an owner file whose folder is gone
  await fs.writeFile(path.join(cache, 'electron-44.9.3+wvcus-win32-x64.zip'), 'archive');
  await fs.writeFile(path.join(cache, 'electron-44.9.3+wvcus-win32-x64.zip.download-777'), 'half');
  await fs.mkdir(path.join(cache, 'mac-widevine-0.1.0-beta.13.8-abcdef01.noindex'), {recursive: true});            // a build template: not this cache's, never matched
  await fs.mkdir(path.join(cache, 'win32-x64-short'), {recursive: true});                                         // not the shape fs.mkdtemp makes
  await fs.mkdir(path.join(cache, 'arm64-iiiiii'), {recursive: true});                                            // the Mac's names: not this platform's
  await fs.utimes(path.join(cache, 'arm64-iiiiii'), new Date(now - 90 * HOUR), new Date(now - 90 * HOUR));
  const log = [];
  const result = await sweepRuntimeCache(cache, {match: WINDOWS_RUNTIME_FOLDER, isAlive: pid => alive.has(pid), now: () => now, log: line => log.push(line)});
  assert.deepEqual(result.removed.sort(), ['win32-x64-aaaaaa', 'win32-x64-cccccc', 'win32-x64-dddddd', 'win32-x64-gggggg']);
  assert.deepEqual((await names(cache)), ['arm64-iiiiii', 'electron-44.9.3+wvcus-win32-x64.zip', 'electron-44.9.3+wvcus-win32-x64.zip.download-777', 'mac-widevine-0.1.0-beta.13.8-abcdef01.noindex', 'win32-x64-bbbbbb', 'win32-x64-bbbbbb.owner', 'win32-x64-eeeeee', 'win32-x64-ffffff', 'win32-x64-short']);
  assert.deepEqual(result.kept.map(item => item.name).sort(), ['win32-x64-bbbbbb', 'win32-x64-eeeeee', 'win32-x64-ffffff']);
  assert.ok(log.some(line => /win32-x64-aaaaaa.*gone/.test(line)) && log.some(line => /win32-x64-cccccc.*more than a day/.test(line)));
});

test('the Mac sweep touches only the Mac folders of the cache (arm64-XXXXXX, x64-XXXXXX), never a Windows one, an archive, or a build template', async t => {
  const {sweepRuntimeCache, MAC_RUNTIME_FOLDER} = await cacheModule();
  const cache = await temp(t, 'acira-sweep-mac-');
  const now = Date.now();
  await folder(cache, 'arm64-AAAAAA', {owner: {pid: 1111, startedAt: now - HOUR}});
  await folder(cache, 'x64-BBBBBB', {ageHours: 30});
  await folder(cache, 'x64-CCCCCC', {owner: {pid: 4242, startedAt: now - HOUR}});
  await folder(cache, 'win32-x64-dddddd', {ageHours: 90});
  await fs.writeFile(path.join(cache, 'electron-44.9.3+wvcus-darwin-arm64.zip'), 'archive');
  await fs.mkdir(path.join(cache, 'mac-widevine-0.1.0-beta.13.8-abcdef01.noindex'), {recursive: true});
  const result = await sweepRuntimeCache(cache, {match: MAC_RUNTIME_FOLDER, isAlive: pid => pid === 4242, now: () => now});
  assert.deepEqual(result.removed.sort(), ['arm64-AAAAAA', 'x64-BBBBBB']);
  assert.deepEqual(await names(cache), ['electron-44.9.3+wvcus-darwin-arm64.zip', 'mac-widevine-0.1.0-beta.13.8-abcdef01.noindex', 'win32-x64-dddddd', 'x64-CCCCCC', 'x64-CCCCCC.owner']);
});

test('the sweep never throws (no cache yet, a folder that cannot be removed) and a Windows build\'s fetch sweeps first: its own new folder is kept, a stale one of a dead build goes, a running build\'s stays', async t => {
  const {sweepRuntimeCache, WINDOWS_RUNTIME_FOLDER, claimRuntimeFolder} = await cacheModule();
  const {fetchWindowsWidevineRuntime, removeWindowsWidevineRuntime} = await windowsModule();
  const dir = await temp(t, 'acira-leftovers-'), cache = path.join(dir, 'cache'), fixture = await fixtureArchive(dir);
  assert.deepEqual(await sweepRuntimeCache(path.join(dir, 'no-such-cache'), {match: WINDOWS_RUNTIME_FOLDER}), {removed: [], kept: []});
  await fs.mkdir(cache, {recursive: true});
  await folder(cache, 'win32-x64-stale0', {owner: {pid: 2147483000, startedAt: Date.now() - 2 * HOUR}});     // a process id that is not running
  const running = await folder(cache, 'win32-x64-live00', {owner: {pid: process.pid, startedAt: Date.now() - 2 * HOUR}});   // this very process stands for the other running build
  const log = [];
  const runtime = await fetchWindowsWidevineRuntime(fetchOptions(fixture, cache, {log: line => log.push(line)}));
  const after = await names(cache);
  assert.ok(!after.includes('win32-x64-stale0') && !after.includes('win32-x64-stale0.owner'), 'the dead build\'s folder is gone');
  assert.ok(after.includes('win32-x64-live00') && after.includes('win32-x64-live00.owner'), 'the running build\'s folder is kept');
  assert.equal(await fs.readFile(path.join(running, 'electron.exe'), 'utf8'), 'MZ');
  assert.ok(log.some(line => /Removed the stale runtime folder win32-x64-stale0/.test(line)));
  const own = path.basename(runtime.runtime);
  assert.ok(after.includes(own) && after.includes(own + '.owner'), 'the new folder is claimed by this build');
  assert.equal(JSON.parse(await fs.readFile(runtime.runtime + '.owner', 'utf8')).pid, process.pid);
  assert.ok(!(await fs.readdir(runtime.runtime)).includes('.owner') && !(await fs.readdir(runtime.runtime)).some(name => name.endsWith('.owner')), 'the owner file is beside the folder, never inside it (the folder goes into the package)');
  await removeWindowsWidevineRuntime(runtime);
  assert.ok(!(await names(cache)).includes(own + '.owner'));
});

test('wiring: build-windows.mjs runs everything after the fetch inside the guard and removes the runtime after packaging as before; the Mac packager removes it once the copies are made; mac build templates are never named', () => {
  const build = read('scripts/build-windows.mjs');
  assert.match(build, /guard=fetcher\.guardWindowsWidevineRuntime;\}\n[^\n]*\nawait guard\(runtime,async\(\)=>\{\n/);
  assert.match(build, /\n\}\);\n?$/, 'the guard closes at the end of the script');
  assert.match(build, /if\(runtime\)await \(await import\('\.\/fetch-windows-widevine\.mjs'\)\)\.removeWindowsWidevineRuntime\(runtime\);/);
  assert.ok(!/fs\.rm\(runtime\.runtime/.test(build));
  const guardAt = build.indexOf('await guard(runtime'), packageAt = build.indexOf('packageWindows(candidate'), resultAt = build.indexOf('WINDOWS-BUILD-RESULT.json');
  assert.ok(guardAt > 0 && guardAt < build.indexOf("for(const script of ['build','test'])") && build.indexOf("for(const script of ['build','test'])") < packageAt && packageAt < resultAt, 'the whole build, tests and checks included, is inside it');
  const mac = read('scripts/package-mac-widevine.mjs');
  assert.match(mac, /await fs\.copyFile\(path\.join\(runtime\.runtime,'Contents\/MacOS\/Electron'\),path\.join\(contents,'MacOS\/AciraBrowser'\)\);\n await removeMacWidevineRuntime\(runtime\);/);
  const macFetch = read('scripts/fetch-mac-widevine.mjs');
  assert.match(macFetch, /sweepRuntimeCache\(cache,\{match:MAC_RUNTIME_FOLDER/);
  assert.match(macFetch, /catch\(error\)\{await removeRuntimeFolder\(extracted\);throw error;\}/);
  assert.ok(!/noindex/.test(read('scripts/runtime-cache.mjs').replace(/^\/\/.*$/gm, '')), 'the sweep names no build template (only comments mention them)');
});
