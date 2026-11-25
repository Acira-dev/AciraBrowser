// Beta 14: the close-up of the person's own seal and member card, on the Welcome's glass (reported 16 Nov 21:19: the seal preview opened in a dark boxed dialog over the Settings page and felt laggy; "it should
// look like the first preview he saw", the Welcome's card step). It is the SAME popup kind as the Welcome (`welcome`), so everything the Welcome has comes with it and nothing is copied or invented: the whole
// window frosts behind it (desktop/welcome-frost.cjs: the same still, the same sigma 48 blur, the same tint, the same 620 ms ramp on the same curves, started by the page's own `opened` and answered by `frost`),
// the popup's frame, glass, rim and shadow are gone (the Welcome's own rules, welcome.css, keyed on `.b14w6`), and the content sits straight on the glass, centred, its label under it. The way in is the
// Welcome's (each block rises from a soft blur as the frost ramps in) and the way out is the Welcome's exit controller (every block fades and blurs out in place from its current state, on one clock, while
// the frost dissolves; nothing moves, scales or cuts). Out: Escape, a click on the glass (anywhere that is not the seal, the card or a button), the close control, or main asking (a window action).
// The content is what it was in the box, only the container changed: the seal is `SealCloser` shown looked-at-closer (the nine pre-rendered frames that turn with the pointer), the card is the member card
// (tilts under the pointer) with its three Share actions (Copy image, Save picture, Save video: the real clipboard and the download manager through main, src/features/memberCard/share.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Copy, Download, Film, X } from 'lucide-react';
import { t } from '../../i18n';
import { subscribeWelcome, welcomeCall } from '../../runtime/welcome';
import { SealCloser } from '../feedback/SealCloser';
import type { SealKind } from '../feedback/Seal';
import { markName, rankName } from '../feedback/words';
import { MemberCard } from '../memberCard/MemberCard';
import { cardFileName, type MemberCardData } from '../memberCard/cardData';
import { copyCardImage, saveCardPicture, saveCardVideo, type ShareResult } from '../memberCard/share';
import type { CardHandle } from '../memberCard/renderer/index';
import { Btn, R, useSurfaceSetup } from './Welcome';
import './viewer.css';

/** The Welcome's own clock: the frost's ramp (welcome-frost.cjs TIMING.rampMs) and the entrance/exit steps it plays against. */
const FROST_MS = 620, OUT_MS = 300, OUT_STEP = 20;

export type ViewerWhat = 'seal' | 'card';
export interface ViewerProps {
  what: ViewerWhat;
  close: () => void;
  /** The animation speed setting ('off' | 'fast' | ...). */
  speed?: string;
  /** The reduced-motion setting. */
  reduced?: boolean;
  /** The seal to show (the profile's rank, or the Early Member mark) and the member's number for the Insider and Founding seals. */
  seal: { kind: SealKind; number: number | null } | null;
  /** The profile's own card (src/features/memberCard/cardData.ts memberCardData), or null when it has none. */
  card: MemberCardData | null;
}

/** The close-up's size from the room the frame leaves (window - 120): large, and always with its label (and the card's actions) in view. The seal never goes past 300 px: its pre-rendered frames are 672 px for a
 * 558 px coin, which is sharp to about 280 px on a 2x screen. */
export const viewerSizes = (innerHeight: number) => {
  const room = Math.max(300, innerHeight - 120);
  return { seal: Math.round(Math.max(200, Math.min(300, room * 0.5))), card: Math.round(Math.max(180, Math.min(300, (room - 210) / 1.5))) };
};

