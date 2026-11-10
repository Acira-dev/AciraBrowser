'use strict';
// 13.6: "New window" and "New private window" from the operating system's own menu (Windows jump list, macOS Dock menu, Linux launcher actions).
// A Windows user saw only "Pin to taskbar / End task / Close window" on Acira's taskbar button; another browser shows "New window". Acira set no jump list.
// These tests pin: the launch flags (exact words, never mistaken for a web app or the installer's quit), the task list and Dock menu in every language,
// which window opens for each request (never two, never the wrong profile, private stays private), the wiring in main.cjs, and the Linux .desktop actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
const os = require('../desktop/os-new-window.cjs');
const { appIdFromArgv, WEB_APP_ARG } = require('../desktop/web-apps.cjs');
const { parseExternalURLs, createExternalLinkIntake } = require('../desktop/accounts/external-links.cjs');
const { filesFromArgv } = require('../desktop/accounts/open-files.cjs');
const { restartArgs } = require('../desktop/restart.cjs');

const APP = '0123456789abcdef0123';
const CODES = ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi'];
const catalog = code => JSON.parse(fs.readFileSync(path.join(root, 'src/i18n', code + '.json'), 'utf8'));
const english = id => catalog('en')[id];
const tmEnglish = id => english(id);

// ---------------------------------------------------------------- the flags

test('the two flags are exact words that name a window request', () => {
  assert.equal(os.NEW_WINDOW_ARG, '--acira-new-window');
  assert.equal(os.NEW_PRIVATE_WINDOW_ARG, '--acira-new-private-window');
  assert.equal(os.windowRequestFromArgv(['C:\\Acira\\AciraBrowser.exe', '--acira-new-window']), 'normal');
  assert.equal(os.windowRequestFromArgv(['/opt/Acira', '--acira-new-private-window']), 'private');
  assert.equal(os.windowRequestFromArgv(['electron', '/repo/desktop/main.cjs', '--use-mock-keychain', '--acira-new-window']), 'normal');
  assert.equal(os.windowRequestFromArgv(['Acira.exe', '--acira-new-private-window', '--acira-new-window']), 'private', 'both: the private window wins');
});

test('anything else is not a window request: look-alikes, prefixes, case, values, paths, non-lists', () => {
  const none = [
    [], null, undefined, 'x', 42, {}, ['Acira.exe'], ['Acira.exe', 'https://acira.test/'],
    ['x', '--acira-new-windows'], ['x', '--acira-new-window=1'], ['x', '--acira-new-window '], ['x', ' --acira-new-window'], ['x', '--ACIRA-NEW-WINDOW'],
    ['x', 'acira-new-window'], ['x', '-acira-new-window'], ['x', '--new-window'], ['x', '--acira-new-private'], ['x', '--acira-new-private-window=1'],
    ['x', 'C:\\somewhere\\--acira-new-window'], ['x', 'https://a.test/?--acira-new-window'], ['x', 42, {}, null],
  ];
  for (const argv of none) assert.equal(os.windowRequestFromArgv(argv), null, JSON.stringify(argv));
});

test('a web app launch and the installer quit are other launches: a window flag beside them changes nothing', () => {
  assert.equal(os.windowRequestFromArgv(['Acira.exe', WEB_APP_ARG + APP, 'https://app.test/']), null);
  assert.equal(os.windowRequestFromArgv(['Acira.exe', WEB_APP_ARG + APP, '--acira-new-window']), null);
  assert.equal(os.windowRequestFromArgv(['Acira.exe', '--acira-new-private-window', WEB_APP_ARG + APP]), null);
  assert.equal(os.windowRequestFromArgv(['Acira.exe', '--acira-installer-quit', '--acira-new-window']), null);
  assert.equal(os.windowRequestFromArgv(['Acira.exe', '--acira-new-private-window', '--acira-installer-quit']), null);
  // a malformed app id is not a web app launch, so the window flag stands
  assert.equal(os.windowRequestFromArgv(['Acira.exe', '--acira-app=XYZ', '--acira-new-window']), 'normal');
  // and the window flags are never taken for a web app, an installer flag, a link or a file
  for (const flag of [os.NEW_WINDOW_ARG, os.NEW_PRIVATE_WINDOW_ARG]) {
    assert.equal(appIdFromArgv(['Acira.exe', flag]), null);
    assert.deepEqual(parseExternalURLs(['Acira.exe', flag]), []);
    assert.deepEqual(filesFromArgv(['Acira.exe', flag], { exists: () => true }), []);
  }
});

