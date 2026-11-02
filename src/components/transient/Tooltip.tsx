import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTooltip,tooltipWidthLimit,type TooltipSide } from '../../ui/tooltipPlacement';
import '../../styles/transient.css';
import { tipKeyAction } from './tooltipKeys';
import { pageCoversTip, parseTip, type ParsedTip } from './tooltipParse';

/** The one tooltip (bible §4, I's PREMIUM_COMPONENTS §9): an inverted chip (rgb 24 24 27, #f4f4f5 text, 1px ring) that
 * slides 4px and fades in from its trigger's side over 140ms expo-out. First show after 500ms; within 300ms of the last one
 * it shows at once, so sweeping a toolbar feels instant. It takes over the `title` of chrome controls in this renderer
 * (the title moves to data-tip-title while hovered, so the OS tooltip never doubles it, and comes back on leave). A
 * website's native view covers this layer, so a tooltip that would land on it goes above or beside its trigger; when no
 * side is free the title is handed back and the OS tooltip shows instead. */

const SELECTOR = 'button[title], a[title], [role="button"][title], [role="tab"][title], [data-tip], [data-tip-title]';
const FIRST_DELAY = 500, SKIP_WINDOW = 300, GAP = 8, EDGE = 8, MAX_WIDTH = 300;
type Side = 'below' | 'above' | 'right' | 'left';
interface Tip { text: string; key?: string; description?: string; x: number; y: number; side: Side; id: number; wrap: boolean; width: number }

/** One tooltip for every label and every explanation (R3-05, founder: the (i) buttons showed two different tips, a long
 * single line on hover and a dark box on click). A short label is one line; anything wider than 300px, and every info
 * button (`data-tip-wrap`), wraps inside a 300px card with 8–10px of padding, 2–3 lines, placed with the same edge
 * clamping. An info button also has `data-tip-pin`: hover and keyboard focus show the tip, a click keeps it open (and a
 * second click, Esc, scrolling or any other click closes it), in the same look. */

/** "Name · Ctrl+T" (controlTitle) becomes the name and a key cap; a second line is the description (tooltipParse.ts). The
 * measuring node and the shown tip are built the same way, so what is measured is what is drawn. */
function fill(node: HTMLElement, tip: { text: string; key?: string; description?: string }) {
  const cap = (key: string) => { const kbd = document.createElement('kbd'); kbd.textContent = key; return kbd; };
  if (!tip.description) { node.replaceChildren(document.createTextNode(tip.text), ...(tip.key ? [cap(tip.key)] : [])); node.removeAttribute('data-desc'); return; }
  const head = document.createElement('span'), title = document.createElement('span'), desc = document.createElement('span');
  head.className = 't-tip-head'; title.className = 't-tip-title'; desc.className = 't-tip-desc';
  title.textContent = tip.text; desc.textContent = tip.description;
  head.append(title, ...(tip.key ? [cap(tip.key)] : []));
  node.replaceChildren(head, desc); node.setAttribute('data-desc', '');
}

