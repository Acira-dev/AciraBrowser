import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from '../../components/AppIcons';

export type RowMenuItem = { id: string; label: string; hint?: ReactNode; icon?: ReactNode; danger?: boolean; onSelect: () => void } | 'separator';

/** The "…" menu of a Rewind row or card: the house menu surface (panels.css, 8px panel, 30px rows, 4px row radius), anchored to its button,
 *  opening from the button's corner with a quick fade and settle (transform and opacity only; skipped when opened from the keyboard).
 *  Arrow keys walk the rows, Enter picks, Esc closes and gives the focus back. Rendered into the app root so no list around it can clip it. */
export function RowMenu({ label, items, className = '' }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false), [fromKeyboard, setFromKeyboard] = useState(false), [box, setBox] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect(), width = 248, height = items.reduce((sum, item) => sum + (item === 'separator' ? 9 : 30), 8);
    const below = window.innerHeight - rect.bottom - 12, up = below < height && rect.top > below;
    setBox({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  }, [open, items]);
  // Opened from the keyboard the first row is highlighted; opened with the pointer nothing is until an arrow key (the panel holds the focus).
  useEffect(() => { if (open && box.left) (fromKeyboard ? panel.current?.querySelector<HTMLElement>('[role=menuitem]') : panel.current)?.focus({ preventScroll: true }); }, [open, box.left]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss); document.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); document.removeEventListener('scroll', dismiss, true); };
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    const rows = [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])], at = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') rows[at < 0 ? 0 : (at + 1) % rows.length]?.focus();
    else if (event.key === 'ArrowUp') rows[at < 0 ? rows.length - 1 : (at - 1 + rows.length) % rows.length]?.focus();
    else if (event.key === 'Home') rows[0]?.focus();
    else if (event.key === 'End') rows.at(-1)?.focus();
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') { close(false); return; }
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  const menu = open && <div ref={panel} className="acira-panel rwp-menu" role="menu" tabIndex={-1} aria-label={label} data-from-keyboard={fromKeyboard || undefined} data-up={box.bottom !== undefined || undefined} style={{ position: 'fixed', ...box, visibility: box.left ? 'visible' : 'hidden' }} onKeyDown={keys}>
    {items.map((item, index) => item === 'separator' ? <hr key={`s${index}`} className="acira-menu-sep" /> : <button key={item.id} type="button" role="menuitem" className={`acira-menu-row${item.danger ? ' acira-menu-row-danger' : ''}`} onClick={() => { close(); item.onSelect(); }}>
      <span className="rwp-menu-icon" aria-hidden>{item.icon}</span><span className="acira-menu-title">{item.label}</span>{item.hint ? <span className="rwp-menu-hint">{item.hint}</span> : <span />}
    </button>)}
  </div>;
  return <>
    <button ref={trigger} type="button" className={`lib-icon ${className}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
      onClick={event => { setFromKeyboard(event.detail === 0); setOpen(value => !value); }}><MoreHorizontal size={14} /></button>
    {menu && createPortal(menu, document.querySelector('.app') ?? document.body)}
  </>;
}
