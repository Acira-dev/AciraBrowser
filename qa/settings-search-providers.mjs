import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, poll } from './d-harness.mjs';

const stamp = Date.now(), root = `.qa-profiles/settings-search-${stamp}`;
const out = path.resolve(`qa/artifacts/settings-search-${stamp}`), checks = [];
await fs.mkdir(out, { recursive: true });
let app = await startApp({ root });
const picker = () => app.ui.locator('[data-setting="search-default-engine"] button[aria-haspopup="listbox"]');
const openSearch = async () => {
  await app.act({ type: 'tab.new', url: 'acira://settings' });
  await app.ui.locator('.bs-sidebar nav').getByRole('button', { name: 'Search', exact: true }).click();
  await app.ui.locator('[data-setting="search-engine-list"]').waitFor();
};
const select = async name => {
  await picker().click();
  // The list is a fixed popover that can close and settle while a pointer-actionability check waits on a window with no frames: press the option itself, as d-sleep does.
  const option = app.ui.getByRole('option', { name, exact: true }); await option.waitFor(); await option.dispatchEvent('click');
};
try {
  await openSearch();
  assert.equal(await app.ui.locator('[data-setting="search-engine"]').count(), 1);
  assert.equal(await picker().count(), 0);
  await app.ui.getByRole('button', { name: /^More engines/ }).click();
  await app.ui.getByRole('button', { name: 'Remove YouTube', exact: true }).click();
  await poll(app.state, state => state.settings.searchProviders && !state.settings.searchProviders.engines.some(engine => engine.id === 'youtube'), 'stock engine removed');
  await picker().waitFor();
  assert.equal(await app.ui.locator('[data-setting="search-engine"]').count(), 0);
  await select('DuckDuckGo');
  await poll(app.state, state => state.settings.searchProviders?.defaultId === 'duckduckgo', 'full picker changes default');
  checks.push('Removing a stock engine keeps exactly one working default-engine picker');

  const profile = (await app.state()).activeBrowserProfileId;
  await app.act({ type: 'browser.profile.create', name: 'Synthetic other search profile' });
  const other=(await app.state()).browserProfiles.find(item=>item.id!==profile).id;
  await app.act({ type: 'browser.profile.settings', id: profile, patch: { searchEngine: 'duckduckgo' } });
  await select('Bing');
  await poll(app.state,state=>state.settings.searchProviders?.defaultId==='bing'&&state.sharedSearchProviderId==='duckduckgo','valid legacy own override changes in full picker');
  assert.equal((await app.state()).browserProfiles.find(item=>item.id===profile).settings.searchProviderId,'bing');
  assert.equal((await app.state()).browserProfiles.find(item=>item.id===other).settings,undefined);
  await select('Wikipedia');
  await poll(app.state,state=>state.settings.searchProviders?.defaultId==='wikipedia','arbitrary stock provider selected only for this profile');
  await app.ui.getByRole('textbox',{name:'Engine name',exact:true}).fill('Synthetic provider');
  await app.ui.getByRole('textbox',{name:'Shortcut keyword',exact:true}).fill('synthetic');
  await app.ui.getByRole('textbox',{name:'Search address with %s',exact:true}).fill('https://synthetic-provider.invalid/?q=%s');
  await app.ui.locator('[data-setting="search-engine-add"]').getByRole('button',{name:'Add',exact:true}).click();
  await poll(app.state,state=>state.settings.searchProviders?.engines.some(engine=>engine.id==='synthetic-provider')&&state.sharedSearchProviderId==='duckduckgo'&&state.settings.searchProviders.defaultId==='wikipedia','list edit preserves shared and own defaults');
  await select('Synthetic provider');
  await poll(app.state,state=>state.settings.searchProviders?.defaultId==='synthetic-provider','arbitrary custom own provider selected');
  await app.ui.getByRole('button',{name:'Remove Synthetic provider',exact:true}).click();
  await poll(app.state,state=>state.settings.searchProviders?.defaultId==='duckduckgo'&&state.sharedSearchProviderId==='duckduckgo','deleted custom own provider falls back to shared default');
  checks.push('Valid legacy own choice migrates to arbitrary provider IDs; list edits and custom-provider deletion preserve shared defaults and other profiles');
  await select('DuckDuckGo');
  await poll(app.state,state=>state.browserProfiles.find(item=>item.id===profile).settings.searchProviderId==='duckduckgo','own provider reset before removal');
  await app.ui.getByRole('button', { name: 'Remove DuckDuckGo', exact: true }).click();
  await poll(app.state, state => state.settings.searchProviders?.defaultId === 'google' && !state.settings.searchProviders.engines.some(engine => engine.id === 'duckduckgo'), 'removed profile override falls back to saved default');
  await select('Bing');
  await poll(app.state, state => state.settings.searchProviders?.defaultId === 'bing', 'new default remains selectable');
  checks.push('Removing a profile-specific engine preserves a valid saved default and allows another choice');

  await app.close();
  app = await startApp({ root });
  const restored = await app.state();
  assert.equal(restored.settings.searchProviders.defaultId, 'bing');
  assert.equal(restored.settings.searchProviders.engines.some(engine => ['youtube', 'duckduckgo'].includes(engine.id)), false);
  assert.equal(restored.browserProfiles.find(item => item.id === profile).settings.searchProviderId, 'bing');
  assert.equal(restored.browserProfiles.find(item => item.id === profile).settings.searchEngine, undefined);
  assert.equal(restored.sharedSearchProviderId,'google');
  await openSearch();
  assert.equal(await picker().getAttribute('aria-label'), 'Default search engine: Bing');
  checks.push('Removed engines and profile default survive a full native restart while the shared default stays Google');
  await app.ui.locator('[data-setting="search-scope"] button[aria-haspopup="listbox"]').click();
  await app.ui.getByRole('option',{name:'All profiles',exact:true}).click();
  await poll(app.state,state=>!state.browserProfiles.find(item=>item.id===profile).settings?.searchProviderId&&state.settings.searchProviders.defaultId==='google','All profiles clears own canonical and legacy choice');
  checks.push('All profiles scope returns this profile to the shared default');
  console.log(JSON.stringify({ ok: true, checks, out }, null, 2));
} finally {
  await app.close();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ checks }, null, 2));
}
