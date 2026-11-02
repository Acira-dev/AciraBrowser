import { DotMatrix } from './DotMatrix';
import { VolumeX } from './AppIcons';
import '../styles/tab-sound.css';

/** The equaliser that tells you a tab is playing sound (R4-30). It stands in the close slot (`slot`: 5 columns of 4 dots) or, where
 * a tab has no room for one, sits on the corner of its site icon (`badge`: 3 columns of 3, square dots straight on a clean cut-out
 * of the icon, no box around them: R4-38). Crisp mode: dots are whole device pixels, sharp at 100%, 150% and 200%. One lightweight
 * renderer per audible tab: it exists only while the tab is audible, shares DotMatrix's single paint loop (about 30 a second, stopped
 * while the window is hidden or minimised) and, with animations Off, is the same bars held still. The CSS swaps it for the x on hover
 * and keyboard focus (tab-sound.css). */
export function TabSoundMeter({ reducedMotion = false, badge = false }: { reducedMotion?: boolean; badge?: boolean }) {
  return <span className="tab-sound-meter" data-variant={badge ? 'badge' : 'slot'} aria-hidden="true">
    <DotMatrix preset="audio" rows={badge ? 3 : 4} cols={badge ? 3 : 5} snap reducedMotion={reducedMotion} />
  </span>;
}

/** What a muted tab shows where it has no room for the speaker-off button beside its icon (icon-only, pinned and narrow strip tabs, compact
 * icon-only tabs): the same speaker-off glyph as the button, small, on the corner of the site icon in the badge's place and cut-out (tab-sound.css). */
export function TabMutedBadge() {
  return <span className="tab-sound-meter" data-variant="badge" data-state="muted" aria-hidden="true"><VolumeX size={10} /></span>;
}
