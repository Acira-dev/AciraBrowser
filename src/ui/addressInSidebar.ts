import { springEasing, springExit, springs } from './springs';

/** Address bar in the sidebar (Settings › Appearance › Layout, off by default; only with tabs in the sidebar).
 *
 * The toolbar's address field, Back, Reload, Forward and the sidebar button sit at the top of the sidebar; every other toolbar
 * button sits behind a thin pill under the field that opens, as one morph, when the pointer rests on it (or on a click). This
 * file is the logic without the DOM: when the block is shown, how tall the strip left over the page is, what Ctrl/Cmd+L does,
 * the morph's springs and the pill's hover timing. App.tsx, AddressMore.tsx and the sidebar use it; tests/address-in-sidebar.test.ts
 * pins it. */

/** The pointer rests on the pill this long before it opens (an intentional hover; passing over it does nothing). */
export const PILL_DWELL_MS = 350;
/** The pointer has been off the pill and its row this long before the row closes. */
export const PILL_LEAVE_MS = 450;
/** The pill's line, its hit area, the open row and what the open row adds to the sidebar's top (CSS px). */
export const PILL_LINE = { width: 72, height: 4, hoverWidth: 92, zone: 10, open: 32 } as const;
export const PILL_OPEN_EXTRA = PILL_LINE.open - PILL_LINE.height;

/** Where the address field stands in the sidebar's block (address-in-sidebar.css: the 36 px top row, 2 px of margin, 28 px tall, 8 px in from the sidebar's sides), in window coordinates. */
export const BLOCK_FIELD = { left: 8, top: 38, height: 28, inset: 8 } as const;
/** The box the field has once the sidebar is revealed. With the sidebar away (Sidebar mode, 'bare') the toolbar is not drawn, so a popup that hangs from a toolbar button (the bookmark star, the
 * zoom level, downloads, extensions, site information, the menu...) has no button to hang from: it hangs from this box instead, where it opens when the sidebar is out (a popup is right-aligned
 * to what it hangs from and kept inside the window, so these open exactly as they do with the sidebar showing). Nothing is drawn there. */
export const revealedFieldBox = (sidebarWidth: number): { x: number; y: number; width: number; height: number } => ({ x: BLOCK_FIELD.left, y: BLOCK_FIELD.top, width: Math.max(0, sidebarWidth - BLOCK_FIELD.inset * 2), height: BLOCK_FIELD.height });

export type ChromeModeName = 'standard' | 'compact' | 'focus';

/** The setting is on and this window shows its tabs in the sidebar. */
export const addressInSidebarWanted = (setting: boolean | undefined, sidebarTabs: boolean): boolean => setting === true && sidebarTabs;

/** Sidebar mode (tabs and the address bar in the sidebar) leaves no top bar in any view but Seamless, which never had one: Full, Compact and
 * Focus all draw the sidebar's address block, and a closed sidebar leaves nothing above the page (it comes back from the left edge, or with
 * Ctrl/Cmd+Shift+E and Ctrl/Cmd+L). Outside Seamless this is true whenever the setting applies. */
export const sidebarModeChrome = (wanted: boolean, seamless: boolean): boolean => wanted && !seamless;

/** The address block is drawn at the top of the sidebar: the setting applies and the sidebar is on screen (docked, floating in at its
 * edge, or just asked for by Ctrl/Cmd+L). With the sidebar away there is no toolbar row to fall back to (see `sidebarModeChrome`). */
export function addressBlockShown(input: { wanted: boolean; sidebarOpen: boolean; edgeSide: boolean; asked: boolean }): boolean {
  return input.wanted && (input.sidebarOpen || input.edgeSide || input.asked);
}

/** What the header over the page holds in Sidebar mode (outside Seamless): the block's strip beside the sidebar, or, with the sidebar away,
 * nothing but the strip ('bare': the toolbar stays in the tree for shortcuts and popups but is not drawn). Undefined elsewhere. */
export type SidebarModeHeader = 'block' | 'bare';
export const sidebarModeHeader = (chrome: boolean, blockShown: boolean): SidebarModeHeader | undefined => (chrome ? (blockShown ? 'block' : 'bare') : undefined);

/** The strip left above the page, to the right of the sidebar, while the block is in the sidebar. On the Mac the window buttons are
 * over the sidebar, so only the page card's own 6 px margin is left. Windows and Linux put the window buttons at the right of the
 * window, over the page column: that strip keeps the toolbar's height (empty, it drags the window) so nothing overlaps them. */
