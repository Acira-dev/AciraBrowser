import {useEffect,useRef,useState} from 'react';
import {t} from '../../i18n';
import {insiderCall,insiderSinceText,useFeedbackView,type InsiderMember,type InsiderOffer,type InsiderResult} from '../../runtime/feedback';
import {noteUse} from '../metrics/noteUse';
import {ProfileAvatar} from '../accounts/profileModel';
import {SealCloser} from '../feedback/SealCloser';
import {certificateTier} from '../feedback/sealNumbers';
import {appTheme,useDialogSurface} from '../dialogs/dialogSurface';
import '../dialogs/dialogs.css';
import '../dialogs/prompts.css';

/** Beta 14 rule 4: the activation sheet ("Activate Insider on this profile?"). It opens in the Insider pop-up (InsiderPopup.tsx). The sheet is a card of the
 * AK glass dialog family (src/features/dialogs: the surface's finish and the card's classes), as every centred dialog is. */

/** The member's lines on the Insider card: "Member No. 7, since November 2026" and who invited. */
export function memberLines(member: InsiderMember | null): string[] {
  if (!member) return [];
  const by = member.by === 'founding-team' ? t('insider.reveal.byFounders') : member.by === 'member' ? t('insider.reveal.byMember') : null;
  return [t('insider.reveal.member', { number: member.number, since: insiderSinceText(member.since) }), ...(by ? [by] : [])];
}

/** What the reveal calls a certificate holder, by the certificate's NUMBER (public 14.4): 1 to 100 a Founding Contributor (the compass seal, "You're a Founding Contributor"), 101 and up an Insider (the black seal, "You're an Insider").
 * The rule and its one constant are in feedback/sealNumbers.ts; the number alone decides, never `by`. No number (a reveal that has not read its certificate yet) is the Founding words, as the reveal always was. */
export function revealOf(member: InsiderMember | null): { kind: 'founding' | 'insider'; title: string } {
  const kind = certificateTier(member?.number) ?? 'founding';
  return { kind, title: t(kind === 'insider' ? 'insider.reveal.titleInsider' : 'insider.reveal.title') };
}

/** One calm line for each answer of an activation link (rule 4: never a raw error). */
export function linkLine(result: InsiderResult['result'] | null, waitSeconds: number | null): string {
  switch (result) {
    case 'used': return t('insider.link.used');
    case 'invalid': return t('insider.link.invalid');
    case 'expired': return t('insider.link.expired');
    case 'revoked': return t('insider.link.revoked');
    case 'rate_limited': return waitSeconds ? t('insider.result.rate_limited', { minutes: Math.max(1, Math.ceil(waitSeconds / 60)) }) : t('insider.result.rate_limited.later');
    case 'clock': return t('insider.result.clock');
    case 'ok': case 'busy': case null: case undefined: return '';
    default: return t('insider.result.offline');
  }
}

/** The sheet: the window's profile (its picture and name), Activate and Not now. Nothing is sent before Activate; the link itself never reaches this page (main keeps it). After an answer:
 * the Insider seal and card (the reveal), or one calm line with Try again where trying again can help (offline, a clock problem, a wait). */
export function ActivateSheet({ close, glass = 64 }: { close: () => void; glass?: number }) {
  const [offer, setOffer] = useState<InsiderOffer | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const settled = useRef(false);
  useEffect(() => {
    let alive = true;
    void insiderCall({ type: 'insider.offer' }).then((answer) => { if (alive) setOffer(answer.offer ?? null); }).catch(() => { if (alive) setOffer(null); });
    noteUse('insiderSheetShown');
    // Leaving the sheet without Activate (Not now, Escape, a click away) is a "no": main forgets the question, and nothing was sent.
    return () => { alive = false; if (!settled.current) void insiderCall({ type: 'insider.decline' }).catch(() => undefined); };
  }, []);
  const activate = async () => {
    if (busy) return;
    setBusy(true); setOffer((current) => (current ? { ...current, state: 'working', result: null } : current));
    try { const answer = await insiderCall({ type: 'insider.activate' }); if (answer.offer !== undefined) setOffer(answer.offer); if (answer.result === 'ok') { settled.current = true; noteUse('insiderCardOpened'); } }
    finally { setBusy(false); }
  };
  const notNow = () => { settled.current = true; void insiderCall({ type: 'insider.decline' }).catch(() => undefined).finally(close); };
  return <ActivateView offer={offer} busy={busy} glass={glass} onActivate={() => void activate()} onNotNow={notNow} onDone={() => { settled.current = true; void insiderCall({ type: 'insider.decline' }).catch(() => undefined); close(); }} onClose={close} />;
}

/** What the sheet draws for one state of the question (pure: the tests render every state). `offer` undefined: the answer from main is on its way; null: there is no question any more.
 * Beta 14: a centred card of the glass dialog family (src/features/dialogs): the surface takes his finish (useDialogSurface: radius 16, the glass slider's tint), the card his classes. The window's
 * profile picture stands where a centred dialog has its 40 px icon; Not now is glass, the answer that goes on is the primary, last. The card takes focus when it opens: Enter is the primary, Esc is
 * Not now, Tab turns the keyboard ring on (and only the keyboard does). */
