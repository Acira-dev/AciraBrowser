'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGlide, springStep, glideSeconds, kickFor, createZoomGlide, MAX_RATIO, ensureLimits, clearMagnification } = require('../desktop/page-zoom-glide.cjs');
const pageDebugger = require('../desktop/page-debugger.cjs');
const { EventEmitter } = require('node:events');

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('planGlide: zoom in grows the old layout and lands at the end, zoom out lands first and shrinks to fit', () => {
  assert.deepEqual(planGlide({ layout: 1, scale: 1 }, 1.1), { kind: 'glide', layout: 1, scale: 1, goal: 1.1, lands: false });
  const out = planGlide({ layout: 1.1, scale: 1 }, 1);
  assert.equal(out.kind, 'glide'); assert.equal(out.layout, 1); near(out.scale, 1.1, 1e-9, 'enlarged to the old size'); assert.equal(out.goal, 1); assert.equal(out.lands, true);
  assert.deepEqual(planGlide({ layout: 1, scale: 1 }, 1), { kind: 'none' });
});

test('planGlide: the page scale never goes below 1 and never beyond 1.6x', () => {
  for (const [from, to] of [[.25, .33], [.33, .5], [1, 1.1], [1.1, 1.25], [2, 2.5], [4, 5], [5, 4], [.5, .33], [1.25, 1.1], [.9, .8]]) {
    const plan = planGlide({ layout: from, scale: 1 }, to);
    assert.equal(plan.kind, 'glide', `${from} -> ${to}`);
    assert.ok(plan.scale >= 1 && plan.goal >= 1 && plan.scale <= MAX_RATIO + 1e-9 && plan.goal <= MAX_RATIO + 1e-9, `${from} -> ${to}: ${JSON.stringify(plan)}`);
  }
  assert.equal(planGlide({ layout: 5, scale: 1 }, 1).kind, 'cut', 'Reset from 500% is a jump, not a glide');
  assert.equal(planGlide({ layout: 1, scale: 1 }, 1.7).kind, 'cut');
  assert.equal(planGlide({ layout: 1, scale: 1 }, Number.NaN).kind, 'cut');
  assert.equal(planGlide({ layout: 1, scale: .9 }, 1.1).kind, 'cut', 'a scale below 1 is not something a page can show');
});

test('planGlide: a press during a glide retargets from what is on screen', () => {
  // zoom in under way (laid out at 100%, shown at 120%), then one more step to 150%: the same layout, a bigger goal
  assert.deepEqual(planGlide({ layout: 1, scale: 1.2 }, 1.5), { kind: 'glide', layout: 1, scale: 1.2, goal: 1.5, lands: false });
  // the same, but 175% is more than 1.6x the layout: it lands where it is (120%) and glides the rest
  const far = planGlide({ layout: 1, scale: 1.2 }, 1.75);
  assert.equal(far.layout, 1.2); assert.equal(far.scale, 1); near(far.goal, 1.75 / 1.2, 1e-9, 'rest'); assert.equal(far.lands, true);
  // a zoom out while zooming in: below the layout it was laid out at, so it lands at the target and shrinks from what is on screen
  const back = planGlide({ layout: 1, scale: 1.2 }, .9);
  assert.equal(back.layout, .9); near(back.scale, 1.2 / .9, 1e-9, 'shown size kept'); assert.equal(back.goal, 1);
  // back to where it started halfway through a zoom in: the scale just eases back down to 1
  assert.deepEqual(planGlide({ layout: 1, scale: 1.05 }, 1), { kind: 'glide', layout: 1, scale: 1.05, goal: 1, lands: false });
});

test('springStep is the interface spring: from rest it settles at the goal, and two half steps are one step', () => {
  near(springStep(1, 0, 1.1, .2, 0).x, 1, 1e-12, 'starts where it was');
  near(springStep(1, 0, 1.1, .2, 1).x, 1.1, 1e-4, 'settled');
  const whole = springStep(1, 0, 1.1, .2, .12), half = springStep(1, 0, 1.1, .2, .06), second = springStep(half.x, half.v, 1.1, .2, .06);
  near(whole.x, second.x, 1e-9, 'x'); near(whole.v, second.v, 1e-9, 'v');
  let last = 1; for (let t = 0; t <= .5; t += .01) { const x = springStep(1, 0, 1.1, .2, t).x; assert.ok(x >= last - 1e-12 && x <= 1.1 + 1e-9, 'never overshoots'); last = x; }
});

