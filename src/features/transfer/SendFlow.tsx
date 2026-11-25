// The sending side, S1 to S5 (spec 4.2, pictures 04-10 and 29): what to send, the code, the number, sending, sent; and the calm end states of 4.6.
//
// Which screen shows follows the session main keeps (`status.outgoing`): nothing or `building` is S1, `ready` S2, `confirming` S3, `sending` and `uploaded` S4, `done` S5;
// an ended one is its message (EndState). Everything the person does is one request to main (`env.call`), and the screens redraw from the status that comes back.
// Closing the sheet never cancels a waiting code: only Cancel, expiry or completion end it (spec 4.2).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorGlyph } from '../../components/EditorGlyph';
import { t } from '../../i18n';
import { SelectionPicker } from './ChecklistRows';
import { CodeChips } from './CodeChips';
import { EndStateView, outgoingEnd, outgoingEndOf, type EndAction, type EndRow } from './EndState';
import { NumberDigits } from './NumberDigits';
import { PairStrip, platformName, thisComputer } from './PairStrip';
import { CheckGrid, TransferGrid } from './TransferGrid';
import { SheetEnvContext, useSheetEnv, type SheetEnv } from './sheetEnv';
import { codeText, defaultSelection, exceedsLimit, expiryOf, formatClock, isEnded, reasonOfError, shareParts, type Selection } from './sendModel';
import { collapseCard, dropHandoff, dropIn, enterStagger, flyDigitsToGrid, morphIntoCard, slideDevices, stash, take, useGlide, useStalled } from './sheetMotion';
import { motionSpeed } from '../../ui/sharedMotion';
import type { OutgoingStatus, TransferStatus, TransferSummary } from './types';

export { SheetEnvContext };
export type { SheetEnv };

// What was ticked last, so "Make a new code" and "Try again" start from it (it lives for this page, not on disk).
let remembered: Selection | null = null;
export const forgetSelection = () => { remembered = null; };
export const rememberedSelection = () => remembered;

export interface SendFlowProps {
  status: TransferStatus;
  refresh: () => Promise<TransferStatus>;
  close: () => void;
  /** The end states that offer the profile file instead ("Use a profile file instead"). */
  onUseFile: () => void;
  reducedMotion?: boolean;
  /** Test seams: the counts S1 starts with, the ticks, and whether the list is unfolded. */
  initial?: { summary?: TransferSummary | null; selection?: Selection; expanded?: boolean; forceLarge?: boolean };
}

