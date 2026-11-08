'use strict';
// A clock the tests move by hand: timers fire in time order when `advance` passes them, and the promises they start get to finish.
function fakeClock(start = Date.parse('2026-11-07T12:00:00Z')) {
  let time = start, serial = 0;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return {
    now: () => time,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { at: time + Math.max(0, ms), fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => [...timers.values()].map((timer) => timer.at - time).sort((a, b) => a - b),
    flush,
    /** Moves the clock forward, running every timer that falls due on the way (each with the clock at its own time). */
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]); time = Math.max(time, due[1].at); due[1].fn(); await flush();
      }
      time = end; await flush();
    },
  };
}
module.exports = { fakeClock };
