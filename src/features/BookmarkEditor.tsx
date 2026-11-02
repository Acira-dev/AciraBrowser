import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Folder } from '../components/AppIcons';
import { MenuFormFlyout } from '../components/MenuFormFlyout';
import { MenuNameForm } from '../components/MenuNameForm';
import { SiteIdentityIcon } from '../components/SiteIdentityIcon';
import type { BookmarkNode, BrowserAction, BrowserSnapshot } from '../runtime/types';
import { pageHost } from './libraryModel';
import './library.css';

import { t } from '../i18n';
/** The popover under the star: name, folder, and Remove. Every change applies as it is made; Done only closes. */
export function BookmarkEditor({ state, url, tor, dispatch, close }: { state: BrowserSnapshot; url?: string; /** Which of the page's bookmarks: its Tor one or its ordinary one (by default, the kind the current tab saves). */tor?: boolean; dispatch: (action: BrowserAction) => void; close: () => void }) {
  const profileId = state.activeBrowserProfileId;
  const nodes = useMemo(() => state.bookmarkNodes.filter(node => node.browserProfileId === profileId), [state.bookmarkNodes, profileId]);
  const torTab = state.tabs.find(item => item.id === state.activeTabId)?.privacy === 'tor', wantsTor = tor ?? torTab;
  const node = nodes.find(item => item.url === url && !!item.tor === wantsTor) ?? nodes.find(item => item.url === url);
  const [name, setName] = useState(node?.title ?? '');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (node) setName(current => current || node.title); }, [node?.id]);
  // A native save can arrive after the editor mounts; focus once its real record exists.
  useEffect(() => { if (!node) return; const frame=requestAnimationFrame(()=>{field.current?.focus();field.current?.select();});return()=>cancelAnimationFrame(frame); }, [node?.id]);
  const folders = useMemo(() => {
    const kids = (parent: string | null) => nodes.filter(item => !item.url && (item.parentId ?? null) === parent).sort((a, b) => a.position - b.position);
    const out: { node: BookmarkNode; depth: number }[] = [], walk = (parent: string | null, depth: number) => kids(parent).forEach(item => { out.push({ node: item, depth }); walk(item.id, depth + 1); });
    walk(null, 0);
    return out;
  }, [nodes]);
  const hasBar = folders.some(({ node: item }) => !item.parentId && item.title.trim().toLowerCase() === 'bookmarks bar');
  const commitName = () => { const next = name.trim(); if (node && next && next !== node.title) dispatch({ type: 'bookmark.rename', id: node.id, title: next }); };
  const send = (parentId: string | null) => { if (node) dispatch({ type: 'bookmark.move', id: node.id, parentId, index: 100000 }); };
  const done = () => { commitName(); close(); };
  if (!url || !node) return <div className="bm-edit"><p className="bm-edit-note">{t("bookmarkeditor.bookmarkRemoved")}</p><div className="bm-edit-actions"><button type="button" className="acira-button acira-button-primary" onClick={close}>{t("favoriteeditor.done")}</button></div></div>;
  const here = node.parentId ?? null, onBar = here === null;
  return <div className="bm-edit" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); done(); } }}>
    <header className="bm-edit-head"><SiteIdentityIcon url={node.url!} size={16} className="lib-site" /><div><strong>{t("bookmarkeditor.bookmarkSaved")}</strong><small>{pageHost(node.url!)}</small></div></header>
    <label className="bm-edit-label" htmlFor="bm-edit-name">{t("profiles.name")}</label>
    <input id="bm-edit-name" ref={field} className="bm-edit-input" value={name} maxLength={200} onChange={event => setName(event.target.value)} onBlur={commitName}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); done(); } }} />
    <span className="bm-edit-label" id="bm-edit-folder">{t("bookmarkeditor.folder")}</span>
    <div className="bm-edit-list" role="listbox" aria-labelledby="bm-edit-folder">
      {!hasBar && <button type="button" role="option" aria-selected={onBar} className="bm-edit-option" onClick={() => send('bookmarks-bar')}><Folder size={14} /><span>{t("bm.bar")}</span>{onBar && <Check size={14} />}</button>}
      {folders.map(({ node: item, depth }) => {
        const isBar = !item.parentId && item.title.trim().toLowerCase() === 'bookmarks bar', selected = here === item.id || (isBar && onBar);
        return <button key={item.id} type="button" role="option" aria-selected={selected} className="bm-edit-option" style={{ ['--depth' as string]: depth }} onClick={() => send(item.id)}><Folder size={14} /><span>{item.title}</span>{selected && <Check size={14} />}</button>;
      })}
      {!folders.some(({ node: item }) => !item.parentId && item.title.trim().toLowerCase() === 'other bookmarks') && <button type="button" role="option" aria-selected={false} className="bm-edit-option" onClick={() => send('other-bookmarks')}><Folder size={14} /><span>{t("bookmarkeditor.otherBookmarks")}</span></button>}
    </div>
    <MenuFormFlyout title={t('bm.newFolder')}>{dismiss=><MenuNameForm label={t('bookmarkmenu.folderName')} action={t('searchEngines.add')} cancel={dismiss} submit={title=>{dispatch({type:'bookmark.folder',title,parentId:here});dismiss();}}/>}</MenuFormFlyout>
    <hr className="acira-sep" />
    <div className="bm-edit-actions">
      <button type="button" className="acira-button acira-button-secondary" onClick={() => { /* The star's toggle removes the kind the current tab saves; any other bookmark goes by its id, with Undo. */ if (!!node.tor === torTab) dispatch({ type: 'bookmark.toggle', url: node.url! }); else { dispatch({ type: 'bookmark.remove', id: node.id }); dispatch({ type: 'toast', text: t('toast.bookmarkRemoved'), action: { label: t('toast.undo'), command: { type: 'bookmark.restore', nodes: [{ ...node }] } } }); } close(); }}>{t("ext.remove")}</button>
      <button type="button" className="acira-button acira-button-primary" onClick={done}>{t("favoriteeditor.done")}</button>
    </div>
  </div>;
}
