import { useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent as ReactKeyboardEvent,type PointerEvent as ReactPointerEvent,type RefObject } from 'react';
import { runtime } from '../../runtime/client';
import { tabCardHost } from '../../runtime/tabCard';
import { tabDisplayTitle } from '../../runtime/tabTitle';
import type { BrowserAction,BrowserSnapshot,TabSession } from '../../runtime/types';
import { mediaTabs,mediaToggle } from '../../ui/mediaRows';
import { closedPanel,createVolumeSender,forgetLevels,keyLevel,levelAt,muteToggle,rememberLevel,rememberedLevel,shownLevel,stepPanel,volumeChange,volumeGlyph,wheelLevel,type VolumeChange,type VolumeGlyphLevel,type VolumeInput,type VolumePanel } from '../../ui/mediaVolume';
import { animateSpring,useListMotion } from '../../ui/sharedMotion';
import { DotMatrix } from '../DotMatrix';
import { Pause,Play } from '../AppIcons';
import { PreviewIcon } from '../PreviewIcon';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import './sidebar-media.css';

import { t } from '../../i18n';
/** Media controls in the sidebar footer (Zen idea 9, "wanted for a long time"): every tab that is playing sound, or that you
 * paused from here, gets a row above the footer with play or pause, the volume, and a jump to the tab. Several can play at
 * once. Main decides what counts (desktop/media-controls.cjs sets `tab.media`); this only draws it.
 *
 * The speaker turns the card into a volume slider (founder, 27 Oct): the card cross-fades away, the speaker glides to the
 * left as the slider's leading glyph, and a track takes the row. Drag anywhere on the row, wheel or arrow keys; the glyph
 * mutes. Let go and it waits (VOLUME_HOLD_MS), then becomes the card again; Esc, focus leaving or the sidebar closing return
 * at once. The timing is ui/mediaVolume.ts (stepPanel); main applies the level to the page. */

