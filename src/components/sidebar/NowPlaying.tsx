import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { runtime } from '../../runtime/client';
import { tabCardHost } from '../../runtime/tabCard';
import { tabDisplayTitle } from '../../runtime/tabTitle';
import type { BrowserAction, TabSession } from '../../runtime/types';
import { t } from '../../i18n';
import { mediaToggle } from '../../ui/mediaRows';
import { closedPanel, createVolumeSender, keyLevel, levelAt, muteToggle, rememberLevel, rememberedLevel, shownLevel, stepPanel, volumeChange, volumeGlyph, wheelLevel, type VolumeChange, type VolumeInput, type VolumePanel } from '../../ui/mediaVolume';
import { clock, dotsShown, glowColors, pipState, positionNow, seekAt, seekRatio, trackText, type PlayerInfo } from '../../ui/nowPlaying';
import { heightCurve, landed } from '../../ui/nowPlayingMotion';
import { paletteFromColor, samplePalette } from '../../ui/nowPlayingPalette';
import { isMac } from '../../ui/platform';
import { MEDIA_REF, openBookmarkMenu } from '../../ui/bookmarkMenu';
import { animateSpring, motionSpeed } from '../../ui/sharedMotion';
import { shortcutFor, useShortcutKeys } from '../../ui/shortcutKeys';
import { useAura } from '../../ui/useAura';
import { useMediaInfo } from '../../ui/useMediaInfo';
import { noteUse } from '../../features/metrics/noteUse';
import { DotMatrix } from '../DotMatrix';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { Line, PlayPause, Speaker } from './NowPlayingIcons';
import './now-playing.css';

/** The now-playing card (Beta 14, approved look 13 Nov): a mini player for one tab that plays sound. Compact (48 px: artwork,
 * title, artist, the dot matrix) until a click opens it; open (122 px) it adds the seek bar and the controls, with a moving
 * glow of the artwork's own colours along its bottom edge. A click on a compact card opens it and keeps it open; a click on the
 * open card's header, anywhere else, or Esc folds it. Going to the tab is deliberate: the artwork, or the Go to tab button.
 * Every control reaches the page through main (desktop/media-controls.cjs); what the card shows is what the page says it plays. */

/** Pace of the card's own motion (track change, the volume morph): 0 when motion is off, .7 in Fast, 1 in Premium. */
const pace = (): number => { const speed = motionSpeed(); return speed === 'off' ? 0 : speed === 'fast' ? .7 : 1; };
/** The closed Mini rail, as miniRail.css names it: there the card is drawn as its artwork's tile and its play / pause. */
const MINI_RAIL_CLOSED = '.acira-sidebar.is-mini:not([data-mini=open])';

// ── The glow: the aura waves (src/ui/nowPlayingAura.ts, drawn by src/ui/useAura.ts) ─────────────────────────────────────────────
/** No artwork palette (yet): a quiet neutral light, four near-greys. */
const NEUTRAL_AURA = ['oklch(.74 .012 270)', 'oklch(.74 .01 250)', 'oklch(.74 .012 270)', 'oklch(.74 .01 250)'];

