'use strict';
// 13.2 (founder, 8 Nov 2026). A tester on Windows 11 saw a page (.html) or an image (.webp) that was meant to open in a NEW tab saved as a
// download instead, and nobody could make it happen on another Mac or Windows machine, in any layout, with or without extensions. This is the
// safety net, whatever the cause on that machine turns out to be:
//  - a download that starts in a tab which is not showing a web page yet (a fresh tab: the new-tab page, about:blank, a page Acira draws),
//  - for an ordinary page or image (text/html, XHTML, or a common image type) that the server did NOT mark as an attachment,
//  - that nobody asked to save (Save link as / Save image as call expectSave first),
// is cancelled, and that address is loaded in the tab instead, ONCE. The same tab and address a second time is let through as a download, so this
// can never loop. Both are written to main.log, by type and reason only (main.log never holds a web address), so the next report says why.
// A tab that is already on a web page keeps every download as before: its links, Save commands and <a download> are the person's choice.
const RENDERABLE = /^\s*(?:text\/html|application\/xhtml\+xml|image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon))\s*(?:;|$)/i;
const SAVE_WINDOW = 30000, TRIED_MAX = 200;
const web = url => /^https?:/i.test(String(url || ''));
const kind = mime => String(mime || '').split(';')[0].trim().toLowerCase() || 'unknown type';

function createNavigationRescue({ now = Date.now, record = () => {} } = {}) {
  const saves = new Map(), tried = new Map();
  let recorder = record;
  const prune = () => { const at = now(); for (const [url, when] of saves) if (at - when > SAVE_WINDOW) saves.delete(url); };
  /** The person asked to save this address (a Save command): the download that follows is never rescued. */
  function expectSave(url) { if (typeof url === 'string' && url) { prune(); saves.set(url, now()); } }
  function note(text) { try { recorder('Navigation saved as a download', new Error(text)); } catch { /* logging never breaks a download */ } }
  /** {url, mime, disposition, tabUrl, wcId} → true when the download is to be cancelled and the address loaded in the tab instead. */
  function shouldRescue({ url, mime, disposition, tabUrl, wcId } = {}) {
    if (!web(url) || wcId === undefined || wcId === null) return false;
    prune();
    if (saves.has(url)) { saves.delete(url); return false; }
    if (/^\s*attachment\b/i.test(String(disposition || ''))) return false;
    if (!RENDERABLE.test(String(mime || ''))) return false;
    if (web(tabUrl)) return false;
    const key = wcId + ' ' + url;
    if (tried.has(key)) { note(`a fresh tab's ${kind(mime)} load became a download again after one retry, so it was kept as a download`); return false; }
    tried.set(key, now()); if (tried.size > TRIED_MAX) tried.delete(tried.keys().next().value);
    note(`a fresh tab's ${kind(mime)} load became a download (not an attachment, nobody asked to save it): it was cancelled and the address loaded in the tab instead`);
    return true;
  }
  return { expectSave, shouldRescue, setRecorder(next) { if (typeof next === 'function') recorder = next; } };
}

/** One per main process: the download engine asks it, the Save commands tell it, main.cjs gives it main.log. */
const shared = createNavigationRescue();
module.exports = { createNavigationRescue, shared, RENDERABLE };
