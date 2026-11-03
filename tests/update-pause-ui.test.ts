import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, rowAction } from '../src/features/settings/updateRow';
import type { UpdateStatus } from '../src/runtime/nativeNetwork';
import { progressHeld, torConnecting } from '../src/ui/matrixShapes';

// The update download pauses (founder, 3 Nov 2026, option B): the toolbar's dots open the update panel, whose title row ends in a progress ring that
// pauses and resumes; paused, the ring keeps its fill in a muted ink and the dots dim, here and in the toolbar. Settings > About shows the pause too.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const { UpdateDownload } = await import('../src/features/updates/UpdatePopover');
const { downloadLine, formatShare, formatTimeLeft } = await import('../src/features/updates/useUpdateReady');
const { pausedTip } = await import('../src/features/updates/UpdatePill');
type View = Parameters<typeof downloadLine>[0];

const view = (patch: Partial<View> = {}): View => ({ phase: 'downloading', version: '0.1.0-beta.9', percent: 42, transferred: 160e6, total: 382e6, speed: 1.3e6, notes: '• Pause the update download', prompt: false, pausable: true, ...patch });
const read = (file: string) => readFileSync(file, 'utf8');

test('downloading: the dots, "Downloading update" and the version; a ring with the real fill that pauses; how much is here and how long is left', () => {
  const html = renderToStaticMarkup(createElement(UpdateDownload, { update: view(), reducedMotion: false }));
  assert.match(html, /data-phase="downloading"/);
  assert.match(html, /<span class="acira-menu-title" id="update-pop-title">Downloading update<span class="acira-menu-sub">Acira 0\.1\.0-beta\.9<\/span><\/span>/);
  assert.match(html, /<button type="button" class="update-ring" aria-label="Pause update download" aria-describedby="update-pop-detail">/);
  assert.match(html, /class="update-ring-fill"[^>]*stroke-dasharray="42 100"/, 'the ring is filled with the real progress');
  assert.match(html, /<p class="update-pop-note update-pop-detail" id="update-pop-detail">160 of 382 MB · 3 min left<\/p>/);
  assert.match(html, /<button type="button" class="acira-button acira-button-quiet">What&#x27;s new<\/button>/, 'What\'s new is the quiet button Read more is');
  assert.match(html, /data-preset="progress"/);
});

test('paused: "Update paused", the ring keeps its fill (muted by CSS) and resumes; the line says it resumes where it stopped; the dots hold still', () => {
  const html = renderToStaticMarkup(createElement(UpdateDownload, { update: view({ phase: 'paused', speed: null }), reducedMotion: false }));
  assert.match(html, /data-phase="paused"/);
  assert.match(html, />Update paused</);
  assert.match(html, /<button type="button" class="update-ring" data-paused="true" aria-label="Resume update download"/);
  assert.match(html, /stroke-dasharray="42 100"/, 'the fill is kept');
  assert.match(html, />160 of 382 MB · resumes where it stopped</);
  assert.match(html, /data-preset="progressHeld"/);
  const css = read('src/features/updates/update-pill.css');
  assert.match(css, /\.update-ring\[data-paused\] \.update-ring-fill \{ stroke: var\(--menu-t3\); \}/, 'muted ink from Acira\'s own tokens');
  assert.match(css, /\.update-download\[data-phase='paused'\] \.update-pop-mark \{ opacity: 0\.5; \}/);
  assert.match(css, /\.app \.update-pill\[data-phase='paused'\] \.update-pill-mark \{ opacity: 0\.5; \}/, 'and the toolbar\'s dots dim too');
});

test('a download Acira cannot pause shows the ring without a control', () => {
  const html = renderToStaticMarkup(createElement(UpdateDownload, { update: view({ pausable: false }), reducedMotion: false }));
  assert.doesNotMatch(html, /<button type="button" class="update-ring"/);
  assert.match(html, /<span class="update-ring" aria-hidden="true">/);
});

test('sizes in the unit of the whole, the time left rounded so it does not flicker, and the percent before the size is known', () => {
  assert.equal(formatShare(160.4e6, 382e6), '160 of 382 MB');
  assert.equal(formatShare(0.5e6, 1.4e9), '0 of 1.4 GB');
  assert.equal(formatShare(4.25e6, 48e6), '4.3 of 48 MB');
  assert.equal(formatTimeLeft(30), 'less than a minute left');
  assert.equal(formatTimeLeft(121), '3 min left');
  assert.match(formatTimeLeft(85 * 60), /^1 hr, 25 min left$|^1 hr 25 min left$/);
  assert.match(formatTimeLeft(118 * 60), /^2 hr left$|^2 hr, 0 min left$/);
  assert.equal(downloadLine(view({ speed: null })), '160 of 382 MB', 'no time before the speed is known');
  assert.equal(downloadLine(view({ total: null, transferred: null, percent: 7 })), '7%');
  assert.equal(pausedTip(view({ phase: 'paused' })), 'Update to Acira 0.1.0-beta.9 paused\n160 of 382 MB');
});

test('the held fill is the progress fill without its blinking next dot, and a still frame (no animation loop)', () => {
  for (const progress of [0, .2, .55, 1]) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const moving = torConnecting(0.3, r, c, 5, 5, progress), held = progressHeld(0.3, r, c, 5, 5, progress);
    assert.equal(held, moving === 1 ? 1 : 0);
    assert.equal(progressHeld(0, r, c, 5, 5, progress), progressHeld(9.7, r, c, 5, 5, progress), 'no motion');
  }
  assert.match(read('src/components/DotMatrix.tsx'), /preset === 'downloadHeld' \|\| preset === 'progressHeld'/);
});

