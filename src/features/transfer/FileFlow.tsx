// The profile file (spec 4.5, pictures 22-26): Save profile file (the same S1 checklist, a password that is on by default and required when Passwords is ticked)
// and Open profile file (main's own dialog, the password of a locked file, then the same preview as the code road).
//
//   save: transfer.saveFile {include, historyDays, ui, password?}   -> {saved, path, name, locked, bytes} | {cancelled} | {passwordsRefused}
//   open: transfer.openFile {password?}                              -> {preview} | {needsPassword, wrongPassword?} | {legacy} | {cancelled}; an error means "not an Acira file"
// "Show in folder" asks main to reveal the file it just wrote: `transfer.reveal {path}` is not in the service yet (Request for W in the report); a refusal is ignored.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorGlyph } from '../../components/EditorGlyph';
import { t } from '../../i18n';
import { SelectionPicker } from './ChecklistRows';
import { EndStateView, type EndRow } from './EndState';
import { ReceiveApply } from './ReceiveApply';
import { CheckGrid, TransferGrid } from './TransferGrid';
import { useSheetEnv } from './sheetEnv';
import { defaultSelection, formatSize, passwordStrength, passwordUsable, reasonOfError, type Selection } from './sendModel';
import { enterStagger } from './sheetMotion';
import type { TransferPreview, TransferRequest, TransferResultBag, TransferSummary } from './types';

export interface FileFlowProps {
  mode: 'save' | 'open';
  close: () => void;
  /** Leaves a preview for the sheet's first screen (the preview's Cancel). */
  backToChoice: () => void;
  reducedMotion?: boolean;
  /** Test seams: where a screen starts. */
  initial?: { summary?: TransferSummary | null; selection?: Selection; expanded?: boolean; password?: string; saved?: TransferResultBag; open?: OpenPhase };
}

export function FileFlow({ mode, close, backToChoice, reducedMotion, initial }: FileFlowProps) {
  return mode === 'save' ? <SaveFile close={close} reduced={reducedMotion} initial={initial} /> : <OpenFile close={close} backToChoice={backToChoice} reduced={reducedMotion} initial={initial?.open} />;
}

// ------------------------------------------------------------------------------------------------ small parts

const Eye = ({ off }: { off: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" />{off && <path d="M2.5 13.5 13.5 2.5" />}
  </svg>
);

/** A password field with its Show/Hide eye. */
export function PasswordField({ value, onChange, label, bad = false, onEnter, autoFocus = true }: { value: string; onChange: (next: string) => void; label: string; bad?: boolean; onEnter?: () => void; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="tx-field-in" data-bad={bad ? '' : undefined}>
      <input type={shown ? 'text' : 'password'} className="tx-pw" aria-label={label} aria-invalid={bad || undefined} autoComplete="off" spellCheck={false} value={value} data-initial-focus={autoFocus ? 'true' : undefined}
        onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter?.(); } }} />
      <button type="button" className="eye" aria-label={shown ? t('transfer.file.hidePassword') : t('transfer.file.showPassword')} aria-pressed={shown} onClick={() => setShown(value => !value)}><Eye off={shown} /></button>
    </div>
  );
}

