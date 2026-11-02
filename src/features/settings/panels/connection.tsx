import { useCallback, useEffect, useState } from 'react';
import { isTorSupported } from '../../../ui/platform';
import type { TorBridgeLineError, TorBridgesStatus, TorBridgeType, TorUpdateStatus } from '../../../runtime/nativeCore';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';

import { t, type MessageId } from '../../../i18n';
/** Settings › Connection: how Acira reaches the internet: the VPN app (vpn.tsx), the proxy (proxy.tsx), secure DNS (secure-dns.tsx) and Tor (here). */
function describe(status?: TorUpdateStatus) {
  if (!status) return t('connection.torStatus.reading');
  if (status.error) return status.error;
  const versions = `Tor ${status.tor} · Tor Expert Bundle ${status.current}`; // i18n-ignore product names and versions
  // Update checks go through Tor (tor-engine.cjs fetch), so "checking" can include Tor connecting first.
  if (status.state === 'checking') return t('connection.torStatus.checking', { versions });
  if (status.state === 'downloading') return t('connection.torStatus.downloading', { versions });
  if (status.updatePending) return t('connection.torStatus.pending', { versions });
  return versions;
}

function Tor() {
  const [status, setStatus] = useState<TorUpdateStatus>(), [problem, setProblem] = useState('');
  const run = useCallback((request: Parameters<typeof native>[0]) => native(request).then((result) => { setStatus(result.torUpdate); setProblem(''); }, (failure) => setProblem(readable(failure))), []);
  useEffect(() => { void run({ type: 'tor.update-status' }); }, [run]);
  useEffect(() => {
    if (!status || status.state === 'idle') return;
    const timer = window.setInterval(() => void run({ type: 'tor.update-status' }), 1500);
    return () => window.clearInterval(timer);
  }, [status, run]);
  const busy = status?.state === 'checking' || status?.state === 'downloading';
  return <SettingGroup title={t("connection.tor")}>
    <SettingRow id="tor-update" title={t("connection.keepTorUpToDate")} detail={describe(status)}>
      <Switch label={t("connection.keepTorUpToDate")} checked={status?.auto ?? true} disabled={!status} onChange={(auto) => void run({ type: 'tor.update-set', auto })} />
    </SettingRow>
    <SettingRow id="tor-update-check" title={t("connection.checkForATorUpdate")} detail={status?.lastChecked ? t('connection.torStatus.lastChecked', { date: new Date(status.lastChecked).toLocaleDateString() }) : t('connection.torStatus.notChecked')}>
      <button type="button" className="st-button" disabled={!status || busy} onClick={() => void run({ type: 'tor.update-check' })}>{busy ? t('connection.torStatus.checkingButton') : t("connection.checkNow")}</button>
    </SettingRow>
    {problem && <SettingNote>{problem}</SettingNote>}
    <SettingNote>{t("connection.checksTheTorProjectOnce2")}</SettingNote>
  </SettingGroup>;
}

type BridgeMode = TorBridgesStatus['mode'];
const BRIDGE_NAMES: Record<TorBridgeType, string> = { obfs4: 'obfs4', snowflake: 'Snowflake', meek: 'meek' }; // i18n-ignore transport names
/** One problem with one pasted line, in words ("Line 2: needs an IP address and port…"). */
const LINE_PROBLEMS: Record<Exclude<TorBridgeLineError['code'], 'many' | 'transport'>, MessageId> = {
  long: 'connection.bridges.err.long', characters: 'connection.bridges.err.characters', address: 'connection.bridges.err.address', fingerprint: 'connection.bridges.err.fingerprint',
  argument: 'connection.bridges.err.argument', obfs4: 'connection.bridges.err.obfs4', webtunnel: 'connection.bridges.err.webtunnel', meek: 'connection.bridges.err.meek',
};
const KIND_DETAIL: Record<TorBridgeType, MessageId> = { obfs4: 'connection.bridges.obfs4Detail', snowflake: 'connection.bridges.snowflakeDetail', meek: 'connection.bridges.meekDetail' };
function lineProblem(error: TorBridgeLineError) {
  if (error.code === 'many') return t('connection.bridges.err.many');
  const problem = error.code === 'transport' ? t('connection.bridges.err.transport', { transport: error.transport || '?' }) : t(LINE_PROBLEMS[error.code] || 'connection.bridges.err.argument');
  return t('connection.bridges.lineError', { line: error.line, problem });
}

