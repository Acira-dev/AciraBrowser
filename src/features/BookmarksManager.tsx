import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ArrowUpRight, Bookmark, Folder, FolderOpen, PenLine, Pin, Plus, Star, Trash2, X } from '../components/AppIcons';
import { SiteIdentityIcon } from '../components/SiteIdentityIcon';
import type { BookmarkNode, BrowserAction, BrowserSnapshot } from '../runtime/types';
import { openPage, savedPageIdentity } from '../ui/pageActions';
import { openBookmarkMenu } from '../ui/bookmarkMenu';
import { folderTitle } from '../ui/bookmarkFolderName';
import { openSavedPage } from '../ui/bookmarkControl';
import { privacyNames } from '../components/TabPrivacyMark';
import { t, useT } from '../i18n';
import { formatShortcut } from '../ui/platform';
import { useListMotion, useSectionMotion } from '../ui/sharedMotion';
import { droppedLink, hasLink } from '../ui/linkDrop';
import { useSiteIcons } from '../ui/siteIcons';
import { ConfirmAction, LibraryEmpty, LibraryPage, LibrarySection, pageHost, useRowWindow, useUndoNotice, windowFrom, windowPadding } from './Library';
import { barBookmarks, suggestHistory } from './libraryModel';

type Drop = { id: string; where: 'before' | 'after' | 'into' } | null;
const ROOT = '';

/** Bookmarks as a folder tree beside the list of what is in the selected folder. Rename in place, drag to reorder or to move
 *  into a folder (Alt+Up/Down does the same from the keyboard), delete and clear folders in two steps. */