/** Asks main for the tab's volume (what the page plays at now): null when there is nothing to read. */
async function readVolume(tabId: string): Promise<number | null> {
  try {
    const value: unknown = await runtime.browserCommand({ type: 'media', tabId, action: 'volume' });
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch { return null; }
}

/** The speaker: a crossed mark when silent, one wave below half, two from half up. The marks cross-fade (opacity only). The
 * same drawing as the editor family's Volume2/VolumeX, so the card's speaker and the slider's glyph are one shape. */
function VolumeGlyph({ level }: { level: VolumeGlyphLevel }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' } as const;
  return <svg className="sb-media-vol-icon" data-level={level} viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" focusable="false">
    <path d="M2 6.1h2.6L8.2 3v10L4.6 9.9H2z" fill="currentColor"/>
    <path className="sb-media-vol-wave1" d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8" {...stroke}/>
    <path className="sb-media-vol-wave2" d="M12.2 3.8a6 6 0 0 1 0 8.4" {...stroke}/>
    <path className="sb-media-vol-x" d="M10.6 6.2l3.6 3.6M14.2 6.2l-3.6 3.6" {...stroke}/>
  </svg>;
}

/** The morph between the card and the slider, on the compositor (transform and opacity). Opening: the card fades and settles
 * back a touch, the speaker glides from its button to the slider's leading place, the track slides out from it and fades in.
 * Closing runs it back; the card's own speaker shows again only once the glyph has landed on it (`data-volume-closing`).
 * Off (or reduced motion) swaps at once. */
function morphVolume(row: HTMLElement, open: boolean, flights: Animation[]): void {
  for (const flight of flights.splice(0)) flight.cancel();
  delete row.dataset.volumeClosing;
  const face = row.querySelector<HTMLElement>('.sb-media-face'), body = row.querySelector<HTMLElement>('.sb-media-vol-body');
  const glyph = row.querySelector<HTMLElement>('.sb-media-vol-glyph'), from = row.querySelector('.sb-media-speaker .sb-media-vol-icon'), to = glyph?.querySelector('.sb-media-vol-icon');
  if (!face || !body || !glyph || !from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), shift = `translate(${a.left - b.left}px,${a.top - b.top}px)`;
  // Fade-through, not a plain cross-fade: the incoming side waits for the outgoing to be mostly gone, so the title never sits
  // over the track; closing, the card waits until the glyph has crossed the play button on its way home.
  const run = (el: Element, keyframes: Keyframe[], token: Parameters<typeof animateSpring>[2], fill: FillMode, opening = false, delay = 0) => {
    const flight = animateSpring(el, keyframes, token, { fill, delay }, opening);
    if (flight) flights.push(flight);
    return Number(flight?.effect?.getTiming().duration) || 0;
  };
  if (open) {
    const out = run(face, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], 'island.content', 'backwards');
    run(glyph, [{ transform: shift }, { transform: 'none' }], 'island.expand', 'backwards', true);
    run(body, [{ opacity: 0 }, { opacity: 1 }], 'island.content', 'backwards', false, out * .45);
    run(body, [{ transform: 'translateX(-10px)' }, { transform: 'none' }], 'island.expand', 'backwards', true);
    return;
  }
  const home = run(glyph, [{ transform: 'none' }, { transform: shift }], 'island.collapse', 'both');
  run(body, [{ opacity: 1 }, { opacity: 0 }], 'island.content', 'both');
  run(body, [{ transform: 'none' }, { transform: 'translateX(-6px)' }], 'island.collapse', 'both');
  run(face, [{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], 'island.content', 'backwards', false, home * .5);
  if (!flights.length) return;
  row.dataset.volumeClosing = '';
  const mine = [...flights], land = () => {
    if (mine.some(flight => !flights.includes(flight))) return;   // a newer morph took over
    delete row.dataset.volumeClosing;
    for (const flight of flights.splice(0)) flight.cancel();
  };
  void Promise.all(mine.map(flight => flight.finished)).then(land, () => {});
}

function MediaRow({ tab, active, dispatch, reduced }: { tab: TabSession; active: boolean; dispatch: (action: BrowserAction) => void; reduced: boolean }) {
  const title = tabDisplayTitle(tab) || tab.url, playing = tab.media === 'playing', host = tabCardHost(tab.url);
  const row = useRef<HTMLDivElement>(null), dial = useRef<HTMLDivElement>(null), slider = useRef<HTMLDivElement>(null), speaker = useRef<HTMLButtonElement>(null);
  const flights = useRef<Animation[]>([]);
  // The level underneath (what unmuting comes back to) and what the slider shows (0 while muted).
  const level = useRef(rememberedLevel(tab.id) ?? 1), muted = useRef(!!tab.muted), start = useRef(level.current), pressing = useRef(false);
  const [value, setValue] = useState(() => shownLevel(level.current, !!tab.muted));
  const [panel, setPanel] = useState<VolumePanel>(closedPanel);
  const step = (input: VolumeInput) => setPanel(current => stepPanel(current, input, performance.now()));
  const sender = useMemo(() => createVolumeSender(next => runtime.browserCommand({ type: 'media', tabId: tab.id, action: 'volume', level: next })), [tab.id]);

  // The page's own level, read when the card appears and each time the slider opens (the site's control may have moved it).
  const refresh = () => void readVolume(tab.id).then(read => {
    if (read === null || pressing.current) return;
    if (!muted.current) { level.current = read; setValue(read); } else if (rememberedLevel(tab.id) === undefined && read > 0) level.current = read;
  });
  useEffect(refresh, [tab.id]);// eslint-disable-line react-hooks/exhaustive-deps
  // Muted from elsewhere (the tab's sound badge, the menu): follow it, except under a held pointer (the drag owns the value).
  useEffect(() => { if (pressing.current) return; muted.current = !!tab.muted; setValue(shownLevel(level.current, !!tab.muted)); }, [tab.muted]);

  const apply = (change: VolumeChange, shown: number) => {
    level.current = change.level; rememberLevel(tab.id, change.level); setValue(shown);
    if (change.page !== null) sender.set(change.page);
    if (change.mute === true) { muted.current = true; dispatch({ type: 'tab.mute', id: tab.id, muted: true }); }
    else if (change.mute === false) { muted.current = false; sender.after(() => dispatch({ type: 'tab.mute', id: tab.id, muted: false })); }
  };
  // The slider shows where it was moved to; at 0 the level underneath stays what it was before (volumeChange).
  const move = (next: number) => { const change = volumeChange(next, { muted: muted.current, level: level.current, start: start.current }); apply(change, change.page ?? 0); };
  const toggleMute = () => { const change = muteToggle({ muted: muted.current, level: level.current }); apply(change, change.mute ? 0 : change.level); step({ type: 'nudge' }); };
  const fromPointer = (x: number) => { const rail = slider.current?.querySelector('.sb-media-vol-rail')?.getBoundingClientRect(); if (rail) move(levelAt(x, rail)); };

  // The wait: the timer is the state machine's deadline, so any input that moves it restarts the wait.
  useEffect(() => {
    if (!panel.open || panel.closeAt === null) return;
    const timer = setTimeout(() => step({ type: 'tick' }), Math.max(0, panel.closeAt - performance.now()));
    return () => clearTimeout(timer);
  }, [panel]);
  const opened = useRef(false);
  useLayoutEffect(() => {
    const el = row.current; if (!el || opened.current === panel.open) return;
    const hadFocus = !!dial.current?.contains(document.activeElement);
    opened.current = panel.open; morphVolume(el, panel.open, flights.current);
    if (panel.open) { slider.current?.focus({ preventScroll: true }); refresh(); }
    else if (hadFocus) speaker.current?.focus({ preventScroll: true });
  }, [panel.open]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const flight of flights.current.splice(0)) flight.cancel(); }, []);
  // The wheel needs a listener that may cancel (React's is passive): over the slider it sets the level, never scrolls the list.
  useEffect(() => {
    const el = dial.current; if (!el || !panel.open) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); start.current = level.current; move(wheelLevel(shownLevel(level.current, muted.current), event.deltaY, event.deltaX)); step({ type: 'nudge' }); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('.sb-media-vol-glyph')) return;
    event.preventDefault(); slider.current?.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    pressing.current = true; start.current = level.current; step({ type: 'press' }); fromPointer(event.clientX);
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => { if (pressing.current) fromPointer(event.clientX); };
  const up = () => { if (!pressing.current) return; pressing.current = false; step({ type: 'release' }); };
  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); step({ type: 'escape' }); return; }
    if (event.key === 'm' || event.key === 'M') { event.preventDefault(); event.stopPropagation(); toggleMute(); return; }
    const next = keyLevel(shownLevel(level.current, muted.current), event.key);
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); start.current = level.current; move(next); step({ type: 'nudge' });
  };
  const percent = Math.round(value * 100), glyph = volumeGlyph(value, value <= 0);
  const volumeName = `${t('sidebarmedia.volume')}: ${title}`;
  return <div ref={row} className="sb-media-row" data-media-tab={tab.id} data-playing={playing || undefined} data-current={active || undefined} data-volume={panel.open || undefined}
    onBlur={event => { if (!row.current?.contains(event.relatedTarget as Node | null)) step({ type: 'leave' }); }}>
    <div className="sb-media-face" inert={panel.open || undefined}>
      <button type="button" className="sb-media-main" data-sb-focus aria-label={`${t('rewindpage.goToTab')}: ${title}`} title={t('rewindpage.goToTab')}
        onClick={() => { if (!active) dispatch({ type: 'tab.select', id: tab.id }); }}>
        <span className="sb-media-icon"><SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} error={false}/></span>
        <span className="sb-media-text"><span className="sb-media-title">{title}</span><span className="sb-media-meta"><span className="sb-media-host">{host}</span><DotMatrix preset={playing && !tab.muted ? 'bars' : 'off'} size={12} reducedMotion={reduced}/></span></span>
      </button>
      <button type="button" className="sb-media-act sb-media-play" data-sb-focus aria-label={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} title={playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')}
        onClick={() => void runtime.browserCommand(mediaToggle(tab)).catch(() => {})}><PreviewIcon icon={playing ? Pause : Play} size={14}/></button>
      <button ref={speaker} type="button" className="sb-media-act sb-media-speaker" data-sb-focus aria-label={volumeName} title={t('sidebarmedia.volume')} aria-expanded={panel.open}
        onClick={event => step({ type: 'open', keyboard: event.detail === 0 })}><VolumeGlyph level={glyph}/></button>
    </div>
    <div ref={dial} className="sb-media-volume" inert={!panel.open || undefined} data-pressing={panel.pressing || undefined} style={{ '--vol': value } as CSSProperties}
      onPointerDown={down} onPointerMove={drag} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      <button type="button" className="sb-media-act sb-media-vol-glyph" data-sb-focus aria-pressed={value <= 0} aria-label={value <= 0 ? t('app.unmuteTab') : t('app.muteTab')}
        onClick={toggleMute}>{/* no title: the glyph flies in under the pointer that just clicked, and a tooltip would pop up over the slider */}<VolumeGlyph level={glyph}/></button>
      <div className="sb-media-vol-body">
        <div ref={slider} className="sb-media-vol-track" role="slider" tabIndex={0} aria-label={volumeName} aria-orientation="horizontal"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={value <= 0 ? t('sidebarmedia.muted') : t('sidebarmedia.volumePercent', { percent })} onKeyDown={key}>
          <span className="sb-media-vol-rail"><span className="sb-media-vol-fill"/></span><span className="sb-media-vol-knob"/>
        </div>
        <span className="sb-media-vol-value" aria-hidden="true">{percent}</span>
      </div>
    </div>
  </div>;
}

