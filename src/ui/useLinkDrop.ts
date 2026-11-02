import { useEffect, useRef } from 'react';
import type { BrowserAction } from '../runtime/types';
import { droppedLink, hasLink } from './linkDrop';

/** Links dragged from a page (or another app) onto the tab strip or the sidebar's tab list open as in Chrome: dropped on a
 * tab they replace it, anywhere else on the strip or list they open in a new tab next to the current one. Acira's own drags
 * are left alone: tabs move with pointer drags, and favourites and bookmarks carry their own data and handle their drops
 * (a drop they handled arrives here already prevented, and is skipped). */
// The strip, and the whole scrolling part of the sidebar (its tab list and the empty space under it, .sb-scroll); favourites are blocked below.
const zones = '.tab-strip-container,.sb-tabs,.sb-scroll';
const blocked = 'input,textarea,[contenteditable=true],.sb-apps';

/** Where a link would land: on a tab ({tabId}), elsewhere on the strip or tab list ({}), or nowhere it should open (null). */
export function linkDropZone(target: Element | null): { tabId?: string } | null {
  if (!target || target.closest(blocked) || !target.closest(zones)) return null;
  const tab = target.closest<HTMLElement>('[data-tab-id]');
  return tab?.dataset.tabId ? { tabId: tab.dataset.tabId } : {};
}

export const linkDropAction = (zone: { tabId?: string }, url: string, activeTabId: string): BrowserAction =>
  zone.tabId ? { type: 'tab.navigate', tabId: zone.tabId, url } : { type: 'tab.new', url, afterId: activeTabId };

export function useLinkDrop(dispatch: (action: BrowserAction) => void, activeTabId: string) {
  const active = useRef(activeTabId);
  active.current = activeTabId;
  useEffect(() => {
    const ours = (event: DragEvent) => {
      const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
      return !event.defaultPrevented && !types.some(type => type.startsWith('application/x-acira')) && hasLink(event.dataTransfer) && linkDropZone(event.target as Element) !== null;
    };
    const over = (event: DragEvent) => { if (!ours(event)) return; event.preventDefault(); event.dataTransfer!.dropEffect = 'link'; };
    const drop = (event: DragEvent) => {
      if (!ours(event)) return;
      const link = droppedLink(event.dataTransfer);
      if (!link) return;
      event.preventDefault();
      dispatch(linkDropAction(linkDropZone(event.target as Element)!, link.url, active.current));
    };
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop); };
  }, [dispatch]);
}