// ── Opening and folding: one set of keyframes, played forward to open and backward to close (the exit is the entrance reversed) ──
interface Flight { list: Animation[]; dir: 1 | -1 }
function flightFor(card: HTMLElement, open: boolean, flight: Flight | null): Flight | null {
  if (flight && flight.list.some(a => a.playState === 'running')) {         // interrupted: the same flight turns round where it is
    if ((flight.dir === 1) !== open) { flight.list.forEach(a => a.reverse()); flight.dir = open ? 1 : -1; }
    return flight;
  }
  // The text that glides is the inner `.np-text.np-in` (the sample's own choice), not its button: the button is stretched to the header's height, so measuring it left the title 6 px low at the first frame.
  const art = card.querySelector<HTMLElement>('.np-art'), text = card.querySelector<HTMLElement>('.np-text.np-in'), more = card.querySelector<HTMLElement>('.np-more');
  const dots = card.querySelector<HTMLElement>('.np-dots'), glow = card.querySelectorAll<HTMLElement>('.np-glow');
  if (!art || !text || !more || !dots) return null;
  // Both layouts are measured; the card animates while laid out full (folding removes `data-full` when it lands).
  const was = card.hasAttribute('data-full');
  card.removeAttribute('data-full');
  const compact = { h: card.getBoundingClientRect().height, art: art.getBoundingClientRect(), text: text.getBoundingClientRect(), dots: dots.getBoundingClientRect(), card: card.getBoundingClientRect() };
  card.setAttribute('data-full', '');
  const full = { h: card.getBoundingClientRect().height, art: art.getBoundingClientRect(), text: text.getBoundingClientRect(), dots: dots.getBoundingClientRect(), card: card.getBoundingClientRect() };
  if (!was && !open) card.removeAttribute('data-full');
  const list: Animation[] = [], opts = { fill: 'both' as FillMode, direction: (open ? 'normal' : 'reverse') as PlaybackDirection };
  const run = (el: Element, keys: Keyframe[], extra: KeyframeAnimationOptions = {}, shape?: (animation: Animation) => void) => {
    const a = animateSpring(el, keys, 'panel.expand', { ...opts, ...extra }, true);
    if (!a) return;
    const effect = a.effect as KeyframeEffect; effect.updateTiming({ easing: landed(String(effect.getTiming().easing)) });
    shape?.(a); list.push(a);
  };
  const dy = (a: DOMRect, b: DOMRect, ca: DOMRect, cb: DOMRect) => (a.top - ca.top) - (b.top - cb.top);
  run(card, [{ height: `${compact.h}px` }, { height: `${full.h}px` }], {}, a => { const e = a.effect as KeyframeEffect, timing = e.getTiming(); e.updateTiming(heightCurve(String(timing.easing), Number(timing.duration), Math.abs(full.h - compact.h), devicePixelRatio)); });
  run(art, [{ transform: `translate(${compact.art.left - full.art.left}px,${dy(compact.art, full.art, compact.card, full.card)}px) scale(${compact.art.width / full.art.width})` }, { transform: 'none' }]);
  run(text, [{ transform: `translate(${compact.text.left - full.text.left}px,${dy(compact.text, full.text, compact.card, full.card)}px)` }, { transform: 'none' }]);
  // The one dot matrix glides with the header: it is the same element at the right end in both layouts.
  run(dots, [{ transform: `translate(${compact.dots.left - full.dots.left}px,${dy(compact.dots, full.dots, compact.card, full.card)}px)` }, { transform: 'none' }]);
  run(more, [{ opacity: 0, filter: 'blur(4px)', transform: 'translateY(-6px)' }, { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-5px)', offset: .22 }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }]);
  glow?.forEach(g => run(g, [{ opacity: 0 }, { opacity: 0, offset: .15 }, { opacity: 1 }]));
  if (!list.length) { if (!open) card.removeAttribute('data-full'); return null; }
  const mine: Flight = { list, dir: open ? 1 : -1 };
  void Promise.all(list.map(a => a.finished)).then(() => {
    if (mine.dir === -1) card.removeAttribute('data-full');
    list.forEach(a => a.cancel());
  }, () => {});
  return mine;
}

// ── One card ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface CardProps { tab: TabSession; main: boolean; full: boolean; onOpen: () => void; onFold: () => void; onGo: () => void; active: boolean; dispatch: (action: BrowserAction) => void; reduced: boolean }
const sendMedia = (tabId: string, command: Record<string, unknown>) => runtime.browserCommand({ type: 'media', tabId, ...command } as Parameters<typeof runtime.browserCommand>[0]).catch(() => undefined);

/** Beta 14.1 (battery): the cards whose light is on for the visible tab (open and playing, the active tab's card). While there is one the root wears
 * `data-np-light` and the sidebar's edge light never rests for want of input (ui/edgeBreath.ts): someone watching or listening is not idle. */
const lightOn = new Set<string>();
const publishLight = () => { if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-np-light', lightOn.size > 0); };

export function NowPlayingCard({ tab, main, full, onOpen, onFold, onGo, active, dispatch, reduced }: CardProps) {
  useShortcutKeys();
  const card = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null), flight = useRef<Flight | null>(null), shown = useRef(full);
  const { info, answeredAt, art, refresh } = useMediaInfo(tab, full);
  const host = tabCardHost(tab.url), text = trackText(info, tabDisplayTitle(tab) || tab.url, host);
  const playing = tab.media === 'playing', live = !!info?.live, pip = pipState(info);
  const [palette, setPalette] = useState<string[] | null>(null), [hover, setHover] = useState(false), [long, setLong] = useState(false), [scrub, setScrub] = useState<number | null>(null);

  // ── Track change: the old track stays drawn on top while it vapors out and the new one forms (CSS np-out / np-in) ──
  const key = info ? `${info.artSrc ?? ''}\n${info.title}\n${info.artist}` : null;
  const [old, setOld] = useState<{ title: string; artist: string; art: string | null; position: number; duration: number | null; live: boolean } | null>(null);
  const last = useRef<{ key: string | null; shown: NonNullable<typeof old> | null }>({ key: null, shown: null });
  const nowShown = { title: text.title, artist: text.artist, art, position: positionNow(info ?? { position: 0, duration: null, rate: 1, playing: false, live: false }, answeredAt, answeredAt), duration: info?.duration ?? null, live };
  useLayoutEffect(() => {
    const before = last.current;
    // A new track swaps in the vapor way; so does the first answer when it names the track differently from the tab (never a cut).
    const named = before.shown && (before.shown.title !== nowShown.title || before.shown.artist !== nowShown.artist);
    if (key !== null && before.shown && pace() && (before.key !== null ? before.key !== key : named)) setOld(before.shown);
    if (key !== null) last.current = { key, shown: nowShown };
    else last.current = { ...before, shown: nowShown };
  }, [key]);// eslint-disable-line react-hooks/exhaustive-deps

  // A long title runs as a marquee while the card is open and playing; it fades over its last 18 px, never cut.
  useLayoutEffect(() => {
    const el = card.current?.querySelector<HTMLElement>('.np-text:not(.np-out) .np-title'), run = el?.firstElementChild as HTMLElement | null; if (!el || !run) return;
    // A long title's box starts 12px left of the text column (its blank fade padding, now-playing.css): the room is the column's.
    const measure = () => setLong(run.scrollWidth - (long ? 32 : 0) > el.clientWidth - (long ? 12 : 0) + 1);
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [text.title, full, long]);

  // The glow's colours: read once per picture (at idle), eased to when the track changes.
  // The glow follows the video's own picture (the artwork main fetched), never the site's icon. The last colours stay while the next picture comes (a playlist moving on
  // eases from one set to the next, never through grey); a card whose page offers no picture at all takes the site's colour.
  useEffect(() => { if (!art) return; let alive = true; void samplePalette(art).then(p => { if (alive) setPalette(p); }); return () => { alive = false; }; }, [art]);
  const siteTint = useMemo(() => paletteFromColor(tab.siteColor), [tab.siteColor]);
  const auraColors = useMemo(() => glowColors({ palette, pictureComing: !!art || !!info?.artSrc, siteTint, neutral: NEUTRAL_AURA }), [palette, art, info?.artSrc, siteTint]);
  useAura(wrap, auraColors, full, playing, reduced);
  useLayoutEffect(() => { if (!(active && playing && full)) return undefined; lightOn.add(tab.id); publishLight(); return () => { lightOn.delete(tab.id); publishLight(); }; }, [active, playing, full, tab.id]);

  // ── Open and fold (the card's `data-full` is owned here, never by render, so a folding card keeps its layout until it lands) ──
  useLayoutEffect(() => { card.current?.toggleAttribute('data-full', full); }, []);// eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = card.current; if (!el || shown.current === full) return; shown.current = full;
    const f = flightFor(el, full, flight.current); flight.current = f;
    if (!f) el.toggleAttribute('data-full', full);
  }, [full]);

  // ── Volume: the other controls step aside and the slider forms from the speaker (the existing slider, same timing rules) ──
  const level = useRef(rememberedLevel(tab.id) ?? 1), muted = useRef(!!tab.muted), start = useRef(level.current), pressing = useRef(false), local = useRef(0);
  const [value, setValue] = useState(() => shownLevel(level.current, !!tab.muted));
  const [panel, setPanel] = useState<VolumePanel>(closedPanel);
  // `ahead`: a timer can fire a hair before the clock it was set from reads its deadline, and a tick that finds the deadline not yet
  // reached changes nothing, so nothing re-arms the timer and the slider would stay open for good. The tick looks a few ms ahead.
  const step = (input: VolumeInput, ahead = 0) => setPanel(current => stepPanel(current, input, performance.now() + ahead));
  const sender = useMemo(() => createVolumeSender(next => runtime.browserCommand({ type: 'media', tabId: tab.id, action: 'volume', level: next })), [tab.id]);
  const rail = useRef<HTMLDivElement>(null), seekRail = useRef<HTMLDivElement>(null), volume = useRef<HTMLDivElement>(null);
  // What the page plays at (its own control may have moved it): taken from the answer unless the hand is on the slider.
  useEffect(() => {
    const read = info?.volume; if (read == null || pressing.current || performance.now() - local.current < 1500) return;
    if (!muted.current) { level.current = read; setValue(read); } else if (rememberedLevel(tab.id) === undefined && read > 0) level.current = read;
  }, [info?.volume, tab.id]);
  useEffect(() => { if (pressing.current) return; muted.current = !!tab.muted; setValue(shownLevel(level.current, !!tab.muted)); }, [tab.muted]);
  const apply = (change: VolumeChange, shownValue: number) => {
    local.current = performance.now(); level.current = change.level; rememberLevel(tab.id, change.level); setValue(shownValue);
    if (change.page !== null) sender.set(change.page);
    if (change.mute === true) { muted.current = true; dispatch({ type: 'tab.mute', id: tab.id, muted: true }); }
    else if (change.mute === false) { muted.current = false; sender.after(() => dispatch({ type: 'tab.mute', id: tab.id, muted: false })); }
  };
  const move = (next: number) => { const change = volumeChange(next, { muted: muted.current, level: level.current, start: start.current }); apply(change, change.page ?? 0); };
  const toggleMute = () => { const change = muteToggle({ muted: muted.current, level: level.current }); apply(change, change.mute ? 0 : change.level); step({ type: 'nudge' }); };
  useEffect(() => {
    if (!panel.open || panel.closeAt === null) return;
    const timer = setTimeout(() => step({ type: 'tick' }, 8), Math.max(0, panel.closeAt - performance.now()));
    return () => clearTimeout(timer);
  }, [panel]);
  useEffect(() => { if (!full) step({ type: 'leave' }); }, [full]);
  const sliderEl = useRef<HTMLDivElement>(null), morph = useRef<Animation[]>([]), morphSeen = useRef(false);
  useLayoutEffect(() => {
    const el = card.current; if (!el) return; const k = pace();
    morph.current.forEach(a => a.cancel()); morph.current = [];
    if (!k || (!panel.open && !morphSeen.current)) { if (panel.open) sliderEl.current?.focus({ preventScroll: true }); return; }
    morphSeen.current = true;
    const buttons = [...el.querySelectorAll<HTMLElement>('.np-ctrl .np-btn:not(.np-volbtn)')].filter(b => getComputedStyle(b).display !== 'none'), body = el.querySelector<HTMLElement>('.np-vol');
    const dir = panel.open ? 'normal' : 'reverse', D = 300 * k;
    buttons.forEach((b, i) => morph.current.push(b.animate([{ opacity: 1, filter: 'blur(0px)', transform: 'none' }, { opacity: 0, filter: 'blur(3px)', transform: 'translateX(8px)' }], { duration: D * .62, delay: (panel.open ? buttons.length - 1 - i : i) * 18 * k, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both', direction: dir })));
    if (body) morph.current.push(body.animate([{ opacity: 0, clipPath: 'inset(-6px 100% -6px -6px)', transform: 'translateX(-6px)' }, { opacity: 0, clipPath: 'inset(-6px 100% -6px -6px)', transform: 'translateX(-6px)', offset: .25 }, { opacity: 1, clipPath: 'inset(-6px -6px -6px -6px)', transform: 'none' }], { duration: D, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both', direction: dir }));
    // Closed: once the controls are home the animations go, so the CSS (a dimmed PiP, hover) owns them again.
    if (!panel.open) { const mine = [...morph.current]; void Promise.all(mine.map(a => a.finished)).then(() => mine.forEach(a => a.cancel()), () => {}); }
    else sliderEl.current?.focus({ preventScroll: true });
  }, [panel.open]);
  useEffect(() => () => { morph.current.forEach(a => a.cancel()); flight.current?.list.forEach(a => a.cancel()); }, []);
  // The wheel needs a listener that may cancel (React's is passive): over the slider it sets the level and never scrolls the list.
  useEffect(() => {
    const el = volume.current; if (!el || !panel.open) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); start.current = level.current; move(wheelLevel(shownLevel(level.current, muted.current), event.deltaY, event.deltaX)); step({ type: 'nudge' }); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const volumeAt = (x: number) => { const r = rail.current?.getBoundingClientRect(); if (r) move(levelAt(x, r)); };
  const volumeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); sliderEl.current?.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    pressing.current = true; start.current = level.current; step({ type: 'press' }); volumeAt(event.clientX);
  };
  const volumeUp = () => { if (!pressing.current) return; pressing.current = false; step({ type: 'release' }); };
  const volumeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); step({ type: 'escape' }); return; }
    if (event.key === 'm' || event.key === 'M') { event.preventDefault(); event.stopPropagation(); toggleMute(); return; }
    const next = keyLevel(shownLevel(level.current, muted.current), event.key);
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); start.current = level.current; move(next); step({ type: 'nudge' });
  };

  // ── Seek ──
  const duration = info?.duration ?? 0, ratio = seekRatio(info?.position ?? 0, info?.duration ?? null, live);
  const held = useRef<{ seconds: number; at: number } | null>(null);
  const settled = held.current && (performance.now() - held.current.at > 1800 || answeredAt > held.current.at + 150) ? null : held.current;
  if (!settled) held.current = null;
  const position = scrub ?? settled?.seconds ?? (info ? positionNow(info, answeredAt, answeredAt) : 0);
  // The bar glides to where the position will be at the next answer, so a second's step is a line, not a tick.
  const ahead = scrub !== null || settled || !info ? position : positionNow(info, answeredAt, answeredAt + 1000);
  const barRatio = duration ? Math.min(1, Math.max(0, ahead / duration)) : 0;
  const seekFrom = (x: number) => { const r = seekRail.current?.getBoundingClientRect(); if (r && duration) setScrub(seekAt(x, r, duration)); };
  const seekEnd = () => {
    if (scrub === null) return;
    const to = scrub; held.current = { seconds: to, at: performance.now() }; setScrub(null);
    void sendMedia(tab.id, { action: 'seek', seconds: to }).then(() => refresh(120));
  };
  const seekKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!duration) return;
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : event.key === 'PageUp' ? 30 : event.key === 'PageDown' ? -30 : 0;
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, duration - 1) : Math.min(duration, Math.max(0, position + delta));
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation();
    held.current = { seconds: to, at: performance.now() }; setScrub(null);
    void sendMedia(tab.id, { action: 'seek', seconds: to }).then(() => refresh(120));
  };

  // ── The other controls ──
  const toggle = () => { void runtime.browserCommand(mediaToggle(tab)).catch(() => {}); refresh(300); };
  const skip = (direction: -1 | 1) => { void sendMedia(tab.id, { action: 'skip', direction }).then(() => refresh(250)); };
  // Beta 14 (usage counts): one use of picture in picture per entry, counted when main answers that the video went in ('active'), never when it comes back.
  const popOut = () => { if (pip === 'none') return; void sendMedia(tab.id, { action: 'pip' }).then((result: unknown) => { if (result === 'active') noteUse('pictureInPictureManual'); refresh(250); }); };
  const stop = () => { void sendMedia(tab.id, { action: 'stop' }); };
  const pipKeys = shortcutFor('pip', isMac() ? 'Ctrl Alt P' : 'Alt P');
  const pipLabel = pip === 'active' ? t('nowplaying.pipBack') : pip === 'none' ? t('nowplaying.pipNone') : t('nowplaying.pip');
  const pipTip = pip === 'available' && pipKeys ? `${pipLabel}  ${pipKeys}` : pipLabel;

  const palettes = auraColors, fallback = 'var(--np-fallback)';
  const style = { '--np-c1': palettes[0] ?? fallback, '--np-c2': palettes[1] ?? fallback, '--np-c3': palettes[2] ?? fallback, '--np-c4': palettes[3] ?? fallback, '--np-pos': scrub !== null ? (duration ? scrub / duration : 0) : barRatio, '--np-vol': value, '--np-k': pace() || 1 } as CSSProperties;
  const percent = Math.round(value * 100), glyph = volumeGlyph(value, value <= 0), volumeName = `${t('sidebarmedia.volume')}: ${text.title}`;
  const dots = dotsShown(tab, info);
  const goLabel = `${t('rewindpage.goToTab')}: ${text.title}`;
  const go = () => onGo();
  const seekValue = t('nowplaying.seekValue', { elapsed: clock(position), total: clock(duration) });

  return <div ref={wrap} className="np-wrap" data-open={full || undefined} data-main={main || undefined} style={style} data-playing={playing || undefined} data-live={live || undefined} data-noart={!art || undefined} data-media-tab={tab.id}>
    <div ref={card} className="np-card" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openBookmarkMenu(MEDIA_REF, { x: event.clientX, y: event.clientY, width: 2, height: 2 }); }} data-current={active || undefined} data-vol={panel.open || undefined} data-hover={hover || undefined} data-long={long || undefined} data-swap={old ? '' : undefined}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      onPointerDown={event => { if (panel.open && !(event.target as Element).closest('.np-ctrl')) step({ type: 'leave' }); }}
      onClick={event => {
        // A click on the open card's header (title, artist, the empty space) folds it; a click anywhere on a compact card but its
        // artwork and its play button opens it. The artwork and the buttons act for themselves.
        const target = event.target as Element; if (target.closest('button,.np-seek,.np-vol')) return;
        // In the closed Mini rail the card is only its artwork's tile: a click anywhere on the tile goes to the playing tab, as the artwork does (reported 20 Nov); the card never opens there.
        if (event.currentTarget.closest(MINI_RAIL_CLOSED)) { go(); return; }
        if (full && target.closest('.np-head')) onFold(); else if (!full) onOpen();
      }}>
      <div className="np-glow" aria-hidden="true"><div className="np-dim"><canvas className="np-aura"/><span className="np-aura-css"/><div className="np-edge"><canvas className="np-aura-edge"/></div></div></div>
      <div className="np-head">
        <button type="button" className="np-art" data-art={art || undefined} data-sb-focus aria-label={goLabel} title={t('rewindpage.goToTab')} onClick={go}>
          <span key={key ?? 'first'} className="np-art-face np-in" onAnimationEnd={event => { if (event.target === event.currentTarget) setOld(null); }}>
            {/* The site's icon stands in until the picture is here, then the picture fades in over it (never a cut). */}
            <span className="np-art-site" data-covered={art || undefined}><SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={20} error={false} className="np-face-img"/></span>
            {art && <img className="np-art-img np-face-img" src={art} alt="" draggable={false}/>}
          </span>
          {old && <span className="np-art-face np-out" aria-hidden="true">{old.art ? <img className="np-face-img" src={old.art} alt="" draggable={false}/> : <span className="np-art-site"><SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={20} error={false} className="np-face-img"/></span>}</span>}
          <span className="np-art-go" aria-hidden="true"><Line name="goto" size={14}/></span>
          <span className="np-art-site-badge"><SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={12} error={false}/></span>
        </button>
        <button type="button" className="np-text-wrap" data-sb-focus aria-expanded={full} aria-label={`${full ? t('nowplaying.fold') : t('nowplaying.open')}: ${text.title}`} onClick={() => (full ? onFold() : onOpen())}>
          {old && <span className="np-text np-out" aria-hidden="true"><span className="np-title"><span className="np-title-run">{old.title}</span></span><span className="np-artist"><span className="np-artist-name">{old.artist}</span></span></span>}
          <span key={key ?? 'first'} className="np-text np-in">
            <span className="np-title" dir="auto"><span className="np-title-run">{text.title}</span>{long && <span className="np-title-run" aria-hidden="true">{text.title}</span>}</span>
            <span className="np-artist" dir="auto"><span className="np-artist-name">{text.artist}</span></span>
          </span>
        </button>
        {/* The right end: the ONE dot matrix, only while audio is really playing (A10); it fades out with a small blur when paused and keeps its box. A compact card under the pointer offers play / pause in its place. */}
        <span className="np-right">
          <span className="np-dots" data-on={dots || undefined} aria-hidden="true"><DotMatrix preset={dots ? 'audio' : 'off'} rows={4} cols={5} snap tone="ink" reducedMotion={reduced}/></span>
          <button type="button" className="np-btn np-play np-hplay" data-sb-focus aria-label={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} tabIndex={full ? -1 : 0} aria-hidden={full || undefined} onClick={toggle}><PlayPause playing={playing}/></button>
        </span>
        {/* The closed Mini rail's player (Beta 14 final round, the team 01:34 / 03:13): the artwork is the rail's tile and this is its play / pause, on the tile's corner like the site's icon on the open card's artwork. It is drawn in the rail only
            (miniRail.css; everywhere else it is display: none, so it is neither seen nor focusable) and goes away with the text when the sidebar opens. */}
        <button type="button" className="np-btn np-rail-play" data-sb-focus aria-label={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} title={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} onClick={toggle}><PlayPause playing={playing}/></button>
      </div>
      <div className="np-more" inert={!full || undefined}>
        {live
          ? <div className="np-seek np-live"><span className="np-live-rail"/><span className="np-live-label">{t('nowplaying.live')}</span><span className="np-live-rail"/></div>
          : <div className="np-seek" data-scrub={scrub !== null || undefined}>
              <span className="np-time"><span key={key ?? 'first'} className="np-in">{clock(position)}</span>{old && !old.live && <span className="np-out" aria-hidden="true">{clock(old.position)}</span>}</span>
              <div ref={seekRail} className="np-rail-hit" role="slider" tabIndex={0} data-sb-focus aria-label={t('nowplaying.seek')} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} aria-valuetext={seekValue} aria-disabled={!duration || undefined}
                onKeyDown={seekKey}
                onPointerDown={event => { if (event.button !== 0 || !duration) return; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* gone */ } seekFrom(event.clientX); }}
                onPointerMove={event => { if (scrub !== null) seekFrom(event.clientX); }} onPointerUp={seekEnd} onPointerCancel={() => setScrub(null)}>
                <span className="np-rail"><span className="np-fill"/></span><span className="np-knob"/>
              </div>
              <span className="np-time np-time-r"><span key={key ?? 'first'} className="np-in">{duration ? `−${clock(Math.max(0, duration - position))}` : ''}</span>{old && !old.live && old.duration ? <span className="np-out" aria-hidden="true">{`−${clock(old.duration - old.position)}`}</span> : null}</span>
            </div>}
        <div className="np-ctrl">
          <span className="np-lg">
            <button type="button" className="np-btn np-volbtn" data-sb-focus aria-label={volumeName} title={t('sidebarmedia.volume')} aria-expanded={panel.open} onClick={event => step(panel.open ? { type: 'leave' } : { type: 'open', keyboard: event.detail === 0 })}><Speaker level={glyph}/></button>
            <button type="button" className="np-btn np-gotab" data-sb-focus aria-label={goLabel} title={t('rewindpage.goToTab')} inert={panel.open || undefined} onClick={go}><Line name="goto"/></button>
          </span>
          <span className="np-ctrl-main" inert={panel.open || undefined}>
            <span className="np-tg">
              <button type="button" className="np-btn" data-sb-focus aria-label={t('nowplaying.previous')} title={t('nowplaying.previous')} onClick={() => skip(-1)}><Line name="prev"/></button>
              <button type="button" className="np-btn np-play np-rplay" data-sb-focus aria-label={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} title={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} onClick={toggle}><PlayPause playing={playing}/></button>
              <button type="button" className="np-btn" data-sb-focus aria-label={t('nowplaying.next')} title={t('nowplaying.next')} onClick={() => skip(1)}><Line name="next"/></button>
            </span>
            <span className="np-rg">
              <button type="button" className="np-btn np-pipbtn" data-sb-focus data-pip={pip} aria-disabled={pip === 'none' || undefined} aria-pressed={pip === 'active'} aria-label={pipLabel} title={pipTip}
                onClick={popOut} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); openBookmarkMenu(MEDIA_REF, { x: box.left + box.width / 2, y: box.top + box.height / 2, width: 2, height: 2 }); } }}><Line name="pip"/></button>
              <button type="button" className="np-btn np-closebtn" data-sb-focus aria-label={t('nowplaying.close')} title={t('nowplaying.close')} onClick={stop}><Line name="close"/></button>
            </span>
          </span>
          <div ref={volume} className="np-vol" inert={!panel.open || undefined} data-pressing={panel.pressing || undefined} onPointerDown={volumeDown} onPointerMove={event => { if (pressing.current) volumeAt(event.clientX); }} onPointerUp={volumeUp} onPointerCancel={volumeUp} onLostPointerCapture={volumeUp}>
            <div ref={el => { rail.current = el?.querySelector<HTMLDivElement>('.np-rail') ?? null; sliderEl.current = el; }} className="np-vol-track" role="slider" tabIndex={0} aria-label={volumeName} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
              aria-valuetext={value <= 0 ? t('sidebarmedia.muted') : t('sidebarmedia.volumePercent', { percent })} onKeyDown={volumeKey}
              onBlur={event => { if (!card.current?.contains(event.relatedTarget as Node | null)) step({ type: 'leave' }); }}><span className="np-rail"><span className="np-fill"/></span><span className="np-knob"/></div>
            <span className="np-vol-value" aria-hidden="true">{percent}</span>
          </div>
        </div>
      </div>
    </div>
  </div>;
}

/** The block's job for one card: which one is open. `useCards` holds the open card's id; a click outside it, Esc, or the card going away folds it. */
export function useOpenCard(ids: readonly string[]): { open: string | null; setOpen: (id: string | null) => void; keepOpen: (ms?: number) => void } {
  const [open, setOpen] = useState<string | null>(null), grace = useRef(0);
  useEffect(() => { if (open && !ids.includes(open)) setOpen(null); }, [open, ids]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.('.np-wrap[data-open]')) setOpen(null); };
    // Esc folds it when the focus is in the browser's own interface (this document); a key typed in a page never reaches here.
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setOpen(null); };
    // A click in the page itself never reaches this document: the window losing focus to the page counts as a click outside. Going
    // to the tab moves focus there too, and that is not a fold (the card stays open, as the brief says).
    const blur = () => { if (performance.now() > grace.current) setOpen(null); };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); window.removeEventListener('blur', blur); };
  }, [open]);
  const keepOpen = useCallback((ms = 900) => { grace.current = performance.now() + ms; }, []);
  return { open, setOpen, keepOpen };
}