function FileCard({ name, locked, bytes }: { name: string; locked: boolean; bytes?: number }) {
  const sub = [locked ? t('transfer.file.locked') : '', bytes ? formatSize(bytes) : ''].filter(Boolean).join(' · ');
  return (
    <div className="tx-file">
      {locked && <EditorGlyph name="LockKeyhole" className="tx-file-icon" />}
      <div><b className="tx-file-name">{name}</b>{sub && <small className="tx-file-sub">{sub}</small>}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ save

function SaveFile({ close, reduced, initial }: { close: () => void; reduced?: boolean; initial?: FileFlowProps['initial'] }) {
  const env = useSheetEnv();
  const [summary, setSummary] = useState<TransferSummary | null>(initial?.summary ?? null);
  const [selection, setSelection] = useState<Selection>(() => initial?.selection ?? defaultSelection());
  const [expanded, setExpanded] = useState(initial?.expanded ?? false);
  const [protect, setProtect] = useState(true), [password, setPassword] = useState(initial?.password ?? '');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState<TransferResultBag | null>(initial?.saved ?? null), [refused, setRefused] = useState(false);

  useEffect(() => {
    if (summary) return;
    let alive = true;
    void (async () => {
      try {
        const result = await env.call({ type: 'transfer.summary', ui: await env.collectUi(await env.profileId()) });
        if (alive && result.summary) setSummary(result.summary);
      } catch { /* the form works without counts */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(summary)]);

  const withPasswords = selection.include.passwords, locked = protect || withPasswords;
  const ready = !busy && (!locked || passwordUsable(password));
  const strength = passwordStrength(password);
  const save = async () => {
    if (!ready) return;
    setBusy(true); setRefused(false);
    try {
      const ui = await env.collectUi(await env.profileId());
      const result = await env.call({ type: 'transfer.saveFile', include: selection.include, historyDays: selection.historyDays, ui, ...(locked ? { password } : {}) });
      if (result.passwordsRefused) { setSelection({ ...selection, include: { ...selection.include, passwords: false } }); setRefused(true); }
      else if (result.saved) setSaved(result);
    } catch { /* main refused or the dialog failed: the form stays as it is */ } finally { setBusy(false); }
  };
  const reveal = () => { if (saved?.path) void env.call({ type: 'transfer.reveal', path: saved.path } as unknown as TransferRequest).catch(() => undefined); };

  if (saved?.saved) return <SavedScreen name={saved.name ?? ''} locked={Boolean(saved.locked)} bytes={saved.bytes} onReveal={reveal} onDone={close} reduced={reduced} />;
  const line = summary
    ? t('transfer.send.summary', { name: summary.profileName, spaces: t('transfer.send.spaces', { count: summary.counts.spaces ?? 0 }), bookmarks: t('transfer.send.bookmarks', { count: summary.counts.bookmarks ?? 0 }), visits: t('transfer.send.visits', { count: summary.counts.history ?? 0 }) })
    : '';
  return (
    <div className="tx-body" data-screen="file-save" data-popup-pending={summary ? undefined : ''}>
      <h2 className="tx-title">{t('transfer.file.save.title')}</h2>
      <p className="tx-sub tx-count" key={summary ? 'counted' : 'waiting'}>{line || ' '}</p>
      <SelectionPicker summary={summary} selection={selection} onChange={next => { setSelection(next); setRefused(false); }} expanded={expanded} onExpanded={setExpanded} />
      <label className="tx-item tx-protect">
        <input type="checkbox" className="tx-check" checked={locked} disabled={withPasswords} onChange={event => setProtect(event.target.checked)} />
        <span className="nm">{t('transfer.file.protect')}</span>
      </label>
      {locked && (
        <>
          <PasswordField value={password} onChange={setPassword} label={t('transfer.file.password')} autoFocus={false} onEnter={() => void save()} />
          <div className="tx-meter" data-strong={strength.bars >= 4 ? '' : undefined} aria-hidden="true">{[1, 2, 3, 4].map(bar => <i key={bar} className="tx-meter-bar" data-on={bar <= strength.bars ? '' : undefined} />)}</div>
          <div className="tx-hint"><span>{t('transfer.file.passwordHint')}</span><span className="tx-strength" aria-live="polite">{strength.label === 'none' ? '' : t(`transfer.file.strength.${strength.label}`)}</span></div>
        </>
      )}
      {withPasswords && <p className="tx-note">{t('transfer.file.protectRequired')}</p>}
      {refused && <p className="tx-warn" role="status">{t('transfer.send.passwordsRefused')}</p>}
      <div className="tx-foot">
        <button type="button" className="acira-button" onClick={close}>{t('transfer.file.cancel')}</button>
        <button type="button" className="acira-button acira-button-primary acira-button-prominent" disabled={!ready} aria-busy={busy || undefined} onClick={() => void save()}>{t('transfer.file.save.button')}</button>
      </div>
    </div>
  );
}

export function SavedScreen({ name, locked, bytes, onReveal, onDone, reduced }: { name: string; locked: boolean; bytes?: number; onReveal: () => void; onDone: () => void; reduced?: boolean }) {
  const title = useRef<HTMLHeadingElement>(null), foot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { enterStagger([title.current, foot.current].filter(Boolean) as Element[], { base: 120, reduced }); }, [reduced]);
  return (
    <div className="tx-body" data-screen="file-saved">
      <CheckGrid reducedMotion={reduced} />
      <h2 className="tx-title tx-center" ref={title} role="status">{t('transfer.file.saved')}</h2>
      <FileCard name={name} locked={locked} bytes={bytes} />
      <div className="tx-foot" ref={foot}>
        <button type="button" className="acira-button" onClick={onReveal}>{t('transfer.file.showInFolder')}</button>
        <button type="button" className="acira-button acira-button-primary acira-button-prominent" data-initial-focus="true" onClick={onDone}>{t('transfer.sent.done')}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ open

export type OpenPhase =
  | { kind: 'asking' }
  | { kind: 'password'; wrong: boolean; name?: string; bytes?: number }
  | { kind: 'preview'; preview: TransferPreview }
  | { kind: 'error'; row: EndRow };

/** The message of a file main would not take: "newer Acira", or "this isn't an Acira profile or bookmarks file" for everything else. */
export function fileErrorRow(error: unknown): EndRow {
  const newer = reasonOfError(error) === 'newer';
  return { message: newer ? 'transfer.file.newer' : 'transfer.file.unknown', glyph: 'alert', actions: ['close'] };
}

function OpenFile({ close, backToChoice, reduced, initial }: { close: () => void; backToChoice: () => void; reduced?: boolean; initial?: OpenPhase }) {
  const env = useSheetEnv();
  const [phase, setPhase] = useState<OpenPhase>(initial ?? { kind: 'asking' }), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const started = useRef(Boolean(initial));

  const open = async (typed?: string) => {
    setBusy(true);
    try {
      const result = await env.call({ type: 'transfer.openFile', ...(typed !== undefined ? { password: typed } : {}) });
      if (result.cancelled) close();
      else if (result.needsPassword) setPhase({ kind: 'password', wrong: Boolean(result.wrongPassword), name: result.name, bytes: result.bytes });
      else if (result.legacy) close(); // an older export or a bookmarks file: main imported it the old way and showed the usual toast with Undo
      else if (result.preview) setPhase({ kind: 'preview', preview: result.preview });
      else setPhase({ kind: 'error', row: fileErrorRow(new Error('unknown')) });
    } catch (error) { setPhase({ kind: 'error', row: fileErrorRow(error) }); } finally { setBusy(false); }
  };
  // The dialog opens by itself, once (a second run of the effect in development must not open a second dialog).
  useEffect(() => { if (started.current) return; started.current = true; void open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelHeld = async () => { await env.call({ type: 'transfer.cancel', side: 'incoming' }).catch(() => undefined); close(); };
  if (phase.kind === 'preview') return <ReceiveApply variant="sheet" source="file" preview={phase.preview} close={close} cancel={backToChoice} />;
  if (phase.kind === 'error') return <EndStateView row={phase.row} onAction={() => close()} />;
  if (phase.kind === 'asking') {
    return (
      <div className="tx-body" data-screen="file-opening">
        <h2 className="tx-title">{t('transfer.file.open.title')}</h2>
        <div className="tx-opening" aria-hidden="true"><TransferGrid preset="loader" rows={5} cols={5} cell={4} reducedMotion={reduced} /></div>
      </div>
    );
  }
  return (
    <div className="tx-body" data-screen="file-password">
      <h2 className="tx-title">{t('transfer.file.openPassword')}</h2>
      <p className="tx-sub">{t('transfer.file.openPasswordBody')}</p>
      {phase.name && <FileCard name={phase.name} locked bytes={phase.bytes} />}
      <p className="tx-label">{t('transfer.file.password')}</p>
      <PasswordField value={password} onChange={setPassword} label={t('transfer.file.password')} bad={phase.wrong} onEnter={() => { if (password && !busy) void open(password); }} />
      {phase.wrong && <p className="tx-warn err" role="alert">{t('transfer.file.wrongPassword')}</p>}
      <div className="tx-foot">
        <button type="button" className="acira-button" onClick={() => void cancelHeld()}>{t('transfer.file.cancel')}</button>
        <button type="button" className="acira-button acira-button-primary acira-button-prominent" disabled={!password || busy} aria-busy={busy || undefined} onClick={() => void open(password)}>{t('transfer.file.openButton')}</button>
      </div>
    </div>
  );
}