test('the glide is 205 ms at Premium, 95 ms at Fast and off when motion is off (the page-zoom token, 160 ms, a frequent surface)', () => {
  assert.equal(glideSeconds('premium'), .205); assert.equal(glideSeconds('fast'), .095); assert.equal(glideSeconds('off'), null); assert.equal(glideSeconds(undefined), null);
  assert.equal(kickFor('fast'), .15); assert.equal(kickFor('premium'), .4); assert.equal(kickFor('off'), 0);
});

// A page, a debugger and a clock that the driver can run against.
function rig({ zoom = 1, attached = false, failSend = false, pinch = undefined, holdFirstScale = false } = {}) {
  let release = null;
  const log = [], clock = { t: 0, queue: [] };
  const wc = Object.assign(new EventEmitter(), { // a real emitter, as Electron's webContents is: the glide listens for the page's navigations
    zoom, destroyed: false,
    isDestroyed: () => wc.destroyed, getZoomFactor: () => wc.zoom,
    setZoomFactor: factor => { wc.zoom = factor; log.push(['zoom', factor]); },
    setVisualZoomLevelLimits: async (a, b) => { log.push(['limits', a, b]); },
    debugger: { attached, isAttached: () => wc.debugger.attached, attach: () => { if (wc.debugger.attached) throw new Error('already'); wc.debugger.attached = true; log.push(['attach']); }, detach: () => { wc.debugger.attached = false; log.push(['detach']); },
      sendCommand: async (method, params) => { if (failSend) throw new Error('gone'); if (method === 'Page.getLayoutMetrics') { log.push(['metrics']); return pinch === undefined ? {} : { cssVisualViewport: { scale: pinch } }; } log.push(['scale', params.pageScaleFactor]); if (holdFirstScale && !release) await new Promise(resolve => { release = resolve; }); return {}; } },
  });
  const glide = createZoomGlide({ now: () => clock.t, later: (fn, ms) => { const item = { at: clock.t + ms, fn }; clock.queue.push(item); return item; }, cancelLater: item => { if (item) item.dead = true; } });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const run = async ms => { const end = clock.t + ms; await flush(); for (;;) { clock.queue = clock.queue.filter(item => !item.dead); const next = clock.queue.sort((a, b) => a.at - b.at)[0]; if (!next || next.at > end) break; clock.queue.splice(clock.queue.indexOf(next), 1); clock.t = next.at; next.fn(); await flush(); } clock.t = end; await flush(); };
  return { wc, glide, log, run, clock, answer: () => release && release() };
}
const request = (r, target, extra = {}) => r.glide.request({ wc: r.wc, target, speed: 'premium', seconds: glideSeconds('premium'), visible: () => true, ...extra });
const scales = r => r.log.filter(entry => entry[0] === 'scale').map(entry => entry[1]);

test('zoom in: the old layout grows from 1 to the step, then the real zoom lands once and the page scale is 1 again', async () => {
  const r = rig({ zoom: 1 });
  assert.equal(request(r, 1.1), true);
  assert.equal(r.glide.targetOf(r.wc), 1.1, 'while it glides the target is the zoom');
  await r.run(30);
  assert.equal(r.wc.zoom, 1, 'the real zoom has not changed yet'); assert.equal(r.log.filter(entry => entry[0] === 'limits').length, 0, 'a pinch is cleared with the page scale, never by toggling the visual zoom limits (that drops the Always dark override)');
  await r.run(700);
  assert.equal(r.wc.zoom, 1.1, 'landed'); assert.equal(r.glide.targetOf(r.wc), null); assert.equal(r.glide.isGliding(r.wc), false);
  const seen = scales(r);
  assert.ok(seen.length >= 8, `many frames, not a cut (${seen.length})`); assert.equal(seen.at(-1), 1, 'ends at scale 1');
  const body = seen.slice(0, -1); assert.ok(body.every((v, i) => v >= 1 && v <= 1.1 + 1e-6 && (i === 0 || v >= body[i - 1] - 1e-9)), 'rises monotonically to the step: ' + body.join(','));
  assert.equal(r.log.filter(entry => entry[0] === 'zoom').length, 1, 'one landing'); assert.equal(r.wc.debugger.attached, false, 'debugger let go');
  assert.ok(r.log.findIndex(entry => entry[0] === 'zoom') < r.log.length - 2, 'the landing comes before the final scale 1 and the detach');
});