test('the installer quit flag here is the one main.cjs and the installer use', () => {
  assert.equal(os.INSTALLER_QUIT_ARG, '--acira-installer-quit');
  assert.match(main, /INSTALLER_QUIT_ARG='--acira-installer-quit'/);
  assert.match(fs.readFileSync(path.join(root, 'packaging/installer/AciraChoose.cs'), 'utf8'), /"--acira-installer-quit"/);
});

test('a restart or an update never replays a window flag (restart.cjs drops every --acira-* switch)', () => {
  assert.deepEqual(restartArgs(['/Apps/Acira', '--use-mock-keychain', '--acira-new-window', '--acira-new-private-window']), ['--use-mock-keychain']);
  assert.deepEqual(restartArgs(['/electron', '/repo/desktop/main.cjs', '--acira-new-private-window', '--inspect=9'], { defaultApp: true }), ['/repo/desktop/main.cjs', '--inspect=9']);
});

test('a launch that only asks for a window is left to us by the link intake; a web address beside it is still a link', () => {
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe', '--acira-new-window']), true);
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe', '--acira-new-private-window']), true);
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe', '--acira-new-window', 'https://a.test/']), false);
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe', 'https://a.test/']), false);
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe']), false);
  assert.equal(os.isWindowOnlyLaunch(['Acira.exe', WEB_APP_ARG + APP, '--acira-new-window']), false);
});

