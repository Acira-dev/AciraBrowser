import { useMemo } from 'react';
import type { BrowserSnapshot, TabSession } from '../runtime/types';
import { makeTab } from '../runtime/core';
import { usePeekMarkerState, type PeekMarker } from './peekMarker';

/**
 * Beta 14.0 (EDICT, Discord, 19 Nov): a video or a song playing in a Link preview is a now-playing card like a tab's. The card takes tabs, and a preview is not one, so
 * (as for a side panel site, ui/sidePanelSites.ts) it is given to the card as a tab-shaped row: the preview's own id (main follows its page by it), its title, address and icon, and
 * what main says about its sound (`media`, `mediaAt`, `muted`). The row is never in the window's tab list, so the tab actions on it are answered here (`isPreviewRow`,
 * `previewRowDispatch`): "Go to tab" has nowhere to go (the preview is already in front), the volume slider's mute reaches the preview's page. When the preview is opened as a tab
 * main hands the page's state to the new tab (desktop/media-controls.cjs attach), and the row gives way to the tab's own card.
 */
export interface PreviewRow extends TabSession { preview: true }
export const isPreviewRow = (tab: unknown): tab is PreviewRow => !!tab && typeof tab === 'object' && (tab as { preview?: unknown }).preview === true;

/** The row for the open preview while its page plays or has paused a sound; none otherwise. Pure. */
export function previewMediaRow(open: PeekMarker | null | undefined, profileId: string): PreviewRow | null {
  if (!open || (open.media !== 'playing' && open.media !== 'paused') || !open.mediaId) return null;
  const tab = makeTab(open.mediaId, '', open.url, profileId);
  return { ...tab, ...(open.title ? { title: open.title } : {}), ...(open.favicon ? { favicon: open.favicon } : {}), media: open.media, mediaAt: open.mediaAt ?? 0, muted: !!open.muted, preview: true as const };
}

/** A request to the open preview (main: desktop/rewind/peek.cjs handle). */
export const askPeek = (request: { type: 'peek.mute'; muted: boolean }): Promise<unknown> => { const bridge = (typeof window === 'undefined' ? undefined : (window as unknown as { acira?: { peek?: (request: unknown) => Promise<unknown> } }).acira); return bridge?.peek ? bridge.peek(request).catch(() => undefined) : Promise.resolve(undefined); };

/** The card's dispatch for the preview's row: the volume slider's mute reaches the preview's page; nothing else is a tab action. */
export function previewRowDispatch<A extends { type: string }>(dispatch: (action: A) => void, ask: (request: { type: 'peek.mute'; muted: boolean }) => unknown): (action: A) => void {
  return action => {
    const mute = action as unknown as { type: string; id?: string; muted?: boolean };
    if (mute.type === 'tab.mute' && typeof mute.id === 'string' && mute.id.startsWith('peek:') && typeof mute.muted === 'boolean') { void ask({ type: 'peek.mute', muted: mute.muted }); return; }
    if (mute.type === 'tab.mute' && typeof mute.id === 'string' && mute.id.startsWith('peek:')) return;
    dispatch(action);
  };
}

/** The preview's row for the card on screen (see `previewMediaRow`). */
export function usePreviewMediaRows(state: Pick<BrowserSnapshot, 'activeBrowserProfileId'>): PreviewRow[] {
  const { open } = usePeekMarkerState();
  return useMemo(() => { const row = previewMediaRow(open, state.activeBrowserProfileId); return row ? [row] : []; }, [open, state.activeBrowserProfileId]);
}
