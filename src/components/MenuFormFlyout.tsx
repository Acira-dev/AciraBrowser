import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Chevron } from './PanelParts';
import { X } from './AppIcons';
import { menuFormGeometry } from '../ui/menuFormGeometry';
import { useMenuFormBackdrop } from '../ui/useMenuFormBackdrop';
import { t } from '../i18n';
import '../styles/menu-form.css';

type Placement = ReturnType<typeof menuFormGeometry>;

/** A deliberately activated child form. The parent keeps its position; native
 * hosting listens for the bounds event and includes this surface in its crop. */
export function MenuFormFlyout({ title, children, disabled = false, icon }: {
  title: string; children: (close: () => void) => ReactNode; disabled?: boolean; /** The row's glyph in the menu's icon column (an empty slot when absent). */ icon?: ReactNode;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false), [placement, setPlacement] = useState<Placement>();
  const [host, setHost] = useState<Element | null>(null);
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useMenuFormBackdrop({trigger,panel,canvas,open,host,bounds:placement?.bounds,onRetire:()=>close(false)});
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const owner = trigger.current.closest('.popup-surface'), app = trigger.current.closest('.app');
    if (!owner || !app) return;
    setHost(app.querySelector('.native-popup-stage') || app);
    const place = () => {
      const button = trigger.current;
      if (!button?.isConnected) return;
      const rect = owner.getBoundingClientRect(), source = button.getBoundingClientRect();
      const height = panel.current ? Math.ceil(panel.current.scrollHeight) : 240;
      const upwards = owner.getAttribute('data-sheet-origin')?.startsWith('bottom');
      const next = menuFormGeometry(rect, source, { width: innerWidth, height: innerHeight }, height, getComputedStyle(button).direction === 'rtl', {top: upwards ? 40 : Math.max(40, rect.top), bottom: upwards ? rect.bottom : innerHeight - 12});
      setPlacement(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      window.dispatchEvent(new CustomEvent('acira-menu-form-bounds', { detail: { id, bounds: next.bounds } }));
    };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(false); };
    window.dispatchEvent(new CustomEvent('acira-menu-form-open', { detail: id }));
    window.addEventListener('acira-menu-form-open', other);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place); observer.observe(owner);
    if (panel.current) observer.observe(panel.current);
    place();
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true); window.removeEventListener('acira-menu-form-open', other);
      window.dispatchEvent(new CustomEvent('acira-menu-form-bounds', { detail: { id, bounds: null } }));
    };
  }, [open, host, id]);
  useLayoutEffect(() => {
    if (!open || !host) return;
    const root = panel.current;
    let remembered:HTMLElement|null=null;
    const remember = (event:FocusEvent) => { if(event.target instanceof HTMLElement)remembered=event.target; };
    const focus = () => { if (!root || root.inert || root.style.visibility === 'hidden') return; (remembered?.isConnected&&!remembered.matches(':disabled')?remembered:root.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || root.querySelector<HTMLElement>('button:not(:disabled)') || root).focus({ preventScroll: true }); };
    const cancelWarming = (event:KeyboardEvent) => { if(event.key==='Escape'&&root?.dataset.formMaterial==='warming'){event.preventDefault();event.stopPropagation();close();} };
    root?.addEventListener('focusin',remember);focus();root?.addEventListener('acira-menu-form-ready', focus);window.addEventListener('keydown',cancelWarming,true);
    return () => {root?.removeEventListener('focusin',remember);root?.removeEventListener('acira-menu-form-ready', focus);window.removeEventListener('keydown',cancelWarming,true);};
  }, [open, host]);
  return <>
    <button ref={trigger} type="button" className="acira-menu-row menu-form-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => open ? close() : setOpen(true)} onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setOpen(true); } }}>
      {icon??<span/>}<span className="acira-menu-title">{title}</span><Chevron/>
    </button>
    {open && host && placement && createPortal(<div ref={panel} id={id} className="menu-form-flyout" role="dialog" aria-label={title} tabIndex={-1} data-placement={placement.side}
      style={{ left: placement.bounds.x, top: placement.bounds.y, width: placement.bounds.width, maxHeight: placement.maxHeight }}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
          const items = [...(panel.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || [])].filter(node => node.getClientRects().length);
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="menu-form-material" aria-hidden="true"><canvas ref={canvas}/><div className="menu-form-tint"/></div>
      <header className="menu-form-heading"><h2>{title}</h2><button type="button" className="menu-form-close" aria-label={t('app.closeMenu')} onClick={() => close()}><X size={16}/></button></header>
      <div className="menu-form-body">{children(() => close())}</div>
    </div>, host)}
  </>;
}
