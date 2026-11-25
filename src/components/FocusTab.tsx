import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { playDeparture, playSettle, rememberChip, takeStrip } from '../ui/focusRowMotion';
import type { TabSession } from '../runtime/types';
import { shownTab } from '../runtime/tabTitle';
import { shownPrivacy } from '../ui/tabPrivacy';
import { cardAnswers, useTabHoverCardMode } from '../ui/tabHoverCard';
import { controlTitle } from '../ui/shortcutHints';
import { tabSound } from '../ui/tabSound';
import { LineIcon } from './LineIcon';
import { VolumeX } from './AppIcons';
import { TabMutedBadge, TabSoundMeter } from './TabSound';
import { TabPrivacyMark, isNewTabState, privacyNames } from './TabPrivacyMark';
import { t as tr } from '../i18n';
import './FocusTab.css';

/** Beta 14: Focus with tabs on top (the Shelf included) shows ONE chip, the current tab, where the row of favicon chips was; the tab-list button beside it reaches
 * every other tab. It is the compact strip's chip (the same classes, the same look, the same hover card, privacy mark, sound badge and close ×), not a second design:
 * what differs is that there is only ever this tab, so there is no track, no scroll, no reorder, and the chip persists across a tab switch, whose icon and name
 * cross-fade in place (120 ms) instead of one chip leaving and another arriving. The row's own width rules (CompactTabs.css `[data-single]`) fit it: a roomy row gives it
 * the icon, the name with a clean ellipsis and the ×; a tight one folds it to the icon, as a compact chip does. */
export interface FocusTabProps {
  tab: TabSession;
  reducedMotion: boolean;
  renderIcon: (tab: TabSession) => ReactNode;
  onClose: (id: string) => void;
  onMute?: (id: string, muted: boolean) => void;
  onContext?: (id: string, anchor: { x: number; y: number; width: number; height: number }) => void;
  /** Arrow keys, Home and End on the chip: the neighbour in the window's tab order, selected (the strip's own keys). */
  onStep: (direction: 'previous' | 'next' | 'first' | 'last') => void;
}

/** One tab's face: the icon with its badges, the name and the privacy mark, the speaker and the ×. A layer of its own so a tab switch can fade one for the other in place;
 * the layer that is leaving is inert (nothing under the pointer is a second, vanishing button). */
function Face({ tab, reduced, renderIcon, onClose, onMute, ref }: { tab: TabSession; reduced: boolean; renderIcon: (tab: TabSession) => ReactNode; onClose: FocusTabProps['onClose']; onMute: FocusTabProps['onMute']; /** AnimatePresence's pop layout measures the leaving layer through this ref (React 19: a plain prop). */ ref?: Ref<HTMLDivElement> }) {
  const present = useIsPresent(), shown = shownTab(tab), sound = tabSound(shown), privacy = shownPrivacy(shown);
  return (
    <motion.div ref={ref} className="acira-compact-tab-inner" data-face="" inert={!present || undefined}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.12, ease: 'linear' }}>
      <span className="acira-compact-tab-icon" data-sleeping={shown.sleeping || undefined}>
        {privacy && isNewTabState(shown.url) ? <TabPrivacyMark privacy={privacy} size={16} className="tab-privacy-mark tab-privacy-icon" /> : <>{renderIcon(shown)}{privacy && <TabPrivacyMark privacy={privacy} size={9} className="tab-privacy-badge" />}</>}
        {sound === 'playing' && <TabSoundMeter badge reducedMotion={reduced} />}{sound === 'muted' && <TabMutedBadge />}
      </span>
      <span className="acira-compact-tab-label" dir="auto"><span className="tab-title-text">{shown.title}</span></span>
      {privacy && !isNewTabState(shown.url) && <TabPrivacyMark privacy={privacy} />}
      {sound === 'muted' && !shown.pinned && <button type="button" className="acira-compact-tab-audio is-muted" title={tr('app.unmuteTab')} aria-label={tr('tabsound.unmuteName', { name: shown.title })} aria-pressed={true} tabIndex={-1} onClick={event => { event.stopPropagation(); onMute?.(shown.id, false); }}><VolumeX size={13} /></button>}
      {sound === 'playing' && <TabSoundMeter reducedMotion={reduced} />}
      {/* Pinned tabs never offer close (Chrome). The current tab's × is always there when the chip has room for it (FocusTab.css); in a tight row it is the icon's hover, as on a compact chip. */}
      {!shown.pinned && <button type="button" className="acira-compact-tab-close" tabIndex={0} title={controlTitle('Close tab')} aria-label={tr('app.closeTitle', { title: shown.title })} onClick={event => { event.stopPropagation(); onClose(shown.id); }}><LineIcon name="x" size={14} /></button>}
    </motion.div>
  );
}

export function FocusTab({ tab, reducedMotion, renderIcon, onClose, onMute, onContext, onStep }: FocusTabProps) {
  const root = useRef<HTMLDivElement>(null), chip = useRef<HTMLDivElement>(null);
  // Entering Focus: the row of chips that was here goes (a picture of it, left by CompactTabs as it unmounted) while this chip settles in; leaving it, the chip's own picture is what CompactTabs plays backwards (ui/focusRowMotion.ts).
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(), mine = chip.current?.getBoundingClientRect();
    if (box && mine) playDeparture(root.current, takeStrip(), { x: mine.x - box.x, width: mine.width });
    playSettle(chip.current);
    return () => rememberChip(root.current);
  }, []);
  const shown = shownTab(tab), sound = tabSound(shown), privacy = shownPrivacy(shown), cardMode = useTabHoverCardMode();
  const label = `${shown.title}${shown.pinned ? ' (pinned)' : ''}${privacy ? `, ${privacyNames[privacy].label}` : ''}${sound === 'playing' ? `, ${tr('tabsound.playing')}` : ''}`;
  const title = cardAnswers(cardMode, shown) ? undefined : `${shown.title}${shown.pageTitle !== undefined ? ` · ${tr('tabrename.renamedTip')}` : ''}${privacy ? ` · ${privacyNames[privacy].tip}` : ''}`;
  return (
    <div ref={root} className="acira-compact-tabs" data-single="true" data-reduced-motion={reducedMotion || undefined} role="tablist" aria-label={tr('browsermenu.allOpenTabs')}>
      <div ref={chip} className="acira-compact-tab focus-tab selected" data-tab-id={shown.id} data-privacy={privacy} data-sound={sound || undefined} data-pinned={shown.pinned} data-labels="true"
        role="tab" aria-selected={true} tabIndex={0} aria-label={label} title={title}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(shown.id); } }}
        onContextMenu={event => { event.preventDefault(); onContext?.(shown.id, { x: event.clientX, y: event.clientY, width: 2, height: 2 }); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const b = event.currentTarget.getBoundingClientRect(); onContext?.(shown.id, { x: b.x, y: b.y, width: b.width, height: b.height }); return; }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); onStep('previous'); }
          else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); onStep('next'); }
          else if (event.key === 'Home') { event.preventDefault(); onStep('first'); }
          else if (event.key === 'End') { event.preventDefault(); onStep('last'); }
          else if (event.key === 'Delete') { event.preventDefault(); onClose(shown.id); }
        }}>
        <span className="acira-compact-selection focus-tab-fill" aria-hidden="true" data-privacy={privacy} />
        <AnimatePresence initial={false} mode="popLayout">
          <Face key={shown.id} tab={tab} reduced={reducedMotion} renderIcon={renderIcon} onClose={onClose} onMute={onMute} />
        </AnimatePresence>
      </div>
    </div>
  );
}