export function BookmarksManager({ state, dispatch, onNavigate }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; onNavigate: (url: string) => void }) {
  const bookmarkSearch = useRef<HTMLInputElement>(null);
  const profileId = state.tabs.find(tab => tab.id === state.activeTabId)?.browserProfileId || state.activeBrowserProfileId;
  const nodes = useMemo(() => state.bookmarkNodes.filter(node => node.browserProfileId === profileId), [state.bookmarkNodes, profileId]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, BookmarkNode[]>();
    for (const node of nodes) { const key = node.parentId && byId.get(node.parentId) && !byId.get(node.parentId)!.url ? node.parentId : ROOT; map.set(key, [...(map.get(key) ?? []), node]); }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [nodes, byId]);
  const [selected, setSelected] = useState(ROOT), [query, setQuery] = useState(''), [editing, setEditing] = useState<string | null>(null), [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null), [drop, setDrop] = useState<Drop>(null);
  const [notice, offer, dismiss] = useUndoNotice();
  const siteIcon = useSiteIcons(state);
  useT();
  const onBar = useMemo(() => new Set(barBookmarks(state.bookmarkNodes, profileId).map(node => node.id)), [state.bookmarkNodes, profileId]);
  const hasBarFolder = nodes.some(node => !node.url && !node.parentId && node.title.trim().toLowerCase() === 'bookmarks bar');
  const folder = selected && byId.get(selected) && !byId.get(selected)!.url ? byId.get(selected)! : null;
  useEffect(() => { if (selected && !folder) setSelected(ROOT); }, [selected, folder]);
  const countIn = (id: string): number => (childrenOf.get(id) ?? []).reduce((total, node) => total + (node.url ? 1 : countIn(node.id)), 0);
  const total = nodes.filter(node => node.url).length, sites = new Set(nodes.filter(node => node.url).map(node => pageHost(node.url!))).size;
  const needle = query.trim().toLowerCase();
  const pathOf = (node: BookmarkNode) => { const names: string[] = []; let at = node.parentId ? byId.get(node.parentId) : undefined; while (at) { names.unshift(folderTitle(at)); at = at.parentId ? byId.get(at.parentId) : undefined; } return names.join(' › '); };
  const found = needle ? nodes.filter(node => node.url && `${node.title} ${node.url}`.toLowerCase().includes(needle)) : null;
  const here = childrenOf.get(selected) ?? [];
  const title = (node: BookmarkNode) => node.id === 'bookmarks-bar' ? t('bm.bar') : (node.url ? node.title : folderTitle(node)) || (node.url ? pageHost(node.url) : t('bm.untitled'));

  /** The node and everything under it, as the restore action needs them. */
  const branchOf = (node: BookmarkNode): BookmarkNode[] => [node, ...(childrenOf.get(node.id) ?? []).flatMap(branchOf)];
  const removeNode = (node: BookmarkNode) => {
    const gone = branchOf(node), count = gone.filter(item => item.url).length;
    dispatch({ type: 'bookmark.remove', id: node.id });
    offer(node.url ? t('bm.removed', { title: title(node) }) : t('bm.deletedAnd', { count, title: title(node) }), () => dispatch({ type: 'bookmark.restore', nodes: gone }));
  };
  const clearFolder = (node: BookmarkNode) => {
    const gone = branchOf(node).slice(1), count = gone.filter(item => item.url).length;
    dispatch({ type: 'bookmark.clear', id: node.id });
    offer(t('bm.removedFrom', { count, title: title(node) }), () => dispatch({ type: 'bookmark.restore', nodes: gone }));
  };
  const toggleBar = (node: BookmarkNode) => move(node.id, onBar.has(node.id) ? 'other-bookmarks' : 'bookmarks-bar', 0);
  const rename = (node: BookmarkNode, value: string) => { setEditing(null); const next = value.trim(); /* the field shows a special folder's translated name: kept as it is, it is no rename */ if (next && next !== node.title && next !== title(node)) dispatch({ type: 'bookmark.rename', id: node.id, title: next }); };
  const move = (id: string, parentId: string | null, index: number) => dispatch({ type: 'bookmark.move', id, parentId, index });
  const dropOn = (target: BookmarkNode | null, where: 'before' | 'after' | 'into', parent: string) => {
    if (!dragId || dragId === target?.id) return;
    if (where === 'into' && target) { move(dragId, target.id, (childrenOf.get(target.id) ?? []).length); return; }
    const siblings = (childrenOf.get(parent) ?? []).filter(node => node.id !== dragId);
    const at = target ? siblings.findIndex(node => node.id === target.id) + (where === 'after' ? 1 : 0) : siblings.length;
    move(dragId, parent || null, Math.max(0, at));
  };
  // A link dragged in from a page (or the address bar) is saved where it lands: on a folder, or in the folder being shown.
  const [linkDrop, setLinkDrop] = useState<{ id: string } | null>(null);
  const linkTarget = (target: EventTarget) => {
    const folder = (target as HTMLElement).closest?.('[data-folder]') as HTMLElement | null;
    if (folder) return { id: folder.dataset.folder!, parentId: folder.dataset.folder === ROOT ? null : folder.dataset.folder! };
    return (target as HTMLElement).closest?.('.bm-main') && !found ? { id: 'main', parentId: selected || null } : null;
  };
  const linkOver = (event: DragEvent<HTMLElement>) => {
    if (dragId || !hasLink(event.dataTransfer)) return;
    const where = linkTarget(event.target);
    if (!where) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    setLinkDrop(current => current?.id === where.id ? current : { id: where.id });
  };
  const linkDropped = (event: DragEvent<HTMLElement>) => {
    if (dragId) return;
    const link = droppedLink(event.dataTransfer), where = linkTarget(event.target);
    setLinkDrop(null);
    if (!link || !where) return;
    event.preventDefault();
    dispatch({ type: 'bookmark.add', url: link.url, title: link.title, parentId: where.parentId, index: 99999 });
  };
  // Right-click anywhere on a row, a folder in the tree or the root opens the same menu as the sidebar and the bookmarks bar.
  const nodeMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement, row = target.closest<HTMLElement>('[data-bm]'), folder = target.closest<HTMLElement>('[data-folder]');
    const ref = row ? 'node:' + row.dataset.bm : folder ? (folder.dataset.folder && folder.dataset.folder !== 'bookmarks-bar' ? 'node:' + folder.dataset.folder : 'node:root') : null;
    if (!ref || target.closest('input')) return;
    event.preventDefault();
    openBookmarkMenu(ref, { x: event.clientX, y: event.clientY, width: 2, height: 2 });
  };
  const mainRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLDivElement>(null);
  useSectionMotion(mainRef, selected);
  useListMotion(listRef, here.map((node) => node.id).join('|'), { followers: true });
  // A long folder keeps only the rows near the screen in the DOM (Library.tsx); the rest is padding of the same height.
  const windowOn = !found && here.length > windowFrom, windowed = useRowWindow(listRef, here.length, 40, windowOn, true);
  const rowDrag = (node: BookmarkNode) => ({
    draggable: !found && editing !== node.id,
    onDragStart: (event: DragEvent) => { setDragId(node.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', node.id); },
    onDragEnd: () => { setDragId(null); setDrop(null); },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragId || dragId === node.id) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect(), ratio = (event.clientY - box.top) / box.height;
      setDrop({ id: node.id, where: !node.url && ratio > 0.3 && ratio < 0.7 ? 'into' : ratio < 0.5 ? 'before' : 'after' });
    },
    onDragLeave: () => setDrop(current => current?.id === node.id ? null : current),
    onDrop: (event: DragEvent) => { event.preventDefault(); if (drop?.id === node.id) dropOn(node, drop.where, selected); setDragId(null); setDrop(null); },
  });
  const reorderKey = (event: KeyboardEvent, node: BookmarkNode) => {
    if (event.key === 'F2') { event.preventDefault(); setEditing(node.id); return; }
    if (event.key === 'Delete' && node.url) { event.preventDefault(); removeNode(node); return; }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || found) return;
    event.preventDefault(); event.stopPropagation();
    const at = here.findIndex(item => item.id === node.id), next = at + (event.key === 'ArrowDown' ? 1 : -1);
    if (next >= 0 && next < here.length) { move(node.id, selected || null, next); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-bm="${node.id}"] .lib-open`)?.focus()); }
  };

  const renameField = (node: BookmarkNode) => <input className="bm-rename" autoFocus aria-label={t('bm.renameAria', { label: title(node) })} defaultValue={node.url ? node.title : title(node)} maxLength={200}
    onFocus={event => event.currentTarget.select()} onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') rename(node, event.currentTarget.value); if (event.key === 'Escape') setEditing(null); }}
    onBlur={event => rename(node, event.currentTarget.value)} />;

  const row = (node: BookmarkNode, path?: string) => {
    const isFolder = !node.url, label = title(node);
    return <div className={`lib-row${isFolder ? ' bm-row-folder' : ''}`} key={node.id} data-bm={node.id} data-dragging={dragId === node.id || undefined} data-drop={drop?.id === node.id ? drop.where : undefined} {...rowDrag(node)}>
      {editing === node.id
        ? <div className="lib-open">{isFolder ? <Folder size={16} /> : <SiteIdentityIcon url={node.url!} favicon={savedPageIdentity(node.url!, state).favicon || siteIcon(node.url!)} size={16} className="lib-site" />}{renameField(node)}</div>
        : isFolder
          ? <button type="button" className="lib-open" data-lib-stop onClick={() => { setSelected(node.id); setQuery(''); }} onDoubleClick={() => setEditing(node.id)} onKeyDown={event => reorderKey(event, node)}>
              <Folder size={16} /><span className="lib-text"><span className="lib-title">{label}</span><span className="lib-host">{t('plural.bookmarks', { count: countIn(node.id) })}</span></span>
            </button>
          : <button type="button" className="lib-open" data-lib-stop title={`${label} · ${node.url}`} onClick={event => openSavedPage(event, node, state, dispatch, onNavigate)} onAuxClick={event => openSavedPage(event, node, state, dispatch, onNavigate)}
              onKeyDown={event => reorderKey(event, node)}>
              <SiteIdentityIcon url={node.url!} favicon={savedPageIdentity(node.url!, state).favicon || siteIcon(node.url!)} size={16} className="lib-site" />
              <span className="lib-text"><span className="lib-title">{label}</span><span className="lib-host">{path ? `${path} · ${pageHost(node.url!)}` : pageHost(node.url!)}{node.tor && ` · ${privacyNames.tor.label}`}</span></span>
            </button>}
      <span className="lib-trail"><span className="lib-actions">
        {!isFolder && <button type="button" className="lib-icon" aria-pressed={onBar.has(node.id)} aria-label={onBar.has(node.id) ? t('bm.removeFromBarAria', { label }) : t('bm.showOnBarAria', { label })} title={onBar.has(node.id) ? t('bm.onBar') : t('bm.showOnBar')} data-on={onBar.has(node.id) || undefined} onClick={() => toggleBar(node)}><Pin size={14} /></button>}
        {!isFolder && <button type="button" className="lib-icon" aria-label={t('history.openNewTabAria', { title: label })} title={t('history.openNewTab')} onClick={() => dispatch({ type: 'tab.new', url: node.url!, ...(node.tor ? { privacy: 'tor' as const } : {}) })}><ArrowUpRight size={14} /></button>}
        <button type="button" className="lib-icon" aria-label={t('bm.renameAria', { label })} title={t('bm.rename')} onClick={() => setEditing(node.id)}><PenLine size={14} /></button>
        {isFolder
          ? <ConfirmAction label={<Trash2 size={14} />} className="lib-icon-confirm" confirmLabel={t('bm.deleteFolderAnd', { count: countIn(node.id) })} ariaLabel={t('bm.deleteFolderAria', { name: label })} onConfirm={() => removeNode(node)} />
          : <button type="button" className="lib-icon" data-danger aria-label={t('bm.removeBookmarkAria', { label })} title={t('history.remove')} onClick={() => removeNode(node)}><X size={14} /></button>}
      </span></span>
    </div>;
  };

  const treeNode = (node: BookmarkNode, depth: number): ReactNode => {
    const kids = (childrenOf.get(node.id) ?? []).filter(child => !child.url);
    return <div key={node.id} role="none">
      <button type="button" className="bm-node" data-folder={node.id} style={{ ['--depth' as string]: depth }} aria-current={selected === node.id || undefined} data-drop={drop?.id === node.id || linkDrop?.id === node.id ? 'into' : undefined}
        onClick={() => { setSelected(node.id); setQuery(''); }}
        onDragOver={event => { if (dragId && dragId !== node.id) { event.preventDefault(); setDrop({ id: node.id, where: 'into' }); } }} onDragLeave={() => setDrop(current => current?.id === node.id ? null : current)}
        onDrop={event => { event.preventDefault(); if (dragId && dragId !== node.id) move(dragId, node.id, (childrenOf.get(node.id) ?? []).length); setDragId(null); setDrop(null); }}>
        {selected === node.id ? <FolderOpen size={14} /> : <Folder size={14} />}<span className="bm-node-name">{title(node)}</span><span className="bm-node-count">{countIn(node.id)}</span>
      </button>
      {kids.map(child => treeNode(child, depth + 1))}
    </div>;
  };

  const unsaved = useMemo(() => suggestHistory(
    state.browsingHistory.filter(item => (item.browserProfileId ?? state.browserProfiles[0]?.id) === profileId), nodes.map(node => node.url),
    { templates: state.settings.searchProviders?.engines?.map(engine => engine.template) ?? [] }), [nodes, state.browsingHistory, state.browserProfiles, state.settings.searchProviders, profileId]);

  const createFolder = (value: string) => { setCreating(false); const name = value.trim(); if (name) dispatch({ type: 'bookmark.folder', title: name, parentId: selected || null }); };
  const rootList = childrenOf.get(ROOT) ?? [], topFolders = rootList.filter(node => !node.url);
  const heading = folder ? title(folder) : t('bm.all');
  const headActions = <button type="button" className="acira-button acira-button-secondary" onClick={() => { setQuery(''); setCreating(true); }}><Plus size={14} />{t('bm.newFolder')}</button>;

  return <LibraryPage title={t('bm.title')} description={nodes.length ? t('bm.description').replace('Ctrl+D',formatShortcut('Ctrl+D')) : t('bm.descriptionShort')}
    count={total ? `${t('plural.bookmarks', { count: total })} · ${t('plural.sites', { count: sites })}` : undefined}
    search={{ label: t('bm.search'), placeholder: t('bm.search'), value: query, onChange: setQuery, inputRef: bookmarkSearch }} actions={nodes.length ? headActions : undefined} notice={notice} onDismissNotice={dismiss}>
    {nodes.length === 0 && !creating
      ? <LibraryEmpty title={t('bm.emptyTitle')} text={t('bm.emptyText')} hint={<>{t('bm.emptyHintBefore')} <kbd>{formatShortcut('Ctrl+D')}</kbd> {t('bm.emptyHintAfter')}</>}>
          <button type="button" className="acira-button acira-button-secondary" onClick={() => setCreating(true)}><Plus size={14} />{t('bm.newFolder')}</button>
        </LibraryEmpty>
      : <div className="bm-layout" onContextMenu={nodeMenu} data-link-drop={linkDrop?.id === 'main' || undefined} onDragOver={linkOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setLinkDrop(null); }} onDrop={linkDropped}>
          <nav className="bm-tree" aria-label={t('bm.folders')}>
            <button type="button" className="bm-node" data-folder={ROOT} aria-current={!selected && !found || undefined} data-drop={drop?.id === ROOT || linkDrop?.id === ROOT ? 'into' : undefined} onClick={() => { setSelected(ROOT); setQuery(''); }}
              onDragOver={event => { if (dragId) { event.preventDefault(); setDrop({ id: ROOT, where: 'into' }); } }} onDragLeave={() => setDrop(current => current?.id === ROOT ? null : current)}
              onDrop={event => { event.preventDefault(); if (dragId) move(dragId, null, rootList.filter(node => node.id !== dragId).length); setDragId(null); setDrop(null); }}>
              <Bookmark size={14} /><span className="bm-node-name">{t('bm.all')}</span><span className="bm-node-count">{total}</span>
            </button>
            {!hasBarFolder && <button type="button" className="bm-node bm-node-virtual" data-folder="bookmarks-bar" style={{ ['--depth' as string]: 1 }} data-drop={drop?.id === 'bookmarks-bar' || linkDrop?.id === 'bookmarks-bar' ? 'into' : undefined} title={t('bm.dropBar')} tabIndex={-1}
              onDragOver={event => { if (dragId) { event.preventDefault(); setDrop({ id: 'bookmarks-bar', where: 'into' }); } }} onDragLeave={() => setDrop(current => current?.id === 'bookmarks-bar' ? null : current)}
              onDrop={event => { event.preventDefault(); if (dragId) move(dragId, 'bookmarks-bar', 0); setDragId(null); setDrop(null); }}><Folder size={14} /><span className="bm-node-name">{t('bm.bar')}</span></button>}
            {topFolders.map(node => treeNode(node, 1))}
          </nav>
          <div className="bm-main" ref={mainRef}>
            {found
              ? <LibrarySection title={t('bm.results')} count={found.length} windowed={found.length ? { count: found.length, at: i => row(found[i], pathOf(found[i])), signature: found.map(node => node.id).join('|') } : undefined}>{found.length ? null : <LibraryEmpty title={t('bm.noMatchTitle')} text={t('bm.noMatchText', { query: query.trim() })}><button type="button" className="acira-button acira-button-secondary" onClick={() => { setQuery(''); bookmarkSearch.current?.focus({ preventScroll: true }); }}>{t('lib.clearSearch')}</button></LibraryEmpty>}</LibrarySection>
              : <>
                  <div className="bm-crumb">
                    {folder && editing === folder.id ? renameField(folder) : <h2 onDoubleClick={() => folder && setEditing(folder.id)}>{heading}</h2>}
                    <span className="lib-section-count">{folder ? countIn(folder.id) : total}</span>
                    {folder && <>
                      <button type="button" className="lib-icon" aria-label={t('bm.renameAria', { label: title(folder) })} title={t('bm.renameFolder')} onClick={() => setEditing(folder.id)}><PenLine size={14} /></button>
                      {countIn(folder.id) > 0 && <ConfirmAction label={t('bm.clear')} confirmLabel={t('bm.removeConfirm', { count: countIn(folder.id) })} ariaLabel={t('bm.removeAllAria', { name: title(folder) })} onConfirm={() => clearFolder(folder)} />}
                      <ConfirmAction label={t('bm.deleteFolder')} confirmLabel={t('bm.deleteFolderConfirm')} ariaLabel={t('bm.deleteFolderAria', { name: title(folder) })} onConfirm={() => removeNode(folder)} />
                    </>}
                  </div>
                  <div className="lib-list" ref={listRef} style={windowPadding(windowOn, windowed.range, windowed.rowHeight, here.length)} onDragOver={event => { if (dragId && event.target === event.currentTarget) event.preventDefault(); }} onDrop={event => { if (event.target === event.currentTarget) { event.preventDefault(); dropOn(null, 'after', selected); setDragId(null); setDrop(null); } }}>
                    {creating && <div className="lib-row"><div className="lib-open"><Folder size={16} /><input className="bm-rename" autoFocus placeholder={t('bm.folderName')} aria-label={t('bm.newFolderName')} maxLength={200}
                      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') createFolder(event.currentTarget.value); if (event.key === 'Escape') setCreating(false); }} onBlur={event => createFolder(event.currentTarget.value)} /></div></div>}
                    {(windowOn ? here.slice(windowed.range.start, windowed.range.end) : here).map(node => row(node))}
                    {!here.length && !creating && <LibraryEmpty title={t('bm.folderEmptyTitle')} text={t('bm.folderEmptyText')} />}
                  </div>
                  {!selected && !query && unsaved.length > 0 && <LibrarySection title={t('bm.fromHistory')} count={t('bm.notSaved')}>
                    {unsaved.map(item => <div className="lib-row" key={item.url}>
                      <button type="button" className="lib-open" data-lib-stop title={`${item.title} · ${item.url}`} onClick={event => openPage(event, item.url, dispatch, onNavigate)} onAuxClick={event => openPage(event, item.url, dispatch, onNavigate)}>
                        <SiteIdentityIcon url={item.url} favicon={savedPageIdentity(item.url, state).favicon || siteIcon(item.url)} size={16} className="lib-site" />
                        <span className="lib-text"><span className="lib-title">{item.title}</span><span className="lib-host">{pageHost(item.url)}</span></span>
                      </button>
                      <button type="button" className="acira-button acira-button-quiet lib-compact" aria-label={t('bm.saveAria', { title: item.title })} onClick={() => dispatch({ type: 'bookmark.toggle', url: item.url })}><Star size={13} />{t('bm.save')}</button>
                    </div>)}
                  </LibrarySection>}
                </>}
          </div>
        </div>}
  </LibraryPage>;
}
