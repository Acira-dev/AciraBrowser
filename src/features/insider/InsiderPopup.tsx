import {useEffect,useId,useRef,useState} from 'react';
import {X} from '../../components/AppIcons';
import {t} from '../../i18n';
import {feedbackAct,insiderCall,useFeedbackView,type CodeResult,type InsiderResult,type InviteRow} from '../../runtime/feedback';
import {noteUse} from '../metrics/noteUse';
import {Seal,type SealKind} from '../feedback/Seal';
import {SealCloser} from '../feedback/SealCloser';
import {markName,rankName} from '../feedback/words';
import type {InsiderFlow} from './insiderFlow';
import {ActivateSheet,memberLines,revealOf} from './InsiderSheets';
import './insider.css';

/** Beta 14, the Insider pop-up: the welcome's steps (welcome, what is new, "We've got something for you", the person's seal, their card), "Are you an Insider?" (for an invite's code only), the reveal, the invites and the person's own seal. EVERY screen here is a PLAIN PLACEHOLDER: the look of the welcome and of the
 * Insider steps is still being designed, so nothing is invented beyond the design system's own pieces (the pop-up glass, buttons, the field, the seals). What is decided and built is the behaviour: the order, the
 * one-time rule, the calm lines for each answer, never a pop-up for an error, "Not now" ends the flow. */

const RESULT_LINES: Record<string, 'insider.result.invalid' | 'insider.result.used' | 'insider.result.expired' | 'insider.result.revoked' | 'insider.result.offline' | 'insider.result.clock'> = {
  invalid: 'insider.result.invalid', used: 'insider.result.used', expired: 'insider.result.expired', revoked: 'insider.result.revoked', offline: 'insider.result.offline', clock: 'insider.result.clock',
};
/** The one calm line under the code field for a result that is not "ok". Unavailable reads as offline ("can't check right now"). */
export const resultLine = (result: InsiderResult) => {
  const kind: CodeResult | 'none_left' | 'busy' | 'closed' = result.result ?? 'offline';
  if (kind === 'rate_limited') return result.waitSeconds ? t('insider.result.rate_limited', { minutes: Math.max(1, Math.ceil(result.waitSeconds / 60)) }) : t('insider.result.rate_limited.later');
  return t(RESULT_LINES[kind] ?? 'insider.result.offline');
};

