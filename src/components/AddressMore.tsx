import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PILL_LINE, createPillDwell, pillMotion, pointInside, pressKeepsFieldFocus, type PillSample } from '../ui/addressInSidebar';
import { publishAddressSidebar } from '../ui/addressSidebarStore';

/** The thin pill under the address field, and the row of the toolbar's other buttons it opens into (address bar in the sidebar).
 * The pill is a 4 px line; it opens when the pointer RESTS on it (a short rest, or a slow pointer: ui/addressInSidebar.ts `createPillDwell`; a pointer just
 * passing over opens nothing), on a click, or when it is tabbed to, and it closes when the pointer has left for 450 ms, on a press outside or on Esc. A menu opened
 * from the row keeps it open. The line, the row and the sidebar's content below are one shape on one number (--addr-t), eased by Acira's morph spring; see
 * address-in-sidebar.css.
 *
 * The address field can be in use meanwhile (beta.12, item 30): the pill stays where it is, and the row opens over it with the field's focus and selection
 * untouched. A press on the pill or the row never takes the focus from the field (mousedown is not default-handled; the click still goes through). Only the
 * open suggestion list, which hangs over this place, hides the pill and keeps the row shut (`suggesting`). */
export function AddressMore({ label, held, suggesting, scale, children }: { label: string; /** A menu from the row is open. */ held: boolean; /** The address suggestions are open: their list hangs over the pill's place. */ suggesting: boolean; /** The animation-speed multiplier. */ scale: number; children: ReactNode }) {
  const [open, setOpen] = useState(false), openRef = useRef(false), heldRef = useRef(held), suggestingRef = useRef(suggesting), inside = useRef(false), wrap = useRef<HTMLDivElement>(null);
  openRef.current = open; heldRef.current = held; suggestingRef.current = suggesting;
  const dwell = useMemo(() => createPillDwell({ isOpen: () => openRef.current, setOpen: next => { openRef.current = next; setOpen(next); }, held: () => heldRef.current }), []);
  useEffect(() => () => dwell.stop(), [dwell]);
  useEffect(() => { if (!held) dwell.released(); }, [held, dwell]);
  // The suggestion list hangs over the pill's place: a row open under it closes with it, and nothing opens while it is there.
  useEffect(() => { if (suggesting) dwell.dismiss(); }, [suggesting, dwell]);
  // The sidebar leaves room while this is mounted and slides its content down while the row is open.
  useLayoutEffect(() => { publishAddressSidebar({ block: true, open }); }, [open]);
  useLayoutEffect(() => () => publishAddressSidebar({ block: false, open: false }), []);
  // The two springs, as CSS (the pill and the sidebar read the same values).
  useLayoutEffect(() => {
    const motion = pillMotion(scale), root = document.documentElement;
    root.style.setProperty('--addr-open-dur', motion.openMs + 'ms'); root.style.setProperty('--addr-open-ease', motion.openEase);
    root.style.setProperty('--addr-close-dur', motion.closeMs + 'ms'); root.style.setProperty('--addr-close-ease', motion.closeEase);
  }, [scale]);
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (!(event.target instanceof Node && wrap.current?.contains(event.target))) dwell.dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dwell.dismiss(); };
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [open, dwell]);
  // The pill's hit area is taller than the 10 px it takes in the layout (PILL_LINE.zone): "still inside" is measured against that.
  const still = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => { const rect = event.currentTarget.getBoundingClientRect(); return pointInside({ left: rect.left, right: rect.right, top: rect.top, bottom: Math.max(rect.bottom, rect.top + PILL_LINE.zone) }, event.clientX, event.clientY); };
  const sample = (event: { clientX: number; clientY: number; timeStamp: number }): PillSample => ({ x: event.clientX, y: event.clientY, t: event.timeStamp });
  return (
    <div ref={wrap} className="sb-addr-more" data-open={open || undefined} data-suggesting={suggesting || undefined}
      onPointerEnter={event => { if (suggestingRef.current) return; inside.current = true; dwell.enter(sample(event)); }}
      onPointerMove={event => { if (suggestingRef.current) return; if (!inside.current) { inside.current = true; } dwell.move(sample(event)); }}
      onPointerLeave={event => { const still_ = still(event); if (!still_) inside.current = false; dwell.leave(still_); }}
      // A press here (the pill, the row's buttons) leaves the keyboard focus where it is: the address field keeps its caret and selection. The click is not affected.
      onMouseDown={event => { if (pressKeepsFieldFocus(event.target as Element)) event.preventDefault(); }}
      onFocus={event => { if (!openRef.current && !suggestingRef.current && event.target instanceof Element && event.target.matches(':focus-visible')) dwell.toggle(); }}
      onBlur={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) dwell.leave(inside.current); }}>
      <div className="sb-addr-shape"><div className="sb-addr-more-in" inert={!open || undefined}>{children}</div></div>
      <button type="button" className="sb-addr-pill" aria-expanded={open} aria-label={label} onClick={() => dwell.toggle()}/>
    </div>
  );
}
