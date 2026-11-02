import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from '../../components/AppIcons';
import { DotMatrix } from '../../components/DotMatrix';
import { useT } from '../../i18n';
import { runtime } from '../../runtime/client';
import type { BrowserSnapshot, RatingFeature } from '../../runtime/types';
import { quietMoment, ratingOverWebsite } from './ratingMoment';
import { RATING_HIDE_EVENT, setRatingOnScreen, type RatingOnScreen } from './ratingStore';
import './rating.css';

/** R4-61: the occasional, quiet feature rating. Main decides WHICH feature and WHETHER the cadence allows it (feature-rating.cjs: 3 uses,
 * 2 days, not the first session, 10 quiet minutes after launch, one ask a week, never again once answered or dismissed twice, only while
 * usage sharing and "Ask me now and then" are on, never in private or Tor windows, never within 30 s of a key pressed in a website). This
 * card adds the moment rules: never while typing, in fullscreen, while video plays or during setup. Over Acira's own pages it is drawn
 * here; while a website is on screen the browser layout carries it to the native overlay's transient layer (as toasts go: the page
 * view would cover it), and the overlay's clicks come back as `rating-*` ui actions. Untouched, it hides after 20 s. */
const FIRST_CHECK_MS = 10 * 60 * 1000, RECHECK_MS = 15 * 60 * 1000, MAX_CHECKS = 8, AUTO_HIDE_MS = 20000, THANKS_MS = 1800, LEAVE_MS = 220;

/** The card itself, wherever it is drawn. Stars and hover are its own; the answer, the dismissal and "touched" go to the owner. */
export function RatingCardBody({ feature, phase, leaving, layer = false, onTouch, onDismiss, onSubmit }: {
  feature: RatingFeature; phase: RatingOnScreen['phase']; leaving: boolean; layer?: boolean; onTouch: () => void; onDismiss: () => void; onSubmit: (stars: number) => void;
}) {
  const t = useT();
  const [stars, setStars] = useState(0), [hover, setHover] = useState(0);
  const shown = hover || stars, name = t(`rating.feature.${feature}`);
  const keys = (event: KeyboardEvent) => {
    onTouch();
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return; }
    const n = Number(event.key); if (n >= 1 && n <= 5) { setStars(n); return; }
    if (event.key === 'Enter' && stars) { event.preventDefault(); onSubmit(stars); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setStars(Math.min(5, (stars || 0) + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setStars(Math.max(1, (stars || 2) - 1)); }
  };
  return (
    <div className="rc-card" role="dialog" aria-live="polite" aria-label={t('rating.question', { feature: name })} data-rating-card data-rating-layer={layer || undefined} data-phase={leaving ? 'leaving' : phase}
      onPointerEnter={onTouch} onFocusCapture={onTouch}>
      {phase === 'ask' ? <>
        <p className="rc-question">{t('rating.question', { feature: name })}</p>
        <button type="button" className="rc-close" aria-label={t('toast.dismiss')} title={t('toast.dismiss')} onClick={onDismiss}><X size={14} /></button>
        <div className="rc-stars" role="radiogroup" aria-label={t('rating.question', { feature: name })} onKeyDown={keys} onPointerLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} tabIndex={(stars || 1) === n ? 0 : -1} className="rc-star" data-lit={n <= shown || undefined}
              aria-label={t('rating.starLabel', { stars: n })} onPointerEnter={() => setHover(n)} onClick={() => setStars(n)}>
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 2.2l2.35 4.9 5.35.72-3.9 3.73.96 5.33L10 14.32l-4.76 2.56.96-5.33L2.3 7.82l5.35-.72z" /></svg>
            </button>
          ))}
        </div>
        <div className="rc-actions">
          <button type="button" className="rc-quiet" onClick={onDismiss}>{t('rating.notNow')}</button>
          <button type="button" className="rc-submit" disabled={!stars} onClick={() => { if (stars) onSubmit(stars); }}>{t('rating.submit')}</button>
        </div>
      </> : <div className="rc-thanks"><DotMatrix preset="check" size={20} label={t('rating.thanks')} /><p>{t('rating.thanks')}</p></div>}
    </div>
  );
}

/** The card in the native overlay's transient layer (over a website): drawn from the layout's context, its clicks go back to the owner
 *  in the main interface as ui actions (main relays them there; only that interface may send a rating). "Touched" is sent once. */
