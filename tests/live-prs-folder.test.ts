import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrowserSnapshot } from '../src/runtime/types';
import type { LivePrRow,LivePrsFolder } from '../src/runtime/livePrs';

// Live pull requests (item 31), the interface: the folder's rows and states, the rules they are drawn by, and the popup's menus. Real components, made-up pull requests.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {};
const model = await import('../src/runtime/livePrs');
const { LiveFolderView,LiveFolderIcon,PrGlyph } = await import('../src/components/sidebar/LiveFolder');
const { Consent,Filters,Repositories } = await import('../src/components/sidebar/LiveFolderMenu');
const read = (file: string) => readFileSync(file, 'utf8');

const NOW = Date.parse('2026-11-07T12:00:00Z');
const row = (number: number, extra: Partial<LivePrRow> = {}): LivePrRow => ({ id: `acme/app#${number}`, title: `Pull request ${number}`, url: `https://github.com/acme/app/pull/${number}`, repo: 'acme/app', number, state: 'open', draft: false, reviewRequested: false, updatedAt: NOW - number * 60e3, relations: ['author'], ...extra });
const rows = [row(1), row(2, { reviewRequested: true, relations: ['review'] }), row(3, { draft: true }), row(4, { state: 'merged', relations: ['recent'] }), row(5, { state: 'closed', relations: ['recent'] })];
const filters = { author: true, review: true, assigned: true, mentioned: false, drafts: true, recent: true, repos: null };
const folder = (extra: Partial<LivePrsFolder> = {}): LivePrsFolder => ({ supported: true, folder: { name: 'Pull requests', filters, hidden: 0 }, phase: 'ok', loading: false, error: null, failures: 0, rows, repos: ['acme/app', 'acme/docs'], total: rows.length, more: false, updatedAt: NOW - 120000, nextAt: NOW + 180000, source: 'mock', ...extra });
const tab = (id: string, url: string) => ({ id, url, title: id, browserProfileId: 'p1', contentKind: 'web' });
const snapshot = (tabs: ReturnType<typeof tab>[] = [], active = 'none') => ({ activeBrowserProfileId: 'p1', activeTabId: active, activeWorkspaceId: 'w1', tabs, workspaces: [{ id: 'w1' }], browserProfiles: [{ id: 'p1' }] }) as unknown as BrowserSnapshot;
const draw = (status: LivePrsFolder, options: { open?: boolean; unseen?: number; state?: BrowserSnapshot } = {}) => renderToStaticMarkup(createElement(LiveFolderView, { status, state: options.state ?? snapshot(), dispatch: () => {}, moveFocus: () => {}, open: options.open ?? true, unseen: options.unseen ?? 0, onToggle: () => {}, onAgain: () => {} }));
const rowsOf = (html: string) => [...html.matchAll(/<div class="sb-tab live-row"[^>]*>/g)].map(match => match[0]);

test('a pull request looks like its state: open, draft (open and not ready), merged, closed; the finished ones are "done"', () => {
  assert.deepEqual(rows.map(model.prLook), ['open', 'open', 'draft', 'merged', 'closed']);
  assert.deepEqual(rows.map(model.prDone), [false, false, false, true, true]);
});

test('the icon\'s sheets are the newest open pull requests first, then finished ones, at most three; an empty folder keeps one open sheet', () => {
  assert.deepEqual(model.sheetLooks(rows), ['open', 'open', 'draft']);
  assert.deepEqual(model.sheetLooks([row(4, { state: 'merged' }), row(5, { state: 'closed' })]), ['merged', 'closed']);
  assert.deepEqual(model.sheetLooks([]), ['open']);
});

test('review requests the person has not seen: the folder\'s dot', () => {
  assert.deepEqual(model.unseenReviews(rows, []).map(item => item.number), [2]);
  assert.deepEqual(model.unseenReviews(rows, ['acme/app#2']), []);
});

test('the pull request a tab shows: its page or any page of it, case-insensitive; nothing else', () => {
  assert.equal(model.pullKeyOf('https://github.com/Acme/App/pull/12'), 'acme/app#12');
  assert.equal(model.pullKeyOf('https://github.com/acme/app/pull/12/files?w=1#diff'), 'acme/app#12');
  for (const other of ['https://github.com/acme/app/issues/12', 'https://github.com/acme/app/pulls', 'https://evil.example/acme/app/pull/12', 'http://github.com/acme/app/pull/12', 'https://github.com/acme/app/pull/12x', '']) assert.equal(model.pullKeyOf(other), null, other);
});