export function ActivateView({ offer, busy = false, glass = 64, onActivate, onNotNow, onDone, onClose }: { offer: InsiderOffer | null | undefined; busy?: boolean; glass?: number; onActivate: () => void; onNotNow: () => void; onDone: () => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), [keys, setKeys] = useState(false), theme = appTheme();
  // the pop-up layer's height (the window's, in interface pixels): the activated card sizes its seal to it
  const [room, setRoom] = useState(() => (typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 900));
  useEffect(() => { if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return; const resize = () => setRoom(window.innerHeight); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useDialogSurface(root, 'dialog', glass, theme);
  const ready = offer === undefined ? 'wait' : offer === null ? 'gone' : offer.state === 'done' && offer.result === 'ok' ? 'ok' : 'ask';
  // the pop-up is not focusable until it is shown: try again for a moment (as the dialog family's sign-in card does)
  useEffect(() => {
    let tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => { const box = root.current; if (!box || box.contains(document.activeElement)) return; box.focus({ preventScroll: true }); if (document.activeElement !== box && tries++ < 20) timer = setTimeout(attempt, 40); };
    attempt();
    return () => clearTimeout(timer);
  }, [ready]);
  const working = !!offer && (offer.state === 'working' || busy);
  const again = !!offer && offer.state === 'done' && (offer.retry || ['offline', 'clock', 'rate_limited'].includes(String(offer.result)));
  const finished = ready === 'gone' || ready === 'ok' || (!!offer && offer.state === 'done' && !again);
  // Enter: the primary of the moment (Activate, Try again or Done); Esc: Not now (a "no": nothing is sent)
  const primary = ready === 'ok' ? onDone : ready === 'gone' ? onClose : finished ? onNotNow : onActivate;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') { setKeys(true); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (ready === 'ok') onDone(); else if (ready === 'gone' || ready === 'wait') onClose(); else onNotNow(); return; }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement) && ready !== 'wait' && !working) { event.preventDefault(); primary(); }
  };
  const card = (className: string, label: string, children: React.ReactNode, extra: Record<string, string> = {}) =>
    <div ref={root} className={`dlg dlg-pad ins-sheet ${className}`} data-theme={theme} data-keys={keys || undefined} data-family="dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKeyDown} {...extra}>{children}</div>;
  const title = t('insider.activate.title');
  // the answer from main is on its way: the pop-up waits for it before it measures (a moment), so the card opens at its own height
  if (offer === undefined) return card('ins-sheet-wait', title, null, { 'aria-busy': 'true', 'data-popup-pending': '' });
  const done = (handler: () => void) => <div className="dlg-foot"><div className="dlg-end"><button type="button" className="dlg-btn dlg-btn-primary" data-default="true" onClick={handler}>{t('insider.done')}</button></div></div>;
  if (offer === null) return card('ins-sheet-gone', title, <>
    <div className="dlg-col"><div className="dlg-title">{title}</div><div className="dlg-sub">{t('insider.link.gone')}</div></div>
    {done(onClose)}
  </>);
  if (ready === 'ok') {
    // The card fits the pop-up's room (the window's height less 120, src/ui/popup.ts): the seal's box (its look-closer size) gives way first, from 224 down to 96, before anything is cut; the rest is the
    // card's own height (the padding 48, the title 34, Done 60, 21 a line). A 1200 x 768 window at interface scale 150 % has 392 for it; the smallest window (900 x 600) at 150 % has 280.
    const lines = memberLines(offer.member), sealBox = Math.max(96, Math.min(224, room - 120 - 142 - lines.length * 21));
    const words = revealOf(offer.member);
    return card('ins-sheet-done', words.title, <>
      <SealCloser kind={words.kind} rest={Math.min(128, sealBox)} big={sealBox} label={t('insider.reveal.closer')} number={offer.member?.number ?? null} />
      <div className="dlg-title ins-sheet-center">{words.title}</div>
      {lines.map((line, index) => <div key={index} className="dlg-sub ins-sheet-center"><bdi>{line}</bdi></div>)}
      {done(onDone)}
    </>);
  }
  const line = working ? t('insider.activate.working') : offer.state === 'done' ? linkLine(offer.result, offer.waitSeconds) : '';
  const profile = offer.profile;
  return card('ins-sheet-ask', title, <>
    <div className="dlg-row dlg-row-start" style={{ gap: 14 }}>
      {profile && <ProfileAvatar name={profile.name} color={profile.color} avatar={profile.avatar} picture={profile.picture} size={40} className="ins-sheet-picture" />}
      <div className="dlg-col">
        <div className="dlg-title">{title}</div>
        {profile && <div className="dlg-sub ins-sheet-name"><bdi>{profile.name}</bdi></div>}
        {/* the answer's one calm line: flat until there is one, and a live region, so it is read out when it comes */}
        <div className="dlg-sub ins-sheet-line popup-status" role="status" aria-live="polite">{line}</div>
      </div>
    </div>
    {finished ? done(onNotNow)
      : <div className="dlg-foot"><div className="dlg-end">
        <button type="button" className="dlg-btn dlg-btn-glass" disabled={working} onClick={onNotNow}>{t('insider.code.notNow')}</button>
        <button type="button" className="dlg-btn dlg-btn-primary" data-default="true" disabled={working} onClick={onActivate}>{again ? t('insider.result.tryAgain') : t('insider.activate.button')}</button>
      </div></div>}
  </>);
}