export function TooltipHost({ blockPage }: { blockPage: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const measure = useRef<HTMLDivElement | null>(null), block = useRef(blockPage);
  block.current = blockPage;
  useEffect(() => {
    let serial = 0, timer: ReturnType<typeof setTimeout> | undefined, current: HTMLElement | null = null, shown = false, lastHide = 0, pinned: HTMLElement | null = null, refreshing = false;
    // A tip carried in data-tip that changes while it is showing (the update download's progress) is redrawn in place: same chip, no new entrance.
    const watcher = new MutationObserver(() => { if (!shown || !current?.isConnected) return; refreshing = true; try { show(current); } finally { refreshing = false; } });
    // A control inside another titled element (a tab's close button inside the tab) holds the ancestors' titles too while
    // it is hovered, or the OS shows the tab's tooltip beside the chip (M, P04: one tooltip per control).
    const held: HTMLElement[] = [];
    const suppress = (el: HTMLElement) => {
      if (el.hasAttribute('title')) { el.dataset.tipTitle = el.getAttribute('title')!; el.removeAttribute('title'); }
      for (let up = el.parentElement?.closest<HTMLElement>('[title]'); up; up = up.parentElement?.closest<HTMLElement>('[title]')) { up.dataset.tipHeld = up.getAttribute('title')!; up.removeAttribute('title'); held.push(up); }
    };
    const restore = (el: HTMLElement) => {
      if (el.dataset.tipTitle !== undefined) { el.setAttribute('title', el.dataset.tipTitle); delete el.dataset.tipTitle; }
      for (const up of held.splice(0)) if (up.dataset.tipHeld !== undefined) { up.setAttribute('title', up.dataset.tipHeld); delete up.dataset.tipHeld; }
    };
    const hide = () => {
      clearTimeout(timer);
      watcher.disconnect();
      pinned = null;
      if (current) restore(current);
      current = null;
      if (shown) { shown = false; lastHide = performance.now(); setTip(null); }
    };
    /** Places the chip on the first free side; false when every side would land on the website's native view. */
    const show = (el: HTMLElement) => {
      const raw = el.dataset.tip || el.dataset.tipTitle || '';
      if (!raw.trim() || !el.isConnected || !measure.current) return false;
      const parsed = parseTip(raw);
      // A two-line tip is taller than a toolbar row: beside a button over a website it may find no free spot, and then the
      // title and its keys (one line, which does fit) are better than the system's raw tooltip.
      return place(el, parsed) || (!!parsed.description && place(el, { text: parsed.text, ...(parsed.key ? { key: parsed.key } : {}) }));
    };
    const place = (el: HTMLElement, parsed: ParsedTip) => {
      const node = measure.current!, { text, key, description } = parsed, r = el.getBoundingClientRect();
      const page = pageCoversTip(block.current, !!el.closest('.setup-dialog')) ? document.querySelector('.page-area')?.getBoundingClientRect() ?? null : null;
      node.style.maxWidth = `${Math.min(MAX_WIDTH,tooltipWidthLimit(r,page,innerWidth))}px`;
      fill(node, parsed);
      // Measured as one line first; an info button, or anything wider than 300px, wraps inside the 300px card.
      node.removeAttribute('data-wrap');
      let w = node.offsetWidth;
      const wrap = !description && (el.hasAttribute('data-tip-wrap') || w > MAX_WIDTH || node.scrollWidth > node.clientWidth);
      if (wrap) { node.setAttribute('data-wrap', ''); w = node.offsetWidth; }
      const h = node.offsetHeight;
      const root = document.documentElement, style = getComputedStyle(el.closest('.app') || root);
      const captionWidth = parseFloat(getComputedStyle(root).getPropertyValue('--caption-width'));
      // macOS controls sit at the left; App's insets already compensate for interface zoom.
      const caption = root.dataset.platform === 'darwin'
        ? {left:0,right:parseFloat(style.getPropertyValue('--mac-caption-space'))||86,top:0,bottom:parseFloat(style.getPropertyValue('--mac-caption-top'))||32}
        : {left:innerWidth-(Number.isFinite(captionWidth)?captionWidth:138),right:innerWidth,top:0,bottom:40};
      const choice = placeTooltip(r,w,{width:innerWidth,height:innerHeight},page,caption,h,!!el.closest('.acira-sidebar .sb-tab,.acira-sidebar .sb-bookmark,.acira-sidebar .sb-folder'));
      if (!choice) return false;
      shown = true;
      setTip({ text, ...(key ? { key } : {}), ...(description ? { description } : {}), ...choice, id: refreshing ? serial : ++serial, wrap, width:w });
      return true;
    };
    const arm = (el: HTMLElement, delay: number) => {
      hide();
      current = el;
      watcher.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
      suppress(el);
      timer = setTimeout(() => { if (current === el && !show(el)) restore(el); }, delay);
    };
    const over = (event: Event) => {
      if (current && !current.isConnected) hide(); // its step or page unmounted under the pointer (R4-10): forget it
      const el = (event.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (!el || el === current) return;
      arm(el, performance.now() - lastHide < SKIP_WINDOW ? 0 : FIRST_DELAY);
    };
    const out = (event: Event) => {
      const next = (event as PointerEvent).relatedTarget as Node | null;
      if (current && next && current.contains(next)) return;
      if (pinned && current === pinned) return; // a click keeps an info tip open
      hide();
    };
    const pinTarget = (event: Event) => (event.target as Element | null)?.closest?.('[data-tip-pin]') as HTMLElement | null;
    // A pointer press hides the tip, except on an info button, whose click toggles it.
    const down = (event: Event) => { if (!pinTarget(event)) hide(); };
    const click = (event: Event) => {
      const el = pinTarget(event); if (!el) return;
      if (current && !current.isConnected) hide();
      if (pinned === el) { hide(); return; }
      if (current !== el) arm(el, 0);
      else if (!shown) { clearTimeout(timer); if (!show(el)) restore(el); }
      pinned = el;
    };
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement, el = target?.closest?.(SELECTOR) as HTMLElement | null;
      if (el && target.matches(':focus-visible')) arm(el, 0);
    };
    // Any key hides the tip; Esc on a pinned info tip is used up doing so (tooltipKeys.ts), so it never also skips setup or closes a popup.
    const key = (event: KeyboardEvent) => {
      const action = tipKeyAction(event.key, shown, pinned !== null);
      hide();
      if (action === 'consume') { event.preventDefault(); event.stopPropagation(); }
    };
    const options = true;
    document.addEventListener('pointerover', over, options);
    document.addEventListener('pointerout', out, options);
    document.addEventListener('focusin', focus, options);
    document.addEventListener('focusout', hide, options);
    document.addEventListener('pointerdown', down, options);
    document.addEventListener('click', click, options);
    document.addEventListener('keydown', key, options);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, options);
    return () => {
      hide();
      document.removeEventListener('pointerover', over, options); document.removeEventListener('pointerout', out, options);
      document.removeEventListener('focusin', focus, options); document.removeEventListener('focusout', hide, options);
      document.removeEventListener('pointerdown', down, options); document.removeEventListener('click', click, options); document.removeEventListener('keydown', key, options);
      window.removeEventListener('blur', hide); window.removeEventListener('resize',hide); window.removeEventListener('scroll', hide, options);
    };
  }, []);
  return createPortal(<>
    <div ref={measure} className="t-tip t-tip-measure" aria-hidden="true"/>
    {tip && <div key={tip.id} className="t-tip" role="tooltip" data-side={tip.side} data-wrap={tip.wrap || undefined} data-desc={tip.description ? '' : undefined} style={{ left: tip.x, top: tip.y, width:tip.width }}>{tip.description ? <><span className="t-tip-head"><span className="t-tip-title">{tip.text}</span>{tip.key && <kbd>{tip.key}</kbd>}</span><span className="t-tip-desc">{tip.description}</span></> : <>{tip.text}{tip.key && <kbd>{tip.key}</kbd>}</>}</div>}
  </>, document.body);
}
