import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, FolderOpen } from '../../components/AppIcons';
import { currentLocale, t, useT } from '../../i18n';
import type { EasyFileItem, EasyFilesOffer } from '../../runtime/types';
import { FileGlyph } from '../Library';
import { answerEasyFiles, forgetEasyFilesOffer, ownShown, useEasyFiles } from './store';
import { downloadsOf, EF, picturesOf, TILE } from './layout';
import './easy-files.css';

/**
 * Easy Files (Beta 14, section AB): the pop-up a page's upload button opens.
 *   Pictures   one row of 112 x 70 tiles (the clipboard picture first, then the newest screenshots) that scrolls sideways only.
 *   Downloads  rows with a real preview, the name with an end ellipsis, size and age.
 *   Browse all files…  the system window.
 * One click attaches (with several allowed: a click ticks, "Attach 3" attaches); Esc or a click away cancels, and the page's input hears it.
 * Keys: Left/Right between the tiles, Up/Down between the row and the list, Enter picks (or ticks), Ctrl/Cmd+Enter attaches the ticked, Esc cancels.
 */
export function sizeText(bytes: number) {
  const number = (value: number, digits: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: digits }).format(value);
  return bytes < 1024 ? `${number(bytes, 0)} B` : bytes < 1024 * 1024 ? `${number(Math.round(bytes / 1024), 0)} KB` : `${number(Math.round(bytes / 1024 / 1024 * 10) / 10, bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
/** "Just now", "18 min ago", "1 h 12 min ago" (under six hours the minutes stay, so a row of hour-old screenshots does not all read "1 h ago"), "5 h ago", "Yesterday", then the date. */
export function ageText(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) return t('easyfiles.justNow');
  if (minutes < 60) return t('easyfiles.minAgo', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 && hours < 6 ? t('easyfiles.hMinAgo', { hours, minutes: minutes % 60 }) : t('easyfiles.hAgo', { hours });
  if (hours < 48) return t('easyfiles.yesterday');
  return new Date(at).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' });
}

function Thumb({ item, src, kind, ticked }: { item: EasyFileItem; src?: string; kind: 'row' | 'tile'; ticked?: boolean }) {
  // A picture that was ready when the pop-up opened is simply there; one that arrives afterwards fades in over the quiet tint.
  const first = useRef(Boolean(src));
  return <span className={`ef-thumb ef-thumb-${kind}`} data-picture={src ? '' : undefined} data-ticked={ticked || undefined} aria-hidden="true">
    {src ? <img className="ef-img" src={src} alt="" draggable={false} data-late={first.current ? undefined : ''} /> : item.picture && kind === 'tile' ? null : <FileGlyph name={item.name} bare />}
    {ticked !== undefined && <span className="ef-tick"><Check size={11} strokeWidth={2.4} /></span>}
  </span>;
}

/** The picture row: native sideways scrolling that rests on whole tiles, a mouse wheel notch = one tile, a drag that follows the pointer, a soft fade only on a side with more to show. */
function PictureRow({ items, thumbs, ticked, multiple, choose }: { items: EasyFileItem[]; thumbs: Readonly<Record<string, string>>; ticked: ReadonlySet<string>; multiple: boolean; choose: (id: string) => void }) {
  const strip = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), dragged = useRef(0);
  const [edges, setEdges] = useState({ start: false, end: false }), [near, setNear] = useState(false);
  const step = TILE.w + EF.tileGap;
  // A right-to-left interface lays the row out from the right and scrollLeft is then 0 down to negative: everything below works on how far the row has moved from its
  // start (`moved`), and turns that back into a physical scroll position with `at`.
  const rtl = (el: HTMLElement) => getComputedStyle(el).direction === 'rtl';
  const measure = () => {
    const el = strip.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth, moved = Math.abs(el.scrollLeft), start = moved > 1, end = moved < max - 1;
    setEdges(previous => previous.start === start && previous.end === end ? previous : { start, end });
    if (bar.current && max > 0) { const share = el.clientWidth / el.scrollWidth; bar.current.style.width = `${share * 100}%`; bar.current.style.transform = `translateX(${(rtl(el) ? -1 : 1) * (moved / max) * (1 / share - 1) * 100}%)`; }
  };
  useLayoutEffect(measure, [items.length]);
  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const el = strip.current; if (!el) return;
    // A mouse wheel turns the row by exactly one tile per notch. A trackpad's sideways swipe is the native scroll (left alone); its slow vertical scroll over the row moves the
    // row sideways with the fingers instead of nothing. The row never scrolls down: it has no vertical overflow.
    let last = 0;
    const wheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const notch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 40;
      const way = rtl(el) ? -1 : 1;                                       // down the wheel = on to the next tile, whichever side the row starts on
      if (notch) { if (event.timeStamp - last < 60) return; last = event.timeStamp; el.scrollBy({ left: way * Math.sign(event.deltaY) * step, behavior: 'smooth' }); }
      else el.scrollBy({ left: way * event.deltaY });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [step]);
  // Dragging with the mouse follows the pointer one to one (snapping off while held), then settles on the nearest whole tile. A drag never picks a tile.
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = strip.current; if (!el || event.pointerType !== 'mouse' || event.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    const x0 = event.clientX, s0 = el.scrollLeft, id = event.pointerId; let moved = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) > 4) { moved = true; el.dataset.dragging = ''; try { el.setPointerCapture(id); } catch { /* released */ } }
      if (moved) el.scrollLeft = s0 - dx;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved) return;
      dragged.current = performance.now();
      const way = rtl(el) ? -1 : 1, target = way * Math.max(0, Math.min(el.scrollWidth - el.clientWidth, Math.round(Math.abs(el.scrollLeft) / step) * step));
      delete el.dataset.dragging;
      el.scrollTo({ left: target, behavior: 'smooth' });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const pick = (id: string) => { if (performance.now() - dragged.current < 350) return; choose(id); };
  return <div className="ef-row" data-near={near || undefined}
    onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const closeToEdge = box.bottom - event.clientY < 18; if (closeToEdge !== near) setNear(closeToEdge); }}
    onPointerLeave={() => setNear(false)}>
    <div ref={strip} className="ef-strip" role="list" data-fade-start={edges.start || undefined} data-fade-end={edges.end || undefined} onScroll={measure} onPointerDown={down}>
      {items.map(item => {
        const clipboard = item.section === 'clipboard', age = clipboard ? item.detail ?? '' : ageText(item.at), on = ticked.has(item.id);
        return <button key={item.id} type="button" role={multiple ? 'checkbox' : 'listitem'} aria-checked={multiple ? on : undefined} data-ef-tile data-ef-item className="ef-tile"
          title={clipboard ? t('easyfiles.clipboard') : item.name} aria-label={clipboard ? t('easyfiles.clipboardAria', { size: age }) : t('easyfiles.tileAria', { name: item.name, age })} onClick={() => pick(item.id)}>
          <Thumb item={item} src={thumbs[item.id]} kind="tile" ticked={multiple ? on : undefined} />
          <span className="ef-tile-cap">{clipboard ? t('easyfiles.clipboard') : age}</span>
        </button>;
      })}
    </div>
    {(edges.start || edges.end) && <div className="ef-bar" aria-hidden="true"><div ref={bar} className="ef-bar-thumb" /></div>}
  </div>;
}

/** One panel per request: a request that arrives while the last pop-up is still leaving gets a panel of its own (its own answered state and ticks), never the old one. */
export function EasyFilesPanel({ close }: { close: () => void }) {
  useT();
  // Each pop-up keeps the offer it opened for: while it is still leaving, the store may already hold the next request (the page asked again), and a panel that followed it would
  // answer for it when it unmounts (a cancel that closes the new pop-up).
  const own = useRef<ReturnType<typeof useEasyFiles> | null>(null);
  own.current = ownShown(own.current, useEasyFiles());
  const { offer, thumbs } = own.current;
  if (!offer) return null;
  return <EasyFilesBody key={offer.token} offer={offer} thumbs={thumbs} close={close} />;
}

function EasyFilesBody({ offer, thumbs, close }: { offer: EasyFilesOffer; thumbs: Readonly<Record<string, string>>; close: () => void }) {
  const answered = useRef(false), root = useRef<HTMLElement>(null), lastTile = useRef(0);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  // Closing without an answer (Esc, a click elsewhere, the tab changing, the window) is a cancel: the page's input hears 'cancel', as from the system window.
  // A late answer to a pop-up that is no longer the pending one is refused by its token, so this can never act on a newer request.
  useEffect(() => () => {
    if (!answered.current) void answerEasyFiles({ token: offer.token, type: 'cancel', reason: 'closed' });
    forgetEasyFilesOffer(offer.token);
  }, []);
  // The pop-up root holds focus when it opens: listen there, in the capture phase, so the very first arrow already lands in the panel's own model.
  const keysRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const host = root.current?.closest<HTMLElement>('.browser-popup'); if (!host) return;
    const on = (event: globalThis.KeyboardEvent) => keysRef.current(event);
    host.addEventListener('keydown', on, true);
    return () => host.removeEventListener('keydown', on, true);
  }, []);
  const { multiple } = offer, pictures = picturesOf(offer.items), files = downloadsOf(offer.items).slice(0, EF.maxDownloads);
  const finish = (request: Parameters<typeof answerEasyFiles>[0]) => { if (answered.current) return; answered.current = true; void answerEasyFiles(request); close(); };
  const choose = (id: string) => {
    if (!multiple) return finish({ token: offer.token, type: 'pick', ids: [id] });
    setTicked(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  };
  const attach = () => { const ids = offer.items.map(item => item.id).filter(id => ticked.has(id)); if (ids.length) finish({ token: offer.token, type: 'pick', ids }); };
  const browse = () => finish({ token: offer.token, type: 'browse' });
  const keys = (event: globalThis.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && multiple) { event.preventDefault(); event.stopPropagation(); attach(); return; }
    if (!/^(Arrow|Home$|End$)/.test(event.key)) return;
    root.current?.closest('[data-input-mode]')?.setAttribute('data-input-mode', 'keyboard');
    const tiles = [...(root.current?.querySelectorAll<HTMLElement>('[data-ef-tile]') || [])], rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-ef-row]') || [])];
    const active = document.activeElement as HTMLElement | null, host = root.current?.closest('.browser-popup');
    if (active && active !== host && !root.current?.contains(active)) return;
    const inRow = active ? tiles.indexOf(active) : -1, inList = active ? rows.indexOf(active) : -1, step = TILE.w + EF.tileGap;
    const focusTile = (index: number) => {
      const tile = tiles[Math.max(0, Math.min(tiles.length - 1, index))]; if (!tile) return false;
      const at = tiles.indexOf(tile); lastTile.current = at; tile.focus({ preventScroll: true });
      // The focused tile always sits in the second slot (the first when it is the first tile, the last ones at the end): clear of both fades.
      const strip = tile.parentElement as HTMLElement;
      strip.scrollTo({ left: (getComputedStyle(strip).direction === 'rtl' ? -1 : 1) * Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, step * (at - 1))), behavior: 'smooth' });
      return true;
    };
    const focusRow = (index: number) => { const row = rows[Math.max(0, Math.min(rows.length - 1, index))]; if (!row) return false; row.focus(); return true; };
    let handled = false;
    if (inRow >= 0) {
      // Left and Right are what the person sees: in a right-to-left interface the next tile is on the left.
      const next = (document.activeElement as HTMLElement | null)?.parentElement && getComputedStyle(document.activeElement!.parentElement!).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === (next === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight')) handled = focusTile(inRow - 1);
      else if (event.key === next) handled = focusTile(inRow + 1);
      else if (event.key === 'Home') handled = focusTile(0);
      else if (event.key === 'End') handled = focusTile(tiles.length - 1);
      else if (event.key === 'ArrowDown') handled = focusRow(0);
      else handled = event.key === 'ArrowUp';
    } else if (inList >= 0) {
      if (event.key === 'ArrowDown') handled = focusRow(inList + 1);
      else if (event.key === 'ArrowUp') handled = inList === 0 && tiles.length ? focusTile(lastTile.current) : focusRow(inList - 1);
      else handled = true;
    } else {
      // The first key lands on the first item that is fully in view (clear of the left fade), so the row never jumps back to its start.
      const strip = tiles[0]?.parentElement, firstClear = strip && Math.abs(strip.scrollLeft) > 0 ? Math.ceil((Math.abs(strip.scrollLeft) + 20) / step) : 0, forward = strip && getComputedStyle(strip).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      handled = event.key === forward || (event.key === 'ArrowDown' && tiles.length > 0) ? focusTile(firstClear) : focusRow(event.key === 'ArrowUp' || event.key === 'End' ? rows.length - 1 : 0);
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  keysRef.current = keys;
  const count = ticked.size;
  return <section ref={root} className="easy-files" aria-label={t('easyfiles.title')}>
    {pictures.length > 0 && <>
      <div className="acira-menu-label ef-label">{t('easyfiles.pictures')}</div>
      <PictureRow items={pictures} thumbs={thumbs} ticked={ticked} multiple={multiple} choose={choose} />
    </>}
    {files.length > 0 && <>
      <div className="acira-menu-label ef-label">{t('easyfiles.downloads')}</div>
      {files.map(item => {
        const on = ticked.has(item.id);
        return <button key={item.id} type="button" role={multiple ? 'checkbox' : undefined} aria-checked={multiple ? on : undefined} data-ef-row data-ef-item className="acira-menu-row acira-menu-row-identity ef-file" title={item.name} onClick={() => choose(item.id)}>
          <Thumb item={item} src={thumbs[item.id]} kind="row" ticked={multiple ? on : undefined} />
          <span className="ef-text"><span className="acira-menu-title" dir="auto">{item.name}</span><span className="acira-menu-sub">{sizeText(item.bytes)} · {ageText(item.at)}</span></span>
          <span />
        </button>;
      })}
    </>}
    {(pictures.length > 0 || files.length > 0) && <hr className="acira-menu-sep" />}
    {multiple && <button type="button" data-ef-row data-ef-item className="acira-menu-row ef-attach" disabled={count === 0} onClick={attach}><Check size={16} className="acira-menu-icon" /><span className="acira-menu-title">{count ? t('easyfiles.attachCount', { count }) : t('easyfiles.attach')}</span><span /></button>}
    <button type="button" data-ef-row data-ef-item className="acira-menu-row ef-browse" onClick={browse}><FolderOpen size={16} className="acira-menu-icon" /><span className="acira-menu-title">{t('easyfiles.browse')}</span><span /></button>
  </section>;
}
