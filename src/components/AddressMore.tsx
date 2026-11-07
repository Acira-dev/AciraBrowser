import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPillDwell, pillMotion, pointInside } from '../ui/addressInSidebar';
import { publishAddressSidebar } from '../ui/addressSidebarStore';

/** The thin pill under the address field, and the row of the toolbar's other buttons it opens into (address bar in the sidebar).
 * The pill is a 4 px line; it opens when the pointer rests on it (350 ms), on a click, or when it is tabbed to, and it closes when
 * the pointer has left for 450 ms, on a press outside or on Esc. A menu opened from the row keeps it open. The line, the row and the
 * sidebar's content below are one shape on one number (--addr-t), eased by Acira's morph spring; see address-in-sidebar.css. */
export function AddressMore({ label, held, scale, children }: { label: string; /** A menu from the row is open. */ held: boolean; /** The animation-speed multiplier. */ scale: number; children: ReactNode }) {
  const [open, setOpen] = useState(false), openRef = useRef(false), heldRef = useRef(held), inside = useRef(false), wrap = useRef<HTMLDivElement>(null);
  openRef.current = open; heldRef.current = held;
  const dwell = useMemo(() => createPillDwell({ isOpen: () => openRef.current, setOpen: next => { openRef.current = next; setOpen(next); }, held: () => heldRef.current }), []);
  useEffect(() => () => dwell.stop(), [dwell]);
  useEffect(() => { if (!held) dwell.released(); }, [held, dwell]);
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
  const still = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => pointInside(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
  return (
    <div ref={wrap} className="sb-addr-more" data-open={open || undefined}
      onPointerEnter={() => { inside.current = true; dwell.enter(); }}
      onPointerMove={() => { if (!inside.current) { inside.current = true; } dwell.move(); }}
      onPointerLeave={event => { const still_ = still(event); if (!still_) inside.current = false; dwell.leave(still_); }}
      onFocus={event => { if (!openRef.current && event.target instanceof Element && event.target.matches(':focus-visible')) dwell.toggle(); }}
      onBlur={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) dwell.leave(inside.current); }}>
      <div className="sb-addr-shape"><div className="sb-addr-more-in" inert={!open || undefined}>{children}</div></div>
      <button type="button" className="sb-addr-pill" aria-expanded={open} aria-label={label} onClick={() => dwell.toggle()}/>
    </div>
  );
}
