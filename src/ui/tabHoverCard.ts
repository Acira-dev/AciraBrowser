import { useEffect,useRef,useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { tabCardKind } from '../runtime/tabCard';
import type { TabSession } from '../runtime/types';
import { rootSidebarSide } from './sidebarSide';
import { cardSideFor } from './tabCardSide';

/** The tab hover card (src/runtime/tabCard.ts, desktop/tab-card.cjs). The main process draws it and owns its timing; the
 * interface only says which tab the pointer is on, where that tab is, and when something (a press, a key, a scroll) ends it. */

export type TabHoverCardMode = 'preview' | 'name' | 'off';
let mode: TabHoverCardMode = 'preview';
const listeners = new Set<() => void>();
/** App publishes the setting here so every tab row can hand its tooltip back when a card takes over (and take it again when
 * the setting says Off) without each row being passed the settings. */
export function setTabHoverCardMode(next: TabHoverCardMode | undefined): void {
  const value: TabHoverCardMode = next === 'name' || next === 'off' ? next : 'preview';
  if (value === mode) return;
  mode = value;
  listeners.forEach(listener => listener());
}
export const tabHoverCardMode = (): TabHoverCardMode => mode;
export const useTabHoverCardMode = (): TabHoverCardMode => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => mode, () => 'preview' as const);

/** True when a card (not the tooltip) answers a pointer resting on this tab. Rows drop their `title` then. */
export const cardAnswers = (cardMode: TabHoverCardMode, tab: Pick<TabSession, 'risk' | 'capturing' | 'privacy' | 'contentKind' | 'sleeping'>): boolean => tabCardKind({ tabHoverCard: cardMode }, tab) !== null;

/** The rows of every tab surface: the horizontal strip, the sidebar's tabs, the compact strip. */
export const TAB_ROW = '.browser-tab[data-tab-id],.sb-tab[data-tab-id],.acira-compact-tab[data-tab-id],.sb-bookmark[data-card-title]';
export const tabRowOf = (node: EventTarget | null): HTMLElement | null => {
  const row = (node as Element | null)?.closest?.(TAB_ROW) as HTMLElement | null;
  return row && !row.closest('[inert]') && !row.closest('.tab-strip-container[data-dragging=true]') ? row : null;
};
/** Where the card goes for a row: under a strip tab, beside a sidebar tab (the page is to its right, or to its left when the sidebar is on the right). */
export const cardSide = (row: HTMLElement): 'below' | 'right' | 'left' => {
  const sidebarRow = row.matches('.sb-tab,.sb-bookmark');
  if (!sidebarRow) return 'below';
  const box = row.getBoundingClientRect();
  return cardSideFor(sidebarRow, box.left + box.width / 2, window.innerWidth, rootSidebarSide());
};
/** A saved page in the sidebar has no tab: its title and address ride on the row and the card is told them. */
export const cardLabel = (row: HTMLElement): { title: string; host: string } | null => row.dataset.cardTitle === undefined ? null : { title: row.dataset.cardTitle, host: row.dataset.cardHost ?? '' };
const rowKey = (row: HTMLElement): string | null => row.dataset.cardTitle === undefined ? row.dataset.tabId ?? null : `label:${row.dataset.cardTitle}
${row.dataset.cardHost ?? ''}`;

/** Where the page area starts: the bottom of the whole top chrome (tab strip, toolbar, bookmarks bar). A card starts at or below it, so it never covers
 * the toolbar's back, forward, address or menu controls; a compact or icon-only tab sits in that chrome too. 0 when the chrome is hidden (Seamless). */
export const cardFloor = (row: HTMLElement): number => {
  const shell = row.closest('.browser-shell') as HTMLElement | null;
  const bottom = shell?.getBoundingClientRect().bottom;
  return typeof bottom === 'number' && Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
};

/** The row that answers the pointer with a card: with tab cards Off the strip and sidebar tabs keep their tooltips, while a saved page's card is its tooltip and stays. */
const cardRow = (node: EventTarget | null): HTMLElement | null => { const row = tabRowOf(node); return row && tabHoverCardMode() === 'off' && row.dataset.cardTitle === undefined ? null : row; };

/** Watches the pointer over tab rows and tells the main process. Mounted once by App. */
export function useTabHoverCard(enabled: boolean, activeTabId?: string | null): void {
  const active = useRef(activeTabId ?? null);
  active.current = activeTabId ?? null;
  useEffect(() => {
    if (!enabled) return;
    let current: string | null = null, pressed: string | null = null;
    const send = (action: 'hover' | 'leave' | 'dismiss', key: string, anchor?: { x: number; y: number; width: number; height: number }, side?: 'below' | 'right' | 'left', floor?: number, label?: { title: string; host: string } | null) => {
      // A label row names no tab; the command still carries one (the open tab) so it validates like every tab command.
      const tabId = key.startsWith('label:') ? active.current : key;
      if (tabId) void runtime.browserCommand({ type: 'tab-card', tabId, action, ...(anchor ? { anchor } : {}), ...(side ? { side } : {}), ...(floor !== undefined ? { floor } : {}), ...(label ? { label } : {}) }).catch(() => {});
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons) return;
      const row = cardRow(event.target), id = row ? rowKey(row) : null;
      if (id === current) return;
      if (!row || !id) { if (current) { send('leave', current); current = null; } pressed = null; return; }
      current = id;
      // A tab pressed to select it shows no card until the pointer leaves and comes back.
      if (pressed === id) return;
      pressed = null;
      const box = row.getBoundingClientRect();
      send('hover', id, { x: box.x, y: box.y, width: box.width, height: box.height }, cardSide(row), cardFloor(row), cardLabel(row));
    };
    const out = (event: PointerEvent) => {
      if (!current) return;
      const next = cardRow(event.relatedTarget);
      if (next && rowKey(next) === current) return;
      if (!next) { send('leave', current); current = null; pressed = null; }
    };
    const end = () => { if (current) { send('dismiss', current); pressed = current; } };
    const down = () => end();
    const key = (event: KeyboardEvent) => { if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt') end(); };
    const options = { capture: true, passive: true } as const;
    document.addEventListener('pointerover', over, options);
    document.addEventListener('pointerout', out, options);
    document.addEventListener('pointerdown', down, options);
    document.addEventListener('keydown', key, options);
    document.addEventListener('wheel', end, options);
    document.addEventListener('contextmenu', end, options);
    document.addEventListener('dragstart', end, options);
    window.addEventListener('blur', end);
    return () => {
      document.removeEventListener('pointerover', over, options); document.removeEventListener('pointerout', out, options);
      document.removeEventListener('pointerdown', down, options); document.removeEventListener('keydown', key, options);
      document.removeEventListener('wheel', end, options); document.removeEventListener('contextmenu', end, options); document.removeEventListener('dragstart', end, options);
      window.removeEventListener('blur', end);
      if (current) send('dismiss', current);
    };
  }, [enabled]);
}
