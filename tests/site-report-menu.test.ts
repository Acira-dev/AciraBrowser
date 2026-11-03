import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrowserSnapshot, TabSession } from '../src/runtime/types';

// "Report a problem…" in the Acira menu (src/features/SiteReport.tsx, BrowserMenu.tsx, popup.ts): the form drawn for real, about the site or about
// Acira, and the menu's height with its new row. SiteReport imports its stylesheets; Node has no CSS loader, so a .css import loads empty here.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= { acira: { platform: 'win32' } }; // the runtime client and the menu read window.acira at import
const { SiteReport } = await import('../src/features/SiteReport');
const { popupNaturalHeight } = await import('../src/ui/popup');

const site = { id: 't1', url: 'https://en.wikipedia.org/wiki/Acira?x=1', contentKind: 'web' } as TabSession;
const settings = { id: 't2', url: 'acira://settings', contentKind: 'internal' } as TabSession;
const form = (tab: TabSession, subjects: ('site' | 'app')[]) => renderToStaticMarkup(createElement(SiteReport, { tab, subjects, dispatch: () => {}, onCancel: () => {}, onSent: () => {} }));
/** The problem rows, each with whether it is chosen. */
const choices = (html: string) => [...html.matchAll(/role="menuitemradio" aria-checked="(true|false)"><span class="menu-toggle-blank" aria-hidden="true"><\/span><span>([^<]+)<\/span>/g)].map(match => [match[2], match[1] === 'true']);

test('from the Acira menu on a website: an About switch (this site first), the site problems, the site in what will be sent', () => {
  const html = form(site, ['site', 'app']);
  assert.match(html, /class="menu-layout-row site-report-about"><span>About<\/span><div class="acira-seg menu-seg menu-seg-labelled" role="radiogroup" aria-label="About"/);
  assert.match(html, /role="radio" aria-checked="true"[^>]*><span>This site<\/span><\/button><button[^>]*role="radio" aria-checked="false"[^>]*><span>Acira<\/span>/);
  assert.doesNotMatch(html, /<svg[^>]*><\/svg><span>This site/, 'words only, no glyph in the switch');
  assert.match(html, /Note \(optional\)/);
  assert.match(html, /Nothing else: not the page&#x27;s address/);
});

test('on an Acira page: no switch, the Acira problems, "Site: None", a note it cannot go without; Send is off until main\'s preview has one', () => {
  const html = form(settings, ['app']);
  assert.doesNotMatch(html, /site-report-about|radiogroup/, 'one subject, no switch');
  assert.match(html, /<span class="acira-menu-sub"><bdi>Acira<\/bdi><\/span>/, 'the form says what it is about');
  for (const label of ["Something doesn&#x27;t work", 'Something looks wrong', 'Crash or freeze', 'Idea or suggestion']) assert.ok(html.includes(label), label);
  for (const label of ['Blocked by mistake', 'Cookie banner or pop-up problem']) assert.ok(!html.includes(label), 'no site problem: ' + label);
  assert.match(html, /<label class="acira-menu-label" for="[^"]+">Note<\/label>/, 'not "(optional)"');
  assert.match(html, /aria-required="true"/);
  assert.match(html, /placeholder="What happened, or your idea\. Don&#x27;t include personal details\."/);
  assert.match(html, />Site<\/[^>]+>[\s\S]{0,200}>None</, 'no site is sent, and the form says so');
  assert.match(html, />Write it above</);
  assert.match(html, /Nothing else: not the sites you visit/);
  assert.match(html, /<button type="button" class="acira-button acira-button-primary" disabled="">Send<\/button>/);
  assert.deepEqual(choices(html), [["Something doesn&#x27;t work", false], ['Something looks wrong', false], ['Crash or freeze', false], ['Idea or suggestion', false]], 'four problems, none chosen yet');
});

test('Page information, Protection and the warning page keep the form as it was: the site only, no switch', () => {
  const html = form(site, ['site']);
  assert.doesNotMatch(html, /site-report-about|radiogroup/);
  assert.deepEqual(choices(html).map(([label]) => label), ['Blocked by mistake', 'Site doesn&#x27;t work', 'Cookie banner or pop-up problem', 'Something else']);
});

const menuState = (extra: Partial<BrowserSnapshot> = {}, tab: Partial<TabSession> = {}) => ({
  activeTabId: 'active', tabs: [{ id: 'active', contentKind: 'web', url: 'https://example.org/', ...tab }], bookmarks: [], downloads: [],
  activeBrowserProfileId: 'p', browserProfiles: [{ id: 'p' }], workspaces: [{ id: 'w', browserProfileId: 'p' }], activeWorkspaceId: 'w', ...extra,
}) as unknown as BrowserSnapshot;

test('the menu is one 30px row taller while this build can send reports, and as before otherwise or in Tor', () => {
  const before = popupNaturalHeight('menu', menuState());
  assert.equal(popupNaturalHeight('menu', menuState({ siteReports: false })), before);
  assert.equal(popupNaturalHeight('menu', menuState({ siteReports: true })), before + 30);
  const torTab = { privacy: 'tor' } as Partial<TabSession>, torBefore = popupNaturalHeight('menu', menuState({}, torTab));
  assert.equal(popupNaturalHeight('menu', menuState({ siteReports: true }, torTab)), torBefore, 'no row in a Tor tab');
  const torWindow = { browserProfiles: [{ id: 'p', tor: true }] } as unknown as Partial<BrowserSnapshot>;
  assert.equal(popupNaturalHeight('menu', menuState({ ...torWindow, siteReports: true })), popupNaturalHeight('menu', menuState(torWindow)), 'no row in a Tor window');
});
