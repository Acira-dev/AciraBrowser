// The receiving side, R1 to R7 over the code road (spec 4.3, pictures 11-17), and the same flow inside first-run setup (4.4, pictures 20-21).
//
//   R1 type the code        chips and a ghost completion (CodeInput); Continue is for five known words.
//   R2 connecting           `transfer.receive { code }` has been sent: the same field, still, and "Connecting…".
//   R3 the number           "On your other computer, type" + the 56 px number the other computer asked for; the pairing strip; announced aloud (assertive).
//   R4 receiving            the progress grid fills with verified bytes; the parts appear early from the manifest, and tick in order as each section passes its check.
//   R5 to R7                ReceiveApply: the preview, bringing it over with the reveal, done.
// Every end of the incoming transfer (cancelled, expired, failed) is one calm message (receiveMessages.ts, EndState). It is all driven by `status.incoming`, read by the sheet
// with useTransferStatus and handed down; this component only sends: receive, cancel, preview, and what the end-state actions mean.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t, useT } from '../../i18n';
import { animateSpring, springs } from '../../ui/sharedMotion';
import { CodeFix, CodeInput } from './CodeInput';
import { codeText, useCodeField } from './codeField';
import { PairStrip, thisComputer } from './PairStrip';
import { ReceiveApply } from './ReceiveApply';
import { ReceiveEndView } from './ReceiveEnd';
import { ReceiveFrame, type FrameAction } from './ReceiveFrame';
import { ReceiveRows, useSequentialTicks } from './ReceiveRows';
import { receiveEnd, endForReason, GONE_END, type ReceiveEnd } from './receiveMessages';
import { manifestRows, receivingRows } from './receiveParts';
import { foldDigits, reasonOfError, shareParts } from './sendModel';
import { useSheetEnv } from './sheetEnv';
import { slideDevices, useGlide, useStalled } from './sheetMotion';
import { TransferGrid } from './TransferGrid';
import type { EndAction } from './EndState';
import type { AppliedResult } from './ReceiveApply';
import type { IncomingStatus, TransferPeer, TransferPreview, TransferStatus } from './types';
import './transfer.css';
import './receive.css';

export interface ReceiveFlowProps {
  /** `sheet`: inside the transfer sheet. `setup`: inside the first-run card (target is the first profile, no "Where should it go?", setup ends after Bring it over). */
  variant: 'sheet' | 'setup';
  status: TransferStatus;
  refresh: () => Promise<TransferStatus>;
  /** Closes the sheet / leaves the flow. */
  close: () => void;
  /** setup only: called once the transfer is applied and the reveal is done, so setup finishes through its normal completion path. It carries the receipt, for the toast with Undo. */
  onApplied?: (result?: AppliedResult) => void;
}

/** The name of the other computer for the sentences about it. */
export const peerLabel = (peer: TransferPeer | null | undefined): string => peer?.label?.trim() || '';
/** The two digits as shown: Western digits always (both computers may use different languages and must show the same glyphs), two places. */
export const numberText = (value: number | string | null | undefined): string => foldDigits(String(value ?? '')).padStart(2, '0').slice(-2);

type Screen = 'code' | 'connecting' | 'number' | 'receiving' | 'preview' | 'end';
/** Which screen the status asks for. `held`: R4 stays until its ticks are seen. */
export function screenFor(incoming: IncomingStatus | null | undefined, { pending = false, ticksDone = false, failed = false }: { pending?: boolean; ticksDone?: boolean; failed?: boolean } = {}): Screen {
  if (failed) return 'end';
  if (pending) return 'connecting';
  if (!incoming) return 'code';
  switch (incoming.state) {
    case 'joining': case 'waiting': return 'connecting';
    case 'confirming': return 'number';
    case 'receiving': case 'checking': return 'receiving';
    case 'preview': return ticksDone ? 'preview' : 'receiving';
    default: return receiveEnd(incoming) ? 'end' : 'code';
  }
}

// ------------------------------------------------------------------------------------------------ the screens

function Connecting({ variant, field, onCancel }: { variant: 'sheet' | 'setup'; field: ReturnType<typeof useCodeField>['field']; onCancel: () => void }) {
  useT();
  const actions: FrameAction[] = [{ id: 'cancel', label: t('transfer.code.cancel'), kind: 'secondary', onClick: onCancel }];
  return (
    <ReceiveFrame variant={variant} screen="connecting" title={t('transfer.receive.title')} sub={t('transfer.receive.hint')} actions={actions}>
      <div className="rx-quiet" data-calm="">
        <CodeInput field={field} send={() => undefined} onSubmit={() => undefined} disabled />
      </div>
      <div className="tx-status rx-status" role="status">
        <TransferGrid preset="heartbeat" rows={3} cols={3} label={t('transfer.receive.connecting')} className="tx-status-grid" />
        <span>{t('transfer.receive.connecting')}</span>
      </div>
    </ReceiveFrame>
  );
}