/** "Are you an Insider?": two plain lines, one code field, a primary action, a quiet "Not now". A wrong answer is one calm line under the field, never a pop-up. */
function CodeScreen({ onOk, onNotNow }: { onOk: () => void; onNotNow: () => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [line, setLine] = useState(''), id = useId(), lineId = useId();
  const submit = async () => {
    if (busy || !text.trim()) return;
    setBusy(true); setLine('');
    const result = await insiderCall({ type: 'insider.redeem', code: text });
    setBusy(false);
    if (result.result === 'ok') { onOk(); return; }
    setLine(resultLine(result));
  };
  return <div className="ins-screen">
    <h2 className="ins-title">{t('insider.code.title')}</h2>
    <p className="ins-text">{t('insider.code.line1')}</p>
    <p className="ins-text">{t('insider.code.line2')}</p>
    <div className="ins-field">
      <label className="ins-label" htmlFor={id}>{t('insider.code.label')}</label>
      <input id={id} className="ins-input" value={text} maxLength={60} spellCheck={false} autoComplete="off" autoCapitalize="characters" autoFocus placeholder={t('insider.code.placeholder')} disabled={busy} aria-describedby={line ? lineId : undefined} aria-invalid={line ? true : undefined}
        onChange={event => { setText(event.target.value); if (line) setLine(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }} />
      <p id={lineId} className="ins-line" role="status" aria-live="polite">{line}</p>
    </div>
    <div className="ins-buttons">
      <button type="button" className="acira-button acira-button-quiet" disabled={busy} onClick={onNotNow}>{t('insider.code.notNow')}</button>
      <button type="button" className="acira-button acira-button-primary" disabled={busy || !text.trim()} onClick={() => void submit()}>{t('insider.code.submit')}</button>
    </div>
  </div>;
}

/** A seal, large, with the rank word, to look at closer. */
function SealShow({ kind, title, lines, number = null }: { kind: SealKind; title: string; lines: string[]; number?: number | null }) {
  return <div className="ins-screen ins-show">
    <SealCloser kind={kind} rest={128} big={224} label={t('insider.reveal.closer')} number={number} />
    <h2 className="ins-title ins-title-center"><bdi>{title}</bdi></h2>
    {lines.map((line, index) => <p key={index} className="ins-text ins-center"><bdi>{line}</bdi></p>)}
  </div>;
}

/** The reveal after a code was accepted. The team decision (16 Nov 21:40): a certificate holder wears the Founding Contributor seal; since the public 14.4 that is so for No. 1 to 100, and No. 101 and up is an Insider and wears the Insider seal
 * ("You're an Insider"): the certificate's number decides (revealOf), and the seal carries that number on its rim. */
function Reveal() {
  const view = useFeedbackView('insider'), member = view.insider.member;
  useEffect(() => { noteUse('insiderCardOpened'); void insiderCall({ type: 'insider.reveal-seen' }); }, []);
  const lines = memberLines(member), words = revealOf(member);
  return <SealShow kind={words.kind} title={words.title} lines={lines} number={member?.number ?? null} />;
}

/** The invites screen: "Invite someone (N left)", the new code shown ONCE with Copy, and the codes made (their state, never in full). The count is the server's, and so is whether invites are open at all (public 14.4, order safety): the screen asks the server's list first and
 * offers a code only when that answer says `invitesOpen`; until the answer comes it shows only its title, and a server that does not say (a missing field) is a closed one. */
function Invites() {
  const view = useFeedbackView('insider'), left = view.insider.invitesLeft;
  const [list, setList] = useState<InviteRow[] | null>(null), [made, setMade] = useState(''), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState<'wait' | 'answered' | 'trouble'>('wait');
  const stamp = useRef(0), noteId = useId(), open = view.insider.invitesOpen;
  const load = async () => { const result = await insiderCall({ type: 'insider.invites' }); if (result.result === 'ok') { setList(result.invites ?? []); setAnswer('answered'); } else setAnswer(result.result === 'closed' || result.result === 'revoked' ? 'answered' : 'trouble'); };
  // the list is asked for first, always: its answer is where the server says whether invites are open (while the build itself has them off, main answers `closed` and sends nothing)
  useEffect(() => { void insiderCall({ type: 'insider.opened' }); void load(); }, []);
  const make = async () => {
    if (busy) return;
    setBusy(true); setProblem(''); setCopied(false);
    const result = await insiderCall({ type: 'insider.invite' });
    setBusy(false);
    if (result.result === 'ok' && result.code) { setMade(result.code); void load(); void feedbackAct({ type: 'feedback.state' }); return; }
    // 'closed': the server's own invites switch is shut (none_left with `closed`): the member's codes are all still theirs, so the calm line says invites are not open, not that none are left
    setProblem(result.result === 'none_left' ? t('insider.invites.noneLeft') : result.result === 'closed' ? t('insider.invites.closed') : t('insider.invites.problem'));
  };
  const copy = async () => { try { await navigator.clipboard.writeText(made); noteUse('insiderInviteCopied'); setCopied(true); const mine = ++stamp.current; window.setTimeout(() => { if (stamp.current === mine) setCopied(false); }, 1600); } catch { /* the code stays on screen to be copied by hand */ } };
  const stateText = (state: InviteRow['state']) => t(state === 'used' ? 'insider.invites.used' : state === 'unused' ? 'insider.invites.unused' : 'insider.invites.expired');
  if (!view.insider.insider) return <div className="ins-screen"><h2 className="ins-title">{t('insider.invites.title')}</h2><p className="ins-text">{t('insider.invites.problem')}</p></div>;
  if (!open && answer === 'wait' && !view.insider.invitesAsked) return <div className="ins-screen"><h2 className="ins-title">{t('insider.invites.title')}</h2></div>;
  if (!open) return <div className="ins-screen">
    <h2 className="ins-title">{t('insider.invites.title')}</h2>
    <div className="ins-buttons ins-buttons-start"><button type="button" className="acira-button acira-button-primary" disabled aria-describedby={noteId}>{t('insider.invites.title')}</button></div>
    <p id={noteId} className="ins-text">{answer === 'trouble' && !view.insider.invitesAsked ? t('insider.invites.problem') : t('insider.invites.closed')}</p>
  </div>;
  return <div className="ins-screen">
    <h2 className="ins-title">{t('insider.invites.title')}</h2>
    {made && <div className="ins-made" role="group" aria-label={t('insider.invites.code')}>
      <p className="ins-label">{t('insider.invites.code')}</p>
      <p className="ins-code" dir="ltr">{made}</p>
      <p className="ins-text">{t('insider.invites.once')}</p>
      <div className="ins-buttons"><button type="button" className="acira-button" onClick={() => void copy()}>{copied ? t('insider.invites.copied') : t('insider.invites.copy')}</button></div>
    </div>}
    <div className="ins-buttons ins-buttons-start"><button type="button" className="acira-button acira-button-primary" disabled={busy || left === 0} onClick={() => void make()}>{left === null ? t('insider.invites.title') : t('insider.invites.make', { count: left })}</button></div>
    <p className="ins-line popup-status" role="status" aria-live="polite">{problem || (left === 0 ? t('insider.invites.noneLeft') : '')}</p>
    <h3 className="ins-label ins-list-title">{t('insider.invites.list')}</h3>
    {list === null ? null : list.length === 0 ? <p className="ins-text">{t('insider.invites.empty')}</p> : <ul className="ins-list">{list.map(item => <li key={item.id} className="ins-item" data-state={item.state}><span className="ins-item-code" dir="ltr">{item.code}</span><span className="ins-item-state">{stateText(item.state)}</span></li>)}</ul>}
  </div>;
}

/** The person's own seal, large (opened from the profile viewer). */
function Own() {
  const view = useFeedbackView('insider');
  const kind: SealKind | null = view.rank ?? (view.mark ? 'early' : null);
  if (!kind) return null;
  return <SealShow kind={kind} title={view.rank ? rankName(view.rank) : markName()} lines={[]} number={kind === 'insider' || kind === 'founding' ? view.insider.member?.number ?? null : null} />;
}

type Step = 'code' | 'invites' | 'own' | 'reveal' | 'activate';
/** The pop-up asks main which screen it was opened for (insiderFlow.ts); the sheet is there at its usual size while it does (a page's reply takes a moment), so it never opens empty and jumps. `flow` names the screen directly (previews, tests). */
export function InsiderPopup({ close, flow: given, glass = 64 }: { close: () => void; flow?: InsiderFlow; glass?: number }) {
  const [asked, setAsked] = useState<InsiderFlow | null>(given ?? null);
  useEffect(() => { if (given) return; let alive = true; void insiderCall({ type: 'insider.flow-take' }).then(answer => { if (alive) setAsked(answer.flow ?? 'code'); }).catch(() => { if (alive) setAsked('code'); }); return () => { alive = false; }; }, [given]);
  // (the pop-up holds its measure for a moment while the answer is out: the activation sheet is a smaller card than the other screens)
  if (!asked) return <section className="ins ins-wait" role="dialog" aria-label={t('insider.code.title')} data-popup-pending="" />;
  return <InsiderScreens close={close} flow={asked} glass={glass} />;
}

function InsiderScreens({ close, flow, glass }: { close: () => void; flow: InsiderFlow; glass: number }) {
  const view = useFeedbackView('insider'), insider = view.insider;
  const first: Step = flow === 'invites' ? 'invites' : flow === 'seal' ? 'own' : flow === 'reveal' ? 'reveal' : flow === 'activate' ? 'activate' : 'code';
  const [step, setStep] = useState<Step>(first), [shown, setShown] = useState<Step>(first), [leaving, setLeaving] = useState(false);
  useEffect(() => { void feedbackAct({ type: 'feedback.opened' }); }, []);
  // A step change is a short fade out, then the next step fades in: nothing cuts.
  const go = (next: Step) => { if (next === step) return; setStep(next); setLeaving(true); };
  useEffect(() => { if (!leaving) return; const timer = window.setTimeout(() => { setShown(step); setLeaving(false); }, 130); return () => window.clearTimeout(timer); }, [leaving, step]);
  const finish = () => close();
  const afterCode = () => go('reveal');
  const notNow = () => { finish(); };
  const body = shown === 'code' ? <CodeScreen onOk={afterCode} onNotNow={notNow} />
    : shown === 'reveal' ? <><Reveal /><div className="ins-buttons ins-after"><button type="button" className="acira-button acira-button-primary" autoFocus onClick={finish}>{t('insider.done')}</button></div></>
    : shown === 'invites' ? <Invites />
    : <Own />;
  // The dialog's name is the screen's own.
  // The activation sheet is a card of the AK glass dialog family (its own surface finish, no close button: Esc and Not now are the way out), not one of the Insider pop-up's screens.
  if (shown === 'activate') return <ActivateSheet close={close} glass={glass} />;
  const label = shown === 'code' ? t('insider.code.title') : shown === 'invites' ? t('insider.invites.title') : shown === 'reveal' ? revealOf(insider.member).title : shown === 'own' ? t('insider.reveal.closer') : t('insider.reveal.closer');
  return <section className="ins" role="dialog" aria-label={label}>
    <button type="button" className="menu-form-close ins-close" aria-label={t('app.close')} onClick={finish}><X size={14} /></button>
    <div className="ins-body" data-leaving={leaving || undefined}>{body}</div>
  </section>;
}
