import type { BookmarkNode } from '../runtime/types';
import { isBarFolder } from './bookmarkMenu';

/**
 * The Bookmarks tree as an ordered list of rows, shared by the sidebar's Bookmarks zone and the All Bookmarks pop-up
 * (Beta 14: one tree, never a second one). Pure: it plans the rows, the components in
 * components/sidebar/BookmarkTree.tsx draw them.
 *
 * Order is the sidebar's (reported 25 Oct): under the root the Bookmarks bar first, then the other folders, then loose
 * pages; inside a folder, by position. A folder shows its contents only while it is open.
 */
export type TreeRow =
  | { kind: 'folder'; node: BookmarkNode; level: number; expanded: boolean; bar: boolean }
  | { kind: 'page'; node: BookmarkNode; level: number }
  /** A link into the Bookmarks page ("Show all 40 bookmarks"): only where the surface limits what it shows. */
  | { kind: 'more'; key: string; level: number; label: string }
  /** A quiet line inside an open folder that holds nothing. */
  | { kind: 'empty'; key: string; level: number };

/** What a surface shows of the tree. `null` means everything. The sidebar is a narrow strip and keeps its short lists; the pop-up shows it all. */
export interface TreeLimits {
  /** Loose pages shown at the root (the sidebar: a few, then "Show all"). */
  loose: number | null;
  /** Items shown inside an open folder. */
  items: number | null;
  /** The deepest level whose contents show; an open folder past it only links to the Bookmarks page. */
  depth: number | null;
}
export const SIDEBAR_LIMITS: TreeLimits = { loose: 5, items: 8, depth: 2 };
export const POPUP_LIMITS: TreeLimits = { loose: null, items: null, depth: null };

export interface TreeOptions {
  isOpen: (node: BookmarkNode) => boolean;
  limits?: TreeLimits;
  /** How many root pages to show when the surface decides it (the sidebar widens it to reveal a page that just arrived); default: `limits.loose`. */
  looseShown?: number | null;
  /** The sidebar's "Show all N bookmarks" row and "N more" rows. The pop-up shows everything, so it has none. */
  links?: boolean;
  /** A quiet row under an open folder with nothing in it. */
  emptyRows?: boolean;
}

const rank = (node: BookmarkNode) => (isBarFolder(node) ? 0 : node.url ? 2 : 1);

/** The children of `parent` (null = the root) in tree order. */
export function kidsOf(nodes: readonly BookmarkNode[], parent: string | null): BookmarkNode[] {
  return nodes
    .filter((node) => (node.parentId || null) === parent)
    .sort((a, b) => (parent === null ? rank(a) - rank(b) || a.position - b.position : a.position - b.position));
}

/** Every row of the tree for these nodes (already the profile's own), in drawing order. Cycles and orphans never loop or show. */
export function treeRows(nodes: readonly BookmarkNode[], options: TreeOptions): TreeRow[] {
  const limits = options.limits ?? SIDEBAR_LIMITS;
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const more = (key: string, level: number, label: string): TreeRow => ({ kind: 'more', key, level, label });
  const walk = (node: BookmarkNode, level: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const expanded = options.isOpen(node);
    rows.push({ kind: 'folder', node, level, expanded, bar: isBarFolder(node) });
    if (!expanded) return;
    if (limits.depth !== null && level >= limits.depth) {
      if (options.links) rows.push(more(node.id, level + 1, 'Show in Bookmarks'));
      return;
    }
    const inside = kidsOf(nodes, node.id);
    const shown = limits.items === null ? inside : inside.slice(0, limits.items);
    if (!inside.length && options.emptyRows) rows.push({ kind: 'empty', key: node.id, level: level + 1 });
    for (const child of shown) {
      if (child.url) rows.push({ kind: 'page', node: child, level: level + 1 });
      else walk(child, level + 1);
    }
    if (options.links && inside.length > shown.length) rows.push(more(node.id, level + 1, `${inside.length - shown.length} more in Bookmarks`));
  };
  const root = kidsOf(nodes, null);
  const folders = root.filter((node) => !node.url);
  const loose = root.filter((node) => node.url);
  const count = nodes.filter((node) => node.url).length;
  const looseCap = options.looseShown === undefined ? limits.loose : options.looseShown;
  const shownLoose = looseCap === null ? loose : loose.slice(0, looseCap);
  for (const folder of folders) walk(folder, 0);
  for (const page of shownLoose) rows.push({ kind: 'page', node: page, level: 0 });
  if (options.links && (loose.length > shownLoose.length || (folders.length && count > shownLoose.length))) rows.push(more('all', 0, `Show all ${count} bookmarks`));
  return rows;
}