export function SendFlow({ status, refresh, close, onUseFile, reducedMotion, initial }: SendFlowProps) {
  const env = useSheetEnv();
  const out = status.outgoing;
  const [summary, setSummary] = useState<TransferSummary | null>(initial?.summary ?? null);
  const [selection, setSelection] = useState<Selection>(() => initial?.selection ?? remembered ?? defaultSelection());
  const [expanded, setExpanded] = useState(initial?.expanded ?? false);
  const [forceLarge, setForceLarge] = useState(initial?.forceLarge ?? false);
  const [creating, setCreating] = useState(false);
  const [local, setLocal] = useState<EndRow | null>(null);
  const [ignored, setIgnored] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // The words are gone from the status once a session ended; the ended code is shown dimmed from what this screen last saw of it.
  const words = useRef<string[]>([]);
  if (out?.code?.length) words.current = out.code;

  // The counts for S1 (they need this page's interface preferences, so they are asked for from here).
  useEffect(() => {
    if (summary || (out && !isEnded(out.state) && out.state !== 'building')) return;
    let alive = true;
    void (async () => {
      try {
        const ui = await env.collectUi(await env.profileId());
        const result = await env.call({ type: 'transfer.summary', ui });
        if (alive && result.summary) setSummary(result.summary);
      } catch { /* S1 still works without counts: the pill and Create code do */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(summary)]);
  useEffect(() => { if (!out || !isEnded(out.state)) setIgnored(false); }, [out?.state]);

  const change = (next: Selection) => { setSelection(next); setForceLarge(false); remembered = next; };
  const tooLarge = forceLarge || out?.reason === 'too_large' || Boolean(summary && exceedsLimit(summary, selection.include, selection.historyDays));

  const dismiss = async () => {
    setIgnored(true); setLocal(null);
    await env.call({ type: 'transfer.cancel', side: 'outgoing' }).catch(() => undefined);
    await refresh();
  };
  const create = async () => {
    if (creating || tooLarge) return;
    setCreating(true); remembered = selection; stash('button', button.current);
    try {
      const ui = await env.collectUi(await env.profileId());
      await env.call({ type: 'transfer.send', include: selection.include, historyDays: selection.historyDays, ui });
      await refresh();
    } catch (error) {
      dropHandoff();
      const reason = reasonOfError(error);
      if (reason === 'too_large') setForceLarge(true); else setLocal(outgoingEnd('failed', reason));
    } finally { setCreating(false); }
  };
  const act = async (action: EndAction) => {
    if (action === 'checkUpdates') { void env.checkForUpdates(); close(); return; }
    await dismiss();
    if (action === 'close') close();
    else if (action === 'useFile') onUseFile();
    else if (action === 'retry' || action === 'tryAgain') await create();
  };
  const cancel = async () => { await env.call({ type: 'transfer.cancel', side: 'outgoing' }).catch(() => undefined); await refresh(); };
  const deny = async () => { await env.call({ type: 'transfer.deny' }).catch(() => undefined); await refresh(); };
  const approve = async (number: string): Promise<{ ok: boolean; reason?: string }> => {
    const answer = await env.call({ type: 'transfer.approve', number }).catch((): { ok?: boolean; reason?: string } => ({ ok: false, reason: 'not_ready' }));
    await refresh();
    return { ok: answer.ok !== false, reason: answer.reason };
  };

  if (local) return <EndStateView row={local} onAction={action => void act(action)} />;
  if (out && isEnded(out.state) && !ignored) {
    const end = outgoingEndOf(out);
    if (end) return <EndStateView row={end} words={out.code?.length ? out.code : words.current} onAction={action => void act(action)} />;
  }
  switch (out?.state) {
    case 'ready': return <CodeScreen out={out} onCancel={() => void cancel()} reduced={reducedMotion} />;
    case 'confirming': return <NumberScreen out={out} platform={status.platform} onApprove={approve} onDeny={() => void deny()} reduced={reducedMotion} />;
    case 'sending': case 'uploaded': return <ProgressScreen out={out} platform={status.platform} onCancel={() => void cancel()} reduced={reducedMotion} />;
    case 'done': return <SentScreen out={out} onDone={async () => { await cancel(); close(); }} reduced={reducedMotion} />;
    default: return <ChecklistScreen summary={summary} selection={selection} onChange={change} expanded={expanded} onExpanded={setExpanded} tooLarge={tooLarge} busy={creating} buttonRef={button} onCreate={() => void create()} />;
  }
}

// ------------------------------------------------------------------------------------------------ S1

const LockLine = ({ text }: { text: string }) => <p className="tx-lock"><EditorGlyph name="LockKeyhole" className="tx-lock-icon" /><span>{text}</span></p>;

export function ChecklistScreen({ summary, selection, onChange, expanded, onExpanded, tooLarge, busy, buttonRef, onCreate }: {
  summary: TransferSummary | null; selection: Selection; onChange: (next: Selection) => void; expanded: boolean; onExpanded: (open: boolean) => void; tooLarge: boolean; busy: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>; onCreate: () => void;
}) {
  const line = summary
    ? t('transfer.send.summary', { name: summary.profileName, spaces: t('transfer.send.spaces', { count: summary.counts.spaces ?? 0 }), bookmarks: t('transfer.send.bookmarks', { count: summary.counts.bookmarks ?? 0 }), visits: t('transfer.send.visits', { count: summary.counts.history ?? 0 }) })
    : '';
  return (
    <div className="tx-body" data-screen="send-what" data-popup-pending={summary ? undefined : ''}>
      <h2 className="tx-title">{t('transfer.send.title')}</h2>
      <p className="tx-sub tx-count" key={summary ? 'counted' : 'waiting'}>{line || '\u00a0'}</p>
      <SelectionPicker summary={summary} selection={selection} onChange={onChange} expanded={expanded} onExpanded={onExpanded} tooLarge={tooLarge} />
      {tooLarge ? <p className="tx-warn tx-warn-block" role="status">{t('transfer.send.tooLarge')}</p> : <LockLine text={t('transfer.send.locked')} />}
      <div className="tx-foot">
        <button ref={buttonRef} type="button" className="acira-button acira-button-primary acira-button-prominent" disabled={tooLarge || busy} aria-busy={busy || undefined} onClick={onCreate}>{t('transfer.send.create')}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S2

/** A clock that re-reads itself every second (the countdown's text, the warning tone). */
function useClock(env: SheetEnv): number {
  const [now, setNow] = useState(() => env.now());
  useEffect(() => { const timer = setInterval(() => setNow(env.now()), 1000); return () => clearInterval(timer); }, [env]);
  return now;
}

export function CodeScreen({ out, onCancel, reduced, copiedFor = 1600 }: { out: OutgoingStatus; onCancel: () => void; reduced?: boolean; copiedFor?: number }) {
  const env = useSheetEnv(), now = useClock(env);
  const words = out.code ?? [], expiry = expiryOf(out.expiresAt, now);
  const card = useRef<HTMLDivElement>(null), plate = useRef<HTMLSpanElement>(null), ghost = useRef<HTMLSpanElement>(null), chips = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null), statusRow = useRef<HTMLDivElement>(null), bar = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [arrived] = useState(() => take('button'));

  // Moment 3: Create code becomes the code. Only when this screen follows the button (reopening the sheet on a waiting code shows it at rest).
  useLayoutEffect(() => {
    if (arrived) morphIntoCard({ plate: plate.current, ghost: ghost.current, chips: chips.current?.children ?? [], title: title.current, status: statusRow.current, timer: bar.current?.parentElement }, arrived.rect, reduced);
    dropHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The card leaves its place for S3's pairing moment.
  useLayoutEffect(() => { const node = card.current; return () => stash('card', node, { clone: true }); }, []);
  // The hairline shrinks linearly with the real time left (time is honest). Animation speed Off: it follows the clock a second at a time.
  useEffect(() => {
    const node = bar.current;
    if (!node || reduced || motionSpeed() === 'off' || typeof node.animate !== 'function') return;
    const left = expiryOf(out.expiresAt, env.now());
    if (!left.left) return;
    const run = node.animate([{ transform: `scaleX(${left.fraction})` }, { transform: 'scaleX(0)' }], { duration: left.left, easing: 'linear', fill: 'forwards' });
    return () => run.cancel();
  }, [out.expiresAt, reduced, env]);

  const copy = async () => {
    try { await env.copy(codeText(words)); setCopied(true); setTimeout(() => setCopied(false), copiedFor); } catch { /* nothing was copied: the label stays "Copy" */ }
  };
  return (
    <div className="tx-body" data-screen="send-code">
      <div className="tx-title-row">
        <h2 className="tx-title" ref={title}>{t('transfer.code.title')}</h2>
        <button type="button" className="acira-button acira-button-quiet tx-copy" onClick={() => void copy()} aria-live="polite"><EditorGlyph name="Copy" className="tx-copy-icon" />{copied ? t('transfer.code.copied') : t('transfer.code.copy')}</button>
      </div>
      <div className="tx-code" ref={card}>
        <span className="tx-code-plate" ref={plate} aria-hidden="true">{arrived && <span className="tx-code-ghost" ref={ghost}>{t('transfer.send.create')}</span>}</span>
        <CodeChips ref={chips} words={words} focusFirst />
        <div className="tx-time" data-late={expiry.late ? '' : undefined} aria-hidden="true"><b ref={bar} className="tx-time-bar" style={{ transform: `scaleX(${expiry.fraction})` }} /></div>
      </div>
      <div className="tx-status" ref={statusRow}>
        <TransferGrid preset="heartbeat" rows={3} cols={3} reducedMotion={reduced} className="tx-status-grid" />
        <span role="status">{t('transfer.code.waiting')}</span>
        <span className="tm" data-late={expiry.late ? '' : undefined}>{t('transfer.code.expires', { time: formatClock(expiry.left) })}</span>
      </div>
      <p className="tx-note">{t('transfer.code.path')}</p>
      {out.passwordsRefused && <p className="tx-warn" role="status">{t('transfer.send.passwordsRefused')}</p>}
      <p className="tx-warn">{t('transfer.code.warning')}</p>
      <div className="tx-foot"><button type="button" className="acira-button" onClick={onCancel}>{t('transfer.code.cancel')}</button></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S3

export function NumberScreen({ out, platform, onApprove, onDeny, reduced }: { out: OutgoingStatus; platform: TransferStatus['platform']; onApprove: (number: string) => Promise<{ ok: boolean; reason?: string }>; onDeny: () => void; reduced?: boolean }) {
  const peer = out.peer, label = peer?.label || t('transfer.pair.thisComputer');
  const [wrong, setWrong] = useState(false), [reset, setReset] = useState(0), [checking, setChecking] = useState(false);
  const root = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null), digits = useRef<HTMLDivElement>(null);
  const shown = [t('transfer.confirm.shownAs', { label }), platformName(peer?.platform), peer?.appVersion ? `Acira ${peer.appVersion}` : ''].filter(Boolean).join(' · ');

  // Moment 6: the code card collapses toward the centre, the glyphs slide in, the grid scans. Moment 7: the digit field drops in.
  // (What the code screen leaves is read here, after the commit: its cleanup runs while this screen is being put in its place.)
  useLayoutEffect(() => {
    const arrived = take('card');
    const host = root.current?.closest<HTMLElement>('.tx') ?? root.current;
    const devices = strip.current?.querySelectorAll('.tx-dev'), wire = strip.current?.querySelector('.tx-wire') ?? null;
    if (arrived) collapseCard(host ?? null, arrived, wire?.getBoundingClientRect() ?? null, reduced);
    if (arrived) slideDevices({ left: devices?.[0] ?? null, right: devices?.[1] ?? null, wire }, reduced);
    dropIn(digits.current, digits.current?.querySelectorAll('.tx-digit') ?? [], reduced);
    dropHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => { const node = digits.current?.querySelector<HTMLElement>('.tx-digits') ?? digits.current; return () => stash('digits', node, { clone: true }); }, []);

  const submit = async (number: string) => {
    setChecking(true);
    const answer = await onApprove(number);
    setChecking(false);
    // A wrong number ends the transfer on main's side (the card resolves into the message); anything else that is not an "ok" is only a number not taken: type it again.
    if (!answer.ok) { if (answer.reason === 'mismatch') setWrong(true); else setReset(value => value + 1); }
  };
  const title = t('transfer.confirm.title');
  return (
    <div className="tx-body" ref={root} data-screen="send-number">
      <h2 className="tx-title tx-center">{title}</h2>
      <div ref={strip}><PairStrip left={{ platform, label: thisComputer() }} right={{ platform: peer?.platform ?? 'unknown', label }} mode="pairing" reducedMotion={reduced} /></div>
      <div ref={digits}><NumberDigits label={title} onComplete={number => void submit(number)} dim={wrong} disabled={checking || wrong} reset={reset} reducedMotion={reduced} /></div>
      <p className="tx-note tx-center" role="status">{shown}</p>
      <p className="tx-note tx-center dim">{t('transfer.confirm.noNumber')} <button type="button" className="tx-link" onClick={onDeny}>{t('transfer.confirm.cancel')}</button></p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S4

export function ProgressScreen({ out, platform, onCancel, reduced }: { out: OutgoingStatus; platform: TransferStatus['platform']; onCancel: () => void; reduced?: boolean }) {
  const peer = out.peer, label = peer?.label || t('transfer.pair.thisComputer'), progress = out.progress;
  const target = progress?.fraction ?? (progress && progress.total ? progress.done / progress.total : 0);
  const fraction = useGlide(target, reduced), stalled = useStalled(target, out.state === 'sending' && target < 1);
  const root = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null);
  // Moment 8: the digit field becomes the progress grid.
  useLayoutEffect(() => {
    const arrived = take('digits');
    const host = root.current?.closest<HTMLElement>('.tx') ?? root.current;
    if (arrived) flyDigitsToGrid(host ?? null, arrived, strip.current?.querySelector<HTMLElement>('.tx-wire') ?? null, reduced);
    dropHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const share = progress && progress.total > 0 ? t('transfer.sending.size', shareParts(progress.done, progress.total)) : '';
  const percent = Math.round(Math.min(1, Math.max(0, target)) * 100);
  return (
    <div className="tx-body" ref={root} data-screen="send-progress">
      <h2 className="tx-title tx-center">{t('transfer.sending.title', { label })}</h2>
      <div ref={strip}><PairStrip left={{ platform, label: thisComputer() }} right={{ platform: peer?.platform ?? 'unknown', label }} mode="progress" fraction={fraction} held={stalled} reducedMotion={reduced} /></div>
      {share && <p className="tx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={share}>{share}</p>}
      <p className="tx-note tx-center">{t('transfer.sending.keepOpen')}</p>
      <div className="tx-foot center"><button type="button" className="acira-button" onClick={onCancel}>{t('transfer.code.cancel')}</button></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S5

export function SentScreen({ out, onDone, reduced }: { out: OutgoingStatus; onDone: () => void; reduced?: boolean }) {
  const label = out.peer?.label || t('transfer.pair.thisComputer');
  const title = useRef<HTMLHeadingElement>(null), foot = useRef<HTMLDivElement>(null);
  // Moment 12: the grid plays its check once and rests; the title and the button rise in on the stagger.
  useLayoutEffect(() => { enterStagger([title.current, foot.current].filter(Boolean) as Element[], { base: 120, reduced }); }, [reduced]);
  return (
    <div className="tx-body" data-screen="send-done">
      <CheckGrid reducedMotion={reduced} />
      <h2 className="tx-title tx-center" ref={title} role="status">{t('transfer.sent.title', { label })}</h2>
      <div className="tx-foot center" ref={foot}><button type="button" className="acira-button acira-button-primary acira-button-prominent" data-initial-focus="true" onClick={onDone}>{t('transfer.sent.done')}</button></div>
    </div>
  );
}
