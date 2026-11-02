import { useCallback, useEffect, useState } from 'react';
import { Segmented } from '../../components/Segmented';
import { torProblem, torRequest } from './torClient';
import './tor.css';

import { t } from '../../i18n';

/** Tor Browser's Standard / Safer / Safest (SecurityLevel.sys.mjs), as far as Chromium can honour them (tor-window.cjs LEVEL_PREFERENCES). */
export type TorLevelName = 'standard' | 'safer' | 'safest';
export interface TorLevelInfo { level: TorLevelName; levels: TorLevelName[]; /** Open Tor pages that were made at another level than the current one. */ stale: number }

export const torLevelName = (level: TorLevelName) => level === 'safest' ? t('tor.level.safest') : level === 'safer' ? t('tor.level.safer') : t('tor.level.standard');
const summary = (level: TorLevelName) => level === 'safest' ? t('tor.level.safestSummary') : level === 'safer' ? t('tor.level.saferSummary') : t('tor.level.standardSummary');
/** What the level turns off, one line each, in the words a person would use. Standard turns nothing off. */
const bullets = (level: TorLevelName) => level === 'safest' ? [t('tor.level.bulletAllJs'), t('tor.level.bulletSafestMedia')] : level === 'safer' ? [t('tor.level.bulletHttpJs'), t('tor.level.bulletJit'), t('tor.level.bulletSaferMedia')] : [];

/** The level, whether pages still run at another one, and the calls that change it. Read fresh each time the panel opens. */
export function useTorLevel() {
  const [info, setInfo] = useState<TorLevelInfo | null>(null), [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [reopened, setReopened] = useState<number | null>(null), [dismissed, setDismissed] = useState(false);
  const read = useCallback(() => torRequest<{ torLevel: TorLevelInfo }>({ type: 'tor.level' }).then(reply => setInfo(reply.torLevel), () => undefined), []);
  useEffect(() => { void read(); }, [read]);
  const choose = useCallback((level: TorLevelName) => {
    setBusy(true); setProblem(''); setReopened(null); setDismissed(false);
    return torRequest<{ torLevel: TorLevelInfo }>({ type: 'tor.level-set', level }).then(reply => setInfo(reply.torLevel), error => setProblem(torProblem(error))).finally(() => setBusy(false));
  }, []);
  const apply = useCallback(() => {
    setBusy(true); setProblem('');
    return torRequest<{ torLevel: TorLevelInfo; reopened: number }>({ type: 'tor.level-apply' }).then(reply => { setInfo(reply.torLevel); setReopened(reply.reopened); }, error => setProblem(torProblem(error))).finally(() => setBusy(false));
  }, []);
  return { info, busy, problem, reopened, dismissed, choose, apply, read, later: () => setDismissed(true) };
}

/** The control itself: the three levels, what the chosen one does, and (when open Tor tabs still run at the previous level) the offer to reopen
 * them. Used by the Tor panel (`variant="panel"`, on the panel's rows) and by Settings (`variant="settings"`). Choosing applies at once; the
 * pages that are already open keep the level they were made with until they reopen, which the offer says plainly. */
export function TorLevelControl({ variant, model }: { variant: 'panel' | 'settings'; model: ReturnType<typeof useTorLevel> }) {
  const { info, busy, problem, reopened, dismissed, choose, apply, later } = model;
  const level = info?.level ?? 'standard', lines = bullets(level);
  const options: readonly (readonly [TorLevelName, string])[] = [['standard', torLevelName('standard')], ['safer', torLevelName('safer')], ['safest', torLevelName('safest')]];
  return <div className="tor-level" data-variant={variant} aria-busy={busy || undefined}>
    <div className="tor-level-seg"><Segmented label={t('tor.level.settingTitle')} value={level} options={options} onChange={next => { if (!busy && next !== level) void choose(next); }}/></div>
    <p className="tor-level-summary" data-level={level}>{summary(level)}</p>
    {lines.length > 0 && <ul className="tor-level-list">{lines.map(line => <li key={line}>{line}</li>)}</ul>}
    {problem && <p className="tor-level-problem" role="alert">{problem}</p>}
    {info && info.stale > 0 && !dismissed && <div className="tor-level-apply" role="group" aria-label={t('tor.level.applyTitle')}>
      <span className="tor-level-apply-title">{t('tor.level.applyTitle')}</span>
      <p className="tor-level-apply-body">{t('tor.level.applyBody')}</p>
      <div className="tor-level-apply-actions">
        <button type="button" className="acira-button acira-button-secondary" disabled={busy} onClick={later}>{t('tor.level.later')}</button>
        <button type="button" className="acira-button acira-button-primary" disabled={busy} onClick={() => void apply()}>{t('tor.level.applyNow')}</button>
      </div>
    </div>}
    {info && info.stale > 0 && dismissed && <p className="tor-level-stale" role="status">{t('tor.level.stale')}</p>}
    {reopened !== null && reopened > 0 && <p className="tor-level-done" role="status">{t('tor.level.applied', { level: torLevelName(level) })}</p>}
  </div>;
}