export function Viewer({ what, close, speed, reduced, seal, card }: ViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  useSurfaceSetup(root);
  // while the viewer is mounted the page's root carries data-welcome (the popup page's own scrollbars and clip rules in welcome.css key on it)
  useLayoutEffect(() => { document.documentElement.setAttribute('data-welcome', ''); return () => document.documentElement.removeAttribute('data-welcome'); }, []);
  const off = !!reduced || speed === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pace = speed === 'fast' ? 0.5 : 1;
  const ms = (x: number) => off ? 0 : Math.round(x * pace);
  const [dark] = useState(() => document.querySelector('.app')?.getAttribute('data-theme') === 'dark');
  const [show, setShow] = useState(false), [leaving, setLeaving] = useState(false);
  const [size, setSize] = useState(() => viewerSizes(window.innerHeight));
  useEffect(() => { const f = () => setSize(viewerSizes(window.innerHeight)); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const timers = useRef<number[]>([]); const after = (delay: number, f: () => void) => { const id = window.setTimeout(f, delay); timers.current.push(id); return id; };
  useEffect(() => () => timers.current.forEach((x) => window.clearTimeout(x)), []);

  // the frost: main starts it when the viewer's page says it opened and says when it has begun ramping; the entrance starts with it (a missed answer starts it anyway after 900 ms, as the Welcome does)
  const awayRef = useRef<() => void>(() => {}), leaveRef = useRef<() => void>(() => {});
  useEffect(() => {
    let shown = false;
    const go = () => { if (shown) return; shown = true; setShow(true); };
    const unsubscribe = subscribeWelcome((event) => { if (event.type === 'frost' && event.phase === 'in') go(); else if (event.type === 'away') awayRef.current(); else if (event.type === 'leave-request') leaveRef.current(); });
    void welcomeCall({ type: 'opened' });
    const fallback = window.setTimeout(go, 900);
    return () => { window.clearTimeout(fallback); unsubscribe(); };
  }, []);

  /** The Welcome's exit controller (Welcome.tsx exitOut, 'all'): the targets cover the whole tree (each `.r6-r`, plus every subtree that holds none); each fades and blurs in place FROM ITS CURRENT opacity
   * and blur (Web Animations, which sit above the CSS entrance, started before React marks the leaving state), an entrance cut short holds where it is, and the viewer closes only after every exit animation
   * and the frost have finished (awaited, with a timeout fallback). */
  const exitOut = (): Promise<unknown> => {
    const r = root.current; if (!r) return Promise.resolve();
    const targets: Element[] = [];
    const walk = (n: Element) => { for (const c of Array.from(n.children)) { if (c.classList.contains('r6-r') || !c.querySelector('.r6-r')) targets.push(c); else walk(c); } };
    walk(r);
    const dur = ms(OUT_MS), anims: Animation[] = [];
    for (const target of targets) {
      const cs = getComputedStyle(target); if (cs.display === 'none') continue;
      const o0 = +cs.opacity, b0 = parseFloat((/blur\(([\d.]+)px\)/.exec(cs.filter) || [])[1] || '0');
      target.getAnimations({ subtree: true }).forEach((a) => a.pause());
      const el = target as HTMLElement; if (el.style) { el.style.opacity = String(o0); el.style.filter = b0 ? `blur(${b0}px)` : ''; el.style.animation = 'none'; if (target.classList.contains('r6-r') && cs.transform !== 'none') el.style.transform = cs.transform; }
      const o = parseFloat(cs.getPropertyValue('--o')); const delay = target.classList.contains('r6-r') && Number.isFinite(o) ? ms(Math.max(0, 6 - Math.min(o, 6)) * OUT_STEP) : 0;
      if (!dur) { anims.push(target.animate([{ opacity: 0 }], { duration: 0, fill: 'forwards' })); continue; }
      const total = delay + dur, from = { opacity: o0, filter: `blur(${b0}px)` };
      anims.push(target.animate([{ ...from, offset: 0 }, { ...from, offset: delay / total, easing: 'cubic-bezier(.4, 0, 1, 1)' }, { opacity: 0, filter: `blur(${Math.max(b0, 10)}px)`, offset: 1 }], { duration: total, fill: 'forwards' }));
    }
    const fallback = new Promise((res) => window.setTimeout(res, dur + 6 * OUT_STEP + 250));
    return Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => 0))), fallback]);
  };
  const leavingAll = useRef(false);
  const leave = useCallback(() => {
    if (leavingAll.current) return;
    leavingAll.current = true;
    const contentOut = exitOut();
    setLeaving(true); void welcomeCall({ type: 'leave' });
    // the popup system's own exit scales its surface toward the anchor: the surface is hidden first so nothing at all can move, everything only fades in place; closes once the content AND the frost are gone
    const frostOut = new Promise((res) => after(ms(FROST_MS) + 80, () => res(0)));
    void Promise.all([contentOut, frostOut]).then(() => { const s = root.current?.closest<HTMLElement>('.acira-popup-surface'); if (s) { s.style.visibility = 'hidden'; s.style.transition = 'none'; s.style.animation = 'none'; s.dataset.wpHid = ''; } close(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  awayRef.current = leave; leaveRef.current = leave;

  // Escape leaves; a press on the glass (anywhere that is not the seal, the card or a control) is a click away. A press outside the frame never reaches the popup system (it would close the viewer without its reverse).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); leaveRef.current(); } };
    const down = (e: PointerEvent) => {
      const target = e.target as Element | null, inRoot = !!(target && root.current?.contains(target));
      if (!inRoot) { e.stopPropagation(); e.preventDefault(); leaveRef.current(); return; }
      if (target && !target.closest('[data-keep], button, a, input, [tabindex]:not([tabindex="-1"])')) { e.preventDefault(); leaveRef.current(); }
    };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', down, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true); };
  }, []);
  // a screen reader hears the viewer's name: focus goes to its label (a heading, not a control: no ring), so Escape works from the first frame
  useEffect(() => { const heading = root.current?.querySelector<HTMLElement>('.v-label'); if (!heading) return; heading.tabIndex = -1; try { heading.focus({ preventScroll: true }); } catch { /* nothing to focus */ } }, []);

  // ── the card's actions: the member card's own three (the same words, the same real clipboard and downloads) ──
  const cardHandle = useRef<CardHandle | null>(null), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<null | 'copy' | 'picture' | 'video'>(null), [note, setNote] = useState<{ text: string; bad: boolean }>({ text: '', bad: false });
  const run = async (kind: 'copy' | 'picture' | 'video', work: (live: CardHandle) => Promise<ShareResult>, done: string) => {
    const live = cardHandle.current; if (!live || busy) return;
    setBusy(kind); setNote({ text: kind === 'video' ? t('memberCard.working') : '', bad: false });
    try { const result = await work(live); setNote(result.ok ? { text: done, bad: false } : result.reason === 'cancelled' ? { text: '', bad: false } : { text: t('memberCard.failed'), bad: true }); }
    catch { setNote({ text: t('memberCard.failed'), bad: true }); }
    finally { setBusy(null); }
  };
  const base = card ? cardFileName(card.rank, card.name) : 'Acira-card';

  const label = what === 'seal' ? (seal ? (seal.kind === 'early' ? markName() : rankName(seal.kind)) : '') : t('memberCard.title');
  return (
    <div ref={root} className="b14w6 b14v" data-view={what} data-dark={dark || undefined} data-btn5="b1" data-show={show || undefined} data-off={off || undefined} data-leaving={leaving || undefined}
      style={{ ['--pace' as string]: off ? 0 : pace, ['--k' as string]: 1 } as CSSProperties} role="dialog" aria-modal="true" aria-label={label}>
      <R t={0} o={0} cls="v-close-wrap"><button type="button" className="wpb wpb-quiet v-close" aria-label={t('app.close')} onClick={leave}><X size={16} strokeWidth={1.9} aria-hidden="true" /></button></R>
      <div className="v-col">
        {what === 'seal'
          ? seal && <R t={0} o={2} dy="0px" cls="v-seal"><div data-keep="" className="v-seal-box" style={{ width: size.seal, height: size.seal }}><SealCloser kind={seal.kind} rest={size.seal} big={size.seal} label={label} number={seal.number} always /></div></R>
          : card && <R t={0} o={2} dy="0px" cls="r6-card-in v-card"><div data-keep="" className="r6-member v-card-box" data-tier={card.rank} style={{ ['--h' as string]: `${size.card * 1.5}px` } as CSSProperties}><MemberCard rank={card.rank} name={card.name} since={card.since} number={card.number} interactive width={size.card} onReady={(ok) => { if (!ok) setReady(false); }} onCard={(live) => { cardHandle.current = live; setReady(!!live); }} /></div></R>}
        <R t={150} o={1} cls="v-label-wrap"><h1 className="r6-title v-label">{label}</h1></R>
        {what === 'card' && card && <>
          <R t={260} o={0} cls="r6-actions v-actions" ><span data-keep="" className="v-actions-row">
            <Btn kind="secondary" className="r6-share-btn" disabled={!ready || !!busy} onClick={() => void run('copy', async (live) => copyCardImage(await live.exportFlat(1200)), t('memberCard.copied'))}><Copy className="r6-share-btn-ico" size={15} strokeWidth={1.8} aria-hidden="true" />{t('memberCard.copy')}</Btn>
            <Btn kind="secondary" className="r6-share-btn" disabled={!ready || !!busy} onClick={() => void run('picture', async (live) => saveCardPicture(await live.exportFlat(1600), `${base}.png`), t('memberCard.pictureSaved'))}><Download className="r6-share-btn-ico" size={15} strokeWidth={1.8} aria-hidden="true" />{t('memberCard.savePicture')}</Btn>
            <Btn kind="secondary" className="r6-share-btn" disabled={!ready || !!busy} onClick={() => void run('video', async (live) => saveCardVideo(await live.recordTilt({ seconds: 6, width: 720 }), `${base}.webm`), t('memberCard.videoSaved'))}><Film className="r6-share-btn-ico" size={15} strokeWidth={1.8} aria-hidden="true" />{t('memberCard.saveVideo')}</Btn>
          </span></R>
          <p className="v-note popup-status" role="status" aria-live="polite" data-bad={note.bad || undefined}>{note.text}</p>
        </>}
      </div>
    </div>
  );
}
