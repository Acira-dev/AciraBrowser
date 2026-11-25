// Beta 14: the one-time "Welcome to Beta 14" screen. Ported from the reference design's approved sample (round 12): every value, curve, duration and size is the sample's; what is new
// here is what the sample did not have (the show-once flag, the profile's real mark and card, Share through the real download manager and clipboard, the words in every language)
// and what is gone is its dead code (the code step, the other fills and variants, the test switches and the console-message hacks).
//
// What it is: the whole window frosts (desktop/welcome-frost.cjs: a still of the window, a true blur of sigma 48 CSS px, one uniform tint) and the welcome sits straight on the glass,
// with no card, box or panel of its own. Steps, the same three for everyone (only the words and the art change):
//   1 Welcome  "Welcome to Beta 14" (the "14" is drawn: Sketch14), a subtitle, six highlights in a 3 x 2 grid, "And 14 more in Beta 14" (swaps the highlights for the list of the
//              other features, in place), Continue.
//   2 Gift     "We've got something for you" with the profile's seal (Insider on an Insider profile, otherwise Early Member). It can be looked at closer as a live 3D coin.
//   3 Card     "Your member card" with the profile's card (tilts under the pointer), Done and Share (copy image, save picture, save video).
// There is NO code step: the invite code lives in the profile viewer ("Enter Insider code") only.
//
// Motion: entrance word by word, then block by block, each rising from a soft blur as the frost ramps in. ONE exit controller (`exitOut`) serves every way out (Continue, See your card,
// Done, Esc, a click on the glass, closing mid-entrance, closing with the coin enlarged): every visible element, canvases, menus and notes included, fades and blurs out together in
// place from its current state, on one clock; nothing moves or scales; the step changes or the screen is removed only after every exit animation and the frost have finished.
// An entrance cut short never jumps to full first. Reduced motion: plain 120 ms fades, the "14" fully drawn, no frost ramp. "Fast" animation speed halves every duration.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Copy, Download, Film, Maximize2, Share } from 'lucide-react';
import { t, type MessageId } from '../../i18n';
import { subscribeWelcome, welcomeCall } from '../../runtime/welcome';
import { Sketch14 } from './Sketch14';
import { FEATURES, MORE, STEPS, type Feature, type WelcomePath, type WelcomeStep } from './welcomeContent';
import { useSealSrc } from '../feedback/Seal';
import { certificateTier } from '../feedback/sealNumbers';
import { loadLiveSeal, releaseLiveSeals, type LiveSeal } from './welcomeCoin';
import { MemberCard } from '../memberCard/MemberCard';
import { cardFileName, type MemberCardData } from '../memberCard/cardData';
import { copyCardImage, saveCardPicture, saveCardVideo, type ShareResult } from '../memberCard/share';
import { canRecordMp4 } from '../memberCard/renderer/mp4';
import { followPointer } from '../../ui/pointerTilt';
import type { CardHandle } from '../memberCard/renderer/index';
import './welcome.css';

/** linear.app hero (measured by the reference design): from {opacity 0, blur 10px, translateY 20%} to rest, 1000 ms, cubic-bezier(.25,.1,.25,1). */
/** The stagger (ms, before the speed setting): words of a title, then blocks. */
const T = { lead: 120, word: 70, afterTitle: 130, block: 190, card: 110, button: 170 };
const OUT_MS = 220, OUT_STEP = 12, FROST_MS = 620, ZOOM_MS = 620;

export interface WelcomeMember { number: number }
export interface WelcomeProps {
  close: () => void;
  /** The animation speed setting ('off' | 'fast' | 'normal'...). */
  speed?: string;
  /** The reduced-motion setting. */
  reduced?: boolean;
  /** The profile's mark now, for the words: the Insider's own on an Insider (or Founding) profile, otherwise Early Member's. */
  path: WelcomePath;
  /** What the profile's own card says (its rank, name, month and number: src/features/memberCard/cardData.ts memberCardData), or null when it has none (the Gift step then shows the Early Member mark and the Card step says so). */
  card: MemberCardData | null;
  /** The Insider build's first-run activation has no answer yet: the Welcome step waits a short moment for it before the Gift step shows the mark. */
  activationPending?: boolean;
  /** The Insider member's number and who let them in (from the signed pass). */
  member: WelcomeMember | null;
  /** 'reveal': an Insider whose pass arrived after the welcome; it starts on the Gift step. */
  mode?: 'welcome' | 'reveal';
  /** The Insider mark was shown (the Gift step on an Insider profile): the reveal is not owed any more. */
  onInsiderShown?: () => void;
  /** D146: the PERSON ended the welcome (its own exit: Done, Escape, a click on the frost). Called once, when the exit starts; never when something else closes the popup. */
  onEnd?: () => void;
}

/** A reveal item: `t` is its start (ms, before the speed setting), `o` its order for the leave (reverse). */
type Rev = { t: number; o: number; dy?: string; cls?: string; children: ReactNode; as?: 'span' | 'div'; style?: CSSProperties };
export function R({ t: start, o, dy, cls = '', children, as = 'div', style }: Rev) {
  const s = { ['--t' as string]: start, ['--o' as string]: o, ...(dy ? { ['--dy' as string]: dy } : {}), ...style } as CSSProperties;
  return as === 'span' ? <span className={`r6-r ${cls}`} style={s}>{children}</span> : <div className={`r6-r ${cls}`} style={s}>{children}</div>;
}