/** R4-31: the hairline above the media block is drawn only when the sidebar's list would otherwise run into the cards: its
 * last row ends within 16px of the block, or it scrolls. With room above (a short list), the cards stand free and there is no line. */
const CLEAR = 16;
function useListTouches(block: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [touches, setTouches] = useState(false);
  useLayoutEffect(() => {
    const el = block.current, scroll = el?.parentElement?.querySelector<HTMLElement>('.sb-scroll');
    if (!on || !el || !scroll) return;
    const measure = () => {
      const last = scroll.lastElementChild as HTMLElement | null, free = last ? scroll.clientHeight - (last.offsetTop + last.offsetHeight) : scroll.clientHeight;
      setTouches(scroll.scrollHeight > scroll.clientHeight + 1 || free < CLEAR);
    };
    const resize = new ResizeObserver(measure), watch = () => { resize.disconnect(); resize.observe(scroll); for (const child of scroll.children) resize.observe(child); };
    const mutate = new MutationObserver(() => { watch(); measure(); });
    watch(); measure();
    mutate.observe(scroll, { childList: true });
    return () => { resize.disconnect(); mutate.disconnect(); };
  }, [on]);
  return touches;
}

export function SidebarMedia({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const live = mediaTabs(state), held = useRef<TabSession[]>([]), block = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const touches = useListTouches(block, live.length > 0 || held.current.length > 0);
  if (live.length) held.current = live;
  // A closed tab's volume goes with it.
  const ids = state.tabs.map(tab => tab.id).join(' ');
  useEffect(() => { forgetLevels(ids.split(' ')); }, [ids]);
  // The block rises in with its first row and settles away after its last: the rows inside glide on the list motion, but a
  // block with no rows has nothing to glide, so these two moments are the block's own.
  const shown = live.length ? live : held.current, count = live.length, before = useRef(0);
  useListMotion(list, live.map(tab => tab.id).join(' '));
  useLayoutEffect(() => {
    const el = block.current, was = before.current; before.current = count;
    if (!el) return;
    if (was === 0 && count > 0) animateSpring(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 'panel.expand', {}, true);
    else if (was > 0 && count === 0) {
      const leaving = animateSpring(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], 'panel.collapse');
      const done = () => { if (before.current === 0) { held.current = []; redraw(n => n + 1); } };
      if (leaving) { leaving.finished.then(done, done); } else done();
    }
  }, [count]);
  if (!shown.length) return null;
  return <div ref={block} className="sb-media" data-leaving={count === 0 || undefined} data-divider={touches || undefined} role="group" aria-label={t('sidebarmedia.region')}>
    <div ref={list} className="sb-media-list">{shown.map(tab => <MediaRow key={tab.id} tab={tab} active={tab.id === state.activeTabId} dispatch={dispatch} reduced={state.settings.reducedMotion}/>)}</div>
  </div>;
}
