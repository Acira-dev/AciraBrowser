import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { artworkCollections, collectionPreview } from '../src/ui/artworkCollections';
import { effectiveView, windowViewOf, windowViewPatch } from '../src/runtime/windowView';

const read = (file: string) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const steps = read('src/features/onboarding/steps.tsx');
const yours = read('src/features/onboarding/MakeItYours.tsx');
const cover = read('src/features/onboarding/CoverStep.tsx');
const settings = read('src/features/BrowserSettings.tsx');
const antiTracking = read('src/features/settings/panels/anti-tracking.tsx');
const metrics = read('src/features/metrics/useMetrics.ts');

// R4-05: "No image" first, Paintings the one selected by default, a real picture per collection shipped locally and credited.
test('the cover step lists No image first and keeps Paintings as the default', () => {
  const order = [...cover.matchAll(/\{ id: "([a-z-]+)", label:/g)].map((match) => match[1]);
  assert.deepEqual(order, ['none', 'built-in', 'landscapes', 'nature', 'architecture', 'space', 'own']);
  assert.match(cover, /initial\.collection/, 'the selection starts from the saved collection (Paintings: built-in)');
  assert.match(read('src/ui/newTabPreferences.ts'), /collection:\s*'built-in'/);
});

test('every collection preview is a shipped photograph and is credited with its source and licence', () => {
  const credits = read('public/artwork/cover-samples/CREDITS.md');
  assert.deepEqual([...artworkCollections].sort(), Object.keys(collectionPreview).sort());
  const seen = new Set<string>();
  for (const collection of artworkCollections) {
    const path = collectionPreview[collection];
    assert.match(path, /^\/artwork\/cover-samples\/[a-z]+\.jpg$/);
    assert.ok(!seen.has(path), 'one picture per collection');
    seen.add(path);
    const bytes = fs.readFileSync(new URL('../public' + path, import.meta.url));
    assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8); // JPEG
    assert.ok(bytes.length > 8000, `${path} is a real picture`);
    const name = path.split('/').pop()!;
    const row = credits.split('\n').find((line) => line.includes('`' + name + '`'));
    assert.ok(row, `${name} is credited`);
    assert.match(row!, /CC0|CC BY|Public domain|not copyrighted/, `${name} names its licence`);
    assert.match(row!, /https?:\/\/|catalog-v2/, `${name} names its source`);
  }
  assert.match(cover, /\.\.\.collectionPreview/, 'setup uses the shared previews');
  assert.match(read('src/features/NewTabSettings.tsx'), /collectionPreview\[collection\]/, 'Settings shows the same previews');
});

// R4-07: one switch, one setting, in setup and at the top of Settings › Privacy.
test('phishing and malware protection is a real switch in setup and the first row in Settings, on the same setting', () => {
  assert.match(steps, /title=\{t\("privacy\.phishingProtection"\)\}[\s\S]{0,400}onChange=\{togglePhishing\}/);
  assert.match(steps, /antitracking\.set[\s\S]{0,80}phishingLists: value/);
  assert.match(steps, /antitracking\.status/);
  assert.doesNotMatch(steps, /className="fr-row fr-noicon fr-fact"/, 'the read-only "On" row is gone');
  assert.match(antiTracking, /id="phishing-lists" title=\{t\("privacy\.phishingProtection"\)\}[^>]*info=\{t\("setup\.phishing\.info"\)\}/);
  assert.match(antiTracking, /patch: \{ phishingLists: next \}/);
  const privacy = settings.slice(settings.indexOf('section === "Privacy" && ('));
  assert.ok(privacy.indexOf('<PhishingProtection') > 0 && privacy.indexOf('<PhishingProtection') < privacy.indexOf('<ProfilePrivacy'), 'first on the page');
  const entry = read('src/features/settings/entries/privacy.ts');
  const line = entry.split('\n').find((item) => item.includes("id: 'phishing-lists'"))!;
  for (const word of ['phishing', 'malware', 'safe browsing', 'dangerous sites']) assert.ok(line.includes(`'${word}'`), `searchable by ${word}`);
  const en = JSON.parse(read('src/i18n/en.json'));
  assert.equal(en['privacy.phishingProtection'], 'Phishing and malware protection');
  assert.match(en['setup.phishing.info'], /turn this off/i, 'the (i) says what turning it off means');
});

