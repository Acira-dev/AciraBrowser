import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LockKeyhole } from '../../components/AppIcons';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { activeWorkspaceOf } from '../../runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { openSettings } from '../../ui/settingsView';
import { securedRequest } from './securedClient';
import { shownColor, shownName } from './WorkspaceSwitcher';
import '../../styles/workspaces.css';
import { t } from '../../i18n';

/**
 * The lock screen of a secured workspace (R3-38): the only page a locked workspace has (acira://locked). Calm: the workspace's
 * own icon with a lock, "Work is locked", one button that asks Windows Hello, and one line on when it locks again. No snapshot
 * of the pages is kept behind it: while locked its tabs are sealed on disk and gone from the window.
 */
export function LockedWorkspace({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const workspace = activeWorkspaceOf(state), [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, [workspace?.id]);
  if (!workspace) return null;
  const name = shownName(workspace), color = shownColor(state, workspace), minutes = state.settings.securedLockMinutes ?? 5;
  const unlock = async () => {
    if (busy) return;
    setBusy(true); setProblem('');
    const result = await securedRequest({ type: 'unlock', id: workspace.id });
    setBusy(false);
    if (!result.ok && result.code !== 'cancelled') setProblem(t('workspaces.unlockFailed'));
  };
  return <main className="ws-locked" aria-labelledby="ws-locked-title" style={color ? { '--ws-color': color } as CSSProperties : undefined}>
    <div className="ws-locked-card">
      <span className="ws-locked-glyph" data-colored={color ? '' : undefined} aria-hidden="true"><WorkspaceGlyph icon={workspaceIcon(workspace)} /><i className="ws-lock-badge"><LockKeyhole size={10} /></i></span>
      <h1 id="ws-locked-title">{t('workspaces.lockedTitle', { name })}</h1>
      <button ref={button} type="button" className="acira-button acira-button-primary ws-locked-unlock" disabled={busy} aria-busy={busy || undefined} onClick={() => void unlock()}><LockKeyhole size={16} />{t('workspaces.unlockHello')}</button>
      {problem && <p className="ws-locked-problem" role="alert">{problem}</p>}
      <p className="ws-locked-note">{minutes ? t('workspaces.lockedNote', { minutes }) : t('workspaces.lockedNoteOs')} <button type="button" className="ws-edit-link" onClick={() => openSettings(state, dispatch, { section: 'Privacy' })}>{t('workspaces.lockedChange')}</button></p>
    </div>
  </main>;
}
