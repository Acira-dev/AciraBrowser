import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { BrowserAction, TabSession } from '../runtime/types';
import { SPLIT_LAYOUTS } from '../runtime/splitLayout';
import { PANE_DROP_MS, cancelPaneDrag, endPaneDrag, movePaneDrag, paneDropArrangement, panePreviewRects, pastDragThreshold, startPaneDrag, type PaneDragState, type PaneRect } from '../ui/paneDrag';
import { requestSplitStills, splitDropLayout } from '../ui/splitDrop';
import { morphSpring, motionScale } from '../ui/splitMotion';
import { carryChip } from '../ui/useTabDragSurface';
import { controlTitle } from '../ui/shortcutHints';
import { runtime } from '../runtime/client';
import { RotateCw, X } from './AppIcons';
import { NavigationProgress } from './NavigationProgress';
import { t, translateText } from '../i18n';
import '../features/split/split.css';
import '../styles/split-picker.css';

/** What the carried chip of a pane drag may stick to (liquid snap): the "Drag up here for layouts" pill and the layout card's cells, nothing else on the page. */
const paneDragTargets = (target: { key: string }) => target.key === 'el:layouts' || target.key.startsWith('zone:');

/** A pane's title ribbon (R3-60): about 25px, the site icon and the title one left-aligned unit, the close button on the
 *  same centre line. It is also the pane's drag handle: press and drag to rearrange the split (ui/paneDrag.ts). The pointer
 *  carries the pane's icon on the glass chip a dragged tab uses (ui/useTabDragSurface.carryChip), which sticks to the layouts
 *  pill and the card's cells like water (ui/liquidSnap.ts); the frames show where everything will go (SplitPaneDragLayer). */
export function SplitRibbon({ tab, icon, active, removeLabel, dispatch, reducedMotion = false }: { tab: TabSession; icon: ReactNode; active: boolean; removeLabel: string; dispatch: (action: BrowserAction) => void; reducedMotion?: boolean }) {
  const press = useRef<{ id: number; x: number; y: number; started: boolean } | null>(null), root = useRef<HTMLDivElement>(null), chip = useRef<ReturnType<typeof carryChip> | null>(null);
  const area = () => root.current?.closest('.page-area')?.getBoundingClientRect() ?? null;
  const relative = (event: PointerEvent, box: DOMRect) => ({ x: event.clientX - box.left, y: event.clientY - box.top });
  const panes = (box: DOMRect): PaneRect[] => [...(root.current?.closest('.split-pages')?.querySelectorAll<HTMLElement>('[data-pane]') ?? [])].map(node => { const r = node.getBoundingClientRect(); return { tabId: node.dataset.pane!, x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height }; });
  /** How long the frames take to land (the spring at the speed setting); Off: at once. */
  const settle = () => Math.round(PANE_DROP_MS * motionScale());
  const letGo = (handOver: boolean) => { chip.current?.end(handOver); chip.current = null; };
  const finish = (event: PointerEvent, commit: boolean) => {
    const current = press.current; if (current?.id !== event.pointerId) return; press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.started) return;
    // R5: a release commits what the frames show; they hold it while the pages are laid out under them, then the pages come back (no morph, no jump).
    if (commit) { const action = endPaneDrag(settle()); letGo(Boolean(action)); if (action) dispatch(action); } else { cancelPaneDrag(settle()); letGo(false); }
  };
  useEffect(() => () => { if (press.current?.started) cancelPaneDrag(); letGo(false); }, []);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && press.current?.started) { press.current = null; cancelPaneDrag(settle()); letGo(false); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  return <div ref={root} className="split-label" data-active={active || undefined} title={t('splitpane.dragToRearrange')}
    onPointerDown={event => { if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button')) return; press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      const current = press.current, box = area(); if (current?.id !== event.pointerId || !box) return;
      if (!current.started) {
        if (!pastDragThreshold(event.clientX - current.x, event.clientY - current.y)) return;
        const rects = panes(box); if (rects.length < 2) return;
        // R4-29: the layout picker comes up with the drag, sized to the page area.
        current.started = true; requestSplitStills(rects.map(rect => rect.tabId)); startPaneDrag(tab.id, rects, relative(event, box), { width: box.width, height: box.height }, splitDropLayout());
        if (root.current) { chip.current = carryChip(root.current, ':scope > :first-child', { only: paneDragTargets }); chip.current.move({ x: event.clientX, y: event.clientY }, -1e9); }
        return;
      }
      movePaneDrag(relative(event, box)); chip.current?.move({ x: event.clientX, y: event.clientY }, -1e9);
    }}
    onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
    {icon}<span>{tab.title}</span>
    {/* Reload (29 Oct): shown while the pointer is over the ribbon (or a key is on it); it keeps its 20px slot so the title and the × never move. Reloads this pane's page only, Shift+click ignoring the cache (Chrome). */}
    {tab.contentKind === 'web' && <button type="button" className="icon-button split-label-reload" title={controlTitle(t('app.reloadPage'))} aria-label={t('app.reloadPage')} onClick={event => { void runtime.browserCommand({ type: 'reload', tabId: tab.id, ...(event.shiftKey ? { ignoreCache: true } : {}) }); }}><RotateCw size={14}/></button>}
    <button type="button" className="icon-button split-label-close" title={controlTitle(removeLabel)} aria-label={removeLabel} onClick={() => dispatch({ type: 'split.remove', tabId: tab.id })}><X size={14}/></button>
    {/* R5 (founder 27 Oct): a pane that is loading shows Acira's loading line (the address bar's Helium painter, same look and timing) along the ribbon's
        bottom edge, the seam with its page, as the compact toolbar's line runs along the chrome/website seam. Every pane, current or not; idle otherwise. */}
    <NavigationProgress tab={tab} placement="boundary" reduced={reducedMotion}/>
  </div>;
}


