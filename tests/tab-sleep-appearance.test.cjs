'use strict';
// 13.5 (lower memory use): a tab that holds Website appearance's debugger session (Always dark, and Light / Dark whenever they differ from Acira's own look) never fell asleep:
// desktop/main.cjs protectedReason answered 'inspecting' for any attached debugger, and since 13.3 Acira's own appearance session keeps the debugger attached to every such tab.
// 'inspecting' now means somebody else (DevTools, a debugger that is not Acira's appearance lease). This file: the wiring in main.cjs, and the real modules in a real Electron
// (tests/fixtures/tab-sleep-appearance/run.cjs): hidden tabs freeze and sleep with the session released, wake dark, can do so over and over, and DevTools or another debugger still keeps a tab awake.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');

test('main.cjs: "inspecting" is DevTools or a debugger that is not Acira\'s own appearance session; the raw isAttached check is gone', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const start = main.indexOf('async protectedReason('), end = main.indexOf('async sleep(id)', start);
  assert.ok(start > 0 && end > start); const body = main.slice(start, end);
  assert.ok(body.includes("if(wc.isDevToolsOpened()||pageDebugger.inUseByOthers(wc))return 'inspecting';"));
  assert.ok(!/debugger\.isAttached\(\)/.test(body), 'a debugger that is merely attached no longer keeps a tab awake');
  // nothing else in the order of protections moved
  const order = ["return 'gone'", "return 'private'", "return 'pinned'", "return 'capturing'", "return 'busy'", "return 'internal'", "return 'audio'", "return 'recently-audible'", "return 'background-activity'", "return 'inspecting'", "return 'notifications'", "return 'download'", "return 'never-sleep'", "return 'inspection-failed'"];
  let at = -1; for (const needle of order) { const next = body.indexOf(needle, at + 1); assert.ok(next > at, needle + ' keeps its place'); at = next; }
});

test('13.5: a tab the person switched to while its sleep check was running is never closed: sleep() looks again before the page is read and again before it is closed (the 13.4 sweep did not)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const start = main.indexOf(' async sleep(id){'), end = main.indexOf('browserEvent(id,{sleeping:true});return {slept:true};}', start);
  assert.ok(start > 0 && end > start); const body = main.slice(start, end);
  const checks = body.match(/if\(pageVisible\(id\)&&!switchedAway\)return \{slept:false,reason:'visible'\};/g) || [];
  assert.equal(checks.length, 2, 'once before the page is read, once before it is closed');
  assert.ok(body.indexOf("reason:'visible'") < body.indexOf("executeJavaScript('[Math.round(scrollX)") && body.lastIndexOf("reason:'visible'") > body.indexOf("executeJavaScript('[Math.round(scrollX)") && body.lastIndexOf("reason:'visible'") < body.indexOf('entry.discarding=true'));
  // the answer is a refusal the sweep and the hand-made "Put to sleep" already understand (a reason string, nothing slept)
  const sleep = require('../desktop/tab-sleep.cjs'); assert.equal(sleep.stayAwakeKind('visible'), 'screen');
});

test('the appearance module and tab sleep share one lease owner name, so "passive" means exactly the Website appearance session', () => {
  const appearance = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'site-appearance.cjs'), 'utf8');
  assert.match(appearance, /acquire\(wc, 'appearance'\)/);
  const {PASSIVE} = require('../desktop/page-debugger.cjs'); assert.deepEqual(PASSIVE, ['appearance']);
  for (const file of ['page-zoom-glide.cjs', 'secured-pages.cjs', 'capture-state.cjs']) assert.ok(!/acquire\([^)]*'appearance'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'desktop', file), 'utf8')), file + ' does not borrow the passive name');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.ok(main.includes("pageDebugger.acquire(wc,'sleep')"), 'the freeze lease is not passive: it is released before the check');
});

test('13.4 worker-crash fix still intact next to the sleep change: workers never attached, never detached, frames only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'site-appearance.cjs'), 'utf8').split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(source, /detachFromTarget/); assert.match(source, /filter:\s*\[\{type:\s*'iframe'\},\s*\{exclude:\s*true\}\]/);
});

