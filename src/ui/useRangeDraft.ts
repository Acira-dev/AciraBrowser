import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { holdLiveRange } from './liveRange';

/** D145 (Beta 14.2): ONE algorithm for a slider whose value is stored and broadcast (the Window opacity slider in Settings and in the Appearance popup).
 *  Dragging it fires an input event for every pointer move (125 to 1000 a second). Each one used to be sent to the store, which saves it, tells main (it re-applies the window's material
 *  and sends the whole state to every view) and brings a new snapshot back: the page spent its frames on that and the handle trailed the pointer by up to half the slider.
 *   - the handle and the number follow the pointer from LOCAL state (`draft`): the control never waits for the store;
 *   - at most ONE change leaves per painted frame, the newest (a drag of any number of moves inside one frame publishes once);
 *   - pointer up (anywhere), pointer cancel, key up, blur and unmount publish the last value NOW, so what was shown last is what is kept;
 *   - the store's value coming back while a drag is under way never moves the handle; after the drag it is taken once it matches what was published (older
 *     answers still on their way, or another window's change meanwhile, do not pull the handle back for a frame), or after `settleMs` whatever it is;
 *   - while the control is busy (pointer down, a value waiting, a published value not yet answered) the page's snapshot path applies the glass density's own changes as they come instead of
 *     crossfading the whole frame for each one (ui/liveRange.ts): the crossfade showed the OLD frame's handle for a quarter of a second per step, which was most of what the eye saw trail. */
export interface RangeDraftHost {
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
  later(callback: () => void, ms: number): number;
  cancelLater(id: number): void;
}
export interface RangeDraft {
  /** The value the handle and the number show. */
  readonly value: number;
  /** The control moved (pointer, arrow keys, Home / End, a click on the track): it shows at once, and one publish per frame carries the newest. */
  input(next: number): void;
  /** The pointer went down on the control: no stored value moves the handle until it is released. */
  press(): void;
  /** Pointer up / cancel, key up, blur: the newest value is published now. */
  release(): void;
  /** The stored value changed (main's answer, or another window). */
  store(value: number): void;
  /** Unmount: the newest value is published, timers stop. The draft can be used again (a development remount). */
  dispose(): void;
}

const browserHost: RangeDraftHost = {
  frame: callback => requestAnimationFrame(callback),
  cancelFrame: id => cancelAnimationFrame(id),
  later: (callback, ms) => window.setTimeout(callback, ms),
  cancelLater: id => window.clearTimeout(id),
};
/** A window that paints no frames (covered, throttled) still publishes: the frame's own turn comes after at most this long. */
const FRAME_FALLBACK_MS = 100;
/** How long the draft waits for the store to answer what it published before it takes the store's value, whatever it is. */
const SETTLE_MS = 700;

export function createRangeDraft(config: { value: number; show: (value: number) => void; publish: (value: number) => void; busy?: (on: boolean) => void; host?: RangeDraftHost; settleMs?: number }): RangeDraft {
  const host = config.host ?? browserHost, settleMs = config.settleMs ?? SETTLE_MS;
  let shown = config.value, stored = config.value, pressed = false, queued: { value: number } | null = null;
  let frameId = 0, fallbackId = 0, settleId = 0;
  /** What was published and not yet seen in the store, oldest first. */
  let inFlight: number[] = [];
  let busy = false;
  /** Busy: the pointer is down, a value waits for its frame, or a published value has not come back yet. */
  const sync = () => { const now = pressed || queued !== null || inFlight.length > 0; if (now !== busy) { busy = now; config.busy?.(now); } };
  const show = (value: number) => { if (value !== shown) { shown = value; config.show(value); } };
  const stopSettle = () => { if (settleId) { host.cancelLater(settleId); settleId = 0; } };
  const settle = () => { settleId = 0; inFlight = []; if (!pressed && !queued) show(stored); sync(); };
  const armSettle = () => { stopSettle(); settleId = host.later(settle, settleMs); };
  const publishNow = () => {
    if (frameId) { host.cancelFrame(frameId); frameId = 0; }
    if (fallbackId) { host.cancelLater(fallbackId); fallbackId = 0; }
    const next = queued; queued = null;
    if (!next) return;
    inFlight.push(next.value); armSettle(); sync();
    config.publish(next.value);
  };
  return {
    get value() { return shown; },
    input(next) {
      show(next); queued = { value: next };
      if (!frameId) frameId = host.frame(publishNow);
      if (!fallbackId) fallbackId = host.later(publishNow, FRAME_FALLBACK_MS);
      sync();
    },
    press() { pressed = true; sync(); },
    release() { pressed = false; publishNow(); if (!inFlight.length && !queued) show(stored); sync(); },
    store(value) {
      stored = value;
      if (pressed || queued) return;   // a drag is under way: the pointer owns the handle
      if (inFlight.length) {
        const at = inFlight.indexOf(value);
        if (at < 0) return;            // an older answer, or another window's change: wait for ours (or the settle)
        inFlight = inFlight.slice(at + 1);
        if (inFlight.length) return;   // answers to the newer ones are still on their way
        stopSettle();
      }
      show(value); sync();
    },
    dispose() { pressed = false; publishNow(); stopSettle(); inFlight = []; sync(); },
  };
}

/** The hook both sliders use. `bind` goes on the `<input type="range">`; `value` is what it and its number show. */
export function useRangeDraft(storeValue: number, onChange: (value: number) => void) {
  const [value, setValue] = useState(storeValue);
  const publish = useRef(onChange); publish.current = onChange;
  const draft = useRef<RangeDraft | null>(null), hold = useRef<(() => void) | null>(null);
  if (!draft.current) draft.current = createRangeDraft({ value: storeValue, show: setValue, publish: next => publish.current(next), busy: on => { if (on) hold.current ??= holdLiveRange(); else { hold.current?.(); hold.current = null; } } });
  const control = draft.current;
  useEffect(() => { control.store(storeValue); }, [control, storeValue]);
  useEffect(() => {
    const away = () => control.release();
    window.addEventListener('blur', away);
    return () => { window.removeEventListener('blur', away); control.dispose(); };
  }, [control]);
  const bind = {
    onChange: (event: ChangeEvent<HTMLInputElement>) => control.input(Number(event.target.value)),
    onPointerDown: () => {
      control.press();
      // The pointer can be let go anywhere (the native slider captures it): the release is heard on the document, once.
      const end = () => { document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true); control.release(); };
      document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
    },
    onKeyUp: () => control.release(),
    onBlur: () => control.release(),
  };
  return { value, bind };
}
