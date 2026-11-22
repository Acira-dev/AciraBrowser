import { useEffect, useRef, useState, type FormEvent } from 'react';
import { runtime } from '../../../runtime/client';
import type { SettingsPanel } from '../panels';
import { SettingGroup, SettingRow, Switch } from '../controls';
import { setOfflineGameEnabled, useOfflineGameEnabled } from '../../../components/offline-game/OfflineGame';

import { t } from '../../../i18n';

/* The "Insider code" row (13.11): the person pastes the code (or the whole link) they were given; main (desktop/insider/insider-service.cjs) checks it with the Insider server and keeps the
   certificate. This row only asks and shows the answer; it never keeps the code (the field is cleared when it is accepted, nothing is stored). Two requests, no others:
   `insider.state` (nothing is sent anywhere: what is already true on this profile) and `insider.code` (the answer is one of the app's ten result names). */
type Result = 'ok' | 'used' | 'invalid' | 'expired' | 'revoked' | 'full' | 'rate_limited' | 'offline' | 'clock' | 'unavailable';
type Failure = { result: Exclude<Result, 'ok'>; waitSeconds: number };
type InsiderState = { available: boolean; eligible: boolean; state: 'idle' | 'checking' | 'accepted'; number: number | null };
type InsiderAnswer = { result: Result; number?: number | null; waitSeconds?: number | null };
/** A check ends by itself after this long (main stops at about the same time and offers "try again"): the row never waits for ever. */
const CHECK_LIMIT = 15000;
const MAX_PASTE = 400;
const askState = async (): Promise<InsiderState | null> => {
  try { return ((await runtime.service({ type: 'insider.state' })) as unknown as { insider?: InsiderState }).insider ?? null; } catch { return null; }
};
const askCode = async (code: string): Promise<InsiderAnswer> => {
  try { return ((await runtime.service({ type: 'insider.code', code })) as unknown as { insider?: InsiderAnswer }).insider ?? { result: 'offline' }; } catch { return { result: 'offline' }; }
};
/** What the row says for each result: expired and revoked are one message, offline and unavailable are one message. */
function failureText({ result, waitSeconds }: Failure): string {
  switch (result) {
    case 'invalid': return t('insiderCode.error.invalid');
    case 'used': return t('insiderCode.error.used');
    case 'expired': case 'revoked': return t('insiderCode.error.noLongerValid');
    case 'full': return t('insiderCode.error.full');
    case 'rate_limited': return t('insiderCode.error.rateLimited', { minutes: Math.max(1, Math.ceil(waitSeconds / 60)) });
    case 'clock': return t('insiderCode.error.clock');
    default: return t('insiderCode.error.offline'); // offline, unavailable
  }
}

function InsiderCodeRow() {
  const [open, setOpen] = useState(false), [code, setCode] = useState(''), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null), [accepted, setAccepted] = useState<number | null>(null);
  const [programme, setProgramme] = useState({ available: true, eligible: true });
  const enterButton = useRef<HTMLButtonElement>(null), field = useRef<HTMLInputElement>(null), wasOpen = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // What is already true on this profile: a code accepted before (the number shows), or a check another window has under way (waited for, up to the limit). Nothing is sent anywhere.
  useEffect(() => {
    let live = true, timer: number | undefined;
    const look = async (left: number) => {
      const answer = await askState();
      if (!live || !answer) return;
      setProgramme({ available: answer.available, eligible: answer.eligible });
      if (answer.state === 'accepted' && answer.number !== null) setAccepted(answer.number);
      else if (answer.state === 'checking' && left > 0) timer = window.setTimeout(() => void look(left - 1), 1000);
    };
    void look(CHECK_LIMIT / 1000);
    return () => { live = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, []);
  // A keyboard user who cancels gets the button back, focused.
  useEffect(() => {
    if (wasOpen.current && !open) enterButton.current?.focus();
    wasOpen.current = open;
  }, [open]);
  // A code that fails leaves the field focused (it was disabled while checking), so the person can correct it.
  useEffect(() => { if (failure) field.current?.focus(); }, [failure]);
  const cancel = () => { setOpen(false); setCode(''); setFailure(null); setBusy(false); };
  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setFailure(null); setBusy(true);
    let limit: number | undefined;
    const answer = await Promise.race([askCode(code), new Promise<InsiderAnswer>((resolve) => { limit = window.setTimeout(() => resolve({ result: 'offline' }), CHECK_LIMIT); })]);
    if (limit !== undefined) window.clearTimeout(limit);
    if (!mounted.current) return;
    setBusy(false);
    if (answer.result === 'ok' && typeof answer.number === 'number') { setCode(''); setAccepted(answer.number); return; }
    setFailure({ result: answer.result === 'ok' ? 'offline' : answer.result, waitSeconds: answer.waitSeconds ?? 300 });
  };
  const message = failure ? failureText(failure) : '';
  if (!programme.available) return null; // a build that names no Insider server shows no row
  if (accepted !== null) {
    return <SettingRow id="insider-code" title={t('insiderCode.activeTitle')} detail={t('insiderCode.activeDetail', { number: accepted })} />;
  }
  return (
    <SettingRow id="insider-code" title={t('insiderCode.title')} detail={t('insiderCode.detail')} stacked={open}>
      {open ? (
        <div className="st-insider">
          <form className="st-source-form" aria-busy={busy} onSubmit={(event) => void activate(event)} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) cancel(); }}>
            <input ref={field} className="st-input" dir="auto" autoFocus type="text" aria-label={t('insiderCode.title')} placeholder={t('insiderCode.placeholder')} value={code} maxLength={MAX_PASTE} spellCheck={false} autoComplete="off" autoCapitalize="none" autoCorrect="off" disabled={busy} aria-invalid={message ? true : undefined} aria-describedby={message ? 'insider-code-error' : undefined} onChange={(event) => { setCode(event.target.value); setFailure(null); }} />
            <button type="submit" className="st-button primary" disabled={busy || !code.trim()}>
              {/* both labels are laid in the same place and one is hidden, so the button is as wide as the longer one in every language: the field does not change width when the check starts */}
              <span className="st-insider-swap"><span data-hide={busy || undefined} aria-hidden={busy}>{t('insiderCode.activate')}</span><span data-hide={!busy || undefined} aria-hidden={!busy}>{t('insiderCode.checking')}</span></span>
            </button>
            <button type="button" className="st-button" disabled={busy} onClick={cancel}>{t('dialog.cancel')}</button>
          </form>
          {message && <p id="insider-code-error" className="st-error" role="alert">{message}</p>}
        </div>
      ) : (
        <button ref={enterButton} type="button" className="st-button" disabled={!programme.eligible} onClick={() => setOpen(true)}>{t('insiderCode.enter')}</button>
      )}
    </SettingRow>
  );
}

function OfflineGameSettings() {
  const enabled = useOfflineGameEnabled();
  return (
    <SettingGroup title={t("offlineGame.extras")} id="offline-page" fold>
      <SettingRow id="offline-game" title={t("offlineGame.offlineGame")} detail={t("offlineGame.detail")}>
        <Switch label={t("offlineGame.offlineGame")} checked={enabled} onChange={setOfflineGameEnabled} />
      </SettingRow>
      <InsiderCodeRow />
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 200, Component: OfflineGameSettings };
export default panel;
