import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { TabSession } from '../runtime/types';
import { coverScale, morphToken, type MorphIntent, type MorphItem, type MorphRect } from '../ui/splitMorph';
import { morphSpring } from '../ui/splitMotion';
import '../styles/split-picker.css';

export interface SplitMorphRun { key: number; items: MorphItem[]; intent: MorphIntent; scale: number; stills: Record<string, string> }

/** The pages gliding between split layouts (R3-26; see ui/splitMorph.ts). Drawn in the page area while the native pages
 *  step aside, one box per page. A box moves and reshapes with transforms only: its outer element is translated and scaled
 *  from the old box to the new, and what it shows is scaled back by the inverse, so the page's still is never stretched: the
 *  box is a window that resizes over it (the still grows to cover the new box as it settles). A page flying in from a dropped
 *  tab starts as a tab-sized glass tile with its title and becomes the page; a page that leaves fades where it stood. One
 *  progress value drives every channel, so an interruption (a new morph) simply starts from where the boxes are. */
export function SplitMorphLayer({ run, live, done, tabs, renderIcon, onDone }: { run: SplitMorphRun | null; live: { current: Map<string, MorphRect> }; done?: boolean; tabs: readonly TabSession[]; renderIcon: (tab: TabSession) => ReactNode; onDone: (key: number) => void }) {
  const pending = useRef(new Set<string>()), keyRef = useRef(0);
  useEffect(() => { if (run) { keyRef.current = run.key; pending.current = new Set(run.items.map(item => item.tabId)); } }, [run]);
  if (!run) return null;
  const settled = (tabId: string) => { if (keyRef.current !== run.key) return; pending.current.delete(tabId); if (!pending.current.size) onDone(run.key); };
  // When the boxes have settled the layer fades out over the pages coming back (the native views take a frame or two to return).
  return <div key={run.key} className="split-picker-layer split-morph-layer" aria-hidden="true" style={{ opacity: done ? 0 : 1, transition: `opacity ${Math.round(140 * Math.max(.4, run.scale))}ms ease-out` }}>
    {run.items.map(item => <Fragment key={item.tabId}>
      {/* D191 (reported 24 Nov: two empty grey panes for half a second after a drop): a page that arrives has its pane's box covered from the first frame, by its picture or, when it has none (a tab that was never on screen), by its title on a glass wash, while the small tile flies in over it. */}
      {item.kind === 'enter' && <div className="split-morph-box split-morph-backing" data-backing={item.tabId} style={{ width: item.to.width, height: item.to.height, transform: `translate(${item.to.x}px, ${item.to.y}px)` }}>
        <div className="split-morph-tile" style={{ width: '100%', height: '100%' }}>
          {run.stills[item.tabId] && <img className="split-morph-still" src={run.stills[item.tabId]} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}/>}
          {(() => { const entry = tabs.find(tab => tab.id === item.tabId); return entry && <span className="split-picker-pane-label">{renderIcon(entry)}<span>{entry.title || entry.url}</span></span>; })()}
        </div>
      </div>}
      <MorphBox item={item} intent={run.intent} scale={run.scale} still={run.stills[item.tabId]} tab={tabs.find(entry => entry.id === item.tabId)} live={live} renderIcon={renderIcon} onSettled={() => settled(item.tabId)}/>
    </Fragment>)}
  </div>;
}

function MorphBox({ item, intent, scale, still, tab, live, renderIcon, onSettled }: { item: MorphItem; intent: MorphIntent; scale: number; still?: string; tab?: TabSession; live: { current: Map<string, MorphRect> }; renderIcon: (tab: TabSession) => ReactNode; onSettled: () => void }) {
  const { from, to } = item, p = useMotionValue(item.kind === 'exit' ? 0 : scale === 0 ? 1 : 0), lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x = useTransform(p, t => lerp(from.x, to.x, t)), y = useTransform(p, t => lerp(from.y, to.y, t));
  const sx = useTransform(p, t => Math.max(.001, lerp(from.width, to.width, t) / to.width)), sy = useTransform(p, t => Math.max(.001, lerp(from.height, to.height, t) / to.height));
  // A moving page keeps its pixels: the still is drawn at the old box's size and grows to cover the new box (uniformly).
  const cover = coverScale(from, to), grow = useTransform(p, t => 1 + (cover - 1) * Math.max(0, Math.min(1, t)));
  const px = useTransform([grow, sx], ([g, s]) => (g as number) / (s as number)), py = useTransform([grow, sy], ([g, s]) => (g as number) / (s as number));
  // The tile of an arriving page keeps its natural size in the window (inverse of the box scale) so its title never stretches.
  const ix = useTransform(sx, s => 1 / s), iy = useTransform(sy, s => 1 / s);
  const fadeTile = useTransform([sx, sy], ([a, b]) => 1 - Math.max(0, Math.min(1, ((a as number) * (b as number) - .12) / .2))), fadeOut = useTransform(p, t => 1 - Math.max(0, Math.min(1, t * 1.4)));
  // A page flying back into its tab (Unsplit) stays solid while it shrinks and fades over the last part of the flight, as it lands.
  const fadeLate = useTransform(p, t => 1 - Math.max(0, Math.min(1, (t - .5) / .4)));
  // Where the box is right now, so a morph that interrupts this one starts from it.
  useEffect(() => p.on('change', t => live.current.set(item.tabId, { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const spring = morphSpring(item.kind === 'exit' && !item.home ? 'menu.fade' : morphToken(intent), scale);
    if (scale === 0) { p.set(1); onSettled(); return; }
    const controls = animate(p, 1, spring as never); controls.then(onSettled, () => {});
    return () => controls.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (item.kind === 'exit' && !item.home) return <motion.div className="split-morph-box" style={{ width: to.width, height: to.height, x: from.x, y: from.y, opacity: fadeOut, originX: 0, originY: 0 }}>
    {still ? <img className="split-morph-still" src={still} alt="" draggable={false} style={{ width: '100%', height: '100%' }}/> : <div className="split-morph-tile"/>}
  </motion.div>;
  return <motion.div className="split-morph-box" data-home={item.home || undefined} style={{ width: to.width, height: to.height, x, y, scaleX: sx, scaleY: sy, originX: 0, originY: 0, ...(item.home ? { opacity: fadeLate } : item.kind === 'enter' ? { opacity: fadeTile } : {}) }}>
    {item.kind === 'move' || item.home
      ? still ? <motion.img className="split-morph-still" src={still} alt="" draggable={false} style={{ width: from.width, height: from.height, scaleX: px, scaleY: py, originX: 0, originY: 0 }}/>
        : <motion.div className="split-morph-tile" style={{ width: to.width, height: to.height, scaleX: ix, scaleY: iy, originX: 0, originY: 0 }}>{tab && <span className="split-picker-pane-label">{renderIcon(tab)}<span>{tab.title || tab.url}</span></span>}</motion.div>
      // The title and the picture of an arriving page stand on its backing (SplitMorphLayer), once; the tile that flies in carries neither and fades out as it grows over the backing (no box in a box, no second title).
      : <motion.div className="split-morph-tile" data-arriving style={{ width: to.width, height: to.height, scaleX: ix, scaleY: iy, originX: 0, originY: 0 }}/>}
  </motion.div>;
}