/** Tor › Bridges (Tor Browser 15's Connection settings): off, a built-in bridge (obfs4, Snowflake, meek, from Tor Browser's own list),
 *  or bridges the person knows, checked line by line as they type. Saving reconnects a Tor that is in use. */
function Bridges() {
  const [status, setStatus] = useState<TorBridgesStatus>(), [mode, setMode] = useState<BridgeMode>('off'), [kind, setKind] = useState<TorBridgeType>('obfs4');
  const [text, setText] = useState(''), [errors, setErrors] = useState<TorBridgeLineError[]>([]), [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const adopt = useCallback((next: TorBridgesStatus) => { setStatus(next); setMode(next.mode); setKind(next.builtin); setText(next.custom.join('\n')); setCount(next.custom.length); setErrors([]); }, []);
  useEffect(() => { void native({ type: 'tor.bridges' }).then((result) => { if (result.torBridges) adopt(result.torBridges); }, (failure) => setNote(readable(failure))); }, [adopt]);
  // Pasted lines are checked as the person types (nothing is saved until Save).
  useEffect(() => {
    if (mode !== 'custom') return;
    const timer = window.setTimeout(() => void native({ type: 'tor.bridges-check', text }).then((result) => { if (!result.torBridgeCheck) return; setErrors(result.torBridgeCheck.errors); setCount(result.torBridgeCheck.count); }, () => undefined), 180);
    return () => window.clearTimeout(timer);
  }, [mode, text]);
  const saved = status && mode === status.mode && (mode !== 'builtin' || kind === status.builtin) && (mode !== 'custom' || text.trim() === status.custom.join('\n'));
  const empty = mode === 'custom' && count === 0;
  const save = () => {
    setBusy(true); setNote('');
    void native({ type: 'tor.bridges-set', bridges: { mode, builtin: kind, ...(mode === 'custom' ? { custom: text } : {}) } }).then((result) => {
      const next = result.torBridges; if (!next) return;
      if (next.ok === false) { setErrors(next.errors || []); setNote(next.code === 'empty' ? t('connection.bridges.err.empty') : t('connection.bridges.notSaved')); return; }
      adopt(next); setNote(t('connection.bridges.saved'));
    }, (failure) => setNote(readable(failure))).finally(() => setBusy(false));
  };
  const modeDetail = mode === 'builtin' ? t('connection.bridges.builtinDetail') : mode === 'custom' ? t('connection.bridges.customDetail') : t('connection.bridges.offDetail');
  return <SettingGroup title={t('connection.bridges')} fold>
    <SettingNote>{t('connection.bridges.note')}</SettingNote>
    <SettingRow id="tor-bridges" title={t('connection.bridges.mode')} detail={modeDetail}>
      <Select label={t('connection.bridges.mode')} value={mode} disabled={!status || busy} onChange={(next) => { setMode(next); setNote(''); }} options={[{ value: 'off', label: t('connection.bridges.off') }, { value: 'builtin', label: t('connection.bridges.builtin') }, { value: 'custom', label: t('connection.bridges.custom') }]} />
    </SettingRow>
    {mode === 'builtin' && <SettingRow id="tor-bridge-type" title={t('connection.bridges.type')} detail={t(KIND_DETAIL[kind] || KIND_DETAIL.obfs4)}>
      <Select label={t('connection.bridges.type')} value={kind} disabled={!status || busy} onChange={(next) => { setKind(next); setNote(''); }} options={(status?.types || []).map((type) => ({ value: type.id, label: BRIDGE_NAMES[type.id] || type.id }))} />
    </SettingRow>}
    {mode === 'custom' && <SettingRow id="tor-bridge-custom" title={t('connection.bridges.provide')} detail={t('connection.bridges.provideDetail')} stacked>
      <textarea className="st-textarea tor-bridge-lines" aria-label={t('connection.bridges.provide')} aria-invalid={errors.length > 0 || undefined} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={4} placeholder={t('connection.bridges.placeholder')} value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setNote(''); }} style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, wordBreak: 'break-all' }} />
      {errors.length > 0 ? <ul className="st-error tor-bridge-errors" role="alert" style={{ margin: 0, paddingInlineStart: 18 }}>{errors.slice(0, 6).map((error) => <li key={`${error.line}-${error.code}`}>{lineProblem(error)}</li>)}</ul>
        : count > 0 && <p className="st-note st-note-inline" role="status">{t('connection.bridges.ready', { count })}</p>}
    </SettingRow>}
    {mode === 'custom' && status?.installed && <MoatRequest onBridges={(next) => { adopt(next); setNote(''); }} />}
    {status && !status.installed && mode !== 'off' && <SettingNote>{t('connection.bridges.missing')}</SettingNote>}
    <SettingRow title={t('connection.bridges.apply')} detail={t('connection.bridges.applyDetail')}>
      <button type="button" className="st-button primary" disabled={!status || busy || Boolean(saved) || errors.length > 0 || empty} onClick={save}>{t('connection.bridges.save')}</button>
    </SettingRow>
    {note && <SettingNote>{note}</SettingNote>}
  </SettingGroup>;
}

