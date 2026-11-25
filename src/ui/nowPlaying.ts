import type { TabSession } from '../runtime/types';

/** The now-playing card (Beta 14): the plain logic behind it, so it can be tested without a window. What a page plays comes
 * from main (desktop/media-controls.cjs `info`, already cleaned there); this holds the rules for what the card shows and when. */

/** What main says a tab plays. `art` is a small data: URL of the artwork, sent only when `artSrc` is not what the card holds. */
export interface PlayerInfo {
  has: boolean; element: boolean; playing: boolean;
  title: string; artist: string; album: string;
  duration: number | null; position: number | null; rate: number; live: boolean; volume: number | null;
  pip: PipState; prev: boolean; next: boolean;
  artSrc: string | null; art: string | null;
}
export type PipState = 'available' | 'active' | 'none';

/** The card's main sound: the latest to begin (`mediaAt`, stamped by main); pausing does not demote it. A tab with no stamp
 * (a card from before the stamp existed) ranks last; on a tie the later tab wins. The same rule as desktop/media-controls.cjs
 * `mainMediaTab`, which Alt+P uses (tests/now-playing-main.test.ts runs both on the same cases). */
export function mainMediaTab<T extends Pick<TabSession, 'media' | 'mediaAt'>>(tabs: readonly T[]): T | null {
  let top: T | null = null;
  for (const tab of tabs) {
    if (tab.media !== 'playing' && tab.media !== 'paused') continue;
    if (!top || (tab.mediaAt ?? 0) >= (top.mediaAt ?? 0)) top = tab;
  }
  return top;
}

/** The tabs the now-playing card looks at: this workspace's, and the other workspaces' of the same profile (the window's scoped view keeps those apart as `otherWorkspaceTabs`, for tab search). A sound playing in another
 * workspace still has a card, and its "go to tab" brings that workspace with it (Beta 14.0, the mini player: the card was drawn from this workspace's tabs only, so switching workspace hid a playing video's controls). */
export const mediaTabsOf = (state: { tabs: readonly TabSession[]; otherWorkspaceTabs?: readonly TabSession[] }): TabSession[] => state.otherWorkspaceTabs?.length ? [...state.tabs, ...state.otherWorkspaceTabs] : [...state.tabs];

/** The cards in order: the main one first, then the rest in tab order, so a card moves only when the main sound changes. */
export function orderCards<T extends Pick<TabSession, 'id' | 'media' | 'mediaAt'>>(tabs: readonly T[]): T[] {
  const live = tabs.filter(tab => tab.media === 'playing' || tab.media === 'paused'), main = mainMediaTab(live);
  return main ? [main, ...live.filter(tab => tab !== main)] : [];
}

/** m:ss, or h:mm:ss from an hour on. Anything that is not a plain number of seconds reads 0:00 (a stream's odd clock never breaks the card). */
export function clock(seconds: number | null | undefined): string {
  const total = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(99 * 3600 + 3599, Math.max(0, Math.round(seconds))) : 0;
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Where the seek bar is: 0..1, or null when there is nothing to seek (live, or the length is not known yet). */
export function seekRatio(position: number | null, duration: number | null, live: boolean): number | null {
  if (live || !duration || !(duration > 0)) return null;
  return Math.min(1, Math.max(0, (position ?? 0) / duration));
}

/** The position now, from the last answer: playing media moves on at its rate between answers, never past its end. */
export function positionNow(info: Pick<PlayerInfo, 'position' | 'duration' | 'rate' | 'playing' | 'live'>, answeredAt: number, now: number): number {
  const at = info.position ?? 0;
  if (!info.playing || info.live) return at;
  const moved = at + Math.max(0, now - answeredAt) / 1000 * (info.rate || 1);
  return info.duration ? Math.min(info.duration, moved) : moved;
}

/** How long to wait before asking main again. The open card needs the position (a second); a closed one only the track's name
 * and artwork; paused media changes rarely; a hidden window asks nothing (null). */
export function pollDelay(state: { playing: boolean; open: boolean; hidden: boolean }): number | null {
  if (state.hidden) return null;
  if (!state.playing) return state.open ? 2500 : 5000;
  return state.open ? 1000 : 2000;
}

/** What the card writes for the track: the page's own title and artist, else the tab's name over its site. */
export function trackText(info: Pick<PlayerInfo, 'title' | 'artist' | 'album'> | null, tabTitle: string, host: string): { title: string; artist: string } {
  const title = info?.title?.trim() || tabTitle.trim() || host;
  const artist = info?.artist?.trim() || info?.album?.trim() || host;
  return { title, artist: artist === title ? host : artist };
}

/** Whether the dot matrix shows: only while audio is really playing (fix A10). The tab's own state says sound is coming out
 * (main sets `playing` only while the page is audible, or muted by the person); a tab muted by the person is silent, and media
 * the page itself has paused is not playing even a moment before the tab's state follows. A page whose sound is not a media
 * element (a game, Web Audio) is judged by the tab's state alone. */
export function dotsShown(tab: Pick<TabSession, 'media' | 'muted'>, info: Pick<PlayerInfo, 'playing' | 'element'> | null): boolean {
  if (tab.media !== 'playing' || tab.muted) return false;
  return !info || !info.element || info.playing;
}

/** The picture-in-picture button's state for the tab: what main found, with a card that has not heard yet reading as unavailable (never a button that pops nothing out). */
export const pipState = (info: Pick<PlayerInfo, 'pip'> | null): PipState => info?.pip ?? 'none';

/** What a click on the seek bar at `x` on the rail asks for, in seconds (the knob's centre follows the pointer, as the volume slider's). */
export function seekAt(x: number, rail: { left: number; width: number }, duration: number, thumb = 12): number {
  const run = rail.width - thumb;
  if (!(run > 0) || !(duration > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, (x - rail.left - thumb / 2) / run)) * duration * 100) / 100;
}

/** The compact card's artwork, the glow and everything that reads colours take the picture's address, else the site's icon. */
export const artworkFor = (art: string | null | undefined, favicon: string | undefined): string | null => art || favicon || null;

/** The four colours the glow follows. The picture's own, while a picture is shown or on its way (so between two tracks the last colours stay until the
 * next picture's arrive, and the glow eases from one to the other, never through grey); with no picture at all, the site's colour; with that unknown (white,
 * grey), a quiet neutral. Never the site's icon: its colours are the logo's, not the video's (and the interface cannot read a remote icon's pixels anyway). */
export function glowColors({ palette, pictureComing, siteTint, neutral }: { palette: string[] | null; pictureComing: boolean; siteTint: string[] | null; neutral: string[] }): string[] {
  if (palette && pictureComing) return palette;
  return siteTint ?? neutral;
}

const PIPS: readonly PipState[] = ['available', 'active', 'none'];
/** Main's answer, checked at the edge: anything that is not the shape it promises is no answer. */
export function readInfo(value: unknown): PlayerInfo | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>, text = (v: unknown) => typeof v === 'string' ? v : '', num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (typeof o.has !== 'boolean') return null;
  return {
    has: o.has, element: o.element === true, playing: o.playing === true,
    title: text(o.title), artist: text(o.artist), album: text(o.album),
    duration: num(o.duration), position: num(o.position), rate: num(o.rate) || 1, live: o.live === true, volume: num(o.volume),
    pip: PIPS.includes(o.pip as PipState) ? o.pip as PipState : 'none', prev: o.prev === true, next: o.next === true,
    artSrc: typeof o.artSrc === 'string' ? o.artSrc : null, art: typeof o.art === 'string' && o.art.startsWith('data:image/') ? o.art : null,
  };
}
