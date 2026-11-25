import { useEffect, useRef, type CSSProperties } from 'react';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { activeWorkspaceOf } from '../../runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { shownColor, shownName } from '../workspaces/WorkspaceSwitcher';
import { shortcutFor, useShortcutKeys } from '../../ui/shortcutKeys';
import { t, useT } from '../../i18n';
import '../../styles/new-tab-page.css';
import './empty-page.css';

/**
 * 14.1 (a Discord ask, Arc's behaviour): the empty page Settings > Tabs > "After closing a tab: Show an empty page" leads to
 * (runtime/emptyPage.ts). Acira's own quiet page: the New Tab page's ground with nothing on it but the workspace's own mark and one hint
 * (the New tab key, or pick a tab). Nothing loads: no picture, no shortcut icons, no request of any kind. It takes the keyboard (the
 * window's keys work at once: the New tab key, the address bar's key, Ctrl+Tab), and its one button opens a New Tab.
 */
export function EmptyPage({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  useT(); useShortcutKeys();
  const root = useRef<HTMLElement>(null);
  const workspace = activeWorkspaceOf(state), several = (state.workspaces?.length ?? 0) > 1;
  const color = workspace && several ? shownColor(state, workspace) : undefined;
  const key = shortcutFor('new-tab', 'Ctrl T');
  // The page is drawn where the closed tab was: the keyboard stays in the window (on the page, never on a control the person did not choose).
  useEffect(() => { const active = document.activeElement; if (!active || active === document.body || !active.closest('input,textarea,[contenteditable=true],[role=dialog]')) root.current?.focus({ preventScroll: true }); }, []);
  return <main ref={root} className="nt-page nt-empty" data-style="framed" tabIndex={-1} aria-label={t('emptypage.label')} style={color ? { '--ws-color': color } as CSSProperties : undefined}>
    <div className="nt-empty-card">
      {workspace && several && <span className="nt-empty-glyph" data-colored={color ? '' : undefined} aria-hidden="true"><WorkspaceGlyph icon={workspaceIcon(workspace)} /></span>}
      {workspace && several && <p className="nt-empty-name">{shownName(workspace)}</p>}
      <p className="nt-empty-hint">{key ? t('emptypage.hint', { key }) : t('emptypage.hintNoKey')}</p>
      <button type="button" className="nt-empty-new" onClick={() => dispatch({ type: 'tab.new' })}>{t('emptypage.newTab')}</button>
    </div>
  </main>;
}