test('a magnified page (a pinch) is cleared first, with the page scale and never with the visual zoom limits; a page at scale 1 is not made to wait for that clearing', async () => {
  const flat = rig({ zoom: 1, pinch: 1 });
  request(flat, 1.1); await flat.run(700);
  assert.equal(flat.log.filter(entry => entry[0] === 'limits').length, 0, 'nothing to clear: the visual zoom limits are left alone');
  assert.equal(flat.wc.zoom, 1.1);
  const pinched = rig({ zoom: 1, pinch: 1.6 });
  request(pinched, 1.1); await pinched.run(700);
  assert.equal(pinched.log.filter(entry => entry[0] === 'limits').length, 0, 'a toggle of the limits pushes the page\'s web preferences again: the Auto Dark Mode override of the page is gone');
  assert.equal(scales(pinched)[0], 1, 'cleared with the page scale before the glide starts'); assert.equal(scales(pinched).length, scales(flat).length + 1, 'exactly one command more than a page that needed no clearing');
  assert.ok(pinched.log.findIndex(entry => entry[0] === 'scale') > pinched.log.findIndex(entry => entry[0] === 'metrics'), 'after the metrics were read');
  const unknown = rig({ zoom: 1 }); request(unknown, 1.1); await unknown.run(700);
  assert.equal(unknown.log.filter(entry => entry[0] === 'limits').length, 0); assert.equal(scales(unknown)[0], 1, 'metrics that cannot be read: cleared to be safe, still with the page scale');
});

test('zoom out: the real zoom lands first, shown enlarged to the old size, and the scale eases down to 1', async () => {
  const r = rig({ zoom: 1.1, pinch: 1 });
  assert.equal(request(r, 1), true);
  await r.run(700);
  const firstZoom = r.log.findIndex(entry => entry[0] === 'zoom'), firstScale = r.log.findIndex(entry => entry[0] === 'scale');
  assert.ok(firstZoom >= 0 && firstZoom < firstScale, 'laid out at the new zoom before any scale is sent');
  assert.equal(r.wc.zoom, 1);
  const seen = scales(r); near(seen[0], 1.1, .03, 'starts at the old size'); assert.ok(seen.length >= 8);
  const body = seen.slice(0, -1); assert.ok(body.every((v, i) => v >= 1 - 1e-9 && (i === 0 || v <= body[i - 1] + 1e-9)), 'falls monotonically: ' + body.join(','));
  assert.equal(seen.at(-1), 1); assert.equal(r.wc.debugger.attached, false);
});

test('a page that is slow to lay out (a heavy site) is not shrunk while it is still working: the glide starts from its answer', async () => {
  const r = rig({ zoom: 1.1, holdFirstScale: true, pinch: 1 });
  request(r, 1); await r.run(400);
  assert.equal(r.wc.zoom, 1, 'laid out at the new zoom at once'); assert.equal(scales(r).length, 1, 'one scale sent, nothing else while it waits: ' + scales(r));
  r.answer(); await r.run(600);
  const seen = scales(r); assert.ok(seen.length >= 8, 'the whole shrink is played after the answer (' + seen.length + ')'); near(seen[0], 1.1, .001, 'from the enlarged size'); assert.equal(seen.at(-1), 1); assert.equal(r.wc.debugger.attached, false);
  const stuck = rig({ zoom: 1.1, holdFirstScale: true, pinch: 1 }); request(stuck, 1); await stuck.run(2200);
  assert.equal(stuck.wc.debugger.attached, false, 'a page that never answers is let go after 2 s'); assert.equal(stuck.wc.zoom, 1);
});

