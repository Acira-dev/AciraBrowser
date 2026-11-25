/** D123 (21 Nov 2026, Chromium 156, regression guard c8 on the 2500-card page at Fast): about 1 return in 30 the toolbar coming back laid the page out at 1034x748, a pixel TALLER than it stood (747)
 * and than any size of the movement, and again at 1034x717 when it landed: two layouts where one is the rule. While the header eases to a new height the interface moves the page under it a frame at a
 * time and sends, with each rectangle, the size the page ends at; main holds the site's layout there (desktop/page-motion.cjs placeLive). Two things taken from ONE frame in the middle of the change went
 * into it: the end size was that frame's page plus that frame's header excess, and the measured follow could send a frame in which the header had not yet taken its first eased height (the DOM between two
 * layouts: the page above and taller than it stood). A toolbar ease now starts from the layout the interface measured before it (src/App.tsx physicalLayout). */

/** The layout the interface last measured: the header's height, the window's size, and each pane's top and size. */
export type LayoutMeasure = { header: number; viewport: string; views: Map<string, { y: number; width: number; height: number }> };

export const viewportKey = (viewport?: { width: number; height: number } | null): string => viewport ? `${viewport.width}x${viewport.height}` : '';

export function layoutMeasure(header: number, viewport: { width: number; height: number } | null | undefined, views: ReadonlyArray<{ tabId: string; bounds: { y: number; width: number; height: number } }>): LayoutMeasure {
    return { header, viewport: viewportKey(viewport), views: new Map(views.map(view => [view.tabId, { y: view.bounds.y, width: view.bounds.width, height: view.bounds.height }])) };
}

/** The size a pane ends at in a toolbar ease (the size main holds its layout at): where it stood when the ease began plus the height the header gives up, none when the header comes back. That is the
 * larger of where the pane starts and where it ends, known before the first frame: a growing page (the toolbar going away) is laid out once at its end, a shrinking one keeps the layout it has. */
export function toolbarEaseEnd(was: { width: number; height: number }, headerFrom: number, headerTo: number): { width: number; height: number } {
    return { width: was.width, height: was.height + Math.max(0, Math.round(headerFrom - headerTo)) };
}

/** While the header comes back (it grows from the height it had when the ease began), the page under it only moves down and gets shorter: a measure that has a pane above or taller than where it stood
 * is the DOM between two layouts and is not sent (the measured follow measures again on the next frame). A header that shrinks, or a pane the ease did not start with, never counts. */
export function toolbarEaseBetween(from: LayoutMeasure, headerTo: number, views: ReadonlyArray<{ tabId: string; bounds: { y: number; height: number } }>): boolean {
    if (!(from.header < headerTo - .5)) return false;
    return views.some(view => { const was = from.views.get(view.tabId); return !!was && (view.bounds.y < was.y || view.bounds.height > was.height); });
}