export const Btn = ({ children, onClick, kind = 'primary', arrow = false, disabled, className = '' }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'quiet' | 'secondary'; arrow?: boolean; disabled?: boolean; className?: string }) => (
  <button type="button" className={`wpb wpb-${kind} ${className}`} disabled={disabled} onClick={onClick}>
    <span className="wpb-label">{children}</span>
    {arrow && <span className="wpb-arrow"><ArrowRight className="wpb-arrow-ico" size={15} strokeWidth={2} aria-hidden="true" /></span>}
  </button>
);

/** The drawn "14" of the title, with the plain numeral for screen readers and selection. */
function Living({ reduced }: { reduced: boolean }) {
  return <span className="r6-14" data-sketch="" data-t="14"><span className="k14-sr">14</span><Sketch14 reduced={reduced} /></span>;
}

/** Words of a title, each its own reveal; the word that holds `{n}` carries the drawn 14 (in that spot, whatever the language puts around it). Returns the elements and the time after
 * the last word. */
function words(text: string, t0: number, o0: number, reduced: boolean) {
  const parts = text.split(/\s+/).filter(Boolean), out: ReactNode[] = []; let at = t0, o = o0;
  // right-to-left (beyond the sample, which was never shown in Arabic): "Beta 14" at the end of the title is one left-to-right run, so the 14 stands after Beta as it is written
  const rtl = document.documentElement.dir === 'rtl', latin = (w: string) => /^[A-Za-z0-9{}.,·+-]+$/.test(w);
  let tail = parts.length; if (rtl) while (tail > 0 && latin(parts[tail - 1])) tail--;
  const run: ReactNode[] = [];
  parts.forEach((w, i) => {
    const cut = w.indexOf('{n}');
    const body = cut < 0 ? w : <>{w.slice(0, cut)}<Living reduced={reduced} />{w.slice(cut + 3)}</>;
    const target = rtl && i >= tail && tail < parts.length ? run : out;
    target.push(<R key={i} as="span" t={at} o={o} cls="r6-word">{body}</R>);
    if (i < parts.length - 1) target.push(' ');
    at += T.word; o += 1;
  });
  if (run.length) out.push(<span key="ltr" dir="ltr" style={{ unicodeBidi: 'isolate' }}>{run}</span>);
  return { el: out, t: at - T.word, o };
}

export function useSurfaceSetup(root: React.RefObject<HTMLDivElement | null>) {
  const [surfaceEl, setSurfaceEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = root.current?.closest<HTMLElement>('.acira-popup-surface') ?? null;
    // A close-up or welcome that closes hides its popup surface for good (its own exit leaves nothing for the popup system to scale). The popup layer keeps ONE surface element while the last one is still going away,
    // so one opened again within about a second lands on the hidden surface: a coin that cannot be seen or moved, an X that cannot be pressed. The new one takes the hiding off (nothing to do on a fresh surface).
    if (el && el.dataset.wpHid !== undefined) { delete el.dataset.wpHid; el.style.removeProperty('visibility'); el.style.removeProperty('transition'); el.style.removeProperty('animation'); }
    if (el) el.dataset.wp6 = ''; setSurfaceEl(el); return () => { if (el) delete el.dataset.wp6; };
  }, [root]);
  // The popup system's aperture and formation are finished on their first frame: only our own reveal remains.
  useEffect(() => {
    let frame = 0; const t0 = performance.now();
    const tick = () => { surfaceEl?.getAnimations({ subtree: true }).forEach((a) => { const tg = (a.effect as KeyframeEffect | null)?.target as Element | null; if (tg && root.current?.contains(tg)) return; a.finish(); }); if (performance.now() - t0 < 600) frame = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(frame);
  }, [surfaceEl, root]);
  return surfaceEl;
}