test('a second press retargets the running glide and the page lands on the last one', async () => {
  const r = rig({ zoom: 1 });
  request(r, 1.1); await r.run(60);
  request(r, 1.25); await r.run(30); assert.equal(r.glide.targetOf(r.wc), 1.25);
  request(r, 1.5); await r.run(900);
  assert.equal(r.wc.zoom, 1.5); assert.equal(r.log.filter(entry => entry[0] === 'zoom').at(-1)[1], 1.5); assert.equal(r.wc.debugger.attached, false);
  assert.equal(r.log.filter(entry => entry[0] === 'attach').length, 1, 'one attach for the whole burst');
  assert.ok(Math.max(...scales(r)) <= 1.5 + 1e-6);
});

test('a burst that goes past 1.6x lands where it is and glides the rest; a reversal lands and shrinks from what is shown', async () => {
  const far = rig({ zoom: 1 });
  request(far, 1.25); await far.run(50); request(far, 1.5); await far.run(40); request(far, 2); await far.run(900);
  assert.equal(far.wc.zoom, 2); assert.ok(far.log.filter(entry => entry[0] === 'zoom').length >= 2, 'it landed on the way');
  assert.ok(Math.max(...scales(far)) <= 1.6 + 1e-6, 'never enlarged more than 1.6x');
  const back = rig({ zoom: 1 });
  request(back, 1.25); await back.run(80); request(back, 1); await back.run(900);
  assert.equal(back.wc.zoom, 1); assert.equal(back.wc.debugger.attached, false); assert.equal(scales(back).at(-1), 1);
});

test('everything it cannot do is the old cut: no motion, a hidden page, an attached debugger, a jump, an unchanged zoom, a destroyed page', async () => {
  for (const [name, setup, args] of [
    ['no motion', () => rig(), { seconds: null }],
    ['hidden', () => rig(), { visible: () => false }],
    ['debugger already attached', () => rig({ attached: true }), {}],
    ['a jump (Reset from 500%)', () => rig({ zoom: 5 }), { target: 1 }],
    ['unchanged', () => rig({ zoom: 1.1 }), { target: 1.1 }],
  ]) {
    const r = setup(); assert.equal(request(r, args.target ?? 1.1, args), false, name); await r.run(100); assert.deepEqual(r.log.filter(entry => entry[0] !== 'limits'), r.wc.debugger.attached ? [] : [], name);
  }
  const r = rig(); r.wc.destroyed = true; assert.equal(request(r, 1.1), false);
});

test('a failing debugger command lands the zoom at once; abort lets go without touching the zoom', async () => {
  const bad = rig({ zoom: 1, failSend: true });
  request(bad, 1.1); await bad.run(400);
  assert.equal(bad.wc.zoom, 1.1, 'landed at the target'); assert.equal(bad.wc.debugger.attached, false); assert.equal(bad.glide.isGliding(bad.wc), false);
  const r = rig({ zoom: 1 });
  request(r, 1.1); await r.run(60); assert.equal(r.glide.abort(r.wc), true); await r.run(100);
  assert.equal(r.wc.zoom, 1, 'abort does not land'); assert.equal(r.wc.debugger.attached, false); assert.equal(r.glide.abort(r.wc), false);
  assert.equal(scales(r).at(-1), 1, 'and the page scale is 1');
});

test('no motion mid-glide, or the page hidden, lands at once; the deadline lands a stuck glide', async () => {
  const r = rig({ zoom: 1 }); let visible = true;
  request(r, 1.25, { visible: () => visible }); await r.run(40); visible = false; await r.run(20);
  assert.equal(r.wc.zoom, 1.25); assert.equal(r.wc.debugger.attached, false);
  const q = rig({ zoom: 1 });
  request(q, 1.25); await q.run(30); request(q, 1.5, { seconds: null }); await q.run(50);
  assert.equal(q.wc.zoom, 1.5, 'motion turned off mid-glide: lands on the latest target'); assert.equal(q.wc.debugger.attached, false);
});