// R4-11: usage sharing is on in setup from the first frame, warmer copy, a Close button, room under the paragraph.
test('share anonymous usage shows its default on while the first answer is on its way, and the sheet says Close', () => {
  assert.match(metrics, /enabled: status \? status\.enabled : newSetup && !problem/);
  assert.match(metrics, /useState<MetricsStatus \| undefined>\(latest\)/, 'coming back shows the real choice at once');
  assert.match(metrics, /type: 'metrics\.set', enabled: true, onlyIfUnset: true/);
  const sheet = steps.slice(steps.indexOf('function UsageSheet'), steps.indexOf('function ConnectionSheet'));
  assert.match(sheet, /\{t\("app\.close"\)\}/);
  assert.doesNotMatch(sheet, /setup\.done/);
  assert.match(read('src/features/metrics/UsageOffNotice.tsx'), /aria-label=\{t\('app\.close'\)\}/);
  const css = read('src/features/onboarding/onboarding.css');
  assert.match(css, /\.fr-sheet-main\.fr-sheet-usage \{\s*padding: 48px 72px 24px;/);
  assert.match(css, /\.fr-sheet-usage \.fr-sheet-note \{\s*align-self: stretch;/);
  assert.match(read('src/i18n/en.json'), /"usage\.setupExplanation": "We’re a small startup\./);
});

// R4-13 / R4-15: Make it yours gets Appearance and View on the same settings as Settings.
test('Make it yours has Appearance and View rows that write the same settings as Settings', () => {
  assert.match(yours, /options=\{\[\["light", t\("setup\.mode\.light"\)\], \["dark", t\("setup\.mode\.dark"\)\], \["system", t\("setup\.mode\.auto"\)\]\] as const\}\s*onChange=\{\(appearance\) => update\(\{ appearance \}\)\}/);
  assert.match(yours, /\["full", t\("windowview\.full"\)\], \["compact", t\("windowview\.compact"\)\], \["seamless", t\("windowview\.seamless"\)\]/);
  assert.match(yours, /onChange=\{\(windowView\) => update\(\{ windowView \}\)\}/);
  assert.doesNotMatch(yours, /yours\.density|toolbarLayout/);
  assert.match(yours, /windowViewDetail\(view\)/, 'each view has its one-line hint');
  const rows = [...yours.matchAll(/<span>\{t\("(app\.appearance|yours\.view|yours\.tabs)"\)\}<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(rows, ['app.appearance', 'yours.tabs', 'yours.view']);
  assert.equal(JSON.parse(read('src/i18n/en.json'))['yours.view'], 'View');
});

test('the View row is the window-view setting: Compact and Seamless round-trip through the same reducer rule as Settings', () => {
  const base = { toolbarLayout: 'expanded' as const };
  for (const view of ['full', 'compact', 'seamless'] as const) {
    const patch = windowViewPatch(base, { windowView: view });
    assert.equal(windowViewOf({ ...base, ...patch }), view);
    assert.equal(effectiveView({ ...base, ...patch }, null), view);
  }
});

// R4-43: stacked group cards (Search, Privacy) keep their 24px gap even when something sits between them in the DOM.
test('stacked setup groups are separated by a general-sibling rule, so nothing between them can glue them together', () => {
  const css = read('src/features/onboarding/onboarding.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.fr-group ~ \.fr-group \{\s*margin-top: 24px;\s*\}/);
  assert.doesNotMatch(css, /\.fr-group \+ \.fr-group/, 'the adjacent-sibling form loses the gap as soon as a sheet anchor or notice sits between the groups');
  // The Privacy step really is two groups with the sheet's anchor between them (the case the adjacent rule missed).
  const start = steps.indexOf('<div className="fr-privacy-controls">');
  const next = steps.slice(start).search(/\n(?:export )?function /);
  const privacy = steps.slice(start, next > 0 ? start + next : undefined);
  assert.equal((privacy.match(/<div className="fr-group">/g) ?? []).length, 2);
  assert.match(privacy, /<\/div>\s*\{sheet && <ConnectionSheet[^\n]*\n[\s\S]*?<div className="fr-group">/);
});

// R4-03: the setup avatar ring is a deliberate ring with a gap.
test('the setup profile ring is an outline with a gap, on the setup avatar only', () => {
  const css = read('src/features/onboarding/onboarding.css');
  assert.match(css, /\.fr-profile \.fr-profile-avatar \{\s*outline: 3px solid var\(--fr-profile-color, transparent\);\s*outline-offset: 4px;/);
});

test('29 Oct: after setup chose "No image", picking a picture or a collection in Settings turns the artwork back on', () => {
  const ntp = read('src/features/NewTabSettings.tsx');
  assert.match(ntp, /update\(\{ \.\.\.artworkCollectionChoice\(collection, prefs\.artwork\), modules: \{ \.\.\.prefs\.modules, artwork: true \} \}\)/, 'a collection');
  assert.match(ntp, /update\(\{ artwork: value as typeof prefs\.artwork, daily: false,[^}]*modules: \{ \.\.\.prefs\.modules, artwork: true \} \}\)/, 'one picture');
  assert.match(cover, /artwork: pick !== "none"/, 'setup still turns it off for "No image"');
});