test('what the folder says when its rows do not: loading, signed out, nothing waiting, filtered out, each error; and "stale" only when old rows are held after a failure', () => {
  assert.equal(model.liveNote(folder()), null);
  assert.equal(model.liveNote(folder({ rows: [], total: 0, phase: 'loading' })), 'loading');
  assert.equal(model.liveNote(folder({ rows: [], total: 0 })), 'nothing-waiting');
  assert.equal(model.liveNote(folder({ rows: [], total: 3 })), 'all-filtered');
  assert.equal(model.liveNote(folder({ rows: [], total: 0, folder: { name: 'Pull requests', filters, hidden: 2 } })), 'all-filtered', 'rows the person hid are not "nothing waiting"');
  assert.equal(model.liveNote(folder({ rows: [], total: 0, phase: 'signed-out' })), 'signed-out');
  for (const [error, note] of [['offline', 'error-offline'], ['rate-limited', 'error-rate-limited'], ['unreadable', 'error-unreadable'], ['error', 'error-other']] as const) assert.equal(model.liveNote(folder({ rows: [], total: 0, phase: 'error', error })), note);
  assert.equal(model.liveNote(folder({ phase: 'error', error: 'offline' })), null, 'with rows to show, the rows speak');
  assert.equal(model.staleRows(folder({ phase: 'error', error: 'offline' })), true); assert.equal(model.staleRows(folder()), false); assert.equal(model.staleRows(folder({ rows: [], phase: 'error' })), false);
  assert.equal(model.minutesSince(NOW - 150000, NOW), 2); assert.equal(model.minutesSince(0, NOW), null);
});