// 13.5: zooming turned Always dark off. webContents.setVisualZoomLevelLimits (the old way to clear a pinch, and to enable pinch at page creation) makes Chromium push the page's web preferences
// again, which resets the Auto Dark Mode override that site-appearance.cjs holds through the page's debugger session: the page stayed attached but turned light until it was reloaded.
const pageOf = (extra = {}) => {
  const log = [], wc = {
    destroyed: false, isDestroyed: () => wc.destroyed,
    setVisualZoomLevelLimits: async (a, b) => { log.push(['limits', a, b]); },
    debugger: { attached: false, isAttached: () => wc.debugger.attached, attach: () => { wc.debugger.attached = true; log.push(['attach']); }, detach: () => { wc.debugger.attached = false; log.push(['detach']); },
      on() {}, removeListener() {}, sendCommand: async (method, params) => { if (extra.failScale && method === 'Emulation.setPageScaleFactor') throw new Error('gone'); log.push(['send', method, params]); return {}; } },
  };
  return { wc, log };
};

test('13.5: a page that holds a session (Always dark) is cleared of a pinch with the page scale through that session, and the session stays', async () => {
  const {wc, log} = pageOf(), appearance = pageDebugger.acquire(wc, 'appearance');
  log.length = 0;
  assert.equal(await clearMagnification(wc), true);
  assert.deepEqual(log, [['send', 'Emulation.setPageScaleFactor', {pageScaleFactor: 1}]], 'one command, no visual zoom limits, no attach, no detach');
  assert.equal(wc.debugger.attached, true, 'the appearance session is not ended by the clearing'); appearance.release(); assert.equal(wc.debugger.attached, false);
});

test('13.5: a page without a session keeps the old clearing (nothing to lose), and nothing is attached for it', async () => {
  const {wc, log} = pageOf();
  assert.equal(await clearMagnification(wc), true);
  assert.deepEqual(log, [['limits', 1, 1], ['limits', 1, 5]]); assert.equal(wc.debugger.attached, false);
});

test('13.5: when the page scale command fails on a page that holds a session, the old way is used and the caller tells the appearance again', async () => {
  const {wc, log} = pageOf({failScale: true}), appearance = pageDebugger.acquire(wc, 'appearance'); let told = 0;
  assert.equal(await clearMagnification(wc, {afterToggle: () => { told++; }}), true);
  assert.deepEqual(log.filter(entry => entry[0] === 'limits'), [['limits', 1, 1], ['limits', 1, 5]]); assert.equal(told, 1, 'told once, after the toggle');
  assert.equal(wc.debugger.attached, true); appearance.release();
});

test('13.5: a session that comes up while the old clearing runs (the page\'s appearance attaches at dom-ready) is told once the toggle is over', async () => {
  const {wc, log} = pageOf(); let told = 0, appearance = null;
  const first = wc.setVisualZoomLevelLimits; wc.setVisualZoomLevelLimits = async (a, b) => { await first(a, b); if (!appearance) appearance = pageDebugger.acquire(wc, 'appearance'); };
  assert.equal(await clearMagnification(wc, {afterToggle: () => { told++; }}), true);
  assert.deepEqual(log.filter(entry => entry[0] === 'limits'), [['limits', 1, 1], ['limits', 1, 5]]); assert.equal(told, 1, 'told once, after the second call');
  appearance.release();
  const quiet = pageOf(); let none = 0; await clearMagnification(quiet.wc, {afterToggle: () => { none++; }}); assert.equal(none, 0, 'no session by the end: nothing to tell');
});

test('13.5: clearing never throws or rejects, whatever the page is', async () => {
  assert.equal(await clearMagnification(null), false);
  const gone = pageOf().wc; gone.destroyed = true; assert.equal(await clearMagnification(gone), false);
  const broken = pageOf().wc; broken.setVisualZoomLevelLimits = () => { throw new Error('Object has been destroyed'); }; assert.equal(await clearMagnification(broken), false);
  const weird = pageOf().wc; weird.setVisualZoomLevelLimits = () => Promise.reject(new Error('no')); assert.equal(await clearMagnification(weird), false);
});

test('13.5: the visual zoom limits are applied once per page, when it is made, so a link preview that becomes a tab (it already holds a session) is not touched again', () => {
  const {wc, log} = pageOf();
  assert.equal(ensureLimits(wc), true); assert.equal(ensureLimits(wc), false); assert.equal(ensureLimits(wc), false);
  assert.deepEqual(log, [['limits', 1, 5]]);
  assert.equal(ensureLimits(null), false);
  const throwing = pageOf().wc; throwing.setVisualZoomLevelLimits = () => { throw new Error('gone'); }; assert.doesNotThrow(() => ensureLimits(throwing));
});