export function addressStripHeight(platform: string, toolbarHeight: number): number {
  return platform === 'darwin' ? 6 : toolbarHeight;
}

/** A layout switch (the sidebar docking or leaving: Ctrl/Cmd+Shift+E, the sidebar button, Ctrl/Cmd+L with the sidebar away) in Sidebar mode brings the block in or takes it out with the
 * sidebar: its header's data-sbmode goes from 'bare' to 'block' ('in') or back ('out'). Anything else (a view switch with the sidebar out on both sides, the setting being turned on or off,
 * where there is no data-sbmode on one side) is not a slide of the block and keeps its own transition. sharedMotion.ts sets the answer on the root for the switch's duration
 * (data-block-slide), address-in-sidebar.css slides the block's picture with the sidebar's. */
export type BlockSlide = 'in' | 'out';
export const blockSlideOf = (before: string | undefined, after: string | undefined): BlockSlide | undefined => (before === 'bare' && after === 'block' ? 'in' : before === 'block' && after === 'bare' ? 'out' : undefined);

export type AddressFocusPlan = 'focus' | 'open-sidebar' | 'reveal-edge';
/** What Ctrl/Cmd+L does with the setting on: focus the field where it is, open a closed sidebar first, or (Seamless) ask for the
 * sidebar's edge. With the setting off it is the toolbar's field, as ever. */
export function addressFocusPlan(input: { wanted: boolean; seamless: boolean; sidebarOpen: boolean; edgeSide: boolean }): AddressFocusPlan {
  if (!input.wanted) return 'focus';
  if (input.seamless) return input.sidebarOpen || input.edgeSide ? 'focus' : 'reveal-edge';
  return input.sidebarOpen ? 'focus' : 'open-sidebar';
}

/** The morph's two springs (Acira's own: `springs.morph` going in, its exit coming back) as CSS times and easings. `scale` is the
 * animation-speed multiplier (Premium 1.7, Fast 1, Off 0: a scale of 0 is instant). */
export function pillMotion(scale: number) {
  const open = springEasing(springs.morph, scale), close = springEasing(springExit(springs.morph), scale);
  return { openMs: open.duration, openEase: open.easing, closeMs: close.duration, closeEase: close.easing };
}

export interface PillRect { left: number; right: number; top: number; bottom: number }
export const pointInside = (rect: PillRect, x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

export interface PillTimers { set(run: () => void, ms: number): unknown; clear(id: unknown): void }
const realTimers: PillTimers = { set: (run, ms) => setTimeout(run, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) };

export interface PillDwell {
  /** The pointer entered the pill or its row. */
  enter(): void;
  /** The pointer moved over it (re-arms the dwell if an enter was missed). */
  move(): void;
  /** The pointer left. `still` says whether it is in fact still inside the pill's box: a stray "left" event is ignored. */
  leave(still: boolean): void;
  /** A click or Enter on the pill: open at once, or close if open. */
  toggle(): void;
  /** A press outside, or Esc: close at once. */
  dismiss(): void;
  /** Whatever held the row open (a menu from it, focus in it) ended. */
  released(): void;
  /** Stop every timer. */
  stop(): void;
}

/** The pill's hover logic: a dwell opens it, leaving closes it after a delay, and a menu opened from it keeps it open. */
export function createPillDwell(options: { isOpen(): boolean; setOpen(open: boolean): void; held(): boolean; timers?: PillTimers; dwell?: number; leaveAfter?: number }): PillDwell {
  const timers = options.timers ?? realTimers, dwell = options.dwell ?? PILL_DWELL_MS, leaveAfter = options.leaveAfter ?? PILL_LEAVE_MS;
  let timer: unknown = null, inside = false;
  const clear = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const closeLater = () => { clear(); timer = timers.set(() => { timer = null; if (!options.held() && !inside) options.setOpen(false); }, leaveAfter); };
  const api: PillDwell = {
    enter() { inside = true; clear(); if (!options.isOpen()) timer = timers.set(() => { timer = null; options.setOpen(true); }, dwell); },
    move() { if (!inside) api.enter(); },
    leave(still) { if (still) return; inside = false; clear(); if (options.isOpen()) closeLater(); },
    toggle() { clear(); options.setOpen(!options.isOpen()); },
    dismiss() { clear(); if (options.isOpen()) options.setOpen(false); },
    released() { if (options.isOpen() && !inside) closeLater(); },
    stop() { clear(); inside = false; },
  };
  return api;
}
