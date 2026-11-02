import '../styles/disclosure.css';
import { followersOf, motionSpeed, springNow } from './sharedMotion';
import { springAt, type SpringSpec } from './springs';

/** Native disclosures (`<details>` in Settings, the extension manager, error pages) open and close without a cut (R3-70).
 * Opening reveals the content from the top while everything below slides down by the same amount, so the content's lower
 * edge and the next element's top edge are one line all the way; closing holds the content on screen (`data-motion-hold`,
 * disclosure.css) while the line sweeps back up, then lets go in the frame it arrives. Nothing is scaled, so text is never
 * distorted: only a clip on the content and `translate` on what follows.
 *
 * One spring drives both from one `requestAnimationFrame` loop. They are written in the same frame on purpose: a clip
 * animation runs on the main thread and a translate animation on the compositor, and when the page's layout is busy the
 * two drift apart (measured: the next block moved 170px while the clip had not started, so text overlapped). The progress
 * `p` (0 closed, 1 open) is a scalar with a position and a speed, so a click in mid-flight retargets it and the sweep
 * turns round without a jump. Off does nothing; popups are skipped (their plate resizes by itself). */
const skip = '.browser-popup,.popup-surface,[data-no-disclosure-motion]';

interface Part { el: HTMLElement; offset: number; height: number }
interface Sweep { details: HTMLDetailsElement; parts: Part[]; total: number; followers: HTMLElement[]; p: number; v: number; target: 0 | 1; spec: SpringSpec | null; started: number; frame: number }
const sweeps = new WeakMap<HTMLDetailsElement, Sweep>();

function draw(sweep: Sweep, p: number): void {
  const clamped = Math.max(0, Math.min(1, p)), open = p >= .9995, reveal = sweep.total * clamped;
  for (const { el, offset, height } of sweep.parts) {
    const visible = Math.max(0, Math.min(height, reveal - offset));
    el.style.clipPath = open ? '' : `inset(0px -8px ${(height - visible).toFixed(2)}px -8px)`;
  }
  for (const el of sweep.followers) el.style.translate = open ? '' : `0px ${(-sweep.total * (1 - clamped)).toFixed(2)}px`;
}
function finish(sweep: Sweep): void {
  cancelAnimationFrame(sweep.frame); sweeps.delete(sweep.details);
  for (const { el } of sweep.parts) el.style.clipPath = '';
  for (const el of sweep.followers) el.style.translate = '';
  sweep.details.removeAttribute('data-motion-hold');
}
function tick(sweep: Sweep, now: number): void {
  if (!sweep.spec) { finish(sweep); return; }
  const state = springAt(sweep.spec, sweep.p, sweep.target, Math.max(0, now - sweep.started) / 1000, sweep.v);
  draw(sweep, state.value);
  if (Math.abs(state.value - sweep.target) < .002 && Math.abs(state.velocity) < .02) { draw(sweep, sweep.target); finish(sweep); return; }
  sweep.frame = requestAnimationFrame(next => tick(sweep, next));
}
/** Send the sweep to `target` from where it is drawn now, with the speed it has. */
function aim(sweep: Sweep, target: 0 | 1, now = performance.now()): void {
  cancelAnimationFrame(sweep.frame);
  if (sweep.spec) { const state = springAt(sweep.spec, sweep.p, sweep.target, Math.max(0, now - sweep.started) / 1000, sweep.v); sweep.p = state.value; sweep.v = state.velocity; }
  sweep.target = target; sweep.started = now; sweep.spec = springNow(target ? 'panel.expand' : 'panel.collapse', true);
  tick(sweep, now);
}

/** Called in the frame after the click, when the browser has toggled the element (a closing one is held open by CSS). */
function begin(details: HTMLDetailsElement, summary: Element, opening: boolean): void {
  const content = ([...details.children] as HTMLElement[]).filter(child => child !== summary && child.getClientRects().length > 0);
  const release = () => details.removeAttribute('data-motion-hold');
  if (!content.length) { release(); return; }
  const boxes = content.map(node => node.getBoundingClientRect()), top = Math.min(...boxes.map(box => box.top)), total = Math.max(...boxes.map(box => box.bottom)) - top;
  if (total < 1) { release(); return; }
  const sweep: Sweep = { details, parts: content.map((el, index) => ({ el, offset: boxes[index].top - top, height: boxes[index].height })), total, followers: followersOf(details), p: opening ? 0 : 1, v: 0, target: opening ? 1 : 0, spec: null, started: performance.now(), frame: 0 };
  sweeps.set(details, sweep);
  draw(sweep, sweep.p);
  aim(sweep, sweep.target);
}

export function installDisclosureMotion(): () => void {
  if (typeof document === 'undefined') return () => {};
  const onClick = (event: MouseEvent) => {
    const summary = (event.target as Element | null)?.closest?.('summary'), details = summary?.parentElement;
    if (!summary || !(details instanceof HTMLDetailsElement) || event.defaultPrevented || motionSpeed() === 'off' || details.closest(skip)) return;
    const running = sweeps.get(details), opening = !details.open;
    // The content of a closing element stays on screen until the sweep has finished.
    if (!opening) details.setAttribute('data-motion-hold', '');
    if (running) { requestAnimationFrame(() => { if (sweeps.get(details) === running) aim(running, opening ? 1 : 0); }); return; }
    requestAnimationFrame(() => { if (!sweeps.has(details)) begin(details, summary, opening); });
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
