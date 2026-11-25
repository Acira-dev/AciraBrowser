import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { t } from '../../i18n';
import { feedbackCall, RANKS } from '../../runtime/feedback';
import { useAura } from '../../ui/useAura';
import { ringColor } from '../feedback/AuraTrigger';
import { markName } from '../feedback/words';
import { useWindowInactive } from '../../ui/windowActive';
import './aura-tip.css';

/** The music card's own quiet neutral (NowPlaying.tsx NEUTRAL_AURA), for the Early Member mark: no rank colour. */
const NEUTRAL = ['oklch(.74 .012 270)', 'oklch(.74 .01 250)', 'oklch(.74 .012 270)', 'oklch(.74 .01 250)'];
/** The tip waits for the page's own reveal to settle, then holds this long while the window is focused. */
export const TIP_DELAY = 700, TIP_HOLD = 8000, TIP_ENTER = 320, TIP_LEAVE = 220, TIP_LEAVE_REDUCED = 90;
/** D15: the tip stands beside the picture, in the picture's own row: 12 px clear of the picture, at most 260 px wide, and 12 px short of the workspace's name (the only other thing in that row), so it covers no control. `room` is the run the name leaves,
 *  handed to the stylesheet as `--aura-room`. A name long enough to leave less than TIP_MIN_ROOM (about 38 letters at 24 px) gives the tip that least, and its words wrap. */
export const TIP_GAP = 12, TIP_MIN_ROOM = 140, TIP_MAX = 260;
export function tipRoom(hostStart: number, titleEnd: number, rtl: boolean): number {
  // LTR: the title ends at its right edge and the picture's row starts at its left; RTL mirrors it. Room = the free run between them, less 12 px on each side.
  const free = rtl ? titleEnd - hostStart : hostStart - titleEnd;
  return Math.max(TIP_MIN_ROOM, Math.min(TIP_MAX, Math.floor(free - 2 * TIP_GAP)));
}

/** Four tints of one rank colour for the glow (the card's glow takes four colours): the colour, a lighter one, the colour, a darker one. */
export function rankTints(hex: string): string[] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return NEUTRAL;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const toward = (to: number, k: number) => `rgb(${[r, g, b].map(v => Math.round(v + (to - v) * k)).join(', ')})`;
  return [toward(0, 0), toward(255, .32), toward(0, 0), toward(0, .24)];
}
/** What the tip says: the rank's own words ("You are now a Founding Contributor", the words the profile viewer's notes use) or the mark's name. */
export const tipText = (owed: string) => owed.startsWith('rank:') && (RANKS as readonly string[]).includes(owed.slice(5)) ? t(`feedback.note.rank.${owed.slice(5)}` as Parameters<typeof t>[0])
  : /^invite:[1-9]\d{0,6}$/.test(owed) ? t('feedback.note.invitedBubble', { count: Number(owed.slice(7)) }) : /^points:[1-9]\d{0,6}$/.test(owed) ? t('feedback.note.pointsAccepted', { count: Number(owed.slice(7)) }) : markName();   // Beta 14.5: "Your friend joined: +25 points". Beta 14.4: "Your report was accepted: +25 points" (one acceptance, or the total of several that arrived together)

/** Beta 14 on the new tab page (the team's notes 17 Nov, A4): when this profile is owed an aura (a new mark or rank), a small tooltip points up at the profile picture, with the music player's moving glow on
 *  its border (the same markup and the same drawing, src/ui/useAura.ts, flipped so the waves and the lit edge face the picture). It replaces the aura layer on this page (AuraTrigger.tsx stands down while the tip is up).
 *  It closes on a click, on Esc, or after eight seconds of the window being focused, by the entrance backwards, and then tells main the aura is done (the ring and the quiet dot follow, as at the end of the
 *  layer's aura). Motion reduced: a plain quick fade and a still glow. The glow is the music card's glow code, nothing new is drawn here. */
