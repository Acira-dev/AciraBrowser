/* Beta 14 (reported 17 Nov): what a thing that tilts with the pointer (the member card, the seal's live coin) hears from the pointer. The page is the trackpad: every pointer move anywhere over the page aims it, not
   only a move over the thing itself; when the pointer leaves the window it goes back to rest (the caller eases it there); and, if the thing can be dragged, a press on it captures the pointer, so the moves go on
   outside the thing and outside the window, and the release ends it. Nothing here moves keyboard focus, and a plain click on the thing (or on any other control) still clicks.
   The caller keeps its own motion rules (reduced motion, Off): this only reports where the pointer is. Returns the function that takes every listener off again. */
export interface FollowPointer {
  /** The pointer is at (clientX, clientY): anywhere over the page, and, while a press on `press` is held, anywhere at all. */
  aim: (clientX: number, clientY: number) => void;
  /** Back to rest: the pointer left the page, or a held press ended outside it. */
  rest: () => void;
  /** A press on this element is a drag (see above). Without it the pointer is only followed. */
  press?: HTMLElement | null;
}

export function followPointer({ aim, rest, press }: FollowPointer): () => void {
  let held: number | null = null, startX = 0, startY = 0, dragged = false;
  const root = document.documentElement;
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
  const move = (event: PointerEvent) => {
    if (held === event.pointerId && !dragged && Math.hypot(event.clientX - startX, event.clientY - startY) > 4) dragged = true;
    aim(event.clientX, event.clientY);
  };
  const leave = () => { if (held === null) rest(); };
  const down = (event: PointerEvent) => {
    if (!press || held !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    try { press.setPointerCapture(event.pointerId); held = event.pointerId; startX = event.clientX; startY = event.clientY; dragged = false; } catch { /* no capture here: the pointer is followed as it always was */ }
  };
  const end = (event: PointerEvent) => {
    if (held === null || event.pointerId !== held) return;
    held = null;
    try { press?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    // the click that follows a real drag is not a click on the thing (it would enlarge or close it): swallowed, once
    if (dragged) window.setTimeout(() => { dragged = false; }, 0);
    if (outside(event.clientX, event.clientY)) rest();
  };
  const click = (event: Event) => { if (dragged) { dragged = false; event.stopPropagation(); event.preventDefault(); } };
  const noFocus = (event: MouseEvent) => event.preventDefault();   // a press does not take the keyboard focus (a button would); the click still follows
  window.addEventListener('pointermove', move);
  window.addEventListener('pointercancel', leave);
  root.addEventListener('pointerleave', leave);
  if (press) {
    press.addEventListener('pointerdown', down); press.addEventListener('pointerup', end); press.addEventListener('pointercancel', end); press.addEventListener('lostpointercapture', end);
    press.addEventListener('mousedown', noFocus); press.addEventListener('click', click, true);
  }
  return () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointercancel', leave); root.removeEventListener('pointerleave', leave);
    if (press) {
      press.removeEventListener('pointerdown', down); press.removeEventListener('pointerup', end); press.removeEventListener('pointercancel', end); press.removeEventListener('lostpointercapture', end);
      press.removeEventListener('mousedown', noFocus); press.removeEventListener('click', click, true);
      if (held !== null) { try { press.releasePointerCapture(held); } catch { /* gone */ } held = null; }
    }
  };
}