test('the toolbar\'s dots are a control in every phase: they open the panel and say what they are; keyboard and screen-reader labels', () => {
  const pill = read('src/features/updates/UpdatePill.tsx'), css = read('src/features/updates/update-pill.css');
  assert.match(pill, /data-popup-trigger="" data-tip=\{tip\} aria-label=\{label\}\s+aria-haspopup="dialog" aria-expanded=\{active\} onClick=\{onOpen\}/);
  assert.doesNotMatch(pill, /aria-disabled/);
  assert.match(css, /\.app \.update-pill:is\(\[data-phase='downloading'\], \[data-phase='paused'\]\):is\(:hover, \[aria-expanded='true'\]\) \{ background: var\(--frame-hover/, 'the toolbar\'s own hover, as its icon buttons (the page\'s --hover was near-white in a private window)');
  assert.match(css, /button\.update-ring:focus-visible \{ outline: 2px solid var\(--focus-ring-color/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.update-ring-fill \{ transition: none; \}/);
  assert.match(css, /\.app\[data-reduced-motion='true'\] \.update-ring-fill \{ transition: none; \}/, 'Acira\'s own reduced-motion setting too');
  assert.match(css, /@media \(forced-colors: active\) \{ \.update-ring-track/);
  assert.doesNotMatch(css.replace(/var\(--font-ui, 'Inter', sans-serif\)/g, ''), /font-family|'Inter'|Geist|Plex/, 'one typeface: the UI font (Inter) only');
  const app = read('src/App.tsx');
  assert.match(app, /kind==='update'\?tr\(\(\{ready:'update\.readyTitle',downloading:'update\.downloadingTitle',paused:'update\.pausedTitle'\} as const\)\[updatePanelPhase\(\)\]\)/, 'the panel is named for what it shows');
  for (const file of ['src/features/updates/UpdatePopover.tsx', 'src/features/updates/UpdatePill.tsx']) assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML|autoFocus/);
});

test('Settings > About: the row\'s button pauses Acira\'s own download, as the panel\'s ring does; paused, it says so and resumes', () => {
  const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ status: 'idle', version: '0.1.0-beta.8', available: null, progress: null, transferred: null, total: null, speed: null, notes: '', lastChecked: null, error: null, autoDownload: true, channel: 'beta', supported: true, reason: null, ...patch } as UpdateStatus);
  assert.equal(describe(status({ status: 'paused', available: '0.1.0-beta.9', progress: 42 })), 'Download of version 0.1.0-beta.9 paused · 42%');
  assert.deepEqual(rowAction(status({ status: 'paused', available: '0.1.0-beta.9', progress: 42 })), { action: 'update.resume', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'downloading', available: '0.1.0-beta.9', progress: 42, pausable: true })), { action: 'update.pause', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'downloading', available: '0.1.0-beta.9', progress: 42, pausable: false })), { action: 'update.check', disabled: true }, 'electron-updater\'s own download cannot pause: the button stays as it was');
  assert.match(read('src/features/settings/panels/updates.tsx'), /button\.action === 'update\.pause'\s+\? <button type="button" className="st-button" onClick=\{\(\) => void act\('update\.pause'\)\}>\{t\('updates\.pause'\)\}<\/button>/, 'a quiet button (not primary): pausing is the lesser act');
  assert.match(read('src/features/settings/panels/updates.tsx'), /button\.action === 'update\.resume'\s+\? <button type="button" className="st-button primary" onClick=\{\(\) => void act\('update\.resume'\)\}>\{t\('updates\.resume'\)\}<\/button>/);
});

test('every new string is in all 13 catalogs, translated (not an English copy), with its parameters', () => {
  const need: Record<string, string[]> = { 'update.downloadingTitle': [], 'update.pausedTitle': [], 'update.sizeOf': ['done', 'total'], 'update.timeLeft': ['time'], 'update.lessThanMinute': [], 'update.resumesWhereStopped': [], 'update.pauseDownload': [], 'update.resumeDownload': [], 'update.pausedTip': ['version'], 'updates.pausedProgress': ['version', 'percent'], 'updates.resume': [], 'updates.pause': [] };
  const files = readdirSync('src/i18n').filter(name => /^[A-Za-z-]+\.json$/.test(name) && name !== 'converted.json'), en = JSON.parse(read('src/i18n/en.json'));
  assert.equal(files.length, 13);
  for (const file of files) {
    const catalog = JSON.parse(read(`src/i18n/${file}`));
    for (const [id, names] of Object.entries(need)) {
      assert.ok(catalog[id] && catalog[id].length > 1, `${file} lacks ${id}`);
      for (const name of names) assert.ok(catalog[id].includes(`{${name}}`), `${file} ${id} lacks {${name}}`);
      if (file !== 'en.json') assert.notEqual(catalog[id], en[id], `${file} ${id} is still English`);
    }
  }
});