const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const fixture = path.join(__dirname, 'fixtures', 'tab-sleep-appearance', 'run.cjs');
const CONFIGS = [{mode: 'always-dark', acira: 'light', session: true}, {mode: 'always-dark', acira: 'dark', session: true}, {mode: 'dark', acira: 'light', session: true}, {mode: 'light', acira: 'dark', session: true}, {mode: 'system', acira: 'light', session: false}, {mode: 'dark', acira: 'dark', session: false}];
const runs = new Map();
function once(config, old = false) {
  const args = [fixture, ...(process.platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : [])];
  const run = spawnSync(electron, args, {encoding: 'utf8', timeout: 175000, killSignal: 'SIGKILL', env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '0', SLEEPAPP_MODE: config.mode, SLEEPAPP_ACIRA: config.acira, SLEEPAPP_CYCLES: '10', ...(old ? {SLEEPAPP_OLD: '1'} : {})}});
  const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
  return {status: run.status, signal: run.signal, result: line ? JSON.parse(line.slice(7)) : null, output: ((run.stdout || '') + (run.stderr || '')).slice(0, 800)};
}
const get = config => { const key = `${config.mode}/${config.acira}`; if (!runs.has(key)) { let attempt = once(config); if (!attempt.result || attempt.result.error === 'timed out') attempt = once(config); runs.set(key, attempt); if (process.env.TAB_SLEEP_DUMP) try { fs.writeFileSync(path.join(process.env.TAB_SLEEP_DUMP, `appearance-${config.mode}-${config.acira}.json`), JSON.stringify(attempt.result || {output: attempt.output}, null, 1)); } catch { /* a debugging aid only */ } } return runs.get(key); };
const skip = !electron ? 'electron binary not available' : process.env.SKIP_ELECTRON_FIXTURES === '1' ? 'SKIP_ELECTRON_FIXTURES=1 (the fixture launches a real Electron: hold the lock where one is shared)' : false;
const expectedDark = config => config.mode === 'system' ? config.acira === 'dark' : config.mode !== 'light'; // told dark, told light, or following Acira
const step = (config, name) => get(config).result.steps.find(item => item.step === name).value;

