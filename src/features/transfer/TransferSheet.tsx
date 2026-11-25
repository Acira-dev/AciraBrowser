// The content of the popup kind `transfer` (spec 4.1): the first screen, the send side, the receive side, the profile file, the calm end states.
// The popup shell, glass, Formation (open and close) and the height measuring are the app's own (App.tsx hosts this inside its popup surface); this only draws
// what is in it and decides which screen that is:
//   1. an outgoing session that is live (building / ready / confirming / sending / uploaded / done) always shows its screen (reopening the sheet on a waiting code shows the same code);
//   2. a live incoming session goes to the receiving flow (agent R's ReceiveFlow);
//   3. otherwise `status.sheet.intent` decides: choice (two cards), send (S1), receive, file-save, file-open.
// A session that had already ended before this sheet opened is cleared quietly and never shown (only one that ends while the sheet is open shows its message).
// Closing the sheet never cancels a waiting code. Escape closes it when nothing is happening to a transfer, and asks (calmly, in the sheet) while one is.
import { usePinnedFoot } from './pinnedFoot';
import { useEffect, useRef, useState } from 'react';
import { EditorGlyph } from '../../components/EditorGlyph';
import { t } from '../../i18n';
import { EMPTY_STATUS, useTransferStatus } from './client';
import { EndStateView, type EndAction, type EndRow } from './EndState';
import { FileFlow } from './FileFlow';
import { ReceiveFlow } from './ReceiveFlow';
import { SendFlow } from './SendFlow';
import { useSheetEnv } from './sheetEnv';
import { isEnded } from './sendModel';
import type { TransferIntent, TransferStatus } from './types';
import './transfer.css';

export interface TransferSheetProps {
  close: () => void;
  reducedMotion?: boolean;
}

export type Screen = TransferIntent;
/** The intent is only believed while it is fresh: main stamps it when the entry point asked, and never clears it for us. */
export const INTENT_FRESH_MS = 5000;
export function screenOfIntent(sheet: TransferStatus['sheet'], now: number): Screen {
  return sheet && now - sheet.at <= INTENT_FRESH_MS ? sheet.intent : 'choice';
}
/** A transfer is happening to the person's other computer: a number is being matched, bytes are moving, or the receiving side is checking them. */
export function transferActive(status: Pick<TransferStatus, 'outgoing' | 'incoming'>): boolean {
  return ['confirming', 'sending', 'uploaded'].includes(status.outgoing?.state ?? '') || ['confirming', 'receiving', 'checking'].includes(status.incoming?.state ?? '');
}
export type EscapeAction = 'close' | 'ask' | 'keep';
/** What Escape does: close when idle (a waiting code stays alive), ask while a transfer is active, and a second Escape on the question keeps going. */
export const escapeAction = (active: boolean, asking: boolean): EscapeAction => asking ? 'keep' : active ? 'ask' : 'close';

export function TransferSheet({ close, reducedMotion }: TransferSheetProps) {
  const { status, refresh } = useTransferStatus();
  const [waited, setWaited] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setWaited(true), 400); return () => clearTimeout(timer); }, []);
  // Until main has answered, an empty frame (the popup waits for it a moment before it measures).
  if (status === EMPTY_STATUS && !waited) return <div className="tx" data-popup-pending="" />;
  return <TransferSheetView status={status} refresh={refresh} close={close} reducedMotion={reducedMotion} />;
}

export interface TransferSheetViewProps extends TransferSheetProps {
  status: TransferStatus;
  refresh: () => Promise<TransferStatus>;
}

