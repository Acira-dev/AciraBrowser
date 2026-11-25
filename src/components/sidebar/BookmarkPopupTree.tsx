import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { BookmarkNode, BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { SubmenuBack, type BrowserMenuIcon } from '../BrowserMenu';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { BookmarkEmptyRow, BookmarkFolderRow, BookmarkPageRow, type RowExtra } from './BookmarkTree';
import { GroupFolderGlyph } from './GroupFolderGlyph';
import { BookmarkMenu } from './BookmarkMenu';
import { siteIdentity } from '../../runtime/sites';
import { openTorBookmark } from '../../ui/bookmarkControl';
import { bookmarkRef } from '../../ui/bookmarkMenu';
import { folderTitle } from '../../ui/bookmarkFolderName';
import { savedPageIdentity } from '../../ui/pageActions';
import { readRailPrefs, setRailPrefs, toggleRailSection, useRailPrefs } from '../../ui/railPrefs';
import { useSiteIcons } from '../../ui/siteIcons';
import { useListMotion } from '../../ui/sharedMotion';
import { noteUse } from '../../features/metrics/noteUse';
import { POPUP_LIMITS, ancestorsOf, searchTree, treeRows, treeStep, type TreeMatch } from '../../ui/bookmarkTreeRows';
import { t } from '../../i18n';
import '../../styles/bookmark-popup-tree.css';

type Row = (label: string, Icon: BrowserMenuIcon, action: () => void, hint?: string) => ReactNode;

/** Which folders the pop-up has open is its own memory (per profile, in the rail's preferences under `bmp:<id>`), apart from the sidebar's
 *  (`bmo:<id>`): opening folders here to look for something never reshapes the sidebar behind it. */
const OPEN = 'bmp:';

/**
 * The All Bookmarks pop-up's list (Beta 14): the same tree as the sidebar's Bookmarks zone (BookmarkTree.tsx rows, the planner in
 * ui/bookmarkTreeRows.ts), every level and every page, folders opening and closing in place. While there is text in the search box it is a
 * flat list of matches with the folders each one lives in; choosing a matching folder opens it in the tree. A bookmark row does what the
 * sidebar's does (open, background tab, its own menu), except drag and drop, which this pop-up leaves out.
 */
export function BookmarkPopupTree({ state, dispatch, query, clearQuery, reserve, onNavigate, close, row }: {
  state: BrowserSnapshot;
  dispatch: (action: BrowserAction) => void;
  query: string;
  clearQuery: () => void;
  /** Room to keep for the tree (ui/popup.ts bookmarksReserve), so opening folders does not resize the pop-up. */
  reserve: number;
  onNavigate: (url: string) => void;
  close: () => void;
  row: Row;
}) {
  const profileId = state.activeBrowserProfileId;
  const privateMode = !!state.browserProfiles.find((profile) => profile.id === profileId)?.private;
  const nodes = useMemo(() => state.bookmarkNodes.filter((node) => node.browserProfileId === profileId), [state.bookmarkNodes, profileId]);
  const folded = useRailPrefs(profileId, privateMode).folded;
  const siteIcon = useSiteIcons(state);
  const host = useRef<HTMLDivElement>(null);
  const menuHost = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<string | null>(null);
  const comeBack = useRef<string | null>(null);
  const treeScroll = useRef(0);
  const reveal = useRef<string | null>(null);
  const isOpen = (node: BookmarkNode) => !!folded[OPEN + node.id];
  const toggle = (node: BookmarkNode) => toggleRailSection(OPEN + node.id, profileId, privateMode);
  const nameOf = (node: BookmarkNode) => (node.url ? node.title || siteIdentity(node.url).label : folderTitle(node) || t('bm.untitled'));
  const text = query.trim();
  const rows = useMemo(() => treeRows(nodes, { isOpen: (node) => !!folded[OPEN + node.id], limits: POPUP_LIMITS, emptyRows: true }), [nodes, folded]);
  /** The rows the keyboard walks: every row but the quiet "Empty" line. A row's `data-tree-index` is its place among them. */
  const walkable = useMemo(() => rows.filter((item) => item.kind !== 'empty'), [rows]);
  const placeOf = useMemo(() => new Map(walkable.map((item, index) => [item, index])), [walkable]);
  const matches = useMemo<TreeMatch[]>(() => (text ? searchTree(nodes, text, nameOf, (url) => siteIdentity(url).label) : []), [nodes, text]);
  // Rows glide to their places, new ones fade in and leavers fade out: the lists' own motion (ui/sharedMotion.ts useListMotion). The search and the tree are two lists
  // (each has its own element, `key`): going from one to the other the old rows fade out where they were and the new ones fade in, instead of every row flying
  // across the pop-up to its new place.
  useListMotion(host, text ? 'q:' + matches.map((match) => match.node.id).join(',') : rows.map((item) => (item.kind === 'folder' || item.kind === 'page' ? item.node.id + (item.kind === 'folder' && item.expanded ? '+' : '') : item.kind + item.key)).join(','));

  // After choosing a folder in the search: it is open and in the tree again, and the keyboard is on it.
  useLayoutEffect(() => {
    const id = reveal.current;
    if (!id || text) return;
    const target = host.current?.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(id)}"]`);
    if (!target) return;
    reveal.current = null;
    // Once now, and again after the list has settled into its places (its rows glide in and the pop-up re-measures): the tall list has its final height by then.
    const go = () => {
      if (!target.isConnected) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
    };
    go();
    requestAnimationFrame(() => requestAnimationFrame(go));
  });
  // Back from a bookmark's own menu: the keyboard returns to the row it came from.
  useLayoutEffect(() => {
    if (actions || !comeBack.current) return;
    const target = host.current?.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(comeBack.current)}"]`);
    comeBack.current = null;
    const viewport = host.current?.closest<HTMLElement>('.popup-scroll');
    if (viewport) viewport.scrollTop = treeScroll.current;
    target?.focus({ preventScroll: true });
  }, [actions]);
  // A bookmark's menu takes the keyboard to its first row (Esc and Left come back from there).
  useLayoutEffect(() => {
    if (!actions) return;
    const viewport = menuHost.current?.closest<HTMLElement>('.popup-scroll');
    if (viewport) viewport.scrollTop = 0;
    menuHost.current?.querySelector<HTMLElement>('.popup-back,.menu-row,button')?.focus({ preventScroll: true });
  }, [actions]);
  // A bookmark removed while its menu is open leaves nothing to show a menu for.
  useEffect(() => {
    if (actions && !nodes.some((node) => node.id === actions)) setActions(null);
  }, [actions, nodes]);

  const rtl = () => !!host.current && getComputedStyle(host.current).direction === 'rtl';
  const openPage = (node: BookmarkNode, ctrl: boolean, shift: boolean, middle: boolean) => {
    const url = node.url!;
    const background = middle || (ctrl && !shift);
    noteUse('bookmarksOpened');
    if (node.tor) openTorBookmark(state, dispatch, url, background);
    else if (background || shift) dispatch({ type: 'tab.new', url, background });
    else {
      onNavigate(url);
      return;
    }
    // A page opened behind leaves the pop-up open for the next one.
    if (!background) close();
  };
  const menuFor = (id: string) => {
    comeBack.current = id;
    // The menu opens at its top, and the list comes back where it was.
    treeScroll.current = host.current?.closest<HTMLElement>('.popup-scroll')?.scrollTop ?? 0;
    setActions(id);
  };
  const pageExtra = (node: BookmarkNode, level: number, index: number): RowExtra => ({
    role: 'treeitem',
    'aria-level': level + 1,
    'aria-label': nameOf(node),
    'data-tree-row': '',
    'data-tree-index': index,
    'data-bookmark-id': node.id,
    title: node.url,
    onClick: (event: MouseEvent<HTMLButtonElement>) => openPage(node, event.ctrlKey || event.metaKey, event.shiftKey, false),
    onAuxClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        openPage(node, true, false, true);
      }
    },
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button === 1) event.preventDefault();
    },
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      menuFor(node.id);
    },
  });
  const folderExtra = (node: BookmarkNode, level: number, index: number, onClick: () => void): RowExtra => ({
    role: 'treeitem',
    'aria-level': level + 1,
    'aria-label': nameOf(node),
    'data-tree-row': '',
    'data-tree-index': index,
    'data-bookmark-id': node.id,
    onClick,
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      menuFor(node.id);
    },
  });
  const pageIcon = (node: BookmarkNode) => {
    const url = node.url!;
    return <SiteIdentityIcon url={url} favicon={siteIcon(url) || savedPageIdentity(url, state).favicon} size={16} />;
  };
  /** A folder chosen in the search opens in the tree: it and every folder above it, then the search clears. */
  const openFolderFromSearch = (node: BookmarkNode) => {
    const next = { ...readRailPrefs(profileId, privateMode).folded };
    for (const folder of [...ancestorsOf(nodes, node.id), node]) next[OPEN + folder.id] = true;
    reveal.current = node.id;
    setRailPrefs({ folded: next }, profileId, privateMode);
    clearQuery();
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const at = target.closest<HTMLElement>('[data-tree-row]');
    if (event.key === 'Escape' && actions) {
      event.preventDefault();
      event.stopPropagation();
      setActions(null);
      return;
    }
    if (!at || actions) return;
    const id = at.dataset.bookmarkId!;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      menuFor(id);
      return;
    }
    // Typing from a row goes to the search box, as in the tab viewer.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      target.closest('.browser-popup')?.querySelector<HTMLInputElement>('.popup-search input')?.focus({ preventScroll: true });
      return;
    }
    if (text) return;
    const step = treeStep(walkable, Number(at.dataset.treeIndex), event.key, rtl());
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    if ('focus' in step) {
      const next = host.current?.querySelector<HTMLElement>(`[data-tree-index="${step.focus}"]`);
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } else {
      const node = nodes.find((item) => item.id === ('open' in step ? step.open : step.close));
      if (node) toggle(node);
    }
  };

  // A bookmark's own menu, in place of the list (the same one the sidebar and the bar give).
  const menuNode = actions ? nodes.find((node) => node.id === actions) : undefined;
  if (menuNode)
    return (
      <div ref={menuHost} className="bmp-menu" style={{ minHeight: reserve }} onKeyDown={keys}>
        <SubmenuBack title={nameOf(menuNode)} onBack={() => setActions(null)} />
        <hr className="acira-menu-sep" />
        <BookmarkMenu state={state} dispatch={dispatch} target={bookmarkRef(menuNode.id)} row={row} close={close} navigate={onNavigate} />
      </div>
    );
  if (!nodes.length) return <p className="popup-empty bmp-note" style={{ minHeight: reserve }}>{t('bm.emptyTitle')}</p>;

  if (text)
    return (
      <div key="search" ref={host} className="bmp-tree" role="list" aria-label={t('bm.results')} style={{ minHeight: reserve }} onKeyDown={keys}>
        {matches.length ? (
          matches.map(({ node, path }, index) => {
            // The nearest folders, quietly: "Work › Clients", or "… › Clients › Acme" when it lives deeper; the whole path is the tooltip.
            // Each folder is its own isolated piece that shortens by itself, so a long name is cut at its own end (in its own direction), never the whole line.
            const near = path.slice(-2);
            const where = path.length ? (
              <span className="bmp-path" title={path.join(' › ')}>
                {path.length > 2 && <span className="bmp-sep">… ›</span>}
                {near.map((name, at) => (
                  <Fragment key={at}>
                    {at > 0 && <span className="bmp-sep">›</span>}
                    <bdi className="bmp-seg">{name}</bdi>
                  </Fragment>
                ))}
              </span>
            ) : null;
            return node.url ? (
              <BookmarkPageRow key={node.id} node={node} level={0} title={nameOf(node)} icon={pageIcon(node)} note={where} extra={{ ...pageExtra(node, 0, index), role: 'listitem' }} />
            ) : (
              <BookmarkFolderRow key={node.id} level={0} expanded={false} bar={false} title={nameOf(node)} note={where} glyph={<GroupFolderGlyph count={0} open={false} />} extra={{ ...folderExtra(node, 0, index, () => openFolderFromSearch(node)), role: 'listitem', 'aria-expanded': undefined }} />
            );
          })
        ) : (
          <p key="none" className="popup-empty bmp-note" data-motion-skip="">
            {t('bm.noMatchTitle')}
          </p>
        )}
      </div>
    );

  return (
    <div key="tree" ref={host} className="bmp-tree" role="tree" aria-label={t('app.allBookmarks')} style={{ minHeight: reserve }} onKeyDown={keys}>
      {rows.map((item) => {
        if (item.kind === 'empty') return <BookmarkEmptyRow key={'empty:' + item.key} level={item.level} label={t('bm.treeEmpty')} />;
        const index = placeOf.get(item) ?? -1;
        if (item.kind === 'folder') return <BookmarkFolderRow key={item.node.id} level={item.level} expanded={item.expanded} bar={item.bar} title={nameOf(item.node)} glyph={<GroupFolderGlyph count={0} open={item.expanded} />} extra={{ ...folderExtra(item.node, item.level, index, () => toggle(item.node)), 'aria-expanded': item.expanded }} />;
        if (item.kind === 'page') return <BookmarkPageRow key={item.node.id} node={item.node} level={item.level} title={nameOf(item.node)} icon={pageIcon(item.node)} extra={pageExtra(item.node, item.level, index)} />;
        return null;
      })}
    </div>
  );
}