test("the link intake, built with main.cjs's own ignore rule: a window-only second start brings no other window forward and opens no link", () => {
  const found = /createExternalLinkIntake\(\{app,argv:process\.argv,ignore:(args=>[^\n]*?),onActivate:/.exec(main);
  assert.ok(found, 'main.cjs builds the link intake with an ignore rule');
  const ignore = new Function('appIdFromArgv', 'INSTALLER_QUIT_ARG', 'isWindowOnlyLaunch', 'return ' + found[1])(appIdFromArgv, '--acira-installer-quit', os.isWindowOnlyLaunch);
  const activations = [], opened = [];
  const app = new EventEmitter();
  const intake = createExternalLinkIntake({ app, argv: ['Acira.exe', '--acira-new-window'], ignore, onActivate: () => activations.push('activate') });
  intake.bind(async url => { opened.push(url); });
  assert.equal(intake.pending, 0, 'a cold start with the flag queues nothing');
  app.emit('second-instance', {}, ['Acira.exe', '--acira-new-window']);
  app.emit('second-instance', {}, ['Acira.exe', '--acira-new-private-window']);
  assert.deepEqual(activations, [], 'no ordinary window is brought forward for a window request');
  // the same intake still does its own work
  app.emit('second-instance', {}, ['Acira.exe']);
  assert.deepEqual(activations, ['activate'], 'a plain second start still brings a window forward');
  app.emit('second-instance', {}, ['Acira.exe', '--acira-new-window', 'https://a.test/x']);
  return new Promise(resolve => setImmediate(resolve)).then(() => {
    assert.deepEqual(opened, ['https://a.test/x'], 'a link beside the flag is still opened');
    app.emit('second-instance', {}, ['Acira.exe', WEB_APP_ARG + APP]);
    assert.deepEqual(activations, ['activate'], 'a web app launch is still left to its own handler');
    intake.dispose();
  });
});

// ---------------------------------------------------------------- the Windows task list and the Dock menu

test('the jump list has two tasks that start Acira with the flags, in the app language', () => {
  const tasks = os.jumpListTasks({ execPath: 'C:\\Users\\Me\\AppData\\Local\\Programs\\AciraBrowser\\AciraBrowser.exe', tm: tmEnglish });
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map(t => t.arguments), ['--acira-new-window', '--acira-new-private-window']);
  assert.deepEqual(tasks.map(t => t.title), ['New window', 'New private window']);
  for (const task of tasks) {
    assert.equal(task.program, 'C:\\Users\\Me\\AppData\\Local\\Programs\\AciraBrowser\\AciraBrowser.exe');
    assert.equal(task.iconPath, task.program);
    assert.equal(task.iconIndex, 0);
    assert.equal(task.workingDirectory, 'C:\\Users\\Me\\AppData\\Local\\Programs\\AciraBrowser');
    assert.equal(task.description, task.title);
    assert.deepEqual(Object.keys(task).sort(), ['arguments', 'description', 'iconIndex', 'iconPath', 'program', 'title', 'workingDirectory']);
  }
});

test('the arguments of each task read back as exactly that window request', () => {
  const tasks = os.jumpListTasks({ execPath: 'C:\\A\\AciraBrowser.exe', tm: tmEnglish });
  assert.deepEqual(tasks.map(t => os.windowRequestFromArgv([t.program, ...t.arguments.split(' ')])), ['normal', 'private']);
});

test('the labels follow the app language: all 13 languages, the words the app already has', () => {
  const i18n = require('../desktop/i18n.cjs');
  const seen = new Set();
  for (const code of CODES) {
    i18n.setMainLocale(code, 'en');
    const tasks = os.jumpListTasks({ execPath: 'C:\\A\\AciraBrowser.exe', tm: id => i18n.tm(id) });
    assert.deepEqual(tasks.map(t => t.title), [catalog(code)['browsermenu.newWindow'], catalog(code)['browsermenu.newPrivateWindow']], code);
    for (const task of tasks) assert.ok(task.title.length > 0 && !task.title.startsWith('browsermenu.'), code + ' has no raw id');
    seen.add(tasks[0].title);
  }
  assert.ok(seen.size >= 12, 'the languages really differ');
  i18n.setMainLocale('system', 'en');
  assert.deepEqual(os.ITEMS.map(item => item.label), ['browsermenu.newWindow', 'browsermenu.newPrivateWindow']);
});

test('the Dock menu: two items in the app language; each opens its own kind of window', () => {
  const opened = [];
  const template = os.dockMenuTemplate({ tm: tmEnglish, open: kind => { opened.push(kind); return Promise.resolve(); } });
  assert.deepEqual(template.map(item => item.label), ['New window', 'New private window']);
  template[0].click();
  template[1].click();
  template[0].click();
  assert.deepEqual(opened, ['normal', 'private', 'normal']);
  // a request that fails never throws out of the menu
  const failing = os.dockMenuTemplate({ tm: tmEnglish, open: () => Promise.reject(new Error('closing')) });
  assert.doesNotThrow(() => failing[0].click());
  const throwing = os.dockMenuTemplate({ tm: tmEnglish, open: () => { throw new Error('closing'); } });
  assert.throws(() => throwing[0].click(), /closing/, 'only a rejected request is swallowed; main always hands a safe one');
});

function menus(options = {}) {
  const calls = { tasks: [], docks: [], built: [], opened: [], warnings: [] };
  let language = 'en';
  const titles = { en: ['New window', 'New private window'], de: ['Neues Fenster', 'Neues privates Fenster'] };
  const tm = id => titles[language][id === 'browsermenu.newWindow' ? 0 : 1];
  const app = {
    isPackaged: true,
    setUserTasks: tasks => { calls.tasks.push(tasks); return options.tasksResult ?? true; },
    dock: options.noDock ? undefined : { setMenu: menu => calls.docks.push(menu) },
  };
  const Menu = { buildFromTemplate: template => { calls.built.push(template); return { items: template }; } };
  const made = os.createOsWindowMenus({
    app, tm, Menu, open: kind => { calls.opened.push(kind); return Promise.resolve(); },
    platform: options.platform || 'win32', execPath: 'C:\\A\\AciraBrowser.exe',
    packaged: options.packaged ?? true, testRun: options.testRun ?? false, warn: message => calls.warnings.push(message),
  });
  return { calls, made, setLanguage: code => { language = code; } };
}

test('Windows: the tasks are set once for a language, again when the language changes, and not repeated', () => {
  const { calls, made, setLanguage } = menus();
  assert.equal(made.refresh(), true);
  assert.equal(calls.tasks.length, 1);
  assert.deepEqual(calls.tasks[0].map(t => t.title), ['New window', 'New private window']);
  assert.equal(made.refresh(), false);
  assert.equal(made.refresh(), false);
  assert.equal(calls.tasks.length, 1, 'nothing changed: the shell is not asked again');
  setLanguage('de');
  assert.equal(made.refresh(), true);
  assert.equal(calls.tasks.length, 2);
  assert.deepEqual(calls.tasks[1].map(t => t.title), ['Neues Fenster', 'Neues privates Fenster']);
  assert.deepEqual(calls.tasks[1].map(t => t.arguments), ['--acira-new-window', '--acira-new-private-window']);
  assert.deepEqual(calls.docks, []);
});

test("Windows: a development run or a test profile never writes into the person's real jump list", () => {
  for (const options of [{ packaged: false }, { testRun: true }, { packaged: false, testRun: true }]) {
    const { calls, made } = menus(options);
    assert.equal(made.refresh(), false);
    assert.deepEqual(calls.tasks, [], JSON.stringify(options));
  }
});

test('Windows: a refused jump list is said once in the log and tried again next time; an exception never escapes', () => {
  const refused = menus({ tasksResult: false });
  assert.equal(refused.made.refresh(), false);
  assert.equal(refused.made.refresh(), false);
  assert.equal(refused.calls.tasks.length, 2, 'not marked as set: it is tried again');
  assert.equal(refused.calls.warnings.length, 2);
  const options = menus();
  const app = { isPackaged: true, setUserTasks: () => { throw new Error('COM failed'); } };
  const broken = os.createOsWindowMenus({ app, tm: tmEnglish, open() {}, Menu: {}, platform: 'win32', execPath: 'C:\\A\\a.exe', packaged: true, testRun: false, warn: m => options.calls.warnings.push(m) });
  assert.doesNotThrow(() => assert.equal(broken.refresh(), false));
  assert.match(options.calls.warnings.join(' '), /COM failed/);
});

test('macOS: the Dock menu is set once per language, with items that open the right windows; a test profile still gets it (it lives only in this process)', () => {
  const { calls, made, setLanguage } = menus({ platform: 'darwin', testRun: true, packaged: false });
  assert.equal(made.refresh(), true);
  assert.equal(made.refresh(), false);
  assert.equal(calls.docks.length, 1);
  assert.deepEqual(calls.docks[0].items.map(i => i.label), ['New window', 'New private window']);
  calls.docks[0].items[0].click();
  calls.docks[0].items[1].click();
  assert.deepEqual(calls.opened, ['normal', 'private']);
  setLanguage('de');
  assert.equal(made.refresh(), true);
  assert.deepEqual(calls.docks[1].items.map(i => i.label), ['Neues Fenster', 'Neues privates Fenster']);
  assert.deepEqual(calls.tasks, [], 'no jump list on a Mac');
});

test('macOS without a Dock object, and Linux, set nothing and say nothing', () => {
  const noDock = menus({ platform: 'darwin', noDock: true });
  assert.equal(noDock.made.refresh(), false);
  const linux = menus({ platform: 'linux' });
  assert.equal(linux.made.refresh(), false);
  assert.deepEqual([linux.calls.tasks, linux.calls.docks, linux.calls.warnings, noDock.calls.warnings], [[], [], [], []]);
});

// ---------------------------------------------------------------- which window opens

function world({ windows = [], sharedSettings, saved, quitting = false } = {}) {
  const log = { made: [], created: [], shown: [], warnings: [] };
  let count = 0;
  const controllers = [];
  const controller = ({ id, privateMode = false, webApp = null, closing = false, ready = Promise.resolve(true), profile = 'personal' }) => {
    const c = {
      id, privateMode, webApp, closing, ready, profile, firstShown: Promise.resolve(),
      show() { log.shown.push(id); },
      openNewWindow(kind) {
        const made = controller({ id: `${id}>${kind}${++count}`, privateMode: kind !== 'normal', profile: kind === 'normal' ? this.profile : undefined });
        made.from = id; made.kind = kind; made.settingsFrom = id;
        log.made.push(made); controllers.push(made);
        return made;
      },
    };
    return c;
  };
  for (const spec of windows) controllers.push(controller(spec));
  const state = { quitting };
  const requests = os.createWindowRequests({
    whenReady: () => Promise.resolve(),
    isQuitting: () => state.quitting,
    isOpen: () => true,
    controllers: () => controllers,
    ordinaryController: () => {
      const open = controllers.filter(c => !c.privateMode && !c.webApp && !c.closing);
      const focused = open.find(c => c.focused);
      const pick = focused || open.find(c => c.last) || open[0];
      if (pick) return pick;
      const made = controller({ id: 'restored' + ++count });
      log.created.push(made.id); controllers.push(made);
      return made;
    },
    createWindow: options => {
      const made = controller({ id: 'created' + ++count, privateMode: Boolean(options.privateMode) });
      made.options = options; log.created.push(made.id); controllers.push(made);
      return made;
    },
    savedSettings: () => sharedSettings ?? saved,
    warn: message => log.warnings.push(message),
  });
  return { requests, log, controllers, state };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('New window with an ordinary window open: one new window, from the window a Ctrl+N would come from, brought to the front', async () => {
  const w = world({ windows: [{ id: 'a', profile: 'work' }, { id: 'b', profile: 'home' }] });
  w.controllers[1].focused = true;
  const made = await w.requests.open('normal');
  assert.equal(w.log.made.length, 1);
  assert.equal(made.from, 'b', 'the focused window is the source');
  assert.equal(made.kind, 'normal');
  assert.equal(made.profile, 'home', 'its profile carries over, as Ctrl+N does');
  assert.deepEqual(w.log.created, [], 'no other window is made or restored');
  await flush();
  assert.deepEqual(w.log.shown, [made.id]);
});

test('New window: with no window focused the one used last, else the first, is the source', async () => {
  const w = world({ windows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  w.controllers[2].last = true;
  assert.equal((await w.requests.open('normal')).from, 'c');
  const v = world({ windows: [{ id: 'a' }, { id: 'b' }] });
  assert.equal((await v.requests.open('normal')).from, 'a');
});

test('New window never takes a web app, a closing window or a private window as its source', async () => {
  const w = world({ windows: [{ id: 'app', webApp: { id: APP } }, { id: 'closing', closing: true }, { id: 'priv', privateMode: true }, { id: 'ok' }] });
  const made = await w.requests.open('normal');
  assert.equal(made.from, 'ok');
});

test('New window with only a private window or a web app open: the ordinary window is restored or made, and that is the one new window', async () => {
  for (const windows of [[{ id: 'priv', privateMode: true }], [{ id: 'app', webApp: { id: APP } }], [], [{ id: 'closing', closing: true }]]) {
    const w = world({ windows });
    const made = await w.requests.open('normal');
    assert.equal(w.log.created.length, 1, JSON.stringify(windows));
    assert.equal(w.log.made.length, 0, 'not a second window on top');
    assert.equal(made.id, w.log.created[0]);
    assert.equal(w.controllers.filter(c => !c.privateMode && !c.webApp && !c.closing).length, 1);
    await flush();
    assert.deepEqual(w.log.shown, [made.id]);
  }
});

test('New private window: from an ordinary window, as Ctrl+Shift+N does; the new window is private', async () => {
  const w = world({ windows: [{ id: 'a', profile: 'work' }, { id: 'priv', privateMode: true }] });
  const made = await w.requests.open('private');
  assert.equal(made.kind, 'private');
  assert.equal(made.privateMode, true);
  assert.equal(made.from, 'a');
  assert.equal(w.log.made.length, 1);
  assert.deepEqual(w.log.created, [], 'no ordinary window is opened for a private request');
  await flush();
  assert.deepEqual(w.log.shown, [made.id]);
});

test('New private window with only private windows open: it comes from a private window, no ordinary window appears', async () => {
  const w = world({ windows: [{ id: 'p1', privateMode: true }, { id: 'app', webApp: {} }] });
  const made = await w.requests.open('private');
  assert.equal(made.from, 'p1');
  assert.equal(made.privateMode, true);
  assert.deepEqual(w.log.created, []);
});

test('New private window with no ordinary or private window (a web app only, or none): one private window with the saved settings; nothing else opens', async () => {
  for (const windows of [[], [{ id: 'app', webApp: {} }], [{ id: 'closing', closing: true }]]) {
    const w = world({ windows, saved: { appearance: 'dark' } });
    const made = await w.requests.open('private');
    assert.equal(w.log.created.length, 1, JSON.stringify(windows));
    assert.equal(made.privateMode, true);
    assert.deepEqual(made.options, { privateMode: true, settings: { appearance: 'dark' } });
    assert.equal(w.controllers.filter(c => !c.privateMode && !c.webApp && !c.closing).length, 0, 'no ordinary window was restored for it');
    await flush();
    assert.deepEqual(w.log.shown, [made.id]);
  }
});

test('a window that is still starting is waited for; one that failed to start opens nothing and says so', async () => {
  let start;
  const w = world({ windows: [{ id: 'a', ready: new Promise(resolve => { start = resolve; }) }] });
  let done = false;
  const pending = w.requests.open('normal').then(made => { done = true; return made; });
  await flush();
  assert.equal(done, false, 'not before the source has loaded its state (its empty state would say Personal)');
  assert.equal(w.log.made.length, 0);
  start(true);
  assert.equal((await pending).from, 'a');
  const failed = world({ windows: [{ id: 'bad', ready: Promise.resolve(false) }] });
  assert.equal(await failed.requests.open('private'), null);
  assert.equal(await failed.requests.open('normal'), null);
  assert.equal(failed.log.made.length + failed.log.created.length, 0);
  assert.equal(failed.log.warnings.length, 2);
});

test('while Acira is quitting nothing opens, before or after the wait', async () => {
  const quitting = world({ windows: [{ id: 'a' }], quitting: true });
  assert.equal(await quitting.requests.open('normal'), null);
  assert.equal(await quitting.requests.open('private'), null);
  assert.equal(quitting.log.made.length + quitting.log.created.length, 0);
  let start;
  const late = world({ windows: [{ id: 'a', ready: new Promise(resolve => { start = resolve; }) }] });
  const pending = late.requests.open('normal');
  await flush();
  late.state.quitting = true;
  start(true);
  assert.equal(await pending, null);
  assert.equal(late.log.made.length, 0);
});

test('an unknown kind opens nothing; two requests make two windows, the second from the first only once it has loaded', async () => {
  const w = world({ windows: [{ id: 'a' }] });
  for (const kind of ['tor', '', undefined, null, 'normal ', 42]) assert.equal(await w.requests.open(kind), null);
  assert.equal(w.log.made.length, 0);
  const [one, two] = await Promise.all([w.requests.open('normal'), w.requests.open('private')]);
  assert.equal(w.log.made.length, 2);
  assert.equal(one.kind, 'normal');
  assert.equal(two.kind, 'private');
  assert.deepEqual(w.log.created, []);
});

test('a request that comes in before the database is open does nothing', async () => {
  const log = [];
  const requests = os.createWindowRequests({ whenReady: () => Promise.resolve(), isQuitting: () => false, isOpen: () => false, controllers: () => [], ordinaryController: () => { log.push('ordinary'); }, createWindow: () => { log.push('create'); } });
  assert.equal(await requests.open('normal'), null);
  assert.equal(await requests.open('private'), null);
  assert.deepEqual(log, []);
});

// ---------------------------------------------------------------- main.cjs

test('main.cjs: the second start routes a window request before anything else, a web app launch is still its own', () => {
  const handler = /app\.on\('second-instance',\(_event,args\)=>\{const requested=windowRequestFromArgv\(args\);if\(requested\)\{void windowsCreated\.then\(\(\)=>requestWindow\(requested\)\);return;\}if\(!appIdFromArgv\(args\)\)return;void windowsCreated\.then\(\(\)=>\{if\(!launchFromArgv\(args\)\)void activateOrdinaryWindow\(\)\.catch\(\(\)=>\{\}\);\}\);\}\);/;
  assert.match(main, handler);
  // it waits for the windows of this start, like a web app launch does
  assert.ok(main.indexOf('windowsCreated=new Promise') < main.indexOf("const requested=windowRequestFromArgv(args)"));
});

test('main.cjs: a start with the private flag is the ordinary start plus one private window; the plain flag adds nothing (the start always opens a window)', () => {
  assert.match(main, /restoreStartWindows\(\);if\(appIdFromArgv\(process\.argv\)\)launchFromArgv\(process\.argv\);[^]*?if\(windowRequestFromArgv\(process\.argv\)==='private'\)void requestWindow\('private'\);\}/);
  assert.doesNotMatch(main, /windowRequestFromArgv\(process\.argv\)==='normal'/);
  // the web app branch of the start never reads the window flag (a web app launch wins)
  assert.match(main, /if\(openWebApp\(process\.argv\)\)deferredRestore=true;else\{restoreStartWindows\(\)/);
});

test('main.cjs: the controller can open a sibling like Ctrl+N, openWindow hands the new window back, and the request code is the tested module', () => {
  assert.match(main, /openNewWindow:kind=>openWindow\(kind\)/);
  assert.match(main, /function openWindow\(kind\)\{[^]*?return createBrowserWindow\(\{privateMode:kind!=='normal'/);
  assert.match(main, /const windowRequests=createWindowRequests\(\{whenReady:\(\)=>app\.whenReady\(\),isQuitting:\(\)=>quitting,isOpen:\(\)=>Boolean\(database\),controllers:\(\)=>controllers,ordinaryController:\(\)=>ordinaryController\(\),createWindow:options=>createBrowserWindow\(options\)/);
  assert.match(main, /const requestWindow=kind=>windowRequests\.open\(kind\)\.catch\(/, 'a failed request is logged, never an unhandled rejection');
  assert.match(main, /const osWindowMenus=createOsWindowMenus\(\{app,tm,open:requestWindow,Menu\}\)/);
});

test("main.cjs: the OS menus are set once an ordinary window has loaded (its language is known) and again when the language changes", () => {
  assert.match(main, /controller\.ready=start\(\)\.then\(\(\)=>\{if\(!privateMode&&!webApp\)osWindowMenus\.refresh\(\);return true;\}\)\.catch\(/);
  assert.match(main, /setLanguage\(state\.settings\.language\);if\(previous\.settings\.language!==state\.settings\.language\)osWindowMenus\.refresh\(\);if\(state===previous\)return state;/);
});

test('the new module keeps to ASCII (the main process script and what it loads stay small)', () => {
  assert.equal(/[^\x00-\x7f]/.test(fs.readFileSync(path.join(root, 'desktop/os-new-window.cjs'), 'utf8')), false);
});

// ---------------------------------------------------------------- Linux launcher actions

function parseDesktop(text) {
  const groups = new Map();
  let group = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) { group = new Map(); assert.ok(!groups.has(header[1]), 'one group per name: ' + header[1]); groups.set(header[1], group); continue; }
    const at = line.indexOf('=');
    assert.ok(at > 0 && group, 'a key=value line inside a group: ' + line);
    const key = line.slice(0, at);
    assert.ok(!group.has(key), 'a key once per group: ' + key);
    group.set(key, line.slice(at + 1));
  }
  return groups;
}
function checkActions(groups, { exec }) {
  const entry = groups.get('Desktop Entry');
  assert.ok(entry, 'has a Desktop Entry group');
  assert.equal(entry.get('Actions'), 'NewWindow;NewPrivateWindow;', 'the entry lists both actions');
  const wanted = { NewWindow: ['browsermenu.newWindow', os.NEW_WINDOW_ARG], NewPrivateWindow: ['browsermenu.newPrivateWindow', os.NEW_PRIVATE_WINDOW_ARG] };
  for (const [action, [id, flag]] of Object.entries(wanted)) {
    const group = groups.get('Desktop Action ' + action);
    assert.ok(group, 'a group for ' + action);
    assert.equal(group.get('Name'), english(id));
    for (const code of CODES.slice(1)) assert.equal(group.get('Name[' + code.replace('-', '_') + ']'), catalog(code)[id], action + ' in ' + code);
    assert.ok(exec(group.get('Exec')), 'Exec of ' + action + ': ' + group.get('Exec'));
    assert.ok(group.get('Exec').endsWith(' ' + flag), 'ends with its flag: ' + group.get('Exec'));
    assert.deepEqual([...group.keys()].filter(key => !/^Name(\[[a-zA-Z_]+\])?$/.test(key)).sort(), ['Exec', ...(group.has('Icon') ? ['Icon'] : [])].sort());
  }
  assert.deepEqual([...groups.keys()].sort(), ['Desktop Action NewPrivateWindow', 'Desktop Action NewWindow', 'Desktop Entry']);
}

function pythonEntry(target) {
  const script = [
    'import ast,json,sys',
    'src=open(sys.argv[1],encoding="utf-8").read();tree=ast.parse(src)',
    'names=("NEW_WINDOW","NEW_PRIVATE_WINDOW","DESKTOP_ACTIONS")',
    'keep=[n for n in tree.body if (isinstance(n,ast.FunctionDef) and n.name in ("desktop_quote","desktop_names","desktop_entry")) or (isinstance(n,ast.Assign) and any(getattr(t,"id","") in names for t in n.targets))]',
    'ns={};exec(compile(ast.Module(keep,[]),"installer","exec"),ns)',
    'sys.stdout.buffer.write(json.dumps({"entry":ns["desktop_entry"](sys.argv[3],"acira-browser",sys.argv[2]),"new":ns["NEW_WINDOW"],"private":ns["NEW_PRIVATE_WINDOW"],"actions":[[a,f] for a,f,_ in ns["DESKTOP_ACTIONS"]]},ensure_ascii=False).encode("utf-8"))',
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-c', script, path.join(root, 'packaging/linux/install-acira-linux.py'), target, 'Acira Browser'], { encoding: 'utf8' });
  if (run.error && run.error.code === 'ENOENT') return null; // no Python on this machine: the two Python checks skip
  assert.equal(run.status, 0, 'the installer helpers run: ' + run.stderr);
  return JSON.parse(run.stdout);
}

test('Linux installer: the .desktop file it writes has both launcher actions, in every language, with the flags', () => {
  const target = '/home/me/.local/share/acira-browser/AciraBrowser.AppImage';
  const out = pythonEntry(target);
  if (!out) return;
  const groups = parseDesktop(out.entry);
  const quoted = '"' + target + '"';
  checkActions(groups, { exec: value => value.startsWith(quoted + ' --acira-new-') });
  assert.equal(groups.get('Desktop Entry').get('Exec'), quoted + ' %U', 'the launcher itself starts as before');
  assert.equal(groups.get('Desktop Entry').get('Name'), 'Acira Browser');
  assert.equal(groups.get('Desktop Entry').get('MimeType'), 'text/html;x-scheme-handler/http;x-scheme-handler/https;');
  assert.equal(groups.get('Desktop Entry').get('StartupWMClass'), 'acira-browser.desktop');
  assert.deepEqual(out.actions, [['NewWindow', os.NEW_WINDOW_ARG], ['NewPrivateWindow', os.NEW_PRIVATE_WINDOW_ARG]]);
  // the installer's own words are the catalog's: nothing to drift
  for (const code of CODES) {
    const key = code.replace('-', '_');
    assert.equal(out.new[key], catalog(code)['browsermenu.newWindow'], code);
    assert.equal(out.private[key], catalog(code)['browsermenu.newPrivateWindow'], code);
  }
  assert.equal(Object.keys(out.new).length, CODES.length);
});

test('Linux installer: the .desktop file is written as UTF-8 even when the locale is not (Latin-1: the action names are Japanese, Arabic, Hindi...)', () => {
  // Runs the installer's OWN write line (found in its source, not copied here) with desktop pointing at a temporary file, under a Latin-1 locale and Python's UTF-8 mode off.
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'acira-desktop-'));
  try {
    const out = path.join(dir, 'acira-browser.desktop');
    const script = [
      'import ast,pathlib,sys',
      'src=open(sys.argv[1],encoding="utf-8").read();tree=ast.parse(src)',
      'names=("NEW_WINDOW","NEW_PRIVATE_WINDOW","DESKTOP_ACTIONS")',
      'keep=[n for n in tree.body if (isinstance(n,ast.FunctionDef) and n.name in ("desktop_quote","desktop_names","desktop_entry")) or (isinstance(n,ast.Assign) and any(getattr(t,"id","") in names for t in n.targets))]',
      'write=[n for n in tree.body if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and getattr(n.value.func,"attr","")=="write_text" and getattr(n.value.func.value,"id","")=="desktop"]',
      'assert len(write)==1,"one desktop.write_text line"',
      'ns={"desktop":pathlib.Path(sys.argv[2]),"name":"Acira Browser","slug":"acira-browser","target":"/home/me/AciraBrowser.AppImage"}',
      'exec(compile(ast.Module(keep+write,[]),"installer","exec"),ns)',
      'print("written")',
    ].join('\n');
    const run = spawnSync('python3', ['-I', '-X', 'utf8=0', '-c', script, path.join(root, 'packaging/linux/install-acira-linux.py'), out], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.ISO8859-1', LANG: 'en_US.ISO8859-1' } });
    if (run.error && run.error.code === 'ENOENT') return; // no Python on this machine
    assert.equal(run.status, 0, 'the installer writes its entry under a Latin-1 locale: ' + run.stderr);
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.includes('Name[ja]=' + catalog('ja')['browsermenu.newWindow']), 'the Japanese name reads back as UTF-8');
    assert.ok(text.includes('Name[ar]=' + catalog('ar')['browsermenu.newPrivateWindow']), 'the Arabic name reads back as UTF-8');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Linux installer: a program path with spaces, a percent sign or a dollar is quoted the same way on every Exec line', () => {
  const target = '/home/a b/50%$HOME`x`/Acira "Browser".AppImage';
  const out = pythonEntry(target);
  if (!out) return;
  const quoted = '"/home/a b/50%%\\$HOME\\`x\\`/Acira \\"Browser\\".AppImage"';
  const groups = parseDesktop(out.entry);
  assert.equal(groups.get('Desktop Entry').get('Exec'), quoted + ' %U');
  assert.equal(groups.get('Desktop Action NewWindow').get('Exec'), quoted + ' --acira-new-window');
  assert.equal(groups.get('Desktop Action NewPrivateWindow').get('Exec'), quoted + ' --acira-new-private-window');
});

test('Linux AppImage: the builder config puts the same two actions in the .desktop file it generates (both identities)', async () => {
  const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper');
  for (const identity of ['', 'qa']) {
    const before = process.env.ACIRA_BUILD_IDENTITY;
    if (identity) process.env.ACIRA_BUILD_IDENTITY = identity; else delete process.env.ACIRA_BUILD_IDENTITY;
    delete require.cache[require.resolve('../packaging/electron-builder-linux.cjs')];
    const config = require('../packaging/electron-builder-linux.cjs');
    if (before === undefined) delete process.env.ACIRA_BUILD_IDENTITY; else process.env.ACIRA_BUILD_IDENTITY = before;
    const fake = {
      packager: { appInfo: { productName: config.productName, sanitizedProductName: config.productName }, executableName: config.executableName, info: { metadata: { desktopName: config.extraMetadata.desktopName } }, fileAssociations: [], config: {}, platformSpecificBuildOptions: config.linux },
      getDescription: () => 'An independent browser',
    };
    const text = await LinuxTargetHelper.prototype.computeDesktopEntry.call(fake, config.linux, 'AppRun --no-sandbox %U', { 'X-AppImage-Version': '1' });
    const groups = parseDesktop(text);
    checkActions(groups, { exec: value => value.startsWith('AppRun --no-sandbox --acira-new-') });
    assert.equal(groups.get('Desktop Entry').get('Exec'), 'AppRun --no-sandbox %U', 'the launcher itself is unchanged');
    assert.equal(groups.get('Desktop Entry').get('MimeType'), 'text/html;x-scheme-handler/http;x-scheme-handler/https;');
  }
  delete require.cache[require.resolve('../packaging/electron-builder-linux.cjs')];
});
