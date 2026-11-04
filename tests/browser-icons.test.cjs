'use strict';
// R4-53: installed browsers' own app icons for the import lists. app.getFileIcon is mocked; nothing real is read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BROWSERS, browserExecutables, createBrowserIcons, sanitizeIcons, validIconUrl, windowsExtract } = require('../desktop/browser-services/browser-icons.cjs');

const PNG = (tag) => 'data:image/png;base64,' + Buffer.from('png-' + tag).toString('base64');
/** A stand-in for Electron's NativeImage. `side` is the icon's pixel size. */
const image = (tag, { side = 32, empty = false, url = PNG(tag) } = {}) => {
  const made = {
    resizedTo: null,
    isEmpty: () => empty,
    toPNG: () => Buffer.from('pixels-' + tag),
    getSize: () => ({ width: side, height: side }),
    resize: (options) => ({ ...made, resizedTo: options, getSize: () => ({ width: options.width, height: options.height }), toDataURL: () => PNG(tag + '-' + options.width) }),
    toDataURL: () => url,
  };
  return made;
};
const WIN = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
const HOME = 'C:\\Users\\me';
/** Files that "exist" on the pretend machine. */
function machine(files, { platform = 'win32', env = WIN, icons = {}, appPaths = {}, home = HOME, extracted = null, thumbnails = {} } = {}) {
  const calls = { icon: [], stat: [], registry: [], generic: [], extract: [] };
  const service = createBrowserIcons({
    platform,
    env,
    home,
    extractIcon: async (file) => (calls.extract.push(file), extracted),
    thumbnail: platform === 'darwin' ? async (file) => { calls.thumb = [...(calls.thumb || []), file]; const made = thumbnails[file]; if (made instanceof Error) throw made; return made || null; } : null,
    app: {
      getFileIcon: async (file, options) => {
        // Windows' stand-in for an executable with no icon of its own: what a path that does not exist gets.
        if (/generic\.exe$/.test(file)) { calls.generic.push(options.size); return image('windows-generic'); }
        calls.icon.push([file, options.size]);
        const made = icons[file + '|' + options.size] ?? icons[file];
        if (made instanceof Error) throw made;
        return made || image('default:' + (platform === 'win32' ? path.win32 : path.posix).basename(file));
      },
    },
    stat: async (file) => {
      calls.stat.push(file);
      return files.includes(file) ? { file: platform !== 'darwin', directory: platform === 'darwin' } : null;
    },
    readAppPaths: async (exe) => {
      calls.registry.push(exe);
      return appPaths[exe] || [];
    },
  });
  return { service, calls };
}

