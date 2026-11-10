'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { softwareDrawingOf, createDrawingWatch } = require(process.env.GPU_DRAWING_PATH || '../desktop/gpu-drawing.cjs');   // GPU_DRAWING_PATH: run the same tests against another copy (the tree before the fix)

test('software drawing is read from the compositing word only', () => {
  assert.equal(softwareDrawingOf({ gpu_compositing: 'enabled', webgl: 'enabled' }), false);
  assert.equal(softwareDrawingOf({ gpu_compositing: 'enabled_on' }), false);
  assert.equal(softwareDrawingOf({ gpu_compositing: 'disabled_software', webgl: 'disabled_off' }), true);
  assert.equal(softwareDrawingOf({ gpu_compositing: 'unavailable_software' }), true);
  assert.equal(softwareDrawingOf({ gpu_compositing: 'disabled_off' }), true);
  // a status that says nothing changes nothing
  for (const nothing of [undefined, null, {}, { gpu_compositing: '' }, { gpu_compositing: 3 }, 'x', []]) assert.equal(softwareDrawingOf(nothing), false);
});

function fakeApp(status) {
  const app = new EventEmitter();
  app.status = status;
  app.getGPUFeatureStatus = () => { if (app.status instanceof Error) throw app.status; return app.status; };
  return app;
}
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (fn) => { const id = next++; pending.set(id, fn); return { id, unref() {} }; },
    clearTimer: (handle) => { if (handle) pending.delete(handle.id); },
    fire() { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    count: () => pending.size
  };
}

test('the watch reads the status at start: a normal GPU is not software; no GPU is, once the first reading has settled or something certain says so', () => {
  assert.equal(createDrawingWatch({ app: fakeApp({ gpu_compositing: 'enabled' }) }).software(), false);
  assert.equal(createDrawingWatch({ app: fakeApp(new Error('before ready')) }).software(), false);
  // "software" at start is not believed yet (see the next test) ...
  const timers = fakeTimers(), app = fakeApp({ gpu_compositing: 'disabled_software' });
  const watch = createDrawingWatch({ app, ...timers }), told = [];
  watch.subscribe(software => told.push(software));
  assert.equal(watch.software(), false, 'a software reading before the first gpu-info-update is not trusted');
  assert.equal(timers.count(), 1, 'it is read again after the settle');
  timers.fire();
  assert.equal(watch.software(), true, 'still software after the settle: now it is');
  assert.deepEqual(told, [true]);
  // ... unless something certain says there is no GPU: then it is believed at once, with nothing to look at again
  for (const certain of [
    a => { a.commandLine = { hasSwitch: name => name === 'disable-gpu' }; },
    a => { a.commandLine = { hasSwitch: name => name === 'disable-gpu-compositing' }; },
    a => { a.isHardwareAccelerationEnabled = () => false; }
  ]) {
    const noGpu = fakeApp({ gpu_compositing: 'disabled_software' }); certain(noGpu);
    const t = fakeTimers(), w = createDrawingWatch({ app: noGpu, ...t });
    assert.equal(w.software(), true);
    assert.equal(t.count(), 0);
  }
  // a certain switch does not turn a normal GPU's reading into software
  const normal = fakeApp({ gpu_compositing: 'enabled' }); normal.commandLine = { hasSwitch: () => false }; normal.isHardwareAccelerationEnabled = () => true;
  assert.equal(createDrawingWatch({ app: normal }).software(), false);
});

test('a normal GPU never says software: the pre-init status of the first ~300 ms of a launch is not believed (13.5 final run: Reduce motion was on for 1.7 s)', () => {
  // measured on the tree: gpu_compositing says disabled_software at 160-220 ms, gpu-info-update at 250-310 ms, "enabled" 50 ms later
  const app = fakeApp({ gpu_compositing: 'disabled_software' }), timers = fakeTimers();
  const watch = createDrawingWatch({ app, ...timers }), told = [];
  watch.subscribe(software => told.push(software));
  assert.equal(watch.software(), false, 'what a window asks for at start (the preload reads this synchronously)');
  app.status = { gpu_compositing: 'enabled' };
  app.emit('gpu-info-update');
  assert.equal(timers.count(), 1, 'the event restarts the one settle timer, it does not add another');
  assert.equal(watch.software(), false);
  timers.fire();
  assert.equal(watch.software(), false);
  assert.deepEqual(told, [], 'nobody is ever told "software"');
});

test('a fallback to software mid-session is told once, after Chromium has settled', () => {
  const app = fakeApp({ gpu_compositing: 'enabled' }), timers = fakeTimers();
  const watch = createDrawingWatch({ app, ...timers }), told = [];
  watch.subscribe(software => told.push(software));
  // the GPU process dies: nothing is said until the status has changed
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
  assert.equal(timers.count(), 1);
  timers.fire();
  assert.deepEqual(told, [], 'status still says enabled: no change, no message');
  app.status = { gpu_compositing: 'disabled_software' };
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
  app.emit('gpu-info-update');
  assert.equal(timers.count(), 1, 'two events in a row make one read');
  timers.fire();
  assert.deepEqual(told, [true]);
  assert.equal(watch.software(), true);
  timers.fire();
  assert.deepEqual(told, [true], 'nothing new, nothing said');
  // and back, if the GPU comes back
  app.status = { gpu_compositing: 'enabled' };
  app.emit('gpu-info-update'); timers.fire();
  assert.deepEqual(told, [true, false]);
});

test('other processes going away, a throwing listener and a stopped watch change nothing', () => {
  const app = fakeApp({ gpu_compositing: 'enabled' }), timers = fakeTimers();
  app.status = { gpu_compositing: 'disabled_software' }; app.commandLine = { hasSwitch: name => name === 'disable-gpu' };   // software from the start, for certain
  const watch = createDrawingWatch({ app, ...timers }), told = [];
  assert.equal(watch.software(), true);
  app.emit('child-process-gone', {}, { type: 'Utility' });
  assert.equal(timers.count(), 0, 'a utility process is not the GPU');
  watch.subscribe(() => { throw new Error('bad listener'); });
  watch.subscribe(software => told.push(software));
  app.status = { gpu_compositing: 'enabled' };
  app.emit('gpu-info-update'); timers.fire();
  assert.deepEqual(told, [false], 'the second listener still hears it');
  watch.dispose();
  assert.equal(app.listenerCount('gpu-info-update'), 0);
  assert.equal(app.listenerCount('child-process-gone'), 0);
});
