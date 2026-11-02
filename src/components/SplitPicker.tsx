import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cascadeDelay, morphSpring, motionScale, riseFor } from '../ui/splitMotion';
import type { TabSession } from '../runtime/types';
import { pickerGeometry, splitTabsFor, type SplitPickerState } from '../ui/splitDrop';
import { SPLIT_LAYOUTS, evenSizes, paneRects } from '../runtime/splitLayout';
import '../styles/split-picker.css';
import { ArrowUp } from './AppIcons';

import { t, translateText } from '../i18n';
type Rect = { x: number; y: number; width: number; height: number };
/** One visible pane under the picker: where its page sits in the page area and, for websites, a still of it (the
 * native page view steps aside while the picker is up, so the still stands in for it under the blur). */
export interface SplitPickerPane { tabId: string; rect: Rect | null; still?: string }

/** A's signature open (popup-material.css): the material settles from .985 at 70% opacity, 200ms expo-out. Blur never
 * animates (bible §3.9): the veil, card and panes each fade their own opacity over a fixed blur, so no fading ancestor
 * cuts their backdrop short (an ancestor below opacity 1 is a backdrop root: the frost would pop in when it ends). */

/** The Snap-style split picker (founder, Round 2): the page blurs, a card of layouts comes down near the top, and the
 * cell under the dragged tab previews the result across the whole page; moving between cells morphs the preview,
 * moving off removes it. Drawn in the page area of the app's UI, so it is one compositor layer above the stills. */
export function SplitPicker({ picker, panes, tabs, renderIcon, reducedMotion, veil = true, children }: { picker: SplitPickerState | null; panes: SplitPickerPane[]; tabs: readonly TabSession[]; renderIcon: (tab: TabSession) => ReactNode; reducedMotion: boolean; /** R4-29: false when another layer (the pane drag's) already draws the veil under the card and the preview. */ veil?: boolean; /** R4-40: drawn over the preview and under the card (the in-place pane zone). */ children?: ReactNode }) {
  // R3-25/R3-26: the springs are the research's tokens (ui/splitMotion.ts) at the global speed, read when the picker is first drawn; Off and reduced motion show it at once.
  const speed = useRef(motionScale()).current, scale = reducedMotion ? 0 : speed, fade = scale === 0 ? { duration: 0 } : morphSpring('menu.fade', scale);
  // The stills stand in for the page views at once (same pixels), and leave with the layer once its children have faded.
  return <AnimatePresence>{picker && <motion.div key="split-picker" className="split-picker-layer" aria-hidden="true">
    {panes.map(pane => pane.rect && pane.still && <img key={pane.tabId} className="split-picker-still" src={pane.still} alt="" draggable={false} style={{ left: pane.rect.x, top: pane.rect.y, width: pane.rect.width, height: pane.rect.height }}/>)}
    {veil && <motion.div className="split-picker-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: morphSpring('menu.fade', scale) }} transition={fade}/>}
    {picker.preview !== false && <Preview picker={picker} tabs={tabs} renderIcon={renderIcon} reducedMotion={reducedMotion} scale={scale}/>}
    {children}
    <AnimatePresence>{picker.card !== false && <Card key="card" picker={picker} reducedMotion={reducedMotion} scale={scale}/>}</AnimatePresence>
    {/* A pane drag keeps the card put away until the pointer rises into the top of the page; this pill marks where it comes from (it takes no input). R5: it
        lights as the pointer nears it (--reach, 0 to 1 over 180 px) and the carried chip sticks to it like water (a liquid target) before the card comes. */}
    <AnimatePresence>{picker.card === false && <motion.span key="dock" className="split-picker-dock-hint" data-liquid-target="layouts" style={{ '--reach': (picker.reach ?? 0).toFixed(3) } as CSSProperties} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}><ArrowUp size={13}/><span>{t('splitpane.layoutsHint')}</span></motion.span>}</AnimatePresence>
  </motion.div>}</AnimatePresence>;
}

