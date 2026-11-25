'use strict';
// 14.3, site notifications in Acira's own panel: the store. One list per window (`owner`: the window's id), newest first, in main's MEMORY ONLY (never
// written anywhere, gone when the window closes or Acira quits), at most `cap` (50) rows, the oldest dropped. A site's notification with a tag replaces
// the one of the same site and tag (as the system does). A muted site's notifications are not kept, only counted ("Muted: news.example, 2 not shown").
// Text is kept as text: control characters out, the title to 200 and the body to 600 characters; nothing from a site is ever treated as markup.
// A secured workspace's row ('neutral') names no site: no origin, no site, no words, only the workspace it came from, and it leaves the list when that
// workspace locks (dropWorkspace). Pure (no Electron): main.cjs gives it the clock and is told of every change; tests/site-notifications.test.cjs holds every rule.

const ORIGIN = /^https?:\/\/[^/\s]+$/i;
const clean = (value, max) => (value == null ? '' : String(value)).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const siteOf = origin => { try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return ''; } };

function createSiteNotifications({now = () => Date.now(), cap = 50, onChange = () => {}} = {}) {
  const lists = new Map();
  let seq = 0;
  const listOf = owner => { let list = lists.get(owner); if (!list) { list = {entries: [], muted: new Map()}; lists.set(owner, list); } return list; };
  const changed = owner => { try { onChange(owner); } catch { /* a listener's failure is not the store's */ } };
  const view = entry => ({id: entry.id, kind: entry.kind, site: entry.site, origin: entry.origin, title: entry.title, body: entry.body, at: entry.at, unread: entry.unread, neutral: entry.neutral === true, tabId: entry.neutral ? null : entry.tabId ?? null});
  const api = {
    /** A notification arrived for this window. Returns the kept row, `{muted: true}` for a muted site, or null for something that is not one. */
    add(owner, input = {}) {
      if (owner == null || !input || typeof input !== 'object') return null;
      const kind = ['page', 'registration', 'worker', 'neutral'].includes(input.kind) ? input.kind : null; if (!kind) return null;
      const neutral = kind === 'neutral', workspace = neutral && typeof input.workspace === 'string' && input.workspace ? input.workspace : null;
      if (neutral && !workspace) return null;
      const origin = neutral ? '' : typeof input.origin === 'string' ? input.origin.replace(/\/+$/, '') : '';
      if (!neutral && !ORIGIN.test(origin)) return null;
      const list = listOf(owner);
      if (!neutral && list.muted.has(origin)) { list.muted.set(origin, list.muted.get(origin) + 1); changed(owner); return {muted: true}; }
      const title = neutral ? '' : clean(input.title, 200), body = neutral ? '' : clean(input.body, 600), tag = neutral ? '' : clean(input.tag, 120);
      if (!neutral && !title && !body) return null;
      if (tag) list.entries = list.entries.filter(entry => !(entry.origin === origin && entry.tag === tag));
      const entry = {id: 'sn' + (++seq), owner, kind, origin, site: neutral ? '' : siteOf(origin), title, body, tag, silent: input.silent === true, at: now(), unread: true, neutral, workspace,
        private: input.private === true, profile: typeof input.profile === 'string' ? input.profile : '',
        token: typeof input.token === 'string' ? input.token.slice(0, 64) : null, tabId: input.tabId ?? null, scope: typeof input.scope === 'string' ? input.scope : null, versionId: Number.isSafeInteger(input.versionId) ? input.versionId : null};
      list.entries.unshift(entry);
      if (list.entries.length > cap) list.entries.length = cap;
      changed(owner);
      return entry;
    },
    /** What the panel shows: the rows (newest first, the site's own words as text) and the muted sites with how many were not shown. */
    list(owner) { const list = lists.get(owner); return {entries: list ? list.entries.map(view) : [], muted: list ? [...list.muted].map(([origin, count]) => ({site: siteOf(origin), origin, count})) : []}; },
    unread(owner) { const list = lists.get(owner); return list ? list.entries.filter(entry => entry.unread).length : 0; },
    /** Whether the bell has anything to show: a row (read or not). A muted count alone is not one. */
    holds(owner) { const list = lists.get(owner); return Boolean(list && list.entries.length); },
    /** The full row (main only: the token, the tab, the worker) for a click. */
    find(owner, id) { const list = lists.get(owner); return list ? list.entries.find(entry => entry.id === id) || null : null; },
    markRead(owner) { const list = lists.get(owner); if (!list || !list.entries.some(entry => entry.unread)) return false; for (const entry of list.entries) entry.unread = false; changed(owner); return true; },
    dismiss(owner, id) { const list = lists.get(owner); if (!list) return false; const before = list.entries.length; list.entries = list.entries.filter(entry => entry.id !== id); if (list.entries.length === before) return false; changed(owner); return true; },
    /** The page closed its own notification (Notification.close()). */
    closeToken(owner, token) { const list = lists.get(owner); if (!list || !token) return false; const before = list.entries.length; list.entries = list.entries.filter(entry => entry.token !== token); if (list.entries.length === before) return false; changed(owner); return true; },
    clear(owner) { const list = lists.get(owner); if (!list || !list.entries.length) return false; list.entries = []; changed(owner); return true; },
    /** Mute a site in this window: its rows go, later ones are only counted (until Acira quits, or Unmute). */
    mute(owner, origin) { if (!ORIGIN.test(String(origin || ''))) return false; const list = listOf(owner), gone = list.entries.filter(entry => entry.origin === origin).length; list.entries = list.entries.filter(entry => entry.origin !== origin); list.muted.set(origin, (list.muted.get(origin) || 0) + gone); changed(owner); return true; },
    unmute(owner, origin) { const list = lists.get(owner); if (!list || !list.muted.delete(origin)) return false; changed(owner); return true; },
    /** A secured workspace locked: its rows leave every window's list. */
    dropWorkspace(workspace) { if (!workspace) return false; let any = false; for (const [owner, list] of lists) { const before = list.entries.length; list.entries = list.entries.filter(entry => entry.workspace !== workspace); if (list.entries.length !== before) { any = true; changed(owner); } } return any; },
    /** The setting went back to As system notifications: every window's rows and muted counts go (the bell with them). */
    clearAll() { for (const [owner, list] of lists) { if (!list.entries.length && !list.muted.size) continue; list.entries = []; list.muted.clear(); changed(owner); } },
    /** The window closed: its list goes with it (memory only). */
    forget(owner) { if (lists.delete(owner)) changed(owner); },
    /** A tab closed (every window's list): a PRIVATE tab's rows go with it (its site and words never outlive it, and nothing can open it again);
     *  an ordinary tab's rows stay (a click opens the site again) but no longer point at the tab. Returns the click tokens of the rows that went. */
    tabClosed(tabId) { const gone = []; if (tabId == null) return gone; for (const [owner, list] of lists) { let changedHere = false; list.entries = list.entries.filter(entry => { if (entry.tabId !== tabId) return true; if (entry.private) { gone.push(entry.token); changedHere = true; return false; } entry.tabId = null; return true; }); if (changedHere) changed(owner); } return gone; },
    /** A private session ended (its tab or window closed): every row that came from it goes, from every window. Returns their click tokens. */
    dropProfile(profile) { const gone = []; if (!profile) return gone; for (const [owner, list] of lists) { const before = list.entries.length; list.entries = list.entries.filter(entry => { if (entry.private && entry.profile === profile) { gone.push(entry.token); return false; } return true; }); if (list.entries.length !== before) changed(owner); } return gone; },
    owners() { return [...lists.keys()]; },
  };
  return api;
}

module.exports = {createSiteNotifications, siteOf};
