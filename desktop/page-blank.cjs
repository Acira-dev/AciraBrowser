'use strict';
// D151 (reported 23 Nov, Seamless with the sidebar floating): a tab that still had to load (restored after the update, or let go while
// asleep) showed its page area as the window's own material (grey-green over his desktop) for up to 3.5 s; on Reddit and Instagram it went
// material, then BLACK (rgb 17,17,17: the empty dark canvas of a first document that draws nothing yet), then the material again (the next
// document, see-through until it drew), then the site. A page view that has not drawn is see-through on the Mac, and while the sidebar floats
// over the live page the interface's page area is a hole (data-sidebar-overlay=native), so what showed was whatever lay behind the views.
// Docked, the interface's own page surface sits under the page view and fills the same moments calmly.
// This module says, per page, whether there is anything of it to see yet: `blank` from the moment a new view is made until the page's first
// contentful paint (text, an image, a canvas: the page's own PerformanceObserver in Acira's isolated world, page-input-preload.cjs, says so),
// across any document that draws only its empty canvas and the documents that follow it. The interface covers the hole with its page surface
// while the shown page is blank and opens it once, at the first content.
// Bounded so no page is covered for good: a document that has painted (ready-to-show) or stopped loading without content is let go after
// FALLBACK_MS unless another document starts meanwhile (a page that is really empty, or one whose content is not "contentful"), a failed or
// gone page at once, and anything at BLANK_MAX_MS.
const BLANK_MAX_MS = 12000, FALLBACK_MS = 1000;

function createPageBlank({ emit, later = (fn, ms) => setTimeout(fn, ms), cancel = clearTimeout }) {
  const pages = new Map();   // tabId -> { blank, timer, fallback, contents, off }

  function set(tabId, record, blank) {
    if (pages.get(tabId) !== record) return;
    cancel(record.timer); record.timer = null; cancel(record.fallback); record.fallback = null;
    if (blank) record.timer = later(() => set(tabId, record, false), BLANK_MAX_MS);
    if (record.blank === blank) return;
    record.blank = blank;
    emit({ type: 'page-blank', tabId, blank });
  }
  function fallback(tabId, record) {
    if (!record.blank || pages.get(tabId) !== record) return;
    cancel(record.fallback);
    record.fallback = later(() => set(tabId, record, false), FALLBACK_MS);
  }

  /** A new view was made for `tabId` (not one adopted from a page that has drawn already): it is blank until it shows content. */
  function track(tabId, contents) {
    forget(tabId);
    if (!contents || typeof contents.on !== 'function') return;
    const record = { blank: false, timer: null, fallback: null, contents, off: [], documents: 0 };
    pages.set(tabId, record);
    const on = (name, fn) => { contents.on(name, fn); record.off.push(() => { try { contents.removeListener(name, fn); } catch { /* gone */ } }); };
    // A document has painted, or stopped loading, and shows nothing contentful: let it go after a while, unless another document is on its way.
    on('ready-to-show', () => fallback(tabId, record));
    on('did-stop-loading', () => fallback(tabId, record));
    on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame !== false && isInPlace !== true) { cancel(record.fallback); record.fallback = null; } });
    on('did-navigate', () => { record.documents++; });
    on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame !== false) set(tabId, record, false); });
    on('render-process-gone', () => { set(tabId, record, false); });
    on('destroyed', () => { forget(tabId); });
    set(tabId, record, true);
  }

  /** The page in `contents` has drawn its first content (its own report, from its main frame). `early`: said in the frame callback before the
   * first frame of a document that has content when parsed; taken only for the view's first document (a later one can be drawn into a new
   * surface the window shows a frame later: the cover then waits for its paint report). */
  function drawn(tabId, contents, early = false) {
    const record = pages.get(tabId);
    if (!record || record.contents !== contents || (early && record.documents > 1)) return;
    set(tabId, record, false);
  }

  /** The page is gone (closed, slept, replaced): it is no longer blank for anyone. */
  function forget(tabId) {
    const record = pages.get(tabId);
    if (!record) return;
    const was = record.blank;
    cancel(record.timer); cancel(record.fallback);
    for (const off of record.off) off();
    pages.delete(tabId);
    if (was) emit({ type: 'page-blank', tabId, blank: false });
  }

  const blank = tabId => !!pages.get(tabId)?.blank;
  /** Every page that is blank now. */
  const list = () => [...pages].filter(([, record]) => record.blank).map(([tabId]) => tabId);
  return { track, drawn, forget, blank, list };
}

module.exports = { createPageBlank, BLANK_MAX_MS, FALLBACK_MS };
