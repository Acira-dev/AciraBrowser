'use strict';

// How heavy a page is to lay out, for the docked sidebar's glide (reported 17 Nov 00:20: a page whose layout is HELD while the sidebar opens shows its header cut at the window's edge for the whole glide and
// re-lays once at the landing). A page that is cheap to lay out is now resized on every frame of the glide (its layout follows the card: nothing is cut, nothing jumps); a heavy one keeps the held glide
// (one layout, smooth frames), and a page that turns out heavy during a live glide drops to the held layout at once (page-motion.cjs `degrade`). The measure is the page's element count, refreshed at most
// every REFRESH_MS from the placements the page already gets; the last one known is used (the first glide of a page nobody has measured yet runs live and degrades if it is strained).
const LIVE_NODE_MAX = 8000, REFRESH_MS = 2500;
const COUNT_SCRIPT = 'document.getElementsByTagName("*").length';
function note(entry, now = Date.now()) {
  const wc = entry?.view?.webContents;
  if (!wc || wc.isDestroyed?.() || typeof wc.executeJavaScript !== 'function') return;
  const url = wc.getURL?.() || '';
  if (entry.nodeCountUrl !== url) { entry.nodeCount = undefined; entry.nodeCountAt = 0; }   // another page: what was counted is not this page's
  if (entry.nodeCountAt && now - entry.nodeCountAt < REFRESH_MS) return;
  entry.nodeCountAt = now; entry.nodeCountUrl = url;
  try { Promise.resolve(wc.executeJavaScript(COUNT_SCRIPT, false)).then(count => { if (Number.isFinite(count)) entry.nodeCount = count; }, () => {}); } catch { /* a page that cannot run it: unknown, taken as light */ }
}
/** D125 (21 Nov 2026): a page is also counted when its document has FINISHED LOADING (desktop/main.cjs, the page's own did-finish-load, once per document), so its first docked-sidebar
 * open already knows a heavy page is heavy and holds it. Counted only from a placement, the count arrived after the first open had begun: the first open of every newly loaded heavy page ran
 * live and the 2500-card page re-wrapped in 5 steps over about 0.2 s before it was held (6 layouts; every later open 1), since the live glide came in (17 Nov, 2471a49f3). The count at a
 * placement (note) stays: it is the fallback for a page placed before its load ended, and what keeps a page that grows heavy after it loaded (an infinite feed) on today's path (it is light
 * at its load, runs live, and drops to the held layout if it strains). One count per load: no timer, no observer; a tab that is asleep loads nothing, so nothing wakes it. */
function loaded(entry, now = Date.now()) {
  if (!entry) return;
  entry.nodeCountAt = 0;   // past the REFRESH_MS window: the loaded document is counted now
  note(entry, now);
}
const light = entry => !(Number.isFinite(entry?.nodeCount) && entry.nodeCount >= LIVE_NODE_MAX && (entry.nodeCountUrl ?? '') === (entry.view?.webContents?.getURL?.() || ''));
module.exports = { note, loaded, light, LIVE_NODE_MAX, REFRESH_MS };
