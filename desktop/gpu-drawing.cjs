'use strict';
/**
 * Is this window drawn in software? (13.5)
 *
 * Without graphics acceleration (a PC with no usable graphics driver, --disable-gpu, a GPU process that crashed and fell back) every animated
 * frame is painted by the CPU: the sidebar glide ran at about 5 frames a second there. Reduce motion fixes that, and until the person has made a
 * choice of their own the interface turns it on while this says "software" (src/runtime/motion.ts holds the rule).
 *
 * `softwareDrawingOf(status)` reads Electron's app.getGPUFeatureStatus(): `gpu_compositing` is "enabled" on a normal graphics stack and
 * "disabled_software" (or "unavailable_software", "disabled_off"...) without one. A status that says nothing leaves things as they were.
 * `createDrawingWatch` reads it once and again when Chromium says the GPU changed or the GPU process went away (a fallback to software
 * mid-session), and tells whoever subscribed when the answer changes.
 *
 * The first reading cannot be believed when it says "software": for the first ~250-300 ms of every launch, with a perfectly good GPU too, Chromium
 * reports `disabled_software` until its first `gpu-info-update` (measured on the final 13.5 tree: reads at 160-220 ms said software, the event came
 * at 250-310 ms, the status was "enabled" 50 ms later). Taking that at face value turned Reduce motion on for the first ~1.7 s of every launch on
 * a normal GPU. So a software reading at start is only believed at once when something certain says there is no GPU (--disable-gpu,
 * --disable-gpu-compositing, app.disableHardwareAcceleration()); otherwise the watch says "not software" and checks again once the first
 * `gpu-info-update` has settled (or `settleMs` after start when the event never comes).
 */
function softwareDrawingOf(status) {
  const value = status && typeof status === 'object' ? status.gpu_compositing : undefined;
  return typeof value === 'string' && value.length > 0 && !/^enabled/.test(value);
}

function createDrawingWatch({ app, settleMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let software = false, timer = null, stopped = false;
  const listeners = new Set();
  const read = () => { try { return softwareDrawingOf(app.getGPUFeatureStatus()); } catch { return software; } };
  // Something that settles it without waiting: the person (or the packaging) switched the GPU off.
  const certainlyNoGpu = () => { try { return Boolean(app.commandLine?.hasSwitch?.('disable-gpu') || app.commandLine?.hasSwitch?.('disable-gpu-compositing') || app.isHardwareAccelerationEnabled?.() === false); } catch { return false; } };
  const refresh = () => {
    timer = null;
    if (stopped) return;
    const next = read();
    if (next === software) return;
    software = next;
    for (const listener of [...listeners]) { try { listener(software); } catch { /* one listener must not stop the others */ } }
  };
  // Chromium updates the status a moment after the event that changed it (the GPU process is relaunched, then the fallback is decided).
  const later = () => { if (stopped) return; if (timer) clearTimer(timer); timer = setTimer(refresh, settleMs); timer?.unref?.(); };
  const onInfo = () => later();
  const onGone = (_event, details) => { if (details && details.type === 'GPU') later(); };
  const first = read();
  software = first && certainlyNoGpu();
  app.on('gpu-info-update', onInfo);
  app.on('child-process-gone', onGone);
  if (first && !software) later();   // "software" so early may be the status before the GPU reported in: look again once it has settled
  return {
    software: () => software,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    dispose() { stopped = true; if (timer) clearTimer(timer); timer = null; listeners.clear(); app.removeListener?.('gpu-info-update', onInfo); app.removeListener?.('child-process-gone', onGone); }
  };
}

let shared = null;
/** One watch for the whole process; made on first ask, after the app is ready. */
function sharedDrawingWatch(app = require('electron').app) { return shared ||= createDrawingWatch({ app }); }

module.exports = { softwareDrawingOf, createDrawingWatch, sharedDrawingWatch };
