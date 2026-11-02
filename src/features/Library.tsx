import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useListMotion } from '../ui/sharedMotion';
import { useT } from '../i18n';
import { useToastActive } from '../ui/toastActive';
import { Archive, Code2, FileText, Headphones, Package, Search, Table2, Terminal, X } from '../components/AppIcons';

import './library.css';

import { dayOffsets, daySpan } from './libraryModel';
export { dayOf, pageHost } from './libraryModel';

/** The frame shared by History, Bookmarks and Downloads: a left-aligned title, one search field that stays in reach, and the
 *  content. `/` focuses the search, Escape clears it, and the arrow keys walk the rows. */
export type UndoNotice = { message: string; undo: () => void };
/** One quiet "Deleted 6 visits · Undo" line at a time; it goes away by itself after ten seconds. */
export function useUndoNotice(): [UndoNotice | null, (message: string, undo: () => void) => void, () => void] {
  const [notice, setNotice] = useState<UndoNotice | null>(null), timer = useRef<number | undefined>(undefined);
  const dismiss = useCallback(() => { window.clearTimeout(timer.current); setNotice(null); }, []);
  const offer = useCallback((message: string, undo: () => void) => { window.clearTimeout(timer.current); setNotice({ message, undo }); timer.current = window.setTimeout(() => setNotice(null), 10000); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [notice, offer, dismiss];
}

export function LibraryPage({ title, description, count, search, actions, wide, notice, onDismissNotice, children }: {
  title: string; description: string; count?: string; actions?: ReactNode; wide?: boolean; children: ReactNode; notice?: UndoNotice | null; onDismissNotice?: () => void;
  search?: { label: string; placeholder: string; value: string; onChange: (value: string) => void; inputRef?: RefObject<HTMLInputElement | null> };
}) {
  const t = useT();
  const ownField = useRef<HTMLInputElement>(null), field = search?.inputRef || ownField, root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (!root.current?.offsetParent || !field.current) return;
      event.preventDefault();
      field.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target !== field.current)) return;
    const stops = [...(root.current?.querySelectorAll<HTMLElement>('[data-lib-stop]:not(:disabled)') ?? [])];
    const at = stops.indexOf(target), step = event.key === 'ArrowDown' ? 1 : -1;
    const next = target === field.current ? (step > 0 ? stops[0] : undefined) : stops[at + step];
    if (at < 0 && target !== field.current) return;
    event.preventDefault();
    if (next) next.focus(); else if (step < 0) field.current?.focus({ preventScroll: true });
  };
  const toastShowing = useToastActive();
  return <div className="ed-library lib" ref={root} data-toast={toastShowing || undefined}><div className="lib-inner" data-wide={wide || undefined} onKeyDown={walk}>
    <header className="lib-head">
      <div><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="lib-head-actions">{actions}</div>}
    </header>
    {(search || count) && <div className="lib-toolbar">
      {search && <label className="lib-search">
        <Search size={14} />
        <input ref={field} aria-label={search.label} placeholder={search.placeholder} value={search.value} spellCheck={false}
          onChange={event => search.onChange(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); search.onChange(''); } }} />
        {search.value ? <button type="button" className="lib-icon" aria-label={t('lib.clearSearch')} onClick={() => { search.onChange(''); field.current?.focus({ preventScroll: true }); }}><X size={14} /></button> : <kbd>/</kbd>}
      </label>}
      {count && <span className="lib-count">{count}</span>}
    </div>}
    {children}
    <div className="lib-undo-slot" role="status" aria-live="polite">
      {notice && <div className="lib-undo"><span>{notice.message}</span><button type="button" className="acira-button acira-button-quiet lib-compact" onClick={() => { notice.undo(); onDismissNotice?.(); }}>{t('toast.undo')}</button><button type="button" className="lib-icon" aria-label={t('lib.dismiss')} onClick={onDismissNotice}><X size={13} /></button></div>}
    </div>
  </div></div>;
}

/** A long list of equal-height rows that exist only near the viewport (History has up to 5,000 visits): `at(i)` builds row i, `signature`
 *  stands for the full set of row keys (it changes when rows are added, removed or reordered, never on scroll). */