export function AuraTip({ owed, reduced, rank = null }: { owed: string | null; reduced: boolean; rank?: string | null }) {
  const [shown, setShown] = useState<string | null>(null), [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null), told = useRef<string | null>(null);
  const [room, setRoom] = useState(TIP_MAX);
  // It appears once the page has settled, and only while this aura is owed.
  useEffect(() => {
    if (!owed || shown || told.current === owed) return;   // an aura that was shown and closed is not shown again while main catches up
    const id = window.setTimeout(() => { setLeaving(false); setShown(owed); }, TIP_DELAY);
    return () => window.clearTimeout(id);
  }, [owed, shown]);
  const leave = (tell: boolean) => {
    if (!shown || leaving) return;
    setLeaving(true);
    if (tell && told.current !== shown) { told.current = shown; void feedbackCall({ type: 'feedback.aura-tip', id: shown }).catch(() => { /* the window is closing, or not allowed: the next chance asks again */ }); }
  };
  // The aura stopped being owed (it was marked done elsewhere, or the switch went off): the tip leaves the same way, with nothing to tell.
  useEffect(() => { if (shown && !owed) leave(false); });// eslint-disable-line react-hooks/exhaustive-deps
  // Gone from the screen only after its exit has run.
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => { setShown(null); setLeaving(false); }, reduced ? TIP_LEAVE_REDUCED : TIP_LEAVE);
    return () => window.clearTimeout(id);
  }, [leaving, reduced]);
  // Esc, a press anywhere, and the hold (it counts only while the window is focused: an aura nobody saw is not used up).
  useEffect(() => {
    if (!shown || leaving) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') leave(true); };
    const press = () => leave(true);
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', press, true);
    let left = TIP_HOLD;
    const timer = window.setInterval(() => { if (document.hasFocus()) left -= 250; if (left <= 0) leave(true); }, 250);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press, true); window.clearInterval(timer); };
  }, [shown, leaving]);// eslint-disable-line react-hooks/exhaustive-deps
  // The room the workspace's name leaves in the picture's row, now and whenever the row changes size (a window resize, a longer name).
  useLayoutEffect(() => {
    const node = tip.current, host = node?.parentElement, row = host?.parentElement, title = row?.querySelector<HTMLElement>('.nt-workspace-title');
    if (!node || !host || !row || !title) return;
    const measure = () => { const h = host.getBoundingClientRect(), t = title.getBoundingClientRect(), rtl = getComputedStyle(host).direction === 'rtl'; setRoom(tipRoom(rtl ? h.right : h.left, rtl ? t.left : t.right, rtl)); };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(row); observer?.observe(title);
    return () => observer?.disconnect();
  }, [shown]);
  // a rank's bubble glows in that rank's colour; the points bubble in the colour of the rank the member already has (the quiet neutral when there is none yet)
  const colors = useMemo(() => shown?.startsWith('rank:') ? rankTints(ringColor(shown.slice(5))) : (shown?.startsWith('points:') || shown?.startsWith('invite:')) && rank ? rankTints(ringColor(rank)) : NEUTRAL, [shown, rank]);
  const inactive = useWindowInactive();   // 14.5 (battery): the glow holds its frame while the window is not the active one
  useAura(card, colors, Boolean(shown), true, reduced || inactive);
  if (!shown) return null;
  return <div ref={tip} className="nt-aura-tip" data-phase={leaving ? 'out' : 'in'} data-reduced={reduced || undefined} role="status" style={{ '--aura-room': `${room}px` } as CSSProperties} onClick={() => leave(true)}>
    <span className="nt-aura-caret" aria-hidden="true" />
    <div ref={card} className="nt-aura-card">
      <div className="np-glow" aria-hidden="true"><div className="np-dim"><canvas className="np-aura" /><span className="np-aura-css" /><div className="np-edge"><canvas className="np-aura-edge" /></div></div></div>
      <p className="nt-aura-text">{tipText(shown)}</p>
    </div>
  </div>;
}
