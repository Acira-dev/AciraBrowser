import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { sidePanelRequest, useSidePanelState } from './sidePanelSites';

/**
 * Beta 14.1 (a Windows member, 21 Nov: on a page full of images there is nowhere safe to click): a click on EMPTY sidebar space closes an open side panel site that
 * floats over the page, the way a click on the page outside the card already does. A docked panel is part of the layout and stays (main decides that, from where the
 * panel really is). It never takes a click meant for the sidebar: anything the sidebar draws to be pressed, dragged or read is not empty (a row, a button, a link, a
 * field, a tile, the edge's handle, a menu or a form), and only a press and release of the main button that stayed within a few pixels counts, so a drag that starts
 * on empty space (a selection, a window drag, a tab dragged out) never closes it. Nothing is prevented or stopped: the sidebar's own handlers see the click as before.
 */
export const CLICK_AWAY_SLOP = 4;
/** What is not empty sidebar space: controls, rows (the sidebar's rows carry `data-flip`), tiles, the edge's drag handle, menus, dialogs and forms drawn in the sidebar.
 *  The thin lines between sections (`.sb-sep`) are empty space, as they are for the sidebar's right-click menu (AciraSidebar `background`). */
export const SIDEBAR_NOT_EMPTY = [
  'button', 'a[href]', 'input', 'textarea', 'select', 'label', 'summary', 'form', '[contenteditable]:not([contenteditable="false"])', '[draggable="true"]',
  '[role="button"]', '[role="link"]', '[role="menu"]', '[role="menuitem"]', '[role="listbox"]', '[role="option"]', '[role="tab"]', '[role="separator"]:not(.sb-sep)', '[role="slider"]',
  '[role="listitem"]', '[role="dialog"]', '[role="group"]', '[role="toolbar"]', '[tabindex]:not([tabindex="-1"])', '[data-flip]:not(.sb-sep)', '[data-sb-focus]',
  '.sb-resize', '.sb-tab', '.sb-app', '.sb-apps-panel', '.sb-cz'
].join(',');

interface ElementLike { closest(selector: string): unknown }
/** Is this the sidebar's empty space: inside the sidebar, and inside nothing it draws to be used? Pure (needs only `closest`). */
export function isEmptySidebarTarget(target: unknown, root: unknown): boolean {
  if (!target || !root || typeof (target as ElementLike).closest !== 'function') return false;
  const element = target as ElementLike;
  return element.closest(SIDEBAR_NOT_EMPTY) === null && (target === root || (typeof (root as { contains?: unknown }).contains === 'function' && (root as { contains(node: unknown): boolean }).contains(target)));
}
export interface PointerAt { x: number; y: number; button: number }
/** A click, not a drag: the main button, pressed and released within CLICK_AWAY_SLOP pixels. Pure. */
export const isClickNotDrag = (down: PointerAt | null, up: PointerAt): boolean => !!down && down.button === 0 && up.button === 0 && Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_AWAY_SLOP;

/** The sidebar's two handlers: the press is remembered (where, which button, on empty space or not), the click closes the panel when both press and click are on
 *  empty space, it is a click and a panel is open here. Main closes only an open panel that floats (`sidepanel.dismiss`). */
export function useSidebarClickAway(): { onPointerDown: (event: PointerEvent<HTMLElement>) => void; onClick: (event: MouseEvent<HTMLElement>) => void } {
  const panel = useSidePanelState();
  const pressed = useRef<(PointerAt & { empty: boolean }) | null>(null);
  const open = useRef(panel.open); open.current = panel.open;
  return {
    onPointerDown: event => { pressed.current = { x: event.clientX, y: event.clientY, button: event.button, empty: isEmptySidebarTarget(event.target, event.currentTarget) }; },
    onClick: event => {
      const down = pressed.current; pressed.current = null;
      if (!open.current || !down?.empty || !isClickNotDrag(down, { x: event.clientX, y: event.clientY, button: event.button })) return;
      if (!isEmptySidebarTarget(event.target, event.currentTarget)) return;
      void sidePanelRequest({ type: 'sidepanel.dismiss' });
    },
  };
}