export type WindowedRows = { count: number; at: (index: number) => ReactNode; signature: string; rowHeight?: number };
/** A single long list (a Bookmarks folder, search results) is windowed from this many rows; a day of History from sectionWindowFrom, so that hundreds of short days cannot add up to thousands of rows. */
export const windowFrom = 80;
const sectionWindowFrom = 8;
/** One scroll listener and one resize observer per scrolling page, however many sections ask: History can have hundreds. */
const watchers = new Map<HTMLElement | Window, { callbacks: Set<() => void>; stop: () => void }>();
function watchScroll(target: HTMLElement | Window, callback: () => void) {
  let watcher = watchers.get(target);
  if (!watcher) {
    const callbacks = new Set<() => void>(), run = () => callbacks.forEach((fn) => fn());
    target.addEventListener('scroll', run, { passive: true });
    const resize = new ResizeObserver(run); resize.observe(target instanceof Window ? document.documentElement : target);
    watcher = { callbacks, stop: () => { target.removeEventListener('scroll', run); resize.disconnect(); watchers.delete(target); } };
    watchers.set(target, watcher);
  }
  watcher.callbacks.add(callback);
  return () => { watcher!.callbacks.delete(callback); if (!watcher!.callbacks.size) watcher!.stop(); };
}
/** The real row height (by nominal height) once any list has measured it, so a day that has never been on screen pads with the right number. */
const measuredRowHeights = new Map<number, number>();
/** The part of a long list worth having in the DOM: the viewport plus a few screens above and below, in blocks so a slow scroll doesn't re-render on every row. */
export function useRowWindow(list: RefObject<HTMLElement | null>, count: number, rowHeight: number, enabled: boolean, eager: boolean) {
  const [range, setRange] = useState(() => ({ start: 0, end: enabled ? Math.min(count, eager ? 30 : 0) : count }));
  const height = useRef(measuredRowHeights.get(rowHeight) ?? rowHeight);
  useLayoutEffect(() => {
    const host = list.current;
    if (!enabled) { setRange(old => old.start === 0 && old.end === count ? old : { start: 0, end: count }); return; }
    if (!host) return;
    const scroller = host.closest<HTMLElement>('.ed-library') ?? null, block = 8, overscan = 16;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const sample = host.querySelector<HTMLElement>(':scope > .lib-row'); if (sample) { const real = sample.getBoundingClientRect().height; if (real > 12) { height.current = real; measuredRowHeights.set(rowHeight, real); } }
      const h = height.current, top = host.getBoundingClientRect().top + 6 /* .lib-list padding-top */, view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      const first = Math.floor((view.top - top) / h) - overscan, last = Math.ceil((view.bottom - top) / h) + overscan;
      // A day entirely above or below the viewport (and its overscan) keeps no rows at all, only its height.
      const away = last <= 0 || first >= count;
      const start = away ? 0 : Math.max(0, first - (((first % block) + block) % block)), end = away ? 0 : Math.min(count, last + block - (last % block));
      setRange(old => old.start === start && old.end === end ? old : { start, end });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const unwatch = watchScroll(scroller ?? window, schedule);
    return () => { cancelAnimationFrame(frame); unwatch(); };
  }, [list, count, enabled]);
  return { range: enabled ? { start: Math.min(range.start, count), end: Math.min(range.end, count) } : { start: 0, end: count }, rowHeight: height.current };
}

/** Padding that stands in for the rows outside the window, so the scroll height and the scrollbar are those of the whole list. */
export const windowPadding = (on: boolean, range: { start: number; end: number }, rowHeight: number, count: number): CSSProperties | undefined => on ? { paddingTop: 6 + range.start * rowHeight, paddingBottom: (count - range.end) * rowHeight } : undefined;

/** Which days of a long History are worth having in the DOM: those within a viewport and a half of the screen. The days before and after are two spacers of exactly their height
 *  (a day's height follows from its row count: libraryModel.dayOffsets), so a history of hundreds of short days costs no more than a few long ones. */
export function useDayWindow(host: RefObject<HTMLElement | null>, counts: number[], rowHeight = 40) {
  const offsets = useMemo(() => dayOffsets(counts, rowHeight), [counts, rowHeight]);
  const enabled = counts.length > 6;
  const [span, setSpan] = useState(() => ({ first: 0, last: Math.min(counts.length, 4) - 1 }));
  useLayoutEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    const scroller = el.closest<HTMLElement>('.ed-library') ?? null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top, view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      const next = daySpan(offsets, view.top - top, view.bottom - top, (view.bottom - view.top) * 1.5) ?? { first: 0, last: 0 };
      setSpan((old) => old.first === next.first && old.last === next.last ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const unwatch = watchScroll(scroller ?? window, schedule);
    return () => { cancelAnimationFrame(frame); unwatch(); };
  }, [host, offsets, enabled]);
  const last = enabled ? Math.min(span.last, counts.length - 1) : counts.length - 1;
  return { enabled, offsets, span: { first: enabled ? Math.min(span.first, last) : 0, last } };
}