export function Welcome({ close, speed, reduced, path: pathNow, card, activationPending = false, member, mode = 'welcome', onInsiderShown, onEnd }: WelcomeProps) {
  const endRef = useRef(onEnd); endRef.current = onEnd;
  const root = useRef<HTMLDivElement>(null);
  useSurfaceSetup(root);
  // while the welcome is mounted the page's root carries data-welcome (the popup page's own scrollbars and clip rules in welcome.css key on it)
  useLayoutEffect(() => { document.documentElement.setAttribute('data-welcome', ''); return () => document.documentElement.removeAttribute('data-welcome'); }, []);
  const off = !!reduced || speed === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pace = speed === 'fast' ? 0.5 : 1;
  const [step, setStep] = useState<WelcomeStep>(mode === 'reveal' ? 'gift' : 'welcome');
  const [show, setShow] = useState(false), [leaving, setLeaving] = useState<null | 'step' | 'all'>(null);
  /** The mark is decided once, when the Gift step is reached (an Insider profile, otherwise Early Member), so the screen never flips under the person's eyes. */
  const [path, setPath] = useState<WelcomePath>(pathNow);
  const [zoom, setZoom] = useState<'off' | 'in' | 'on' | 'out'>('off');
  const [share, setShare] = useState<'closed' | 'menu'>('closed'), [note, setNote] = useState<null | 'saving' | 'recording' | 'saved' | 'copied' | 'failed'>(null);
  const [all, setAll] = useState(false);
  const [dark] = useState(() => document.querySelector('.app')?.getAttribute('data-theme') === 'dark');
  // no real number and month, no card: the welcome is the Welcome and the Gift (the Gift step ends it), and the progress line counts two
  const steps = card ? STEPS : STEPS.filter((s) => s !== 'card');
  const rank = card?.rank ?? (path === 'insider' ? (certificateTier(member?.number) ?? 'founding') : 'early'), memberNumber = card?.number && /^\d+$/.test(card.number) ? Number(card.number) : null;
  // the seal's picture at rest (the Gift step and the enlarge's start): the file of the member's number, or above the rendered range the live coin's own picture of it (null until it is ready), never another number's
  const sealSrc = useSealSrc(rank, 224, memberNumber, { delayMs: 1500 });   // after the Welcome's own entrance (the frost, the first step's rise), like the coin's preload
  // a rank the sample has no words for (Contributor, Trusted Contributor, Founding Contributor) is named by the rank list's own words, which every language has; the card's title is the card's own "Your card"
  const named = rank !== 'early' && rank !== 'insider', rankName = named ? t(`feedback.rank.${rank}` as 'feedback.rank.founding') : '';
  const cardHandle = useRef<CardHandle | null>(null), [cardReady, setCardReady] = useState(false);
  // Save video makes an MP4 wherever this browser can encode H.264, else a WebM: the menu names the file it will really make
  const [mp4, setMp4] = useState(true);
  useEffect(() => { let alive = true; void canRecordMp4().then((ok) => { if (alive) setMp4(ok); }).catch(() => { if (alive) setMp4(false); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (step === 'gift' && path === 'insider') onInsiderShown?.(); }, [step, path]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The composition scales with the window: 1 at 1280 x 720 (x 0.7 as designed), about 1.27 maximised on a 2560 monitor at 150 %. The frame itself is the window. */
  const kOf = () => 0.7 * Math.max(1, Math.min(1.6, Math.min(window.innerWidth / 1340, window.innerHeight / 780)));
  const [k, setK] = useState(kOf);
  useEffect(() => { const f = () => setK(kOf()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  /** Fit (Beta 14, beyond the sample, whose scale never goes under 0.7): when a step's content is taller than the window leaves room for (a small window, a long language, a large interface
   * scale, the "14 more" list), the whole composition scales down further so the last control is always on screen; never up. At every size the sample was shown at it fits, and nothing changes. */
  const [fit, setFit] = useState(1);
  const stepEl = useRef<HTMLDivElement>(null);
  const featsRef = useRef<HTMLDivElement>(null);
  const sizeFeats = () => {
    const el = featsRef.current, vis = el?.querySelector<HTMLElement>(all ? '.r6-all' : '.r6-grid'); if (!el || !vis) return;
    delete el.dataset.scroll; const natural = vis.offsetHeight; el.style.height = natural + 'px';
    let h = natural;
    // beyond the sample: when the open "14 more" list makes the step taller than the window leaves room for (a small window), the list scrolls inside its own box, so Back and Continue stay on screen
    const content = stepEl.current?.firstElementChild as HTMLElement | null;
    // the highlights box is eased (a height transition): count what is around it plus where it is going
    if (all && content) { const z = parseFloat(stepEl.current?.style.zoom || '') || 1, chrome = content.offsetHeight - el.offsetHeight, room = Math.max(120, window.innerHeight - 120) / z; if (room - chrome >= 140 && chrome + natural > room + 0.5) h = room - chrome; }
    el.style.height = h + 'px'; if (h < natural - 0.5) el.dataset.scroll = '';
  };
  const refit = () => {
    const el = stepEl.current, content = el?.firstElementChild as HTMLElement | null; if (!el || !content) return;   // the step fills the frame: what must fit is its content
    const room = Math.max(120, window.innerHeight - 120);
    /** The content's height on screen once the highlights box has reached the height it is easing to (its height transition would otherwise be measured half way). */
    const height = () => { const feats = featsRef.current, target = parseFloat(feats?.style.height || '') || 0; return (content.offsetHeight - (feats?.offsetHeight ?? 0) + target) * (parseFloat(el.style.zoom) || 1); };
    let f = 1; el.style.zoom = String(k); sizeFeats();
    for (let i = 0; i < 12; i++) {
      const h = height(); if (!h) break;
      if (h <= room + 0.5 && (f >= 1 || h >= room * 0.985)) break;
      const next = Math.min(1, Math.max(0.72, f * Math.pow(room / h, 1.6)));   // the text has floors, so the height falls slower than the scale: step a little harder, and never past a quarter smaller (further, only the floors would be left, and the step scrolls instead)
      if (Math.abs(next - f) < 0.004) break;
      f = next; el.style.zoom = String(k * f); sizeFeats();
    }
    el.style.zoom = String(k * f); sizeFeats();   // what React will also write for this fit
    // what the scale cannot reach (the text has floors: a 150 % interface in a window under about 1000 x 620): the step scrolls inside the frame, Continue is a scroll away (and Enter / the arrow keys always work)
    root.current?.toggleAttribute('data-tall', height() > room + 2);
    setFit((cur) => Math.abs(cur - f) < 0.004 ? cur : f);
  };
  useEffect(() => { window.addEventListener('resize', refit); return () => window.removeEventListener('resize', refit); }); // eslint-disable-line react-hooks/exhaustive-deps
  const kk = k * fit;
  const timers = useRef<number[]>([]); const after = (ms: number, f: () => void) => { const id = window.setTimeout(f, ms); timers.current.push(id); return id; };
  useEffect(() => () => timers.current.forEach((x) => window.clearTimeout(x)), []);
  const ms = (x: number) => off ? 0 : Math.round(x * pace);

  /** Share: the member card's own three (Copy image, Save picture, Save video), the real clipboard and the download manager through main (desktop/member-card-share.cjs). */
  const shareCard = async (kind: 'copy' | 'picture' | 'video') => {
    const live = cardHandle.current; setShare('closed'); if (!card) return;
    // the card is being drawn again (its data changed under the open menu): say so, never nothing at all
    if (!live) { setNote('failed'); after(5200, () => setNote(null)); return; }
    setNote(kind === 'video' ? 'recording' : kind === 'picture' ? 'saving' : null);
    try {
      const base = cardFileName(card.rank, card.name);
      const result: ShareResult = kind === 'copy' ? await copyCardImage(await live.exportFlat(1200))
        : kind === 'picture' ? await saveCardPicture(await live.exportFlat(1600), `${base}.png`) : await saveCardVideo(await live.recordTilt({ seconds: 6, width: 720 }), `${base}.webm`);
      if (result.ok) { setNote(kind === 'copy' ? 'copied' : 'saved'); after(kind === 'copy' ? 2600 : 5200, () => setNote(null)); }
      else if (result.reason === 'cancelled') setNote(null);
      else { setNote('failed'); after(5200, () => setNote(null)); }
    } catch { setNote('failed'); after(5200, () => setNote(null)); }
  };

  // the frost: main starts it when the welcome opens and says when it has started ramping; the reveal starts with it
  useEffect(() => {
    let shown = false;
    const go = () => { if (shown) return; shown = true; setShow(true); };
    const unsubscribe = subscribeWelcome((event) => { if (event.type === 'frost' && event.phase === 'in') go(); else if (event.type === 'away') awayRef.current(); else if (event.type === 'leave-request') leaveRef.current(); });
    void welcomeCall({ type: 'opened' });
    const fallback = window.setTimeout(go, 900);
    return () => { window.clearTimeout(fallback); unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // between steps the vapor is 220 ms + up to 6 x 12 ms (the CSS), and the next step starts with no lead and a shorter rise
  const [stepped, setStepped] = useState(false);
  const hist = useRef<WelcomeStep[]>([]);
  const exitAnims = useRef<Animation[]>([]);
  /** ONE exit controller. The targets cover the whole tree (each `.r6-r`, plus every subtree that holds no `.r6-r`: canvases, layers, menus, toasts); each fades and blurs in place FROM ITS
   * CURRENT opacity and blur (Web Animations, which sit above the CSS animations, started in the same task, before React marks the leaving state), entrances still running inside them are
   * frozen where they are, and the welcome closes or changes step only after every exit animation has finished (awaited, with a timeout fallback). */
  const exitOut = (kind: 'step' | 'all'): Promise<unknown> => {
    const r = root.current; if (!r) return Promise.resolve();
    const targets: Element[] = [];
    const walk = (n: Element) => { for (const c of Array.from(n.children)) {
      if (kind === 'step' && c.classList.contains('r9-progress')) continue;   // the progress line stays between steps
      if (c.classList.contains('r6-r') || !c.querySelector('.r6-r')) targets.push(c); else walk(c); } };
    walk(r);
    const dur = ms(kind === 'all' ? 300 : OUT_MS), stepMs = kind === 'all' ? 20 : OUT_STEP;
    const anims: Animation[] = [];
    for (const target of targets) {
      const cs = getComputedStyle(target); if (cs.display === 'none') continue;
      const o0 = +cs.opacity, b0 = parseFloat((/blur\(([\d.]+)px\)/.exec(cs.filter) || [])[1] || '0');
      target.getAnimations({ subtree: true }).forEach((a) => a.pause());   // an entrance cut short holds where it is (no jump to full)
      // the block's own CSS animation is replaced by its current state, inline, so the CSS exit can't start it from 1 for a frame
      const el = target as HTMLElement; if (el.style) { el.style.opacity = String(o0); el.style.filter = b0 ? `blur(${b0}px)` : ''; el.style.animation = 'none'; if (target.classList.contains('r6-r') && cs.transform !== 'none') el.style.transform = cs.transform; }
      const o = parseFloat(cs.getPropertyValue('--o')); const delay = target.classList.contains('r6-r') && Number.isFinite(o) ? ms(Math.max(0, 6 - Math.min(o, 6)) * stepMs) : 0;
      if (!dur) { anims.push(target.animate([{ opacity: 0 }], { duration: 0, fill: 'forwards' })); continue; }
      // the stagger is a hold inside the animation (not a delay), so the element is held at its current state from the very first frame
      const total = delay + dur, from = { opacity: o0, filter: `blur(${b0}px)` };
      anims.push(target.animate([{ ...from, offset: 0 }, { ...from, offset: delay / total, easing: 'cubic-bezier(.4, 0, 1, 1)' }, { opacity: 0, filter: `blur(${Math.max(b0, 10)}px)`, offset: 1 }], { duration: total, fill: 'forwards' }));
    }
    exitAnims.current = anims;
    const fallback = new Promise((res) => window.setTimeout(res, dur + 6 * stepMs + 250));
    return Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => 0))), fallback]);
  };
  const go = (next: WelcomeStep, back = false) => {
    if (next === step || leaving) return;
    const done = exitOut('step');
    setLeaving('step');
    void done.then(() => {
      if (!back) hist.current.push(step);
      if (next === 'gift') setPath(pathNow);   // the mark is decided when the Gift step is reached
      setLeaving(null); setZoom('off'); setStepped(true); setStep(next);
      // the layers that live across steps (coin, hint, toast) come back to their own CSS state for the next step
      requestAnimationFrame(() => { exitAnims.current.forEach((a) => { const target = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null; a.cancel();
        if (target?.isConnected && target.style) { for (const p of ['opacity', 'filter', 'animation']) target.style.removeProperty(p); target.getAnimations({ subtree: true }).forEach((x) => x.play()); } }); exitAnims.current = []; });
    });
  };
  const goBack = () => { if (leaving || zoom !== 'off') return; const prev = hist.current.pop(); if (prev) go(prev, true); };
  const leavingAll = useRef(false);
  const leave = useCallback(() => {
    if (leaving === 'all' || leavingAll.current) return;
    leavingAll.current = true;
    try { endRef.current?.(); } catch { /* the exit goes on */ }
    const contentOut = exitOut('all');
    setLeaving('all'); void welcomeCall({ type: 'leave' });
    // The popup system's own exit scales its surface toward the anchor (the toolbar button, top right). Our content is already gone by then, but the surface is hidden first so nothing at
    // all can move: everything only fades in place. Closes only once every exit animation has finished AND the frost has dissolved.
    const frostOut = new Promise((res) => after(ms(FROST_MS) + 80, () => res(0)));
    void Promise.all([contentOut, frostOut]).then(() => { const s = root.current?.closest<HTMLElement>('.acira-popup-surface'); if (s) { s.style.visibility = 'hidden'; s.style.transition = 'none'; s.style.animation = 'none'; s.dataset.wpHid = ''; } close(); });
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the seal: small beside the text, enlarges into a live coin ──
  const slot = useRef<HTMLDivElement>(null), zoomEl = useRef<HTMLDivElement>(null), cv = useRef<HTMLDivElement>(null);
  const live = useRef<LiveSeal | null>(null), pose = useRef({ x: 0, y: 0, tx: 0, ty: 0, raf: 0 });
  const BIG = () => Math.round(Math.min(460, (root.current?.clientHeight || 600) * 0.66));
  const dpr = window.devicePixelRatio || 1;
  useEffect(() => { if (step === 'gift') { const id = window.setTimeout(() => { void loadLiveSeal(Math.round(460 * dpr), rank, card?.number ?? null).then((l) => { live.current = l; }, () => undefined); }, ms(1400)); return () => window.clearTimeout(id); } }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = (big: boolean) => {
    const z = zoomEl.current, s = slot.current, r = root.current; if (!z || !s || !r) return;
    const R0 = r.getBoundingClientRect(), S = s.getBoundingClientRect(), B = BIG();
    z.style.width = z.style.height = B + 'px';
    const cx = R0.width / 2 - B / 2, cy = R0.height / 2 - B / 2 - 18;
    const sx = S.left - R0.left, sy = S.top - R0.top, scale = S.width / B;
    z.style.transform = big ? `translate(${cx}px, ${cy}px)` : `translate(${sx}px, ${sy}px) scale(${scale})`;
  };
  const tick = () => {
    const p = pose.current; p.x += (p.tx - p.x) * 0.14; p.y += (p.ty - p.y) * 0.14;
    live.current?.draw(-0.1 + p.y * 0.5, 0.14 + p.x * 0.72, p.x * 1.6 - p.y * 0.5);
    if (zoomEl.current) zoomEl.current.style.setProperty('--gx', String(p.x)), zoomEl.current.style.setProperty('--gy', String(p.y));
    p.raf = requestAnimationFrame(tick);
  };
  const enlarge = async () => {
    if (zoom !== 'off' || leaving) return;
    if (!live.current) { try { live.current = await loadLiveSeal(Math.round(460 * dpr), rank, card?.number ?? null); } catch { return; } }   // a coin lettered for another number is never shown
    const z = zoomEl.current; if (!z) return;
    const c = live.current.canvas; if (cv.current && c.parentElement !== cv.current) { c.classList.add('r6-zoom-canvas'); cv.current.appendChild(c); }
    pose.current.tx = pose.current.ty = pose.current.x = pose.current.y = 0;
    live.current.draw(-0.1, 0.14, 0);
    z.style.transition = 'none'; place(false); z.getBoundingClientRect();
    setZoom('in');
    requestAnimationFrame(() => { z.style.transition = `transform ${ms(ZOOM_MS)}ms cubic-bezier(.2,0,0,1)`; place(true); });
    cancelAnimationFrame(pose.current.raf); pose.current.raf = requestAnimationFrame(tick);
    after(ms(ZOOM_MS), () => setZoom('on'));
  };
  const minimize = () => {
    if (zoom !== 'on' && zoom !== 'in') return;
    const z = zoomEl.current; if (!z) return;
    pose.current.tx = pose.current.ty = 0;            // the coin turns back to its rest pose on the way home
    setZoom('out'); z.style.transition = `transform ${ms(ZOOM_MS)}ms cubic-bezier(.2,0,0,1)`; place(false);
    after(ms(ZOOM_MS) + 20, () => { cancelAnimationFrame(pose.current.raf); live.current?.draw(-0.1, 0.14, 0); setZoom('off'); });
  };
  function away() { if (zoomRef.current === 'on' || zoomRef.current === 'in') minimizeRef.current(); }
  const zoomRef = useRef(zoom); zoomRef.current = zoom; const minimizeRef = useRef(minimize); minimizeRef.current = minimize;
  const awayRef = useRef(away); awayRef.current = away; const leaveRef = useRef(leave); leaveRef.current = leave;
  useEffect(() => () => { cancelAnimationFrame(pose.current.raf); releaseLiveSeals(); }, []);   // the Welcome has closed: the coin's GPU memory goes with it
  // pointer: tilt while enlarged (the whole window is the trackpad); the card tilts under the pointer. The pointer leaving the window lets the coin ease back to rest; a press on the enlarged coin captures the pointer,
  // so it goes on turning outside the coin and the window, and the release ends it (src/ui/pointerTilt.ts).
  useEffect(() => {
    const move = (x: number, y: number) => {
      if (zoomRef.current === 'on' || zoomRef.current === 'in') { const r = root.current!.getBoundingClientRect(); pose.current.tx = Math.max(-1, Math.min(1, ((x - r.left) / r.width - 0.5) * 2.2)); pose.current.ty = Math.max(-1, Math.min(1, ((y - r.top) / r.height - 0.5) * 2.2)); }
    };
    return followPointer({ aim: move, rest: () => { pose.current.tx = 0; pose.current.ty = 0; }, press: cv.current });
  }, []);

  // A screen reader hears each step: focus moves to its headline (a heading, not a control, with no ring), so the dialog's name and the step are read and Enter / the arrow keys still go on.
  useEffect(() => {
    const heading = root.current?.querySelector<HTMLElement>('.r6-title'); if (!heading) return;
    heading.tabIndex = -1; try { heading.focus({ preventScroll: true }); } catch { /* nothing to focus */ }
  }, [step]);

  // Clicks outside the content never reach the popup system (it would close the welcome without its reverse); a click away from an enlarged seal minimizes it.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Element | null, inRoot = !!(target && root.current?.contains(target));
      if (zoomRef.current !== 'off') { if (!(target && cv.current?.contains(target))) { e.stopPropagation(); e.preventDefault(); away(); } return; }
      if (!inRoot) { e.stopPropagation(); e.preventDefault(); }
      // a click on text or empty glass never moves focus (no ring, no focused frame): only real controls take it
      else if (target && !target.closest('button, input, label, a, [tabindex]:not([tabindex="-1"])')) e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true); return () => window.removeEventListener('pointerdown', down, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // keyboard flow. Esc puts an enlarged coin back, else closes (nothing is lost: the mark is already on the profile); Enter / -> continue (unless a control has focus: it answers Enter
    // itself), <- goes back one step.
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (zoomRef.current !== 'off') away(); else leave(); return; }
      const target = e.target as Element | null, inControl = !!target?.closest?.('button, input, a, [role="menuitem"]');
      const rtl = document.documentElement.dir === 'rtl', fwd = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft';
      if ((e.key === 'Enter' && !inControl) || (e.key === fwd && !target?.closest?.('input'))) { if (zoomRef.current !== 'off') return; e.preventDefault(); primary(); }
      else if (e.key === back && !target?.closest?.('input')) { e.preventDefault(); goBack(); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  });

  useLayoutEffect(sizeFeats, [all, step, k, fit]);
  useLayoutEffect(refit, [step, all, k, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Continue on the Welcome step: if the Insider build's first-run activation is still out, wait a short moment (at most four seconds) so the Gift step shows the right mark
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (!holding) return;
    if (!activationPending) { setHolding(false); go('gift'); return; }
    const id = window.setTimeout(() => { setHolding(false); go('gift'); }, 4000);
    return () => window.clearTimeout(id);
  }, [holding, activationPending]); // eslint-disable-line react-hooks/exhaustive-deps
  const toGift = () => { if (activationPending) setHolding(true); else go('gift'); };
  const primary = () => { if (step === 'welcome') toGift(); else if (step === 'gift') { if (card) go('card'); else leave(); } else leave(); };
  // the house line-draw on hover: every icon stroke gets pathLength 1 once (CSS replays the draw)
  useEffect(() => { root.current?.querySelectorAll('.r6-feat-icon > *, .r6-all-icon > *').forEach((n) => n.setAttribute('pathLength', '1')); });

  // ── steps ──
  const L = stepped ? 0 : T.lead;
  const featureName = (f: Feature) => t(`b14welcome.${f.id}.name` as MessageId), featureLine = (f: Feature) => t(`b14welcome.${f.id}.line` as MessageId);
  /** Features: no boxes, no colour. The plain line icon, the name under it, one line under that. */
  const featureGrid = (cards: readonly Feature[], t0: number, o0: number, factor = 1) => (
    <div className="r6-grid" data-n={cards.length}>
      {cards.map((f, i) => { const Icon = f.icon; return (
        <R key={f.id} t={t0 + i * T.card * factor} o={o0 + Math.min(i, 5)} cls="r6-cell">
          <div className="r6-feat">
            <Icon className="r6-feat-icon" size={24} strokeWidth={1.5} aria-hidden="true" />
            <span className="r6-feat-name">{featureName(f)}</span>
            <span className="r6-feat-line">{featureLine(f)}</span>
          </div>
        </R>); })}
    </div>
  );
  const welcome = () => {
    const tw = words(t('b14welcome.title'), L, 0, off);
    const tSub = tw.t + T.afterTitle, tCards = tSub + T.block;
    const tMore = tCards + (FEATURES.length - 1) * T.card * 0.6 + T.button;
    return <div className="r6-col r6-v1" data-all={all || undefined}>
      <h1 className="r6-title r6-title-l">{tw.el}</h1>
      <R t={tSub} o={tw.o} cls="r6-sub">{t('b14welcome.sub')}</R>
      <div className="r6-feats" ref={featsRef}>
        {featureGrid(FEATURES, tCards, tw.o + 1, 0.6)}
        <div className="r6-all" aria-hidden={!all || undefined}>
          {MORE.map((f, i) => { const Icon = f.icon; return (
            <div key={f.id} className="r6-all-item" style={{ ['--i' as string]: i } as CSSProperties}>
              <Icon className="r6-all-icon" size={18} strokeWidth={1.6} aria-hidden="true" /><span className="r6-all-name">{featureName(f)}</span><span className="r6-all-line">{featureLine(f)}</span></div>); })}
        </div>
      </div>
      <R t={tMore} o={tw.o + 8} cls="r6-more-row"><button type="button" className="r6-more" aria-expanded={all} onClick={() => setAll((x) => !x)}>{all ? t('b14welcome.moreBack') : t('b14welcome.more', { count: MORE.length })}<ChevronDown className="r6-more-chev" size={14} strokeWidth={2} aria-hidden="true" /></button></R>
      <R t={tMore + T.button} o={tw.o + 9} cls="r6-actions"><Btn arrow onClick={toGift}>{t('b14welcome.continue')}</Btn></R>
    </div>;
  };
  /** Every step after the welcome is one two-column grid on the glass. Text on the LEFT (eyebrow, headline, body, the action row on the same left edge), the focal object on the RIGHT,
   * vertically centred to the text. The grid, the left edge and the action row's position are the same on every step, so stepping through keeps them still. */
  const split = (text: ReactNode, visual: ReactNode, cls = '') => <div className={`r6-split ${cls}`}><div className="r6-split-text">{text}</div><div className="r6-split-visual">{visual}</div></div>;
  const head = (eyebrow: string, title: string, body: ReactNode) => {
    const tw = words(title, L + 60, 1, off), tSub = tw.t + T.afterTitle;
    return { tSub, o: tw.o, el: <><R t={L} o={0} cls="r6-eyebrow">{eyebrow}</R><h1 className="r6-title r6-title-s">{tw.el}</h1><R t={tSub} o={tw.o} cls="r6-sub r6-sub-l">{body}</R></> };
  };
  const gift = () => {
    const ins = path === 'insider', seal = sealSrc, tier = ins && rank === 'insider';   // `tier`: an Insider (No. 101 and up), whose words never say Founding Contributor
    const h = head(named ? rankName : t(ins ? 'b14welcome.gift.eyebrow.insider' : 'b14welcome.gift.eyebrow.early'), t('b14welcome.gift.title'), t(tier ? 'b14welcome.gift.body.insiderTier' : ins ? 'b14welcome.gift.body.insider' : 'b14welcome.gift.body.early'));
    return split(<>{h.el}<R t={h.tSub + T.block} o={h.o + 1} cls="r6-actions r6-actions-l">{card ? <Btn arrow onClick={() => go('card')}>{t('b14welcome.gift.next')}</Btn> : <Btn onClick={leave}>{t('b14welcome.done')}</Btn>}</R></>,
      <R t={h.tSub + 80} o={h.o + 2} dy="0px" cls="r6-seal-in">
        <div className="r6-seal-wrap" data-zoom={zoom}>
          <button type="button" className="r6-seal" ref={slot as unknown as React.RefObject<HTMLButtonElement>} onClick={() => void enlarge()} aria-label={t(tier ? 'b14welcome.gift.lookCloser.insiderTier' : ins ? 'b14welcome.gift.lookCloser.insider' : 'b14welcome.gift.lookCloser.early')} data-hidden={zoom !== 'off' || undefined}>
            <span className="r6-seal-shadow" /><img className="r6-seal-img" src={seal ?? undefined} alt="" draggable={false} />{seal && <span className="r6-seal-sheen" style={{ WebkitMaskImage: `url(${seal})`, maskImage: `url(${seal})` } as CSSProperties} />}
          </button>
          <button type="button" className="r6-seal-caption" onClick={() => void enlarge()}><Maximize2 size={12} strokeWidth={1.9} aria-hidden="true" />{t('b14welcome.gift.lookCloser')}</button>
        </div>
      </R>, 'r6-gift');
  };
  const cardStep = () => {
    const ins = path === 'insider', num = card?.number ?? (member ? String(member.number).padStart(4, '0') : null);
    const body = ins ? t('b14welcome.card.body.insider', { number: num ?? '----' }) : t('b14welcome.card.body.early');   // the inviter is in the Insider sheet (insider.reveal.byFounders / byMember): `by` is a code, never a name to print
    const h = head(named ? rankName : t(ins ? 'b14welcome.card.eyebrow.insider' : 'b14welcome.card.eyebrow.early'), named ? t('memberCard.title') : t(ins ? 'b14welcome.card.title.insider' : 'b14welcome.card.title.early'), body);
    // the card is the member card (Beta 14: his five cards, drawn by src/features/memberCard); it is as tall as the sample's card was (43.4 % of the window's height before the scale, 340 to 700 px)
    const cardWidth = Math.round(Math.max(340, Math.min(700, 0.434 * window.innerHeight / kk)) * 2 / 3);
    return split(<>{h.el}
      <R t={h.tSub + T.block} o={h.o + 1} cls="r6-actions r6-actions-l r6-pair r6-card-actions">
        <Btn onClick={leave}>{t('b14welcome.done')}</Btn>
        {card && <span className="r6-share">
          <Btn kind="secondary" className="r6-share-btn" onClick={() => cardReady && setShare((x) => x === 'menu' ? 'closed' : 'menu')}><Share className="r6-share-btn-ico" size={15} strokeWidth={1.8} aria-hidden="true" />{t('b14welcome.share')}</Btn>
          <span className="r6-share-menu" data-open={share === 'menu' || undefined} role="menu" aria-hidden={share !== 'menu' || undefined}>
            <button type="button" role="menuitem" className="r6-share-item" onClick={() => void shareCard('copy')}><Copy className="r6-share-ico" size={15} strokeWidth={1.7} aria-hidden="true" /><span>{t('b14welcome.share.copy')}</span></button>
            <button type="button" role="menuitem" className="r6-share-item" onClick={() => void shareCard('picture')}><Download className="r6-share-ico" size={15} strokeWidth={1.7} aria-hidden="true" /><span>{t('b14welcome.share.image')}</span><em className="r6-share-ext">{t('b14welcome.share.png')}</em></button>
            <button type="button" role="menuitem" className="r6-share-item" onClick={() => void shareCard('video')}><Film className="r6-share-ico" size={15} strokeWidth={1.7} aria-hidden="true" /><span>{t('b14welcome.share.video')}</span><em className="r6-share-ext">{t(mp4 ? 'b14welcome.share.mp4' : 'b14welcome.share.webm')}</em></button>
          </span>
        </span>}
      </R>
      <div className="r6-note" data-on={note || undefined} aria-live="polite">
        {note === 'saving' ? t('b14welcome.note.saving') : note === 'recording' ? t('b14welcome.note.recording') : note === 'copied' ? <><Check className="r6-note-ico" size={13} strokeWidth={2.4} aria-hidden="true" />{t('b14welcome.note.copied')}</> : note === 'saved' ? <><Check className="r6-note-ico" size={13} strokeWidth={2.4} aria-hidden="true" />{t('b14welcome.note.saved')}</> : note === 'failed' ? t('b14welcome.note.failed') : null}
      </div></>,
      <R t={L} o={h.o + 2} dy="0px" cls="r6-card-in">
        {card
          ? <div className="r6-member" data-tier={card.rank} style={{ ['--h' as string]: `${cardWidth * 1.5}px` } as CSSProperties}><MemberCard rank={card.rank} name={card.name} since={card.since} number={card.number} interactive width={cardWidth} onReady={(ok) => { if (!ok) setCardReady(false); }} onCard={(live) => { cardHandle.current = live; setCardReady(!!live); }} /></div>
          : <div className="r6-member-missing" role="note">{t('b14welcome.card.missing')}</div>}
      </R>, 'r6-cardstep');
  };
  const body = step === 'welcome' ? welcome() : step === 'card' ? cardStep() : gift();
  return (
    <div ref={root} className="b14w6" data-step={step} data-dark={dark || undefined} data-btn5="b1" data-show={show || undefined} data-off={off || undefined} data-stepped={stepped || undefined} data-leaving={leaving || undefined} data-zoom={zoom}
      style={{ ['--pace' as string]: off ? 0 : pace, ['--k' as string]: kk } as CSSProperties} role="dialog" aria-modal="true" aria-label={t('b14welcome.label')}>
      <div key={step} ref={stepEl} className="r6-step" style={{ zoom: kk } as CSSProperties}>{body}</div>
      <div className="r6-zoom" ref={zoomEl} data-zoom={zoom} aria-hidden={zoom === 'off' || undefined}>
        <img className="r6-zoom-img" src={sealSrc ?? undefined} alt="" draggable={false} />
        <div className="r6-zoom-cv" ref={cv} />
      </div>
      <div className="r6-zoom-hint" data-zoom={zoom}>{t('b14welcome.gift.hint')}</div>
      <div className="r9-progress" aria-hidden="true">{steps.map((s, i) => { const at = steps.indexOf(step); return <i key={s} className="r9-dot" data-on={i === at || undefined} data-done={i < at || undefined} />; })}</div>
    </div>
  );
}