test('13.5: main wires it: no direct visual zoom limits call is left, the instant path clears with clearMagnification, the page is limited once at creation (tab and link preview), the theme change forces the appearance', () => {
  const fs = require('node:fs'), path = require('node:path'), main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.doesNotMatch(main, /setVisualZoomLevelLimits/, 'every call goes through page-zoom-glide.cjs');
  assert.match(main, /clearMagnification\(wc,\{afterToggle:\(\)=>siteAppearance\.reassert\(wc\)\}\);wc\.setZoomFactor\(zoom\)/);
  assert.equal((main.match(/ensureLimits\(wc\)/g) || []).length, 2, 'ensurePage and the link preview');
  assert.match(main, /pageCreated:\(wc,source\)=>\{ensureLimits\(wc\);zoomGlide\.watch\(wc\);siteAppearance\.attach\(wc,source\);\}/);
  assert.match(main, /nativeTheme\.on\('updated',\(\)=>siteAppearance\.refreshAll\(\{force:true\}\)\)/);
});

// ---- 13.5: no glide while the main frame navigates (a rare renderer crash: page scale commands racing a navigation's commit) ----------------------------------------------------------------
const navStart = (wc, extra = {}) => wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://example.com/next', ...extra });
const commit = wc => wc.emit('did-navigate', {}, 'https://example.com/next');

test('13.5 guard: while the main frame navigates (start to commit) a zoom step is not glided: the caller applies it at once, and not one page scale command is sent', async () => {
  const r = rig({ zoom: 1 });
  r.glide.watch(r.wc);
  assert.equal(r.glide.isNavigating(r.wc), false, 'a page at rest');
  navStart(r.wc);
  assert.equal(r.glide.isNavigating(r.wc), true);
  assert.equal(request(r, 1.1), false, 'false: the caller sets the zoom itself');
  assert.equal(request(r, .9), false);
  assert.equal(r.glide.isGliding(r.wc), false); assert.equal(r.glide.targetOf(r.wc), null);
  await r.run(700);
  assert.deepEqual(r.log, [], 'no debugger session, no page scale, no zoom: the glide did nothing at all');
  commit(r.wc);
  assert.equal(r.glide.isNavigating(r.wc), false);
  assert.equal(request(r, 1.1), true, 'committed: glides again');
  await r.run(700);
  assert.equal(r.wc.zoom, 1.1);
});

test('13.5 guard: a navigation that starts while a glide runs lands it at once: the final zoom now, the page scale back to 1, the session let go, and nothing else is sent', async () => {
  for (const [from, to] of [[1, 1.1], [1.1, 1]]) {
    const r = rig({ zoom: from });
    r.glide.watch(r.wc);
    assert.equal(request(r, to), true);
    await r.run(60);
    assert.equal(r.glide.isGliding(r.wc), true, `${from} -> ${to} is under way`);
    const sent = scales(r).length;
    navStart(r.wc);
    assert.equal(r.glide.isGliding(r.wc), false, 'over'); assert.equal(r.wc.zoom, to, 'the final zoom is applied now');
    await r.run(700);
    assert.equal(scales(r).length, sent + 1, 'exactly one command after the navigation started (the page scale back to 1)');
    assert.equal(scales(r).at(-1), 1); assert.equal(r.wc.debugger.attached, false, 'the session is let go');
    assert.equal(r.log.filter(entry => entry[0] === 'zoom').length, from === to ? 0 : 1, 'the final zoom is set once');
  }
});

test('13.5 guard: a glide that is still clearing a pinch when the navigation starts never begins', async () => {
  const r = rig({ zoom: 1, pinch: 1.6, holdFirstScale: true });
  r.glide.watch(r.wc);
  request(r, 1.1); await r.run(5);
  assert.deepEqual(scales(r), [1], 'only the clearing of the pinch is out (and unanswered)');
  navStart(r.wc);
  r.answer(); await r.run(700);
  assert.ok(scales(r).every(v => v === 1), 'no glide frame was sent after it: ' + scales(r).join(','));
  assert.equal(r.wc.zoom, 1.1); assert.equal(r.glide.isGliding(r.wc), false); assert.equal(r.wc.debugger.attached, false);
});

