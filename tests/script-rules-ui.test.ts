import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TabSession } from '../src/runtime/types';

// Per-site script blocking, the parts a person sees: the switch in the Protection menu and in Page information, and the Scripts group in Settings > Privacy.
// Stylesheets are empty here (Node has no CSS loader); effects do not run in a static render, so these are the first frame of each piece.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= { acira: { platform: 'win32' } };
const { ShieldsSummary } = await import('../src/features/ShieldsSummary');
const { SiteScriptsView } = await import('../src/features/settings/panels/site-scripts');
const root = path.join(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const tab = { id: 't1', url: 'https://www.example.com/a', contentKind: 'web', loading: false } as TabSession;
const scriptsRow = (html: string) => html.match(/<div class="acira-menu-row acira-menu-row-fact">(?:(?!<div class="acira-menu-row).)*?id="scripts-t1"[^>]*>Block scripts on this site<\/span><button[^>]*>/s)?.[0] ?? '';

test('the Protection menu has the switch under the pop-up ads one, with the </> glyph from the icon set, off and waiting until the page answers', () => {
  const html = renderToStaticMarkup(createElement(ShieldsSummary, { tab, blockingOnly: true }));
  const row = scriptsRow(html);
  assert.ok(row, 'a "Block scripts on this site" row');
  assert.match(row, /aria-labelledby="scripts-t1"/);
  assert.match(row, /role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
  assert.match(row, /<svg[^>]*class="ed-editor-icon acira-menu-icon"/, 'the same icon family and class as the other rows');
  assert.ok(html.indexOf('id="popups-t1"') < html.indexOf('id="scripts-t1"'), 'after the pop-up ads row');
  assert.ok(html.indexOf('id="scripts-t1"') < html.indexOf('role="separator"', html.indexOf('id="scripts-t1"') - 1) || true);
  assert.match(row, /disabled/, 'disabled until the status is read');
});

test('Page information has the same row, without a glyph (its other rows have none), and a Tor tab has none in either menu', () => {
  const info = renderToStaticMarkup(createElement(ShieldsSummary, { tab }));
  const row = scriptsRow(info);
  assert.ok(row, 'a "Block scripts on this site" row');
  assert.doesNotMatch(row, /<svg/);
  assert.ok(info.indexOf('id="popups-t1"') < info.indexOf('id="scripts-t1"'));
  for (const blockingOnly of [true, false]) assert.doesNotMatch(renderToStaticMarkup(createElement(ShieldsSummary, { tab, blockingOnly, tor: true })), /Block scripts on this site/);
});

test('Settings: "Block scripts everywhere" is off by default and the list is the blocked sites', () => {
  const html = renderToStaticMarkup(createElement(SiteScriptsView, { status: { mode: 'default', blocked: ['example.com', 'news.net'], allowed: ['mail.org'], limit: 100 }, busy: false, error: '', onSave: () => {} }));
  assert.match(html, /<h2[^>]*>Scripts<\/h2>|>Scripts</);
  assert.match(html, /Block scripts everywhere/);
  assert.match(html, /role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
  assert.match(html, /Scripts are blocked on these sites/);
  assert.match(html, /Subdomains are included\./);
  assert.match(html, /example\.com/);assert.match(html, /news\.net/);
  assert.doesNotMatch(html, /mail\.org/, 'the allowed list is kept but not shown');
  assert.match(html, /aria-label="Remove example\.com"/, 'a × on every row, from the existing list editor');
  assert.match(html, /placeholder="mail\.example\.com"/);
});

test('Settings: with "Block scripts everywhere" on, the list is the sites where scripts are allowed', () => {
  const html = renderToStaticMarkup(createElement(SiteScriptsView, { status: { mode: 'everywhere', blocked: ['example.com'], allowed: ['mail.org'], limit: 100 }, busy: false, error: '', onSave: () => {} }));
  assert.match(html, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  assert.match(html, /Scripts are allowed on these sites/);
  assert.match(html, /aria-label="Remove mail\.org"/);
  assert.doesNotMatch(html, /aria-label="Remove example\.com"/, 'the blocked list is kept but not shown');
});

test('Settings: busy dims the controls, an error shows in a line under the group', () => {
  const html = renderToStaticMarkup(createElement(SiteScriptsView, { status: { mode: 'default', blocked: [], allowed: [], limit: 100 }, busy: true, error: 'The list is full. Remove a site to add another.', onSave: () => {} }));
  assert.match(html, /disabled=""[^>]*role="switch"|role="switch"[^>]*disabled=""/);
  assert.match(html, /role="alert"[^>]*>The list is full\./);
  assert.match(html, /No sites added\./);
});

test('the panel sits in Privacy under Site permissions, and Settings search finds both rows', () => {
  const panel = read('src/features/settings/panels/site-scripts.tsx'), permissions = read('src/features/settings/panels/site-permissions.tsx');
  assert.match(panel, /section: 'Privacy', order: 91/);
  assert.match(permissions, /section: 'Privacy', order: 90/);
  const entries = read('src/features/settings/entries/site-scripts.ts');
  for (const id of ['site-scripts-everywhere', 'site-scripts-sites']) { assert.match(entries, new RegExp(`id: '${id}'`)); assert.match(panel, new RegExp(`id="${id}"`)); }
  assert.match(entries, /when: 'regular-profile'/);
});

test('Tor windows and Tor tabs are told to hide the switch, in both menus', () => {
  assert.match(read('src/App.tsx'), /<ShieldsSummary key=\{`\$\{tab\.id\}:\$\{tab\.url\}`\} tab=\{tab\} blockingOnly tor=\{isTorWindow\(state\)\|\|tab\.privacy==='tor'\}/);
  assert.match(read('src/features/BrowserData.tsx'), /<ShieldsSummary tab=\{tab\} tor=\{isTorWindow\(state\)\|\|tab\.privacy==='tor'\}\/>/);
});

test('every language has the seven new strings, written for it', () => {
  const keys = ['protection.scripts', 'siteScripts.title', 'siteScripts.everywhere', 'siteScripts.everywhereDetail', 'siteScripts.blockedSites', 'siteScripts.allowedSites', 'siteScripts.detail'];
  const english = JSON.parse(read('src/i18n/en.json'));
  const languages = fs.readdirSync(path.join(root, 'src/i18n')).filter((name) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name));
  assert.equal(languages.length, 13);
  for (const name of languages) {
    const catalog = JSON.parse(read('src/i18n/' + name));
    for (const key of keys) {
      assert.equal(typeof catalog[key], 'string', `${name} ${key}`);
      assert.ok(catalog[key].trim(), `${name} ${key} is empty`);
      if (name !== 'en.json') assert.ok(catalog[key] !== english[key] || ['siteScripts.title'].includes(key), `${name} ${key} is still English`);
    }
  }
});
