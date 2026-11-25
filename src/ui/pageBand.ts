/**
 * Where the toolbar band ends and the page begins (Beta 14, Ambient mode seams). The sidebar's light and the toolbar's light, and the sidebar's edge light, all stop or start at the same line: the bottom of the
 * toolbar band, which is the page's top edge (in Seamless with the toolbar shown it is the toolbar's own bottom). One number in window pixels, one watcher, so every surface that draws light reads the same
 * line at the same moment. The layout is real (no transforms hide the toolbar: a hidden one has no height), so plain rectangles say it.
 */
const page = () => document.querySelector<HTMLElement>('.browser-body > .page-area') ?? document.querySelector<HTMLElement>('.page-area');
const shell = () => document.querySelector<HTMLElement>('.browser-shell');

/** The band's bottom edge in window pixels: the page's top, or the toolbar's bottom when that is lower (a toolbar over the page). 0 with neither. */
export function bandBottom(): number { return bandBottomOf(page()?.getBoundingClientRect(), shell()?.getBoundingClientRect()); }
/** The same line from rectangles already read (a paint reads them once for every surface, ambient.ts `measure`). */
export const bandBottomOf = (p: DOMRect | null | undefined, s: DOMRect | null | undefined): number => Math.max(p && p.height > 0 ? p.top : 0, s && s.height > 0 && s.bottom > 0 ? s.bottom : 0);

const listeners = new Set<() => void>();
let started = false, observer: ResizeObserver | null = null, mutations: MutationObserver | null = null, frame = 0;
const attach = () => {
  observer?.disconnect();
  for (const el of [page(), shell()]) if (el) observer?.observe(el);
  mutations?.disconnect();
  mutations?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode-switch', 'data-sidebar-side', 'data-sidebar-overlay'] });
  const app = document.querySelector<HTMLElement>('.app'), box = shell();
  if (app) mutations?.observe(app, { attributes: true, attributeFilter: ['class'] });
  if (box) mutations?.observe(box, { attributes: true, attributeFilter: ['data-seamless', 'data-layout', 'data-sbmode', 'class'] });
};
const check = () => { frame = 0; for (const listener of [...listeners]) listener(); };
const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
/** Be told, once per frame at most, when the page or the toolbar changes size or the view changes (a taller or shorter toolbar, a window resize, a Seamless toolbar shown or hidden). Each listener
 *  compares what it draws with what it drew and does nothing when it is the same. Cheap: two size observers and attribute filters on three elements; nothing runs until something moves. */
export function watchPageBand(listener: () => void): void {
  listeners.add(listener);
  if (started || typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function') return;
  started = true;
  observer = new ResizeObserver(schedule);
  mutations = new MutationObserver(() => { attach(); schedule(); });
  attach(); schedule();
}