/** A day (or any group): quiet title and count over a hairline that fades out at both ends; the action appears on hover. */
export function LibrarySection({ title, count, action, children, windowed, eager, day, lead }: { title: string; count?: number | string; action?: ReactNode; children?: ReactNode; windowed?: WindowedRows; eager?: boolean; day?: boolean; lead?: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const on = Boolean(windowed && windowed.count > sectionWindowFrom);
  const { range, rowHeight } = useRowWindow(list, windowed?.count ?? 0, windowed?.rowHeight ?? 40, on, Boolean(eager));
  // Rows that stay glide, new rows fade in and rows that leave fade out (A's shared motion); the signature is the set of row keys.
  useListMotion(list, windowed ? windowed.signature : Children.toArray(children).map((child) => isValidElement(child) ? String(child.key) : '').join('|'), { followers: true });
  const rows = windowed ? Array.from({ length: Math.max(0, range.end - range.start) }, (_, i) => windowed.at(range.start + i)) : children;
  const spacing = windowPadding(on, range, rowHeight, windowed?.count ?? 0);
  return <section className="lib-section" aria-label={title} data-windowed={on || undefined} data-day={day || undefined} data-lead={lead || undefined}>
    <header className="lib-section-head"><h2>{title}</h2>{count !== undefined && <span className="lib-section-count">{count}</span>}{action && <span className="lib-section-action">{action}</span>}</header>
    <div className="lib-list" ref={list} style={spacing}>{rows}</div>
  </section>;
}

/** Two steps for a destructive click: the first arms it (and says what will happen), the second does it. */
export function ConfirmAction({ label, confirmLabel, onConfirm, ariaLabel, className = '' }: { label: ReactNode; confirmLabel: string; onConfirm: () => void; ariaLabel: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return <button type="button" className={`acira-button acira-button-quiet lib-compact ${className}`} data-armed={armed || undefined} data-lib-stop aria-label={armed ? confirmLabel : ariaLabel}
    onBlur={() => setArmed(false)} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

/** The long end of a file name never disappears: the middle gives way first. */
export function MiddleName({ name }: { name: string }) {
  if (name.length <= 16) return <span className="lib-name"><span className="lib-name-head">{name}</span></span>;
  const dot = name.lastIndexOf('.'), tail = dot > 0 && name.length - dot <= 8 ? 10 : 7;
  return <span className="lib-name" title={name}><span className="lib-name-head">{name.slice(0, -tail)}</span><span className="lib-name-tail">{name.slice(-tail)}</span></span>;
}

const ImageGlyph = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2" /><circle cx="5.6" cy="6.1" r="1.1" /><path d="M2.4 12l3.6-3.4 2.6 2.4 2-1.8 3 2.8" /></svg>;
const VideoGlyph = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6.7 5.9v4.2l3.4-2.1z" /></svg>;
const kinds: [RegExp, (props: { size?: number }) => ReactNode][] = [
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|tiff?|ico)$/i, ImageGlyph],
  [/\.(mp4|mkv|mov|avi|webm|m4v|wmv)$/i, VideoGlyph],
  [/\.(zip|7z|rar|tar|gz|tgz|bz2|xz|iso|dmg)$/i, Archive],
  [/\.(exe|msi|msix|appx|deb|rpm|pkg|apk|appimage)$/i, Package],
  [/\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i, Headphones],
  [/\.(xlsx?|csv|tsv|ods|numbers)$/i, Table2],
  [/\.(js|ts|tsx|jsx|json|html|css|py|rs|go|java|c|cpp|h|cs|rb|php|sh|ps1|xml|yml|yaml|md)$/i, Code2],
  [/\.(bat|cmd|ps1|sh)$/i, Terminal],
];
/** One neutral glyph per kind of file; the 32px tile around it is the same for all of them. */
export function FileGlyph({ name, bare = false, children }: { name: string; /** Just the 16px icon, for the icon column of a menu row. */ bare?: boolean; /** Shown in the icon's place (the download matrix). */ children?: ReactNode }) {
  const Icon = kinds.find(([pattern]) => pattern.test(name))?.[1] ?? FileText;
  if (bare) return <span className="acira-menu-icon dl-file" aria-hidden="true">{children ?? <Icon size={16} />}</span>;
  return <span className="lib-glyph" aria-hidden="true">{children ?? <Icon size={16} />}</span>;
}

/** Empty and no-match states: left-aligned, no art. One line, one sentence, at most one action. */
export function LibraryEmpty({ title, text, hint, children }: { title: string; text: string; hint?: ReactNode; children?: ReactNode }) {
  return <div className="lib-empty">
    <h2>{title}</h2><p>{text}</p>
    {children && <div className="lib-empty-actions">{children}</div>}
    {hint && <p className="lib-empty-hint">{hint}</p>}
  </div>;
}