export function RatingLayer({ rating, tabId }: { rating: RatingOnScreen; tabId: string }) {
  const held = useRef(false);
  const send = (action: 'rating-hold' | 'rating-dismiss' | 'rating-submit', stars?: number) => void runtime.browserCommand({ type: 'ui', tabId, action, ...(stars ? { stars } : {}) }).catch(() => undefined);
  return <div className="overlay-rating"><RatingCardBody key={rating.feature} layer feature={rating.feature} phase={rating.phase} leaving={rating.leaving}
    onTouch={() => { if (held.current) return; held.current = true; send('rating-hold'); }} onDismiss={() => send('rating-dismiss')} onSubmit={(stars) => send('rating-submit', stars)} /></div>;
}

/** The owner: asks main when the moment allows, keeps the card's phase and timers, answers for the overlay's copy. */
export function RatingCard({ state, privateWindow }: { state: BrowserSnapshot; privateWindow: boolean }) {
  const [feature, setFeature] = useState<RatingFeature | null>(null);
  const [phase, setPhase] = useState<RatingOnScreen['phase']>('ask'), [leaving, setLeaving] = useState(false);
  const latest = useRef(state); latest.current = state;
  const touched = useRef(false), timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => { for (const id of timers.current) clearTimeout(id); setRatingOnScreen(null); }, []);

  // A bounded number of checks per session (never a loop on app state): first after 10 minutes, then every 15.
  useEffect(() => {
    if (privateWindow || !(window as { acira?: unknown }).acira) return;
    let checks = 0, alive = true, timer = 0;
    const check = async () => {
      if (!alive || ++checks > MAX_CHECKS) return;
      if (quietMoment(latest.current, privateWindow)) {
        try {
          const offer = (await runtime.service({ type: 'rating.offer' })).rating;
          if (alive && offer) { await runtime.service({ type: 'rating.shown', feature: offer }); setFeature(offer); return; }
        } catch { /* not now */ }
      }
      timer = window.setTimeout(check, RECHECK_MS);
    };
    timer = window.setTimeout(check, FIRST_CHECK_MS);
    // QA and future triggers can ask for a check now; it counts toward the same bounded number and main's rules still decide.
    const now = () => { clearTimeout(timer); void check(); };
    window.addEventListener('acira:rating-check', now);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('acira:rating-check', now); };
  }, [privateWindow]);

  const leave = useCallback(() => { setLeaving(true); later(() => { setFeature(null); setPhase('ask'); setLeaving(false); touched.current = false; }, LEAVE_MS); }, []);
  const dismiss = useCallback(() => { if (feature) void runtime.service({ type: 'rating.dismiss', feature }).catch(() => undefined); leave(); }, [feature, leave]);
  const submit = useCallback((stars: number) => {
    if (!feature || !Number.isInteger(stars) || stars < 1 || stars > 5) return;
    touched.current = true;
    void runtime.service({ type: 'rating.answer', feature, stars }).catch(() => undefined);
    setPhase('thanks'); later(leave, THANKS_MS);
  }, [feature, leave]);
  const touch = useCallback(() => { touched.current = true; }, []);

  // The browser layout reads this to draw the card in the overlay while a website is on screen.
  useEffect(() => { setRatingOnScreen(feature ? { feature, phase, leaving } : null); }, [feature, phase, leaving]);
  // The overlay's copy answers through main as ui actions; a click in the page closes the overlay, which hides the card quietly (not a dismissal).
  const handlers = useRef({ dismiss, submit, touch, leave }); handlers.current = { dismiss, submit, touch, leave };
  useEffect(() => {
    const stop = runtime.subscribeBrowser((event) => {
      if (event.type !== 'ui') return;
      if (event.action === 'rating-hold') handlers.current.touch();
      else if (event.action === 'rating-dismiss') handlers.current.dismiss();
      else if (event.action === 'rating-submit' && typeof event.stars === 'number') handlers.current.submit(event.stars);
    });
    const hide = () => handlers.current.leave();
    window.addEventListener(RATING_HIDE_EVENT, hide);
    return () => { stop(); window.removeEventListener(RATING_HIDE_EVENT, hide); };
  }, []);

  // Untouched for 20 s: hide quietly (not a dismissal; the weekly gap already started when it appeared).
  useEffect(() => {
    if (!feature || phase !== 'ask' || leaving) return;
    const id = window.setTimeout(() => { if (!touched.current) leave(); }, AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [feature, phase, leaving, leave]);

  if (!feature || ratingOverWebsite(state)) return null;
  return <RatingCardBody key={feature} feature={feature} phase={phase} leaving={leaving} onTouch={touch} onDismiss={dismiss} onSubmit={submit} />;
}