function NumberScreen({ variant, incoming, platform, onCancel }: { variant: 'sheet' | 'setup'; incoming: IncomingStatus; platform: TransferStatus['platform']; onCancel: () => void }) {
  useT();
  const strip = useRef<HTMLDivElement>(null), number = useRef<HTMLDivElement>(null);
  const label = peerLabel(incoming.peer), digits = numberText(incoming.number);
  // Moment 6 and 7: the glyphs slide in from the sides and the grid follows; the number rises in on `morph`.
  useLayoutEffect(() => {
    const parts = strip.current?.querySelectorAll('.tx-dev'), wire = strip.current?.querySelector('.tx-wire') ?? null;
    if (parts && parts.length === 2) slideDevices({ left: parts[0], right: parts[1], wire });
    if (number.current) animateSpring(number.current, [{ opacity: 0, transform: 'translateY(10px) scale(.96)', filter: 'blur(4px)' }, { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }], springs.morph, { delay: 120 }, true);
  }, []);
  const actions: FrameAction[] = [{ id: 'cancel', label: t('transfer.confirm.cancel'), kind: 'quiet', onClick: onCancel }];
  return (
    <ReceiveFrame variant={variant} screen="number" center title={t('transfer.receive.confirmTitle')} sub={t('transfer.receive.confirmBody', { label })} actions={actions}>
      <div ref={strip}>
        <PairStrip left={{ platform: incoming.peer?.platform ?? 'unknown', label }} right={{ platform, label: thisComputer() }} mode="pairing" />
      </div>
      <div ref={number} className="tx-number" aria-hidden="true">{digits}</div>
      {variant === 'sheet' && <p className="tx-sub">{t('transfer.receive.confirmBody', { label })}</p>}
    </ReceiveFrame>
  );
}

function ReceivingScreen({ variant, incoming, platform, onCancel, onTicked }: { variant: 'sheet' | 'setup'; incoming: IncomingStatus; platform: TransferStatus['platform']; onCancel: () => void; onTicked: () => void }) {
  useT();
  const checking = incoming.state === 'checking' || incoming.state === 'preview';
  const manifest = incoming.manifest, counts = manifest?.counts ?? {};
  const rows = useMemo(() => manifestRows(manifest), [manifest]);
  const verified = checking ? 1 : incoming.progress?.fraction ?? 0;
  const fraction = useGlide(verified), held = useStalled(verified, incoming.state === 'receiving');
  // The rows tick in order, 60 ms apart, once the data is being checked; the screen stays until the last one has.
  const ticked = useSequentialTicks(rows.length, checking, onTicked);
  const size = incoming.progress && incoming.progress.total ? t('transfer.sending.size', shareParts(checking ? incoming.progress.total : incoming.progress.done, incoming.progress.total)) : '';
  const label = peerLabel(incoming.peer);
  const actions: FrameAction[] = [{ id: 'cancel', label: t('transfer.code.cancel'), kind: 'secondary', onClick: onCancel, disabled: incoming.state === 'preview' }];
  return (
    <ReceiveFrame variant={variant} screen="receiving" center title={checking ? t('transfer.receive.checking') : t('transfer.receive.receiving', { label })} actions={actions}>
      <PairStrip left={{ platform: incoming.peer?.platform ?? 'unknown', label }} right={{ platform, label: thisComputer() }} mode="progress" fraction={fraction} held={held} />
      {size && <p className="tx-progress" aria-live="off">{size}</p>}
      <div className="rx-parts" style={{ textAlign: 'left' }}>
        <ReceiveRows rows={receivingRows(rows, counts, fraction, ticked)} stagger drawTicks />
      </div>
    </ReceiveFrame>
  );
}

// ------------------------------------------------------------------------------------------------ the flow