/** The folders above `id`, outermost first (not `id` itself). Stops at a cycle. */
export function ancestorsOf(nodes: readonly BookmarkNode[], id: string): BookmarkNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: BookmarkNode[] = [];
  const seen = new Set<string>([id]);
  for (let parent = byId.get(id)?.parentId ?? null; parent && !seen.has(parent); ) {
    seen.add(parent);
    const folder = byId.get(parent);
    if (!folder) break;
    chain.unshift(folder);
    parent = folder.parentId ?? null;
  }
  return chain;
}

/** One search match: the bookmark or folder and where it lives ("Work", "Clients": its folders, outermost first). */
export interface TreeMatch {
  node: BookmarkNode;
  path: string[];
}

/** Matches for a search, in tree order: pages by name, address or host, folders by name. `nameOf` is the name on screen (a translated "Bookmarks bar"). */
export function searchTree(nodes: readonly BookmarkNode[], query: string, nameOf: (node: BookmarkNode) => string, hostOf: (url: string) => string = (url) => url): TreeMatch[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const order = treeRows(nodes, { isOpen: () => true, limits: POPUP_LIMITS }).map((row) => ('node' in row ? row.node : null)).filter((node): node is BookmarkNode => !!node);
  const out: TreeMatch[] = [];
  for (const node of order) {
    const hay = (nameOf(node) + ' ' + (node.url ? node.url + ' ' + hostOf(node.url) : '')).toLocaleLowerCase();
    if (words.every((word) => hay.includes(word))) out.push({ node, path: ancestorsOf(nodes, node.id).map(nameOf) });
  }
  return out;
}

/** A keyboard step in the tree. `focus` is a row index; `open`/`close` name a folder; null leaves the key alone. */
export type TreeStep = { focus: number } | { open: string } | { close: string } | null;

/**
 * Up/Down move, Right opens a folder (or steps into an open one), Left closes it (or goes to its parent folder); Home/End
 * go to the first/last row. `rtl` swaps Left and Right, as every menu in Acira does.
 */
export function treeStep(rows: readonly TreeRow[], index: number, key: string, rtl = false): TreeStep {
  if (index < 0 || index >= rows.length) return null;
  const row = rows[index];
  if (key === 'ArrowDown') return index + 1 < rows.length ? { focus: index + 1 } : null;
  if (key === 'ArrowUp') return index > 0 ? { focus: index - 1 } : null;
  if (key === 'Home') return { focus: 0 };
  if (key === 'End') return { focus: rows.length - 1 };
  const into = rtl ? 'ArrowLeft' : 'ArrowRight';
  const out = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === into) {
    if (row.kind !== 'folder') return null;
    if (!row.expanded) return { open: row.node.id };
    return rows[index + 1] && rows[index + 1].level > row.level ? { focus: index + 1 } : null;
  }
  if (key === out) {
    if (row.kind === 'folder' && row.expanded) return { close: row.node.id };
    for (let at = index - 1; at >= 0; at--) if (rows[at].kind === 'folder' && rows[at].level < row.level) return { focus: at };
    return null;
  }
  return null;
}

/** The row height both surfaces draw (the sidebar's --sb-row). */
export const TREE_ROW_HEIGHT = 32;
/** How many rows the pop-up's tree has with every folder open: the height it reserves, so opening and closing folders never moves the pop-up. */
export function allOpenRowCount(nodes: readonly BookmarkNode[]): number {
  return treeRows(nodes, { isOpen: () => true, limits: POPUP_LIMITS, emptyRows: true }).length;
}