/** The live layout preview while a pane ribbon is dragged (R5, founder 27 Oct: "move the tabs accordingly, showing how they'd align"). Every pane is a
 *  frame — its ribbon (icon and title) over a still of its page — and while the pointer is on a zone every frame glides to the box the release gives it
 *  (ui/paneDrag.panePreviewRects, the page's own geometry): the others slide and resize out of the way and the dragged pane's frame, a glass box ringed in
 *  the accent, lands where it will sit, at its final size. Another zone re-flows on the shared spring; off every zone (or Esc) they glide back; a release
 *  holds what is shown while the pages are laid out under it. The frames move with transforms only (no layout per frame): each one is laid out at its
 *  target size once per re-flow, and its transform carries it from where it is; the ribbon and the still are scaled back so neither ever stretches.
 *  Drawn in the page area over the panes (the native pages step aside during the drag). */
export function SplitPaneDragLayer({ drag, stills, ribbonHeight, tabs, renderIcon, reducedMotion }: { drag: PaneDragState | null; stills: Record<string, string>; ribbonHeight: number; tabs: readonly TabSession[]; renderIcon: (tab: TabSession) => ReactNode; reducedMotion: boolean }) {
  const speed = useRef(motionScale()).current, scale = reducedMotion ? 0 : speed;
  const shown = drag ? panePreviewRects(drag) : [], next = drag && drag.phase !== 'back' ? paneDropArrangement(drag) : null;
  // At most one short label, and only where it adds something: the name of the layout an edge or a card cell would give (not for a swap).
  const layout = next && drag?.split && next.layout !== drag.split.layout ? translateText(SPLIT_LAYOUTS[next.layout].label) : '';
  return <AnimatePresence>{drag && <motion.div key="pane-drag" className="split-picker-layer split-drag-layer" data-phase={drag.phase} aria-hidden="true" exit={{ opacity: 0, transition: morphSpring('menu.fade', scale) }}>
    {drag.rects.map(home => { const tab = tabs.find(item => item.id === home.tabId), source = home.tabId === drag.tabId;
      return <PaneFrame key={home.tabId} home={home} rect={shown.find(rect => rect.tabId === home.tabId) ?? home} still={stills[home.tabId]} tab={tab} source={source} page={drag.phase !== 'drag'} label={source ? layout : ''} ribbonHeight={ribbonHeight} scale={scale} renderIcon={renderIcon}/>; })}
  </motion.div>}</AnimatePresence>;
}

