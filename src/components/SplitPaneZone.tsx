import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { morphSpring, motionScale } from '../ui/splitMotion';
import type { SplitPickerState } from '../ui/splitDrop';
import { t } from '../i18n';
import '../styles/split-picker.css';

/** The in-place drop zone while a tab (or, dragging a pane by its ribbon, a pane) is dragged over a pane of an open split (R4-40): one glass box in the accent over where the dropped page would sit,
 *  the pane itself to replace it, the new pane's cell for an edge, gliding from one zone to the next, with a short label of what a release does. It is
 *  drawn inside the layout picker (between the preview and the card), so it shares the blurred stills and the veil. */
export function SplitPaneZone({ pane, reducedMotion }: { pane: SplitPickerState['pane']; reducedMotion: boolean }) {
  const speed = useRef(motionScale()).current, scale = reducedMotion ? 0 : speed;
  const zone = pane?.zone, rect = pane?.rect;
  const label = !zone ? '' : zone.kind === 'replace' ? t('splitzone.replace') : zone.kind === 'move' ? (zone.edge === 'left' ? t('splitzone.moveLeft') : zone.edge === 'right' ? t('splitzone.moveRight') : zone.edge === 'top' ? t('splitzone.moveTop') : t('splitzone.moveBottom')) : zone.edge === 'left' ? t('splitzone.left') : zone.edge === 'right' ? t('splitzone.right') : zone.edge === 'top' ? t('splitzone.top') : t('splitzone.bottom');
  return <AnimatePresence>{zone && rect && <motion.div key="pane-zone" className="split-pane-zone" data-kind={zone.kind}
    initial={scale === 0 ? false : { opacity: 0, left: rect.x, top: rect.y, width: rect.width, height: rect.height }} animate={{ opacity: 1, left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    exit={{ opacity: 0, transition: morphSpring('menu.fade', scale) }} transition={{ ...morphSpring('reorder.move', scale), opacity: morphSpring('menu.fade', scale) }}>
    <span className="split-picker-pane-label"><span>{label}</span></span>
  </motion.div>}</AnimatePresence>;
}