test('the seen-reviews list is kept in this window\'s storage per profile, capped, and a broken store is just empty', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  try {
    assert.deepEqual(model.readSeenReviews('p1'), []);
    model.writeSeenReviews('p1', ['a/b#1', 'a/b#1', 'a/b#2']); assert.deepEqual(model.readSeenReviews('p1'), ['a/b#1', 'a/b#2']); assert.deepEqual(model.readSeenReviews('p2'), []);
    model.writeSeenReviews('p1', Array.from({ length: 300 }, (_, i) => `a/b#${i}`)); assert.equal(model.readSeenReviews('p1').length, 200);
    store.set('acira-live-prs-seen:p1', '{not json'); assert.deepEqual(model.readSeenReviews('p1'), []);
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.deepEqual(model.readSeenReviews('p1'), []); model.writeSeenReviews('p1', ['x']);
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test('the folder is a tab group\'s own markup: group header with the folder icon, a filter button in the "+" slot, rows in the members list', () => {
  const html = draw(folder());
  assert.match(html, /class="ed-rail-tab-group sb-group sb-live"/); assert.match(html, /class="ed-rail-tab-group-name sb-group-header"[^>]*aria-expanded="true"/);
  assert.match(html, /class="sb-tab-icon sb-group-folder"/); assert.match(html, /class="sb-header-add sb-live-filter"[^>]*aria-label="Filter pull requests"/);
  assert.match(html, /class="ed-rail-group-members sb-group-members" role="list"/);
  assert.match(html, /<span class="sb-group-name">Pull requests<\/span>/);
  assert.equal(rowsOf(html).length, 5);
  assert.equal((html.match(/<svg[^>]*viewBox="0 0 16 16"[^>]*style="overflow:visible"/g) || []).length, 2, 'the folder icon is drawn closed and open, like any group\'s');
});

test('each row: its state\'s glyph, the title, repo and number in the tooltip; one blue dot only where a review is asked; merged and closed are done', () => {
  const html = draw(folder()), rendered = rowsOf(html);
  assert.deepEqual(rendered.map(item => /data-look="(\w+)"/.exec(item)?.[1]), ['open', 'open', 'draft', 'merged', 'closed']);
  assert.deepEqual(rendered.map(item => item.includes('data-done')), [false, false, false, true, true]);
  assert.equal((html.match(/live-review/g) || []).length, 1); assert.match(html, /aria-label="Review requested"/);
  assert.match(html, /title="Pull request 1 · acme\/app#1"/);
  assert.match(html, /aria-label="Pull request 4, acme\/app#4, Merged"/);
  assert.match(html, /aria-label="Pull request 2, acme\/app#2, Open, Review requested"/);
  assert.match(html, /aria-label="Hide until it changes: Pull request 1"/);
});

test('a row whose pull request is open in a tab is the current row when that tab is, and its × closes the tab (the row stays); other rows hide until it changes', () => {
  const html = draw(folder(), { state: snapshot([tab('t1', 'https://github.com/acme/app/pull/1/files')], 't1') });
  const [first, second] = rowsOf(html);
  assert.match(first, /aria-current="true"/); assert.doesNotMatch(second, /aria-current/);
  assert.match(html, /aria-label="Close Pull request 1"/); assert.match(html, /title="Close the tab \(the row stays\)"/);
  assert.match(html, /aria-label="Hide until it changes: Pull request 2"/);
  const elsewhere = draw(folder(), { state: snapshot([tab('t1', 'https://github.com/acme/app/pull/1')], 'other') });
  assert.doesNotMatch(rowsOf(elsewhere)[0], /aria-current/, 'a tab that is open but not on screen does not make the row current');
  const privateTab = draw(folder(), { state: snapshot([{ ...tab('t1', 'https://github.com/acme/app/pull/1'), privacy: 'private' } as never], 't1') });
  assert.doesNotMatch(rowsOf(privateTab)[0], /aria-current/, 'a private tab is not a tab of the folder');
});

test('closed: the rows are hidden (the current one stays under the header, like a group), the notes go, and the blue dot shows on the icon for an unseen review', () => {
  const closed = draw(folder(), { open: false, unseen: 1 });
  assert.match(closed, /data-collapsed="true"/); assert.match(closed, /aria-expanded="false"/); assert.match(closed, /live-dot live-dot-icon/);
  assert.ok(rowsOf(closed).every(item => item.includes('data-hidden') && item.includes('inert')));
  assert.match(closed, /aria-label="Pull requests, Review requested"/);
  assert.doesNotMatch(draw(folder(), { open: true, unseen: 1 }), /live-dot-icon/, 'open: the dot is for the closed folder');
  const holding = draw(folder(), { open: false, state: snapshot([tab('t1', 'https://github.com/acme/app/pull/3')], 't1') });
  assert.equal(rowsOf(holding).filter(item => !item.includes('data-hidden')).length, 1);
  assert.match(holding, /data-holds-active="true"/);
  assert.doesNotMatch(draw(folder({ rows: [], total: 0 }), { open: false }), /live-notes/);
});

test('empty, signed-out and error states are quiet lines under the header, with their one action', () => {
  const empty = draw(folder({ rows: [], total: 0 }));
  assert.match(empty, /Nothing is waiting for you\./); assert.doesNotMatch(empty, /live-action/);
  const filtered = draw(folder({ rows: [], total: 4 })); assert.match(filtered, /The filters hide every pull request\./);
  const loading = draw(folder({ rows: [], total: 0, phase: 'loading', loading: true })); assert.match(loading, /Loading pull requests…/);
  const out = draw(folder({ rows: [], total: 0, phase: 'signed-out' }));
  assert.match(out, /Sign in to GitHub in this profile to see your pull requests here\./); assert.match(out, />Sign in to GitHub</); assert.match(out, />Check again</); assert.equal(rowsOf(out).length, 0);
  for (const [error, text] of [['offline', "Can&#x27;t reach GitHub right now."], ['rate-limited', 'GitHub asked Acira to wait a while.'], ['unreadable', "Can&#x27;t read GitHub right now."], ['error', "Couldn&#x27;t load pull requests."]] as const) {
    const failed = draw(folder({ rows: [], total: 0, phase: 'error', error })); assert.match(failed, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.match(failed, />Try again</);
  }
  const stale = draw(folder({ phase: 'error', error: 'offline' })); assert.match(stale, /Showing the last list\. Trying again soon\./); assert.equal(rowsOf(stale).length, 5, 'the last rows stay'); assert.doesNotMatch(stale, />Try again</);
});

test('"More on GitHub" appears when GitHub has more than the folder holds, and not while signed out', () => {
  assert.match(draw(folder({ more: true })), />More on GitHub</);
  assert.doesNotMatch(draw(folder()), /More on GitHub/);
  assert.doesNotMatch(draw(folder({ more: true, rows: [], total: 0, phase: 'signed-out' })), /More on GitHub/);
});

test('titles are text, never markup', () => {
  const html = draw(folder({ rows: [row(9, { title: '<img src=x onerror=alert(1)>' })] }));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the glyphs and the icon: four pull request glyphs on the 16px grid; the sheets take the colour of their state', () => {
  for (const look of ['open', 'draft', 'merged', 'closed'] as const) assert.match(renderToStaticMarkup(createElement(PrGlyph, { look })), /viewBox="0 0 16 16"[^>]*stroke="currentColor"/);
  const icon = renderToStaticMarkup(createElement(LiveFolderIcon, { looks: ['open', 'draft', 'merged'], open: false }));
  assert.equal((icon.match(/<rect /g) || []).length, 3);
  assert.match(icon, /var\(--tab-group-green\)/); assert.match(icon, /var\(--tab-group-grey\)/); assert.match(icon, /var\(--tab-group-purple\)/);
  assert.equal((renderToStaticMarkup(createElement(LiveFolderIcon, { looks: ['open'], open: true })).match(/<rect /g) || []).length, 1);
});

test('the question before the folder exists says what it does and keeps nothing: the sign-in this profile already has, no Acira server, no token', () => {
  const html = renderToStaticMarkup(createElement(Consent, { close: () => {} }));
  assert.match(html, /Add a live folder for pull requests\?/); assert.match(html, /using the github\.com sign-in this profile already has/);
  assert.match(html, /It does not use Acira(&#x27;|')s servers, and Acira keeps no GitHub password or token\./);
  assert.match(html, />Not now</); assert.match(html, />Add folder</);
});

test('the filter menu: the four reasons, drafts, recently merged (1 day), repositories, refresh with when it last ran, remove in red; checks follow the filters', () => {
  const html = renderToStaticMarkup(createElement(Filters, { status: folder(), close: () => {}, openRepos: () => {}, rootRef: { current: null }, now: NOW }));
  for (const label of ['Created by me', 'Review requested', 'Assigned to me', 'Mentioned', 'Drafts', 'Recently merged or closed', 'Repositories', 'Refresh now', 'Remove live folder']) assert.match(html, new RegExp('<span>' + label + '</span>'));
  const check = (label: string) => new RegExp('<button[^>]*role="menuitemcheckbox"[^>]*aria-checked="(true|false)"[^>]*>(?:<svg[^>]*>.*?</svg>)?<span>' + label + '</span>').exec(html)?.[1];
  assert.deepEqual(['Created by me', 'Review requested', 'Assigned to me', 'Mentioned', 'Drafts', 'Recently merged or closed'].map(check), ['true', 'true', 'true', 'false', 'true', 'true']);
  assert.match(html, /<em class="live-menu-value">1 day<\/em>/); assert.match(html, /<em class="live-menu-value">All<\/em>/); assert.match(html, /<em class="live-menu-value">2 min ago<\/em>/);
  assert.match(html, /data-danger="true"[^>]*>.*Remove live folder/);
  const chosen = renderToStaticMarkup(createElement(Filters, { status: folder({ folder: { name: 'Pull requests', filters: { ...filters, repos: ['acme/app'] }, hidden: 0 }, updatedAt: 0 }), close: () => {}, openRepos: () => {}, rootRef: { current: null }, now: NOW }));
  assert.match(chosen, /<em class="live-menu-value">1 chosen<\/em>/); assert.match(chosen, /<em class="live-menu-value">not yet<\/em>/);
});

test('the repositories list: All repositories, then each repository seen with its check, and the note that only repositories with a pull request for you are listed', () => {
  const draws = (repos: string[] | null) => renderToStaticMarkup(createElement(Repositories, { status: folder({ folder: { name: 'Pull requests', filters: { ...filters, repos }, hidden: 0 } }), back: () => {}, rootRef: { current: null } }));
  // React says so on the console when a list has no keys (it did: the rows of this list); nothing may be said while any of these draw.
  const errors: unknown[][] = [], original = console.error; console.error = (...args: unknown[]) => { errors.push(args); };
  try { draws(null); draws(['acme/docs']); renderToStaticMarkup(createElement(Filters, { status: folder(), close: () => {}, openRepos: () => {}, rootRef: { current: null }, now: NOW })); draw(folder()); draw(folder({ rows: [], total: 0, phase: 'signed-out' })); }
  finally { console.error = original; }
  assert.deepEqual(errors, [], 'no warnings from React');
  const all = draws(null);
  assert.match(all, /<span>All repositories<\/span>/); assert.match(all, /<span>acme\/app<\/span>/); assert.match(all, /<span>acme\/docs<\/span>/); assert.match(all, /Only repositories that have a pull request for you are listed\./);
  assert.equal((all.match(/aria-checked="true"/g) || []).length, 3, 'all repositories and both repositories show checked');
  const some = draws(['acme/docs']);
  assert.equal((some.match(/aria-checked="true"/g) || []).length, 1); assert.match(some, /aria-checked="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?<span>acme\/docs<\/span>/);
});

test('it is wired in: the sidebar draws the folder first among the list rows, the popup kind exists with its width and its place, the sidebar menu offers it only in the sidebar, nothing is on by default', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /const body=\[\.\.\.\(newTabsTop\?\[newTab\]:\[\]\),\s*<LiveFolder key="live-folder"/);
  assert.match(read('desktop/validation.cjs'), /'favorite-edit', 'live-folder', 'split'/);
  const app = read('src/App.tsx');
  assert.match(app, /kind === 'live-folder' && <LiveFolderMenu/); assert.match(app, /state\.settings\.verticalTabs && <LiveFolderStripRow/);
  const popup = read('src/ui/popup.ts');
  assert.match(popup, /'bookmark-edit','live-folder'\]\.includes\(kind\)\?260/); assert.match(popup, /if\(kind==='live-folder'\)return 340/);
  assert.doesNotMatch(read('src/runtime/types.ts').match(/export interface Settings\{[^}]*/)?.[0] ?? '', /live/i, 'no setting turns it on: the person adds the folder');
});