test('13.5 guard: what starts the guard and what ends it', () => {
  const state = (fn) => { const r = rig(); r.glide.watch(r.wc); fn(r); return r.glide.isNavigating(r.wc); };
  // starts: a main-frame navigation to another document; not a same-document one (hash, pushState), not a sub-frame's
  assert.equal(state(r => navStart(r.wc)), true);
  assert.equal(state(r => navStart(r.wc, { isSameDocument: true })), false, 'a same-document navigation is not one');
  assert.equal(state(r => navStart(r.wc, { isMainFrame: false })), false, 'a sub-frame\'s is not one');
  assert.equal(state(r => r.wc.emit('did-start-navigation', {}, 'https://example.com/', false, true)), true, 'the positional form (url, isInPlace, isMainFrame) is understood too');
  assert.equal(state(r => r.wc.emit('did-start-navigation', {}, 'https://example.com/', true, true)), false);
  // ends: the commit, the end of loading (a stop, a download, a 204), a failure of the main frame, a crash, the page going away
  assert.equal(state(r => { navStart(r.wc); commit(r.wc); }), false, 'commit');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-stop-loading'); }), false, 'stop loading (the person pressed Stop, a download, a 204)');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/', true); }), false, 'a failure');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('render-process-gone', {}, { reason: 'crashed' }); }), false, 'the renderer is gone');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('destroyed'); }), false, 'the page is destroyed');
  // does not end it: a newer navigation took over the aborted one (-3), a sub-frame failing, a hash change, a redirect on the way
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/', true); }), true, 'an aborted navigation can be the cancelled predecessor of the one in flight');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-fail-load', {}, -105, 'x', 'https://ads.invalid/', false); }), true, 'a sub-frame failing');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-navigate-in-page', {}, 'https://example.com/#a', true); }), true, 'a hash change is not a commit');
  assert.equal(state(r => { navStart(r.wc); r.wc.emit('did-redirect-navigation', {}, 'https://example.com/b', false, true); }), true, 'a redirect is still the same navigation');
});

test('13.5 guard: a second navigation (a script redirect, a JS challenge) starts before the first one has finished: the guard holds until the last one commits', () => {
  const r = rig(); r.glide.watch(r.wc);
  navStart(r.wc); commit(r.wc); assert.equal(r.glide.isNavigating(r.wc), false, 'the challenge page is up');
  navStart(r.wc, { url: 'https://example.com/?solution=1' });
  assert.equal(r.glide.isNavigating(r.wc), true, 'its script navigates again');
  r.wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/', true);
  assert.equal(r.glide.isNavigating(r.wc), true, 'the aborted first one reporting late does not end the second');
  commit(r.wc);
  assert.equal(r.glide.isNavigating(r.wc), false);
});

test('13.5 guard: a page is watched once, however often it is handed over; an unwatched page glides as it always did; outside a navigation a watched page does the identical thing', async () => {
  const r = rig(); r.glide.watch(r.wc); r.glide.watch(r.wc);
  for (const name of ['did-start-navigation', 'did-navigate', 'did-stop-loading', 'did-fail-load', 'render-process-gone']) assert.equal(r.wc.listenerCount(name), 1, name);
  const plain = rig({ zoom: 1 }), watched = rig({ zoom: 1 });
  watched.glide.watch(watched.wc);
  assert.equal(request(plain, 1.1), true); assert.equal(request(watched, 1.1), true);
  await plain.run(700); await watched.run(700);
  assert.deepEqual(watched.log, plain.log, 'the same commands in the same order outside a navigation');
  assert.equal(r.glide.isNavigating(null), false); assert.doesNotThrow(() => r.glide.watch(null));
});

test('13.5 guard: main hands every page it makes to the glide (tab and link preview)', () => {
  const fs = require('node:fs'), path = require('node:path'), main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.equal((main.match(/zoomGlide\.watch\(wc\)/g) || []).length, 2, 'ensurePage and the link preview');
  assert.match(main, /wc\.setZoomMode\('isolated'\);ensureLimits\(wc\);zoomGlide\.watch\(wc\);/);
});
