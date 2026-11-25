import type { BrowserCommand, Rectangle, ScreenshotKind } from '../runtime/types';

/** Beta 14: the three kinds of page screenshot, and their order in the menu: the kind used last comes first, and it is what Enter picks.
 *  (desktop/page-capture-core.cjs keeps the same list for main; tests/page-capture-core.test.cjs and tests/screenshot-menu.test.ts hold the two together.) */
export const screenshotKinds: readonly ScreenshotKind[] = ['area', 'visible', 'full'];
export const orderedScreenshotKinds = (last: unknown): ScreenshotKind[] => (screenshotKinds.includes(last as ScreenshotKind) ? [last as ScreenshotKind, ...screenshotKinds.filter(kind => kind !== last)] : [...screenshotKinds]);
/** Where the menu opens when a key (not a button) asked for it: at the top of the page, centred, like the command palette. */
export const screenshotMenuAnchor = (page: { x: number; y: number; width: number; height: number } | null | undefined, viewport: { width: number; height: number }) => {
  const box = page && page.width > 0 ? page : { x: 0, y: 0, width: viewport.width, height: viewport.height };
  return { x: Math.round(box.x + box.width / 2 - 110), y: Math.round(box.y + 12), width: 220, height: 2 };
};
/** The command every screenshot-menu entry point sends: the More tools row (no bounds: the menu opens at the top of the page) and the sidebar's camera button (its bounds, so the menu opens at it).
 *  One shape, validated by desktop/validation.cjs (tests/menu-tools-validated.test.ts runs every entry point through it): a screenshot menu never borrows a `ui open` with a made-up target tab. */
export const screenshotMenuCommand = (tabId: string, anchor?: Rectangle): Extract<BrowserCommand, { type: 'screenshot-menu' }> => ({ type: 'screenshot-menu', tabId, ...(anchor ? { anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height } } : {}) });
