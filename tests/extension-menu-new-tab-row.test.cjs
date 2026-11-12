'use strict';
// 13.7, GitHub issue #4: we told a user "extensions button > the arrow next to Tabrr > Use as New Tab page", but the toolbar's extensions menu had no such row: the switch
// lived only in Settings > Extensions (the full manager), so the user's menu showed Turn off / Unpin / Check for update / Remove / What it can access and nothing else. The menu's
// per-extension body now carries the same switch (the shared SwitchRow of the Shields panel) for an extension whose manifest has chrome_url_overrides.newtab.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/components/ExtensionManager.tsx'), 'utf8');
const panel = source.slice(source.indexOf('<section className="extension-panel"'), source.indexOf('</section>', source.indexOf('<section className="extension-panel"')));
const body = panel.slice(panel.indexOf('<Disclosure key={extension.id}'), panel.indexOf('<Disclosure className="acira-nested"'));
const settings = source.slice(source.indexOf('<section className="extension-manager" aria-label={t("extensionmanager.extensionsManager")} aria-busy={busy}>'));

test('the toolbar menu\'s extension body has the "Use as New Tab page" switch, only for an extension that overrides the New Tab page', () => {
  assert.ok(panel.length > 1000 && body.length > 300, 'the compact panel and an extension\'s body were found');
  assert.match(body, /\{extension\.overridesNewTab&&<SwitchRow /, 'only when the manifest has chrome_url_overrides.newtab');
  assert.match(body, /label=\{t\("extensionmanager\.useAsNewTab"\)\}/, 'the label Settings uses');
  assert.match(body, /checked=\{extension\.newTabChosen\?\?false\}/);
  assert.match(body, /request\(\{type:'newTab',profileId,extensionId:extension\.id,allowed:!extension\.newTabChosen\}\)/, 'the request Settings sends');
  assert.match(body, /disabled=\{busy\|\|!extension\.enabled\}/, 'a turned-off extension has no switch to press');
  assert.match(source, /import \{ActionRow,Disclosure,SwitchRow\} from '\.\/PanelParts';/);
});

test('Settings > Extensions keeps its own switch, and the strings exist in every language', () => {
  assert.match(settings, /extension\.overridesNewTab&&<button type="button" className="btn" role="switch" aria-checked=\{extension\.newTabChosen\?\?false\}/);
  const dir = path.join(__dirname, '../src/i18n');
  for (const file of fs.readdirSync(dir).filter(name => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(typeof catalog['extensionmanager.useAsNewTab'], 'string', file);
  }
});