test('an installed browser gets its executable icon at the large size, as a PNG data URL', async () => {
  const { service, calls } = machine(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
  const icons = await service.icons(['Chrome', 'Edge']);
  assert.deepEqual(Object.keys(icons), ['Chrome']);
  assert.match(icons.Chrome, /^data:image\/png;base64,/);
  assert.deepEqual(calls.icon, [['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'large']]);
});

test('a browser with no executable on this machine has no icon, so the interface keeps its letter tile', async () => {
  const { service, calls } = machine([]);
  assert.deepEqual(await service.icons(['Edge', 'Zen']), {});
  assert.equal(calls.icon.length, 0, 'nothing is read when there is nothing installed');
  // The App Paths registry is consulted only after the usual folders came up empty.
  assert.deepEqual(calls.registry.sort(), ['msedge.exe', 'zen.exe']);
});

test('an empty or failing large icon falls back to the normal size; no usable size means no icon', async () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const zen = 'C:\\Program Files\\Zen Browser\\zen.exe';
  const { service, calls } = machine([edge, zen], { icons: { [edge + '|large']: image('e', { empty: true }), [edge + '|normal']: image('edge-normal'), [zen]: new Error('no icon') } });
  const icons = await service.icons(['Edge', 'Zen']);
  assert.equal(icons.Edge, PNG('edge-normal'));
  assert.equal('Zen' in icons, false);
  assert.deepEqual(calls.icon.filter(([file]) => file === edge).map(([, size]) => size), ['large', 'normal']);
  assert.deepEqual(calls.icon.filter(([file]) => file === zen).map(([, size]) => size), ['large', 'normal']);
});

test('Windows\' generic application icon is not a browser\'s icon: the shell\'s own extraction is used, else the letter tile', async () => {
  const helium = 'C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe';
  const generic = { [helium]: image('windows-generic') };
  const rescued = machine([helium], { icons: generic, extracted: PNG('helium-real') });
  assert.equal((await rescued.service.icons(['Helium'])).Helium, PNG('helium-real'));
  assert.deepEqual(rescued.calls.extract, [helium]);
  assert.deepEqual(rescued.calls.icon.map(([, size]) => size), ['large', 'normal'], 'both sizes were tried first');
  const hopeless = machine([helium], { icons: generic, extracted: null });
  assert.deepEqual(await hopeless.service.icons(['Helium']), {}, 'never the blank-window stand-in');
  const hostile = machine([helium], { icons: generic, extracted: 'data:image/svg+xml;base64,PHN2Zz4=' });
  assert.deepEqual(await hostile.service.icons(['Helium']), {}, 'the extracted icon is validated like any other');
  // A real icon never starts a PowerShell.
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const normal = machine([chrome], { extracted: PNG('unused') });
  await normal.service.icons(['Chrome']);
  assert.equal(normal.calls.extract.length, 0);
  assert.deepEqual(normal.calls.generic, ['large'], 'the stand-in is looked up once, only when a browser was found');
});

test('each browser is looked up once per session', async () => {
  const { service, calls } = machine(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
  const [first, second] = await Promise.all([service.icons(['Chrome']), service.icons(['Chrome', 'Brave'])]);
  assert.deepEqual(first, second);
  await service.icons();
  await service.icons(['Chrome']);
  assert.equal(calls.icon.length, 1, 'getFileIcon ran once for Chrome');
  assert.equal(calls.stat.filter((file) => /chrome\.exe$/i.test(file)).length >= 1, true);
  const statsAfterFirst = calls.stat.length;
  await service.icons();
  assert.equal(calls.stat.length, statsAfterFirst, 'no file is checked again');
});

test('only the browsers asked about are probed, and unknown names are ignored', async () => {
  const { service, calls } = machine([]);
  await service.icons(['Zen', 'Nonsense', '__proto__', 'Zen']);
  assert.ok(calls.stat.every((file) => /Zen/i.test(file)), calls.stat.join());
});

test('a per-user install is found under the profile folder when LOCALAPPDATA points somewhere else (a redirected test profile)', async () => {
  const helium = 'C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe';
  const { service } = machine([helium], { env: { ...WIN, LOCALAPPDATA: 'C:\\ae\\r4\\fixture-local' } });
  assert.equal((await service.icons(['Helium'])).Helium, PNG('default:chrome.exe'));
  const list = browserExecutables({ ...WIN, LOCALAPPDATA: 'C:\\ae\\r4\\fixture-local' }, { platform: 'win32', home: HOME });
  assert.ok(list.Helium.includes('C:\\ae\\r4\\fixture-local\\imput\\Helium\\Application\\chrome.exe'));
  assert.ok(list.Helium.includes(helium));
});

test('Helium registers chrome.exe, so a registered Chrome inside its folder is not Chrome; a registered path elsewhere is used', async () => {
  const helium = 'C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe';
  const portable = 'D:\\Apps\\Chrome\\chrome.exe';
  let machineA = machine([helium], { appPaths: { 'chrome.exe': ['"' + helium + '"'] } });
  assert.deepEqual(await machineA.service.icons(['Chrome']), {}, 'Helium is not Chrome');
  let machineB = machine([portable], { appPaths: { 'chrome.exe': ['"' + portable + '"'] } });
  assert.match((await machineB.service.icons(['Chrome'])).Chrome, /^data:image\/png/);
  assert.deepEqual(machineB.calls.icon, [[portable, 'large']]);
});

test('a big icon is scaled down before it crosses to the interface; a small one is left alone', async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const big = image('big', { side: 256 });
  const { service } = machine([chrome], { icons: { [chrome]: big } });
  assert.equal((await service.icons(['Chrome'])).Chrome, PNG('big-64'));
  const small = machine([chrome], { icons: { [chrome]: image('small', { side: 32 }) } });
  assert.equal((await small.service.icons(['Chrome'])).Chrome, PNG('small'));
});

test('anything that is not a small PNG data URL is dropped (validation of the IPC field)', async () => {
  assert.equal(validIconUrl(PNG('ok')), true);
  for (const bad of ['', null, undefined, 42, {}, 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'https://example.test/i.png', 'data:image/png;base64,', 'data:image/png;base64,a b', 'data:image/png;base64,' + 'A'.repeat(100 * 1024)]) {
    assert.equal(validIconUrl(bad), false, String(bad).slice(0, 40));
  }
  const clean = sanitizeIcons({ Chrome: PNG('c'), Edge: 'javascript:alert(1)', Zen: PNG('z'), Opera: PNG('o'), __proto__: { Brave: PNG('b') } }, ['Chrome', 'Edge', 'Brave', 'Opera']);
  assert.deepEqual(clean, { Chrome: PNG('c') }, 'invalid, unknown, inherited and unrequested entries are all removed');
  assert.deepEqual(sanitizeIcons(null), {});
  assert.deepEqual(sanitizeIcons('Chrome'), {});
  // The lookup never lets a bad image through either.
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const hostile = machine([chrome], { icons: { [chrome]: image('x', { url: 'data:image/svg+xml;base64,PHN2Zz4=' }) } });
  assert.deepEqual(await hostile.service.icons(['Chrome']), {});
});

test('unsupported platforms and a missing app.getFileIcon give no icons and read nothing', async () => {
  const linux = machine(['/usr/bin/google-chrome'], { platform: 'linux', env: {}, home: '/home/me' });
  assert.deepEqual(await linux.service.icons(), {});
  assert.equal(linux.calls.stat.length, 0);
  const noApi = createBrowserIcons({ platform: 'win32', env: WIN, home: HOME, app: {}, stat: async () => ({ file: true }) });
  assert.deepEqual(await noApi.icons(), {});
  assert.deepEqual(await createBrowserIcons({ platform: 'win32' }).icons(), {});
});

test('macOS looks for the .app bundle', async () => {
  const bundle = '/Applications/Google Chrome.app';
  const list = browserExecutables({}, { platform: 'darwin', home: '/Users/me' });
  assert.deepEqual(list.Chrome, [bundle, '/Users/me/Applications/Google Chrome.app']);
  assert.equal(list.Zen[0], '/Applications/Zen.app');
  const { service, calls } = machine([bundle], { platform: 'darwin', env: {}, home: '/Users/me' });
  const icons = await service.icons(['Chrome', 'Edge']);
  assert.deepEqual(Object.keys(icons), ['Chrome']);
  assert.deepEqual(calls.icon, [[bundle, 'normal']]);
  assert.equal(calls.registry.length, 0, 'the Windows registry is never read on a Mac');
});

test('macOS uses the supported small fallback when its normal icon is unavailable', async () => {
  const bundle = '/Applications/Google Chrome.app';
  const { service, calls } = machine([bundle], { platform: 'darwin', env: {}, home: '/Users/me', icons: { [bundle + '|normal']: new Error('unavailable'), [bundle + '|small']: image('small-mac') } });
  assert.equal((await service.icons(['Chrome'])).Chrome, PNG('small-mac'));
  assert.deepEqual(calls.icon, [[bundle, 'normal'], [bundle, 'small']]);
  assert.equal(calls.registry.length, 0);
});

test('every browser the importers can name has a place to look, and the list matches what imports.cjs and import-firefox.cjs detect', () => {
  const win = browserExecutables(WIN, { platform: 'win32', home: HOME });
  for (const name of BROWSERS) assert.ok(win[name]?.length, name + ' has no Windows candidates');
  const detected = new Set([...require('../desktop/imports.cjs').browserRoots('win32', HOME).map(([name]) => name), ...require('../desktop/browser-services/import-firefox.cjs').firefoxRoots('win32', HOME).map(([name]) => name)]);
  for (const name of detected) assert.ok(BROWSERS.includes(name), name + ' is imported but has no icon lookup');
});

test('main hands the icons to Settings with the list (only browsers that have a profile), and setup shares the same lookup', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /case 'imports\.discover':shape\(\[\]\)/);
  assert.match(main, /browserIcons\(\)\.icons\(\)/);
  assert.match(main, /icons:Object\.fromEntries\(Object\.entries\(icons\)\.filter\(\(\[name\]\)=>present\.has\(name\)\)\)/);
  assert.match(main, /createDefaultBrowserService\(\{app,shell,browserIconLookup:browserIcons\(\)\}\)/);
});

test('setup\'s default-browser service answers from the injected lookup and never throws', async () => {
  const { createDefaultBrowserService } = require('../desktop/accounts/default-browser.cjs');
  const asked = [];
  const service = createDefaultBrowserService({ app: { isPackaged: true, getPath: () => 'x', isDefaultProtocolClient: () => false }, shell: {}, platform: 'win32', getRegistration: () => null, browserIconLookup: { icons: async (names) => (asked.push(names), { Zen: PNG('z') }) } });
  assert.deepEqual(await service.browserIcons(), { Zen: PNG('z') });
  const broken = createDefaultBrowserService({ app: { isPackaged: true, getPath: () => 'x', isDefaultProtocolClient: () => false }, shell: {}, platform: 'win32', getRegistration: () => null, browserIconLookup: { icons: async () => { throw new Error('boom'); } } });
  assert.deepEqual(await broken.browserIcons(), {});
});

test('macOS takes the bundle\'s own icon from its thumbnail, because getFileIcon answers the generic application icon', async () => {
  const bundle = '/Applications/Google Chrome.app';
  const { service, calls } = machine([bundle], { platform: 'darwin', env: {}, home: '/Users/me', thumbnails: { [bundle]: image('chrome-thumb', { side: 64 }) } });
  assert.equal((await service.icons(['Chrome'])).Chrome, PNG('chrome-thumb'));
  assert.deepEqual(calls.thumb, [bundle]);
  assert.deepEqual(calls.icon, [], 'getFileIcon is not asked when the thumbnail has the icon');
});

test('macOS falls back to getFileIcon when the thumbnail is empty or fails', async () => {
  const bundle = '/Applications/Google Chrome.app';
  for (const thumbnails of [{ [bundle]: image('x', { empty: true }) }, { [bundle]: new Error('no thumbnail') }, {}]) {
    const { service, calls } = machine([bundle], { platform: 'darwin', env: {}, home: '/Users/me', thumbnails });
    assert.match((await service.icons(['Chrome'])).Chrome, /^data:image\/png;base64,/);
    assert.deepEqual(calls.icon, [[bundle, 'normal']]);
  }
});

test('Windows\' own icon for an executable comes from Acira\'s signed helper, the path on its standard input; anything but a PNG is dropped', async () => {
  const calls = [];
  const exec = (answer) => (file, args, options, callback) => { const call = { file, args, options, input: null }; calls.push(call); setImmediate(() => callback(null, answer)); return { stdin: { on() {}, end(text) { call.input = text; } } }; };
  const helper = 'C:\\Acira\\resources\\acira-verify.exe', helium = 'C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe';
  const png = Buffer.from('\x89PNG helium').toString('base64');
  assert.equal(await windowsExtract(helium, { helper, exec: exec(png + '\r\n') }), 'data:image/png;base64,' + png);
  assert.equal(calls[0].file, helper); assert.deepEqual(calls[0].args, ['icon']); assert.equal(calls[0].input, helium);
  assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.timeout, 8000);
  assert.equal(await windowsExtract(helium, { helper, exec: exec('not base64 <svg>') }), null);
  assert.equal(await windowsExtract(helium, { helper, exec: exec('') }), null);
  assert.equal(await windowsExtract(helium, { helper: null, exec: () => assert.fail('no helper, nothing starts') }), null);
});
