import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Folder, FolderOpen, PanelTop } from '../AppIcons';
import type { BookmarkNode } from '../../runtime/types';
import { PreviewIcon } from '../PreviewIcon';
import { TabPrivacyMark } from '../TabPrivacyMark';

/**
 * The rows of the Bookmarks tree, drawn once for every surface that shows it: the sidebar's Bookmarks zone and the All
 * Bookmarks pop-up (Beta 14). What a row IS (its icon, its name, a folder's chevron, a Tor page's mark, the 32px height
 * and the 12px step per level in sidebar.css) lives here; what a surface DOES with it (drag and drop, FLIP motion, which
 * click opens what, its own keyboard) comes in as `extra`, spread onto the row's button.
 */
type Data = { [name: `data-${string}`]: string | number | boolean | undefined };
export type RowExtra = ButtonHTMLAttributes<HTMLButtonElement> & Data;

const levelStyle = (level: number) => ({ '--sb-level': level }) as CSSProperties;

/** A saved page. `icon` is the page's site icon (the surface decides which favicon it has), `title` the name on screen. */
export function BookmarkPageRow({ node, level, title, icon, note, extra }: { node: BookmarkNode; level: number; title: string; icon: ReactNode; /** Quiet text after the name (the pop-up's search: the folders it is in). */ note?: ReactNode; extra?: RowExtra }) {
  return (
    <button type="button" className="sb-bookmark" data-tor={node.tor || undefined} data-level={level} style={levelStyle(level)} {...extra}>
      <span className="sb-tab-icon">{icon}</span>
      <span className="sb-tab-title" dir="auto">
        {title}
      </span>
      {note}
      {node.tor && <TabPrivacyMark privacy="tor" className="sb-tab-mark" />}
    </button>
  );
}

/** A folder: its icon (the Bookmarks bar has its own), its name and the chevron that shows on hover or focus. */
export function BookmarkFolderRow({ level, expanded, bar, title, note, glyph, extra }: { level: number; expanded: boolean; bar: boolean; title: string; note?: ReactNode; /** The folder's drawing, when a surface has its own (the pop-up draws the section M folder that morphs); default: the sidebar's. */ glyph?: ReactNode; extra?: RowExtra }) {
  return (
    <button type="button" className="sb-folder" data-bar={bar || undefined} aria-expanded={expanded} data-level={level} style={levelStyle(level)} {...extra}>
      <span className="sb-tab-icon">{glyph && !bar ? glyph : <PreviewIcon icon={bar ? PanelTop : expanded ? FolderOpen : Folder} size={16} />}</span>
      <span className="sb-tab-title" dir="auto">
        {title}
      </span>
      {note}
      <PreviewIcon icon={ChevronDown} size={12} className="sb-folder-chevron" />
    </button>
  );
}

/** "Show all 40 bookmarks": a quiet row that goes to the Bookmarks page (the sidebar's short lists end in one). */
export function BookmarkMoreRow({ level, label, extra }: { level: number; label: string; extra?: RowExtra }) {
  return (
    <button type="button" className="sb-bookmark sb-bookmark-more" data-level={level} style={levelStyle(level)} {...extra}>
      <span className="sb-tab-icon">
        <PreviewIcon icon={ArrowUpRight} size={14} />
      </span>
      <span className="sb-tab-title" dir="auto">
        {label}
      </span>
    </button>
  );
}

/** What an open folder with nothing in it says (the pop-up): one quiet row, at the level of the rows it would have had. */
export function BookmarkEmptyRow({ level, label, extra }: { level: number; label: string; extra?: HTMLAttributes<HTMLDivElement> }) {
  return (
    <div className="sb-bookmarks-empty bmp-empty" style={levelStyle(level)} {...extra}>
      <span className="sb-tab-icon" aria-hidden="true" />
      <span dir="auto">{label}</span>
    </div>
  );
}