export function ReceiveFlow({ variant, status, refresh, close, onApplied }: ReceiveFlowProps) {
  useT();
  const env = useSheetEnv();
  const { field, send, words } = useCodeField();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ReceiveEnd | null>(null);
  const [ticksDone, setTicksDone] = useState(false);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  /** Once the person has the preview in front of them, main forgets the session the moment the apply finishes (nothing is incoming any more). The apply and Done screens belong to that moment, so they stay until the sheet is left. */
  const [kept, setKept] = useState<TransferPreview | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const typed = useRef<string[]>([]);
  const incoming = status.incoming;
  const state = incoming?.state;

  // A new session starts clean.
  useEffect(() => { if (state === 'joining') { setTicksDone(false); setPreview(null); setGone(false); setKept(null); } }, [state]);
  // The preview, once the data has arrived and been checked (the payload lives in main; it is dropped if the sheet is closed, spec 14.17).
  useEffect(() => {
    if (state !== 'preview' || preview || gone) return;
    let alive = true;
    env.call({ type: 'transfer.preview' }).then((bag) => { if (alive) { if (bag.preview) setPreview(bag.preview); else setGone(true); } }, () => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, [state, preview, gone, env]);

  useEffect(() => { if (state === 'preview' && preview) setKept(preview); }, [state, preview]);

  const cancelIncoming = useCallback(async () => { try { await env.call({ type: 'transfer.cancel', side: 'incoming' }); } catch { /* nothing was running */ } await refresh(); }, [env, refresh]);
  const leave = useCallback(async () => { setKept(null); await cancelIncoming(); close(); }, [cancelIncoming, close]);
  const submit = useCallback(async (code: readonly string[]) => {
    if (code.length !== 5) return;
    typed.current = [...code];
    setPending(true); setFailure(null);
    try { await env.call({ type: 'transfer.receive', code: codeText(code) }); }
    catch (error) { const reason = reasonOfError(error); setPending(false); setFailure(endForReason(reason === 'internal' ? 'unavailable' : reason)); return; }
    // main answers once the session exists, so the status read now is this attempt's (never the ended one before it)
    await refresh();
    setPending(false);
  }, [env, refresh]);

  // In setup Escape goes back (it never skips setup from inside this card), ahead of setup's own keys.
  useEffect(() => {
    if (variant !== 'setup') return;
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); void leave(); } };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, [variant, leave]);

  const row = failure ?? (gone ? GONE_END : receiveEnd(incoming));
  const screen = screenFor(incoming, { pending, ticksDone, failed: Boolean(failure) || gone });
  const onEnd = async (action: EndAction) => {
    setBusy(true);
    try {
      switch (action) {
        case 'back': setFailure(null); setGone(false); await cancelIncoming(); break;
        case 'retry': case 'tryAgain': if (typed.current.length === 5) { setFailure(null); setGone(false); await submit(typed.current); } else { setFailure(null); await cancelIncoming(); } break;
        case 'useFile': await cancelIncoming(); setFailure(null); if (variant === 'setup') close(); else await env.call({ type: 'transfer.open', intent: 'file-open' }).catch(() => undefined); break;
        case 'checkUpdates': await env.checkForUpdates(); await cancelIncoming(); close(); break;
        default: await leave();
      }
    } finally { setBusy(false); }
  };

  let body;
  if (kept && !incoming) {
    // applied: main has forgotten the session; this is Done (or the look reveal still running), not the empty code field
    body = <ReceiveApply variant={variant} source="code" preview={kept} close={close} cancel={() => void leave()} onApplied={onApplied} />;
  } else switch (screen) {
    case 'connecting': body = <Connecting variant={variant} field={field} onCancel={() => void leave()} />; break;
    case 'number': body = <NumberScreen variant={variant} incoming={incoming!} platform={status.platform} onCancel={() => void leave()} />; break;
    case 'receiving': body = <ReceivingScreen variant={variant} incoming={incoming!} platform={status.platform} onCancel={() => void leave()} onTicked={() => setTicksDone(true)} />; break;
    case 'preview': body = preview
      ? <ReceiveApply variant={variant} source="code" preview={preview} close={close} cancel={() => void leave()} onApplied={onApplied} />
      : <ReceivingScreen variant={variant} incoming={incoming!} platform={status.platform} onCancel={() => void leave()} onTicked={() => setTicksDone(true)} />; break;
    case 'end': body = row ? <ReceiveEndView variant={variant} row={row} words={typed.current} onAction={(action) => void onEnd(action)} busy={busy} /> : null; break;
    default: {
      const actions: FrameAction[] = [
        ...(variant === 'setup' ? [{ id: 'back', label: t('setup.back'), kind: 'secondary' as const, onClick: () => close() }] : []),
        { id: 'continue', label: t('transfer.receive.continue'), kind: 'primary', disabled: !words, onClick: () => words && void submit(words) }
      ];
      body = (
        <ReceiveFrame variant={variant} screen="code" title={t('transfer.receive.title')} sub={variant === 'setup' ? t('transfer.receive.hint') : undefined} actions={actions}>
          <CodeInput field={field} send={send} onSubmit={() => words && void submit(words)} describedBy="rx-hint" />
          {field.bad && <CodeFix suggestion={field.suggestion} send={send} id="rx-fix" />}
          {variant === 'sheet' && <p className="tx-note" id="rx-hint">{t('transfer.receive.hint')}</p>}
        </ReceiveFrame>
      );
    }
  }
  const announcement = screen === 'number' && incoming ? `${t('transfer.receive.confirmTitle')} ${numberText(incoming.number)}. ${t('transfer.receive.confirmBody', { label: peerLabel(incoming.peer) })}` : '';
  return (
    <div className="rx-flow" data-variant={variant} data-screen={screen}>
      {body}
      {/* The number is announced the moment it appears (spec 14.20); this region exists from the first screen, so a change in it is read out. */}
      <div className="tx-sr" aria-live="assertive" aria-atomic="true">{announcement}</div>
    </div>
  );
}