type Box = { x: number; y: number; width: number; height: number };
function PaneFrame({ home, rect, still, tab, source, page, label, ribbonHeight, scale, renderIcon }: { home: PaneRect; rect: Box; still?: string; tab?: TabSession; source: boolean; /** Looks like the page (the drag is ending): full still. */ page: boolean; label: string; ribbonHeight: number; scale: number; renderIcon: (tab: TabSession) => ReactNode }) {
  const node = useRef<HTMLDivElement>(null), ribbon = useRef<HTMLDivElement>(null), picture = useRef<HTMLImageElement>(null), caption = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(home.x), y = useMotionValue(home.y), w = useMotionValue(home.width), h = useMotionValue(home.height), target = useRef<Box>(rect);
  // The frame starts as the page it stands for, then reads as a box (its still dims under the glass) once the drag is under way.
  const [boxed, setBoxed] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setBoxed(true)); return () => cancelAnimationFrame(frame); }, []);
  /** Writes the transforms for where the frame is now (x, y, w, h) against the box it is laid out at (`target`). */
  const paint = () => {
    const t = target.current, vx = x.get(), vy = y.get(), vw = Math.max(1, w.get()), vh = Math.max(1, h.get()), sx = vw / Math.max(1, t.width), sy = vh / Math.max(1, t.height);
    if (node.current) node.current.style.transform = `translate3d(${vx}px,${vy}px,0) scale(${sx},${sy})`;
    if (ribbon.current) ribbon.current.style.transform = `scale(${1 / sx},${1 / sy})`;
    if (caption.current) caption.current.style.transform = `translate(-50%,-50%) scale(${1 / sx},${1 / sy})`;
    // The still keeps its pixels: drawn at the pane's own size, scaled evenly to cover the frame below the ribbon.
    const cover = Math.max(vw / Math.max(1, home.width), Math.max(1, vh - ribbonHeight) / Math.max(1, home.height - ribbonHeight));
    if (picture.current) picture.current.style.transform = `translate(0,${ribbonHeight / sy}px) scale(${cover / sx},${cover / sy})`;
  };
  useEffect(() => { const stops = [x, y, w, h].map(value => value.on('change', paint)); return () => stops.forEach(stop => stop()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A new box: lay the frame out at it and repaint before the browser paints (so the new size never shows unscaled), then glide there on the shared spring.
  useLayoutEffect(() => {
    target.current = rect;
    // The ribbon keeps its height and is scaled back, so its width is what shows: as wide as the frame is now or will be, cut by the frame's edge.
    const wide = () => { if (ribbon.current) ribbon.current.style.width = `${Math.max(rect.width, w.get())}px`; }; wide(); paint();
    const spring = morphSpring('reorder.move', scale);
    if (scale === 0) { x.set(rect.x); y.set(rect.y); w.set(rect.width); h.set(rect.height); wide(); paint(); return; }
    const controls = [animate(x, rect.x, spring), animate(y, rect.y, spring), animate(w, rect.width, spring), animate(h, rect.height, spring)];
    controls[2].then(() => { if (ribbon.current && target.current === rect) ribbon.current.style.width = `${rect.width}px`; }, () => {});
    return () => controls.forEach(control => control.stop());
  }, [rect.x, rect.y, rect.width, rect.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const repaintWith = <T extends HTMLElement>(ref: { current: T | null }) => (element: T | null) => { ref.current = element; if (element) paint(); };
  return <div ref={node} className="split-drag-frame" data-pane={home.tabId} data-source={source || undefined} data-look={boxed && !page ? 'box' : 'page'} style={{ width: rect.width, height: rect.height }}>
    {still ? <img ref={repaintWith(picture)} className="split-drag-frame-still" src={still} alt="" draggable={false} style={{ width: home.width, height: Math.max(0, home.height - ribbonHeight) }}/> : null}
    <div ref={ribbon} className="split-label split-drag-frame-ribbon" data-active={source || undefined}>{tab && renderIcon(tab)}<span>{tab ? tab.title || tab.url : ''}</span></div>
    {label && <span ref={repaintWith(caption)} className="split-drag-frame-caption">{label}</span>}
  </div>;
}
