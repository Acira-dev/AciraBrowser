'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGlide, springStep, glideSeconds, kickFor, createZoomGlide, MAX_RATIO } = require('../desktop/page-zoom-glide.cjs');

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
  const wc = {
    zoom, destroyed: false, handlers: {},
    isDestroyed: () => wc.destroyed, getZoomFactor: () => wc.zoom, once: (name, fn) => { wc.handlers[name] = fn; },
    setZoomFactor: factor => { wc.zoom = factor; log.push(['zoom', factor]); },
    setVisualZoomLevelLimits: async (a, b) => { log.push(['limits', a, b]); },
    debugger: { attached, isAttached: () => wc.debugger.attached, attach: () => { if (wc.debugger.attached) throw new Error('already'); wc.debugger.attached = true; log.push(['attach']); }, detach: () => { wc.debugger.attached = false; log.push(['detach']); },
      sendCommand: async (method, params) => { if (failSend) throw new Error('gone'); if (method === 'Page.getLayoutMetrics') { log.push(['metrics']); return pinch === undefined ? {} : { cssVisualViewport: { scale: pinch } }; } log.push(['scale', params.pageScaleFactor]); if (holdFirstScale && !release) await new Promise(resolve => { release = resolve; }); return {}; } },
  };
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
  assert.equal(r.wc.zoom, 1, 'the real zoom has not changed yet'); assert.ok(r.log.some(entry => entry[0] === 'limits'), 'a pinch is cleared first, as the instant path does');
  await r.run(700);
  assert.equal(r.wc.zoom, 1.1, 'landed'); assert.equal(r.glide.targetOf(r.wc), null); assert.equal(r.glide.isGliding(r.wc), false);
  const seen = scales(r);
  assert.ok(seen.length >= 8, `many frames, not a cut (${seen.length})`); assert.equal(seen.at(-1), 1, 'ends at scale 1');
  const body = seen.slice(0, -1); assert.ok(body.every((v, i) => v >= 1 && v <= 1.1 + 1e-6 && (i === 0 || v >= body[i - 1] - 1e-9)), 'rises monotonically to the step: ' + body.join(','));
  assert.equal(r.log.filter(entry => entry[0] === 'zoom').length, 1, 'one landing'); assert.equal(r.wc.debugger.attached, false, 'debugger let go');
  assert.ok(r.log.findIndex(entry => entry[0] === 'zoom') < r.log.length - 2, 'the landing comes before the final scale 1 and the detach');
});

test('a magnified page (a pinch) is cleared first; a page at scale 1 is not made to wait for that clearing', async () => {
  const flat = rig({ zoom: 1, pinch: 1 });
  request(flat, 1.1); await flat.run(700);
  assert.equal(flat.log.filter(entry => entry[0] === 'limits').length, 0, 'nothing to clear: the visual zoom limits are left alone');
  assert.equal(flat.wc.zoom, 1.1);
  const pinched = rig({ zoom: 1, pinch: 1.6 });
  request(pinched, 1.1); await pinched.run(700);
  assert.deepEqual(pinched.log.filter(entry => entry[0] === 'limits'), [['limits', 1, 1], ['limits', 1, 5]], 'cleared as the instant path clears it');
  assert.ok(pinched.log.findIndex(entry => entry[0] === 'limits') < pinched.log.findIndex(entry => entry[0] === 'scale'), 'before any scale is sent');
  const unknown = rig({ zoom: 1 }); request(unknown, 1.1); await unknown.run(700);
  assert.equal(unknown.log.filter(entry => entry[0] === 'limits').length, 2, 'metrics that cannot be read: cleared to be safe');
});

test('zoom out: the real zoom lands first, shown enlarged to the old size, and the scale eases down to 1', async () => {
  const r = rig({ zoom: 1.1 });
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
  const r = rig({ zoom: 1.1, holdFirstScale: true });
  request(r, 1); await r.run(400);
  assert.equal(r.wc.zoom, 1, 'laid out at the new zoom at once'); assert.equal(scales(r).length, 1, 'one scale sent, nothing else while it waits: ' + scales(r));
  r.answer(); await r.run(600);
  const seen = scales(r); assert.ok(seen.length >= 8, 'the whole shrink is played after the answer (' + seen.length + ')'); near(seen[0], 1.1, .001, 'from the enlarged size'); assert.equal(seen.at(-1), 1); assert.equal(r.wc.debugger.attached, false);
  const stuck = rig({ zoom: 1.1, holdFirstScale: true }); request(stuck, 1); await stuck.run(2200);
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