function Preview({ picker, tabs, renderIcon, reducedMotion, scale }: { picker: SplitPickerState; tabs: readonly TabSession[]; renderIcon: (tab: TabSession) => ReactNode; reducedMotion: boolean; scale: number }) {
  // The panes fade with the layer when the picker leaves (read, not awaited: a nested presence that waits holds the layer).
  const present = useIsPresent(), zone = picker.zone, order = zone ? splitTabsFor(picker.current, picker.tabId, zone.index) : [], inset = 10;
  const spec = zone ? SPLIT_LAYOUTS[zone.layout] : null, rects = zone && spec ? paneRects({ layout: zone.layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) }, { x: inset, y: inset, width: picker.width - inset * 2, height: picker.height - inset * 2 }, 6) : [];
  return <AnimatePresence>{zone && <motion.div key="preview" className="split-picker-preview">
    {order.map((id, index) => { const tab = tabs.find(item => item.id === id), rect = rects[index]; return rect && <motion.div key={id} layout={!reducedMotion} initial={{ opacity: 0 }} animate={{ opacity: present ? 1 : 0 }} exit={{ opacity: 0 }} transition={{ ...morphSpring('reorder.move', scale), opacity: morphSpring('menu.fade', scale) }} className="split-picker-pane" data-new={id === picker.tabId || undefined} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
      {tab && <span className="split-picker-pane-label">{renderIcon(tab)}<span>{tab.title || tab.url}</span></span>}
    </motion.div>; })}
  </motion.div>}</AnimatePresence>;
}

function Card({ picker, reducedMotion, scale }: { picker: SplitPickerState; reducedMotion: boolean; scale: number }) {
  const { card, thumbs } = pickerGeometry(picker.width, picker.height, picker.layouts, picker.lift);
  // R3-25: the card grows in from the strip side it came from (a short rise, `popover.grow`, no bounce) and leaves on `menu.shrink`; its layouts follow one after another (the row cascade). Glass is never scaled, so the card moves and fades.
  const grow = morphSpring('popover.grow', scale), rise = riseFor(scale);
  // One accent highlight glides between the cells as the pointer moves (it morphs from choice to choice, like the preview).
  const hovered = picker.zone ? thumbs.find(thumb => thumb.layout === picker.zone!.layout)?.cells.find(cell => cell.index === picker.zone!.index) : undefined;
  return <motion.div className="split-picker-card" style={{ left: card.x, top: card.y, width: card.width, height: card.height }} initial={scale === 0 ? { opacity: 0 } : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: scale === 0 ? 0 : -4, transition: { ...morphSpring('menu.shrink', scale), opacity: morphSpring('menu.fade', scale) } }} transition={scale === 0 ? { duration: 0 } : { ...grow, opacity: morphSpring('menu.fade', scale) }}>
    <span className="split-picker-title">{picker.zone ? translateText(SPLIT_LAYOUTS[picker.zone.layout].label) : t("splitpicker.dropOnASpotTo")}</span>
    {thumbs.map((thumb, order) => <motion.span key={thumb.layout} className="split-picker-thumb" data-active={picker.zone?.layout === thumb.layout || undefined} initial={scale === 0 ? false : { opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} transition={scale === 0 ? { duration: 0 } : { ...grow, opacity: morphSpring('menu.fade', scale), delay: cascadeDelay(order, scale) }} style={{ left: thumb.x - card.x, top: thumb.y - card.y, width: thumb.width, height: thumb.height }}>
      {thumb.cells.map(cell => <span key={cell.index} className="split-picker-cell" data-hover={picker.zone?.layout === thumb.layout && picker.zone?.index === cell.index || undefined} style={{ left: cell.x - thumb.x, top: cell.y - thumb.y, width: cell.width, height: cell.height }}/>)}
    </motion.span>)}
    <AnimatePresence>{hovered && <motion.span key="hover" className="split-picker-highlight" initial={reducedMotion ? false : { opacity: 1, left: hovered.x - card.x, top: hovered.y - card.y, width: hovered.width, height: hovered.height }} animate={{ opacity: 1, left: hovered.x - card.x, top: hovered.y - card.y, width: hovered.width, height: hovered.height }} exit={{ opacity: 0 }} transition={reducedMotion ? { duration: 0 } : { ...morphSpring('reorder.move', scale), opacity: morphSpring('menu.fade', scale) }}/>}</AnimatePresence>
  </motion.div>;
}
