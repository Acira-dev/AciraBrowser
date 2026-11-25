// R7: Your profile is here (picture 17, spec 4.3). One line per part, then the follow-ups that only appear when they apply:
//   Install N extensions   the app's own extension review, one extension after another, "3 of 7" while it runs (the same install call ExtensionReinstall makes)
//   Web apps               one row each with Open: installing a web app needs its page
//   Restart to finish      secure DNS, third-party cookies or the privacy signal changed; they apply when Acira starts
//   Switch to <language>   never silent: switching reloads the interface
//   "Sites will ask you to sign in again."   once
//   Undo and Close         the usual import toast with Undo appears too, and the batch stays in import history
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { currentLocale, t, useT } from '../../i18n';
import { LOCALES } from '../../i18n/locales';
import { reducedMotion as reducedMotionNow } from '../../ui/sharedMotion';
import { UpdateMark } from '../updates/UpdateMark';
import { runtime } from '../../runtime/client';
import { undoImportBatches } from '../../ui/importedFavorites';
import { EndStateView } from './EndState';
import { ReceiveFrame, type FrameAction, type ReceiveVariant } from './ReceiveFrame';
import { ReceiveRows } from './ReceiveRows';
import { fromName } from './ReceivePreview';
import { readyRows, includedRows } from './receiveParts';
import { enterStagger } from './sheetMotion';
import type { TransferApplied, TransferPreview, TransferRequest, TransferResultBag, TransferInclude } from './types';

/** What the toast says was brought: "6 Spaces, 412 bookmarks and history" (the setup's own words for an import). */
export function importedWhat(counts: Record<string, number>, rows: readonly string[]): string {
  const parts: string[] = [];
  if (rows.includes('spaces') && counts.spaces) parts.push(t('setup.count.spaces', { count: counts.spaces }));
  if (rows.includes('bookmarks') && counts.bookmarks) parts.push(t('setup.count.bookmarks', { count: counts.bookmarks }));
  if (rows.includes('history') && counts.history) parts.push(t('setup.kindLower.history'));
  if (!parts.length) return '';
  try { return new Intl.ListFormat(currentLocale(), { style: 'long', type: 'conjunction' }).format(parts); } catch { return parts.join(', '); }
}
/** The usual import toast with Undo (what Setup shows after an import): "Imported 6 Spaces and 412 bookmarks from Alex", Undo reverts the batch. */
export function importToast(applied: Pick<TransferApplied, 'batchId' | 'createdProfileId'>, what: string, from: string) {
  if (!what) return null;
  return {
    type: 'toast' as const, text: t('setup.toast.imported', { what, from }),
    action: { label: t('toast.undo'), labelId: 'toast.undo' as const, command: { type: 'import.undo' as const, batchIds: [applied.batchId], ...(applied.createdProfileId ? { profileIds: [applied.createdProfileId] } : {}) } }
  };
}

export type InstallOutcome = 'added' | 'cancelled' | 'failed';
/** Installs the extensions one after another (the app's own review shows for each), reporting where it is: "3 of 7". */
export async function installExtensions(
  profileId: string, ids: readonly string[], progress: (current: number, total: number) => void,
  install: (profileId: string, extensionId: string) => Promise<{ cancelled?: boolean; error?: string }> = (profile, extensionId) => runtime.extensions({ type: 'install', profileId: profile, extensionId }) as Promise<{ cancelled?: boolean; error?: string }>
): Promise<Record<string, InstallOutcome>> {
  const out: Record<string, InstallOutcome> = {};
  for (let at = 0; at < ids.length; at++) {
    progress(at + 1, ids.length);
    try {
      const result = await install(profileId, ids[at]);
      out[ids[at]] = result.cancelled ? 'cancelled' : result.error ? 'failed' : 'added';
    } catch { out[ids[at]] = 'failed'; }
  }
  return out;
}

export interface DoneProps {
  variant: ReceiveVariant;
  applied: TransferApplied;
  preview: TransferPreview;
  /** The parts left out in the preview. */
  include: Partial<TransferInclude>;
  close: () => void;
  /** Calls the service (the sheet's stand-in in tests). */
  call?: (request: TransferRequest) => Promise<TransferResultBag>;
}

