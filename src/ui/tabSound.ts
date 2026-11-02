/** Which sound state a tab is in, and what its close slot shows (R4-30). Electron only reports "audible" yes or no, plus the
 * mute the person chose, so this is all the state there is: no levels, no history. */
export type TabSound = 'playing' | 'muted' | null;

/** Muted wins: a muted tab keeps its speaker-off button (the one click that unmutes it) even when the page has gone quiet,
 * exactly as before. Only an audible, unmuted tab shows the equaliser. */
export const tabSound = (tab: { audible?: boolean; muted?: boolean }): TabSound => tab.muted ? 'muted' : tab.audible ? 'playing' : null;

/** What stands in the close slot: the equaliser while a tab plays and nobody is on it, the × the moment the pointer or the
 * keyboard is (so the tab can always be closed). A muted or silent tab shows its ordinary slot. The CSS (tab-sound.css)
 * draws exactly this with :hover and :focus-visible. */
export const closeSlotShows = (sound: TabSound, engaged: boolean): 'meter' | 'close' => sound === 'playing' && !engaged ? 'meter' : 'close';

/** A strip tab at or below this width (px) has no room for a slot beside its title: the close × floats over the title end on hover,
 * so the equaliser becomes a small badge on the site icon instead, as it does on icon-only tabs. Matches the @container rule
 * in BrowserTabs.css. */
export const SLOT_MIN_TAB_WIDTH = 105;
export const soundPlacement = (width: number, iconOnly: boolean): 'slot' | 'badge' => iconOnly || width < SLOT_MIN_TAB_WIDTH ? 'badge' : 'slot';