export function TransferSheetView({ status, refresh, close, reducedMotion }: TransferSheetViewProps) {
  const env = useSheetEnv();
  const [openedAt] = useState(() => env.now());
  const [screen, setScreen] = useState<Screen>(() => screenOfIntent(status.sheet, env.now()));
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  usePinnedFoot(root);

  // What was already over when the sheet opened is not shown.
  const out = status.outgoing, inc = status.incoming;
  const staleOut = useRef(Boolean(out && (out.state === 'done' || isEnded(out.state)))), staleInc = useRef(Boolean(inc && isEnded(inc.state)));
  if (!out || !(out.state === 'done' || isEnded(out.state))) staleOut.current = false;
  if (!inc || !isEnded(inc.state)) staleInc.current = false;
  const outShown = staleOut.current ? null : out, incShown = staleInc.current ? null : inc;
  useEffect(() => {
    const clear = (side: 'outgoing' | 'incoming') => void env.call({ type: 'transfer.cancel', side }).then(() => refresh()).catch(() => undefined);
    if (staleOut.current) clear('outgoing');
    if (staleInc.current) clear('incoming');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The side an entry point asked for has been read: main forgets it (it would also after 15 s). One that asks again while the sheet is open (Settings, the palette) moves it.
  const intentAt = status.sheet?.at ?? 0;
  useEffect(() => {
    if (!status.sheet) return;
    if (intentAt > openedAt) { setScreen(status.sheet.intent); setAsking(false); }
    void env.call({ type: 'transfer.sheetSeen' }).catch(() => undefined);
  }, [intentAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown: Screen = outShown ? 'send' : incShown ? 'receive' : screen;
  // A session the sheet has shown makes its side the sheet's own: when it ends and is cleared, the sheet stays on that side (what to send), not on the two cards.
  useEffect(() => { if (outShown && screen !== 'send') setScreen('send'); else if (!outShown && incShown && screen !== 'receive') setScreen('receive'); }, [Boolean(outShown), Boolean(incShown)]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = { outgoing: outShown, incoming: incShown };
  const active = transferActive(live);
  useEffect(() => { if (!active) setAsking(false); }, [active]);

  // Focus follows the screen: the first chip, the first digit, the password, the first button (spec 14.20).
  const signature = `${shown}|${outShown?.state ?? ''}|${incShown?.state ?? ''}`;
  useEffect(() => {
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-initial-focus=true]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [signature]);
  useEffect(() => { if (asking) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.tx-stop [data-initial-focus=true]')?.focus({ preventScroll: true })); }, [asking]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const action = escapeAction(active, asking);
    if (action === 'close') return; // the popup closes itself (the code, if one is waiting, stays alive)
    event.preventDefault(); event.stopPropagation();
    setAsking(action === 'ask');
  };

  const stop = async () => {
    setAsking(false);
    if (outShown?.state === 'confirming') await env.call({ type: 'transfer.deny' }).catch(() => undefined);
    else if (outShown) await env.call({ type: 'transfer.cancel', side: 'outgoing' }).catch(() => undefined);
    else if (incShown) await env.call({ type: 'transfer.cancel', side: 'incoming' }).catch(() => undefined);
    await refresh();
  };

  // `status.relay` is false when the app has no relay address (the relay's project is not set up yet): that is "not available yet", unlike a relay that exists but cannot be reached ("not available right now").
  const unavailable: EndRow = { message: 'transfer.error.notYet', glyph: 'wifi-off', actions: ['useFile'] };
  const useFile = (side: Screen) => setScreen(side === 'send' ? 'file-save' : 'file-open');
  let body;
  if (shown === 'choice') body = <ChoiceScreen onPick={setScreen} />;
  else if (shown === 'send') body = status.relay === false && !outShown ? <EndStateView row={unavailable} onAction={(_: EndAction) => useFile('send')} /> : <SendFlow status={{ ...status, outgoing: outShown }} refresh={refresh} close={close} onUseFile={() => useFile('send')} reducedMotion={reducedMotion} />;
  else if (shown === 'receive') body = status.relay === false && !incShown ? <EndStateView row={unavailable} onAction={(_: EndAction) => useFile('receive')} /> : <ReceiveFlow variant="sheet" status={{ ...status, incoming: incShown }} refresh={refresh} close={close} />;
  else body = <FileFlow mode={shown === 'file-save' ? 'save' : 'open'} close={close} backToChoice={() => setScreen('choice')} reducedMotion={reducedMotion} />;

  return (
    <div className="tx" ref={root} onKeyDown={onKeyDown} data-screen-kind={shown} data-reduced-motion={reducedMotion ? 'true' : undefined}>
      {body}
      {asking && (
        <div className="tx-stop" role="group" aria-label={t('transfer.stop.ask')}>
          <p className="tx-stop-ask">{t('transfer.stop.ask')}</p>
          <div className="tx-stop-row">
            <button type="button" className="acira-button" data-initial-focus="true" onClick={() => setAsking(false)}>{t('transfer.stop.keep')}</button>
            <button type="button" className="acira-button" onClick={() => void stop()}>{t('transfer.stop.confirm')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The first screen from the menu (picture 03): two cards and the version line. There is no Cancel: Esc closes the sheet. */
export function ChoiceScreen({ onPick }: { onPick: (screen: Screen) => void }) {
  return (
    <div className="tx-body" data-screen="choice">
      <h2 className="tx-title">{t('transfer.choice.title')}</h2>
      <div className="tx-cards">
        <button type="button" className="tx-card" data-initial-focus="true" onClick={() => onPick('send')}><EditorGlyph name="Send" className="tx-card-icon" /><b className="tx-card-name">{t('transfer.choice.send')}</b><span className="tx-card-desc">{t('transfer.choice.sendDesc')}</span></button>
        <button type="button" className="tx-card" onClick={() => onPick('receive')}><EditorGlyph name="Download" className="tx-card-icon" /><b className="tx-card-name">{t('transfer.choice.receive')}</b><span className="tx-card-desc">{t('transfer.choice.receiveDesc')}</span></button>
      </div>
      <p className="tx-note dim">{t('transfer.choice.version')}</p>
    </div>
  );
}