for (const config of CONFIGS) {
  const label = `${config.mode} on a ${config.acira} Acira${config.session ? '' : ' (holds no session)'}`;
  test(`13.5: ${label}: the fixture ran to the end, nothing crashed, no error`, {skip}, () => {
    const run = get(config); assert.equal(run.signal, null, 'killed by ' + run.signal); assert.ok(run.result, 'no result: ' + run.output); assert.equal(run.result.error, undefined, run.result.error); assert.equal(run.status, 0);
    assert.deepEqual(run.result.gone, [], 'no renderer crashed'); assert.deepEqual(run.result.errors, [], 'no uncaught error or unhandled rejection');
  });
  test(`13.5: ${label}: the tabs start with the session the setting asks for`, {skip}, () => {
    const opened = step(config, 'opened'); assert.equal(opened.wantsSession, config.session);
    assert.deepEqual(opened.sessions, [config.session, config.session, config.session, config.session]);
    assert.deepEqual(opened.dark, [expectedDark(config), expectedDark(config), expectedDark(config), expectedDark(config)]);
  });
  test(`13.5: ${label}: hidden tabs freeze and then sleep (13.4: the ones with a session never did); DevTools and another debugger still keep a tab awake`, {skip}, () => {
    const protections = step(config, 'protections'); assert.equal(protections.devTools, true); assert.equal(protections.foreignInUse, true);
    const frozen = step(config, 'frozen'); assert.deepEqual(frozen.frozen, ['b', 'w'], 'b and the workers page freeze; c (DevTools) and f (another debugger) are inspected and left alone');
    assert.deepEqual(frozen.protected, {c: 'inspecting', f: 'inspecting'});
    const slept = step(config, 'slept'); assert.deepEqual(slept.slept, ['b', 'w'], 'asleep: the pages are closed'); assert.deepEqual(slept.protected, {c: 'inspecting', f: 'inspecting'});
    assert.deepEqual(slept.awake, ['a', 'c', 'f']); assert.equal(slept.leftOnDeadPages, 0, 'no lease or debugger left on a page that is gone');
    const after = step(config, 'after-sleep'); assert.equal(after.activeSession, config.session, 'the shown tab keeps its session and its page');
    const released = step(config, 'released'); assert.deepEqual(released.slept, ['c', 'f'], 'DevTools closed / the other debugger detached: they sleep at the next sweep'); assert.deepEqual(released.awake, ['a']); assert.deepEqual(released.protected, {});
    assert.equal(released.leftOnDeadPages, 0);
  });
  test(`13.5: ${label}: a woken tab loads dark again, and 10 wake / sleep rounds leave no lease behind`, {skip}, () => {
    const rounds = step(config, 'rounds'); assert.equal(rounds.length, 10);
    for (const round of rounds) {
      assert.equal(round.session, config.session, 'round ' + round.round); assert.equal(round.dark, expectedDark(config), 'round ' + round.round + ' dark');
      assert.deepEqual(round.frozenSweep, ['b']); assert.equal(round.frozen, true); assert.equal(round.held, config.session ? 2 : 1, 'while frozen: the appearance session (when there is one) and the freeze');
      assert.equal(round.slept, true, 'round ' + round.round + ' sleeps'); assert.equal(round.gone, true); assert.deepEqual(round.protected, {}); assert.equal(round.leftOnDeadPages, 0);
      assert.equal(round.outstanding, config.session ? 1 : 0, 'only the shown tab\'s own session is left'); assert.equal(round.sessions, config.session ? 1 : 0);
    }
  });
  test(`13.5: ${label}: a page that starts Web Workers non-stop with a cross-site frame sleeps and wakes without a crash`, {skip}, () => {
    const woken = step(config, 'woken-workers-page'); assert.equal(woken.alive, true);
    assert.equal(woken.page, expectedDark(config));
    assert.deepEqual(woken.frames, [woken.page], 'the cross-site frame is told what the page is told'); assert.equal(woken.state.session, config.session);
    if (config.session) assert.equal(woken.state.frames, 1, 'one followed target: the frame, no worker');
    const again = step(config, 'workers-page-slept-again'); assert.deepEqual(again.slept, ['w']); assert.equal(again.leftOnDeadPages, 0);
    const stays = step(config, 'active-stays'); assert.deepEqual(stays.slept, []); assert.deepEqual(stays.awake, ['a']);
    const { final } = get(config).result; assert.deepEqual(final.outstanding, config.session ? ['appearance'] : [], 'the only lease left is the shown tab\'s'); assert.equal(final.liveSessions, config.session ? 1 : 0);
  });
}

// The negative control: the question 13.4 asked (any attached debugger = somebody is inspecting) on the same fixture. Tabs that hold the appearance session are never frozen and never sleep;
// a tab with no session (System) sleeps. This is what makes the tests above fail on 13.4.
for (const config of [{mode: 'always-dark', acira: 'light', session: true}, {mode: 'system', acira: 'light', session: false}]) {
  test(`13.4 control: ${config.mode}: with "any attached debugger = inspecting" the tabs ${config.session ? 'with the session never sleep' : 'sleep (nothing attached)'}`, {skip}, () => {
    let run = once(config, true); if (!run.result || run.result.error === 'timed out') run = once(config, true);
    assert.ok(run.result, 'no result: ' + run.output); assert.equal(run.result.error, undefined, run.result.error);
    const frozen = run.result.steps.find(item => item.step === 'frozen').value, slept = run.result.steps.find(item => item.step === 'slept').value;
    if (config.session) { assert.deepEqual(frozen.frozen, [], 'nothing freezes'); assert.deepEqual(slept.slept, [], 'nothing sleeps'); assert.deepEqual(slept.protected, {b: 'inspecting', c: 'inspecting', f: 'inspecting', w: 'inspecting'}); }
    else { assert.deepEqual(slept.slept, ['b', 'w']); assert.deepEqual(slept.protected, {c: 'inspecting', f: 'inspecting'}); }
  });
}
