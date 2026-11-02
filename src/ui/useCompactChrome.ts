import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { runtime } from '../runtime/client';
import { compactRest, compactStep, compactTimings, type CompactEvent, type CompactPin, type CompactState } from './compactChrome';
import { startModeTransition } from './sharedMotion';

/** R4-14: the Compact view's controller (state machine in compactChrome.ts, spec docs/launch/COMPACT_MODE_UX.md). Feeds it
 * the window's events, runs its one timer, and plays a phase change on the layout spring (`startModeTransition` 'layout',
 * the same machinery as every view switch; Off applies it at once). Returns whether the full chrome shows and `send`
 * for App's own paths (Ctrl+L, Enter, Esc, a click in a native page). */
export function useCompactChrome({ enabled, tabIds, tabId, tabUrl, popupOpen, dragging, addressFocused, chromeBottom }: {
  enabled: boolean; tabIds: readonly string[]; tabId: string; tabUrl: string; popupOpen: boolean; dragging: boolean; addressFocused: boolean;
  /** Where the chrome ends (CSS px from the top); App sets it after laying the rows out. */
  chromeBottom: { current: number };
}): { expanded: boolean; send: (event: CompactEvent) => void } {
  const [expanded, setExpanded] = useState(false);
  const machine = useRef<CompactState>(compactRest), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A phase change plays as a view transition, which takes the page's hits until it ends. One that starts during a press
  // (focus leaving the address field, a press below the chrome) waits for the release, or the release and its click land on
  // the transition instead of what was pressed: the first click on a sidebar tab after a new tab did nothing.
  const pressing = useRef(false), held = useRef<boolean | null>(null);
  const play = useCallback((show: boolean) => startModeTransition(() => flushSync(() => setExpanded(show)), 'layout'), []);
  const live = useRef({ enabled, chromeBottom: 0 });
  live.current = { enabled, get chromeBottom() { return chromeBottom.current; } };
  const send = useCallback((event: CompactEvent) => {
    const before = machine.current;
    const next = live.current.enabled || event.type === 'reset' || event.type === 'pin' ? compactStep(before, event) : before;
    if (next === before) return;
    machine.current = next;
    // The last few transitions, for QA (qa-compact.mjs reads it when a path fails).
    const trail = ((window as unknown as { __compactTrail?: string[] }).__compactTrail ??= []);
    trail.push(`${event.type}${event.type === 'pin' ? `:${event.pin}=${event.on}` : event.type === 'timeout' ? `:${event.due}` : ''} -> ${next.phase}/${next.reason ?? '-'}/${next.due ?? '-'}/[${next.pins.join(',')}]`); if (trail.length > 30) trail.shift();
    if (next.due !== before.due || event.type === 'cycle' || (event.type === 'switch' && next.due === 'cycle')) {
      clearTimeout(timer.current); timer.current = undefined;
      const due = next.due;
      if (due) timer.current = setTimeout(() => send({ type: 'timeout', due }), compactTimings[due]);
    }
    if (next.phase !== before.phase) {
      const show = next.phase === 'expanded';
      if (pressing.current) { held.current = show; return; }
      // Queued so a change that starts inside a React commit (a pin from an effect) flushes after it, on its own frame.
      queueMicrotask(() => play(show));
    }
  }, [play]);
  // Leaving Compact (another view, a Settings page) drops any expansion without motion of its own.
  useEffect(() => { if (!enabled) { send({ type: 'reset' }); setExpanded(false); } }, [enabled, send]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // New blank tab expands; any other change of the active tab is a switch (Ctrl+Tab keeps its own timer).
  const previous = useRef({ ids: new Set(tabIds), active: tabId });
  useLayoutEffect(() => {
    const created = !previous.current.ids.has(tabId), changed = previous.current.active !== tabId;
    previous.current = { ids: new Set(tabIds), active: tabId };
    if (!changed) return;
    send(created && tabUrl === 'acira://new' ? { type: 'new-tab' } : { type: 'switch' });
  }, [tabIds, tabId, tabUrl, send]);
  // Pins that App already knows.
  const pin = useCallback((name: CompactPin, on: boolean) => send({ type: 'pin', pin: name, on }), [send]);
  useEffect(() => { pin('popup', popupOpen); }, [popupOpen, pin]);
  useEffect(() => { pin('drag', dragging); }, [dragging, pin]);
  useEffect(() => { pin('address', addressFocused); }, [addressFocused, pin]);
  // The window's own signals: the pointer over the chrome (a real move, so a row that grows under a resting pointer does not
  // hold itself open), a click in an Acira page below the chrome, Ctrl+Tab and Esc from the keyboard, the window losing focus.
  useEffect(() => {
    // Compared with the machine's own pin (a keyboard expansion drops it while the pointer rests), so the next real move pins again.
    const setOver = (value: boolean) => { if (value !== machine.current.pins.includes('pointer')) pin('pointer', value); };
    const move = (event: PointerEvent) => { if (event.movementX || event.movementY) setOver(event.clientY >= 0 && event.clientY < live.current.chromeBottom); };
    const leave = () => setOver(false);
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.clientY < live.current.chromeBottom || event.target.closest('.popup-surface,[data-popup-trigger]')) return;
      send({ type: 'page' });
    };
    const key = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.key === 'Tab') send({ type: 'cycle' });
      else if (event.key === 'Escape') send({ type: 'escape' });
    };
    const press = () => { pressing.current = true; };
    // After the release's click has been dispatched (the next task), the held phase change plays.
    const release = () => {
      pressing.current = false;
      const show = held.current; held.current = null;
      if (show !== null) setTimeout(() => { if (!pressing.current) play(show); else held.current = show; }, 0);
    };
    const blur = () => { release(); send({ type: 'blur' }); };
    const unsubscribe = runtime.subscribeBrowser(event => {
      if (event.type !== 'shortcut') return;
      if (event.command === 'cycle-reveal') send({ type: 'cycle' });
      else if (event.command === 'escape') send({ type: 'escape' });
    });
    window.addEventListener('pointerdown', press, true); window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true);
    window.addEventListener('pointermove', move, true); document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', press, true); window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('pointermove', move, true); document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur);
    };
  }, [send, pin, play]);
  return { expanded: enabled && expanded, send };
}