/** Moat (Tor Browser's "Request a bridge from torproject.org"): Acira reaches bridges.torproject.org through a disguised
 *  (domain-fronted) connection, the person answers its picture puzzle, and the bridges it gives are saved as theirs. */
function MoatRequest({ onBridges }: { onBridges: (next: TorBridgesStatus) => void }) {
  const [step, setStep] = useState<'idle' | 'asking' | 'puzzle' | 'checking' | 'done'>('idle');
  const [puzzle, setPuzzle] = useState<{ transport: string; image: string; challenge: string } | null>(null);
  const [answer, setAnswer] = useState(''), [note, setNote] = useState('');
  const ask = (retry = false) => {
    setStep('asking'); setAnswer(''); if (!retry) setNote('');
    void native({ type: 'tor.moat-fetch' }).then((result) => {
      const next = result.torMoat; if (!next?.image || !next.challenge) throw new Error(t('connection.moat.failed'));
      setPuzzle({ transport: next.transport || 'obfs4', image: next.image, challenge: next.challenge }); setStep('puzzle');
    }).catch(() => { setStep('idle'); setNote(t('connection.moat.failed')); });
  };
  const submit = () => {
    if (!puzzle || !answer.trim()) return;
    setStep('checking');
    void native({ type: 'tor.moat-check', transport: puzzle.transport, challenge: puzzle.challenge, solution: answer.trim() }).then((result) => {
      if (result.torMoat?.wrong) { setNote(t('connection.moat.wrong')); ask(true); return; }
      if (result.torBridges) onBridges(result.torBridges);
      setPuzzle(null); setStep('done'); setNote(t('connection.moat.saved', { count: result.torMoat?.count || 0 }));
    }, () => { setStep('puzzle'); setNote(t('connection.moat.failed')); });
  };
  const busy = step === 'asking' || step === 'checking';
  return <>
    <SettingRow id="tor-bridge-moat" title={t('connection.moat.title')} detail={t('connection.moat.detail')} stacked={Boolean(puzzle)}>
      {puzzle ? <div className="tor-moat" style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 420 }}>
        <img src={`data:image/jpeg;base64,${puzzle.image}`} alt={t('connection.moat.puzzle')} style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#fff' }} />
        <input className="st-input" style={{ width: '100%', maxWidth: 400, boxSizing: 'border-box' }} aria-label={t('connection.moat.answer')} placeholder={t('connection.moat.answer')} value={answer} disabled={busy} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="st-button primary" disabled={busy || !answer.trim()} onClick={submit}>{step === 'checking' ? t('connection.moat.checking') : t('connection.moat.submit')}</button>
          <button type="button" className="st-button" disabled={busy} onClick={() => ask(true)}>{t('connection.moat.another')}</button>
        </div>
      </div>
        : <button type="button" className="st-button" disabled={busy} onClick={() => ask()}>{step === 'asking' ? t('connection.moat.asking') : t('connection.moat.request')}</button>}
    </SettingRow>
    {note && <SettingNote>{note}</SettingNote>}
  </>;
}

function Connection() { return isTorSupported() ? <><Tor/><Bridges/></> : <SettingGroup title={t("privacy.connection")}><SettingNote>{t("local.torWindowsAvailability")}</SettingNote></SettingGroup>; }

const panel: SettingsPanel = { section: 'Connection', icon: 'tabs', order: 10, Component: Connection };
export default panel;