type Phase = 'done' | 'undone';
export function Done({ variant, applied, preview, include, close, call }: DoneProps) {
  useT();
  const [phase, setPhase] = useState<Phase>('done');
  const [problem, setProblem] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [step, setStep] = useState<{ current: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Record<string, InstallOutcome>>({});
  const [have, setHave] = useState<string[]>([]);
  const follow = useRef<HTMLDivElement>(null);
  const rows = includedRows(preview.included).filter((row) => include[row] !== false);
  const profileId = applied.profileId;
  useEffect(() => { let alive = true; runtime.extensions({ type: 'list', profileId }).then((result) => { if (alive) setHave(result.extensions.map((item) => item.id)); }).catch(() => undefined); return () => { alive = false; }; }, [profileId]);
  // The toast with Undo, once, over the page.
  const toasted = useRef(false);
  useEffect(() => {
    if (toasted.current) return;
    toasted.current = true;
    const toast = importToast(applied, importedWhat(preview.counts ?? {}, rows), fromName(preview));
    if (toast) void Promise.resolve(runtime.dispatch(toast)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (follow.current) enterStagger(Array.from(follow.current.children), { base: 120 }); }, [phase]);

  const installable = (applied.extensions ?? []).filter((item) => !have.includes(item.id));
  const pending = installable.filter((item) => outcome[item.id] !== 'added');
  const failed = installable.filter((item) => outcome[item.id] === 'failed').length;
  const folder = Number((applied.notMoved as { folderExtensions?: number } | undefined)?.folderExtensions) || 0;
  const language = applied.language ? (LOCALES.find((locale) => locale.code === applied.language)?.native ?? applied.language) : '';
  const [restarted, setRestarted] = useState(false);

  const install = async () => {
    setStep({ current: 1, total: pending.length });
    const result = await installExtensions(profileId, pending.map((item) => item.id), (current, total) => setStep({ current, total }));
    setOutcome((before) => ({ ...before, ...result }));
    setStep(null);
  };
  const undo = async () => {
    setUndoing(true); setProblem('');
    try {
      await undoImportBatches([applied.batchId], (batchId) => runtime.service({ type: 'imports.undo', batchId }) as Promise<{ undone?: boolean }>);
      setPhase('undone');
    } catch (error) { setProblem(String((error as Error)?.message || error).slice(0, 200)); setUndoing(false); }
  };
  const restart = async () => {
    try { await (call ?? ((request: TransferRequest) => runtime.service(request as never) as unknown as Promise<TransferResultBag>))({ type: 'transfer.restart' } as unknown as TransferRequest); setRestarted(true); } catch { /* main did not restart: the row stays */ }
  };

  if (phase === 'undone') return variant === 'sheet' ? <EndStateView row={{ message: 'transfer.done.undone', glyph: 'none', actions: ['close'] }} onAction={() => close()} /> : null;

  const actions: FrameAction[] = [
    { id: 'undo', label: t('toast.undo'), kind: 'secondary', disabled: undoing, onClick: () => void undo() },
    { id: 'close', label: t('transfer.done.close'), kind: 'primary', initialFocus: true, onClick: close }
  ];
  const fu = (id: string, name: string, button: { label: string; onClick: () => void; disabled?: boolean } | null, sub?: string) => (
    <div key={id} className="tx-fu" data-follow={id}>
      <span className="nm">{name}{sub && <small className="tx-fu-sub">{sub}</small>}</span>
      {button && <button type="button" className="acira-button acira-button-secondary" disabled={button.disabled} onClick={button.onClick}>{button.label}</button>}
    </div>
  );
  return (
    <ReceiveFrame variant={variant} screen="done" title={<>{variant === 'sheet' && <span className="tx-title-mark" aria-hidden="true"><UpdateMark panel preset="check" tone="accent" reducedMotion={reducedMotionNow()} /></span>}{t('transfer.done.title')}</>} actions={actions} live="polite">
      <ReceiveRows rows={readyRows(rows, preview.counts ?? {}, include)} label={t('transfer.done.title')} />
      <div ref={follow} className="tx-follow">
        {installable.length > 0 && pending.length > 0 && fu('extensions', t('transfer.done.extensions', { count: pending.length }),
          { label: step ? t('transfer.done.extensionsStep', step) : t('transfer.done.installButton'), onClick: () => void install(), disabled: Boolean(step) }, failed ? t('transfer.done.extensionsGone') : undefined)}
        {folder > 0 && fu('folder', t('transfer.done.extensionsFolder'), null)}
        {(applied.webApps ?? []).length > 0 && <div key="webapps-head" className="tx-note rx-fu-head">{t('transfer.done.webApps')}</div>}
        {(applied.webApps ?? []).map((app, index) => fu('webapp-' + index, app.name, { label: t('transfer.done.webAppOpen'), onClick: () => void runtime.dispatch({ type: 'tab.new', url: app.startUrl }) }))}
        {applied.needsRestart && !restarted && fu('restart', t('transfer.done.restart'), { label: t('transfer.done.restartButton'), onClick: () => void restart() }, t('transfer.done.restartWhy'))}
        {language && fu('language', t('transfer.done.language', { language }), { label: t('transfer.done.switchButton'), onClick: () => void runtime.dispatch({ type: 'settings.update', patch: { language: applied.language as never } }) })}
      </div>
      <p className="tx-note rx-signin">{t('transfer.done.signIn')}</p>
      {problem && <p className="tx-warn err" role="alert">{problem}</p>}
    </ReceiveFrame>
  );
}
