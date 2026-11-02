import { useState, type FormEvent } from 'react';
import { runtime } from '../../../runtime/client';
import { type SearchProvider, type SearchProviders } from '../../../runtime/searchProviders';
import type { BrowserAction, BrowserSnapshot } from '../../../runtime/types';
import {currentSearchProviders,sharedProviderList,sharedProvidersConfigured} from '../../../ui/searchSettings';
import {ProfileScope,scopedSetting} from '../ProfileScope';
import { SettingGroup, SettingNote, SettingRow, Select } from '../controls';
import { readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';
const slug = (name: string, taken: readonly string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'engine';
  let id = /^[a-z]/.test(base) ? base : `e-${base}`, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
};

function SearchEngines({ state,dispatch }: { state: BrowserSnapshot; dispatch:(action:BrowserAction)=>void }) {
  const providers = currentSearchProviders(state);
  const [error, setError] = useState(''), [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ name: '', keyword: '', template: '' });
  const save = async (next: SearchProviders | null) => {
    setError('');
    try { await runtime.dispatch({ type: 'settings.update', patch: { searchProviders: next } }); return true; } catch (failure) { setError(readable(failure)); return false; }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const engine: SearchProvider = { id: slug(form.name, providers.engines.map((item) => item.id)), name: form.name.trim(), keyword: form.keyword.trim().replace(/^!/, '').toLowerCase(), template: form.template.trim() };
    if (await save(sharedProviderList(state,[...providers.engines, engine]))) setForm({ name: '', keyword: '', template: '' });
  };
  const remove = (id: string) => {
    const engines = providers.engines.filter((item) => item.id !== id);
    void save(sharedProviderList(state,engines));
  };
  const stock = !sharedProvidersConfigured(state);
  const custom = !stock || !['google','duckduckgo','bing'].includes(providers.defaultId);
  return (
    <>
      <SettingGroup title={t("searchEngines.searchEngines")}>
        {custom && (
          <SettingRow id="search-default-engine" title={t("nativeCore.defaultSearchEngine")} detail="Used for anything typed in the address bar that is not a web address.">
            <Select value={providers.defaultId} label={t("nativeCore.defaultSearchEngine")} options={providers.engines.map((item) => ({ value: item.id, label: item.name }))} onChange={(defaultId) => scopedSetting(state,dispatch,'searchProviderId',defaultId,()=>void save({...providers,defaultId}))} />
          </SettingRow>
        )}
        {custom && <ProfileScope state={state} dispatch={dispatch} setting="searchProviderId" id="search-scope" />}
        <div data-setting="search-engine-list">
          <div className="nc-table-head nc-engine" aria-hidden="true"><span>{t("acirasidebar.name")}</span><span>{t("searchEngines.shortcut")}</span><span>{t("acirasidebar.address")}</span><span /></div>
          {(showAll ? providers.engines : providers.engines.filter((engine) => engine.id === providers.defaultId)).map((engine) => (
            <div className="nc-engine" key={engine.id}>
              <span>{engine.name}{engine.id === providers.defaultId ? t("searchEngines.default") : ''}</span>
              <span className="nc-mono">{engine.keyword ? `!${engine.keyword}` : '—'}</span>
              <span className="nc-mono" title={engine.template}>{engine.template.replace(/^https:\/\//, '')}</span>
              <button type="button" className="nc-link" disabled={providers.engines.length < 2} aria-label={t("extensionmanager.removeNamed", { name: engine.name })} onClick={() => remove(engine.id)}>{t("acirasidebar.remove")}</button>
            </div>
          ))}
        </div>
        {providers.engines.length > 1 && <div className="nc-actions" style={{ marginTop: 8 }}><button type="button" className="st-button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? t("searchEngines.showOnlyTheOneIn") : `More engines… (${providers.engines.length - 1})`}</button></div>}
        <form className="nc-form" data-setting="search-engine-add" onSubmit={add}>
          <input className="st-input" aria-label={t("searchEngines.engineName")} placeholder={t("acirasidebar.name")} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className="st-input" aria-label={t("searchEngines.shortcutKeyword")} placeholder={t("searchEngines.keyword")} maxLength={25} value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} />
          <input className="st-input" aria-label={t("searchEngines.searchAddressWithS")} placeholder="https://example.com/search?q=%s" value={form.template} onChange={(event) => setForm({ ...form, template: event.target.value })} />
          <button type="submit" className="st-button primary" disabled={!form.name.trim() || !form.template.trim()}>{t("searchEngines.add")}</button>
        </form>
        {error && <p className="nc-message" data-bad role="alert">{error}</p>}
        <div className="nc-actions" style={{ marginTop: 12 }}>
          <button type="button" className="st-button" disabled={stock} onClick={() => void save(null)}>{t("searchEngines.restoreDefaultEngines")}</button>
        </div>
      </SettingGroup>
      <SettingNote>{t("searchEngines.typeAShortcutBeforeYour")} <span className="nc-mono">{t("searchEngines.dPrivateBrowsers")}</span>{t("searchEngines.toUseThatEngineOnce")}</SettingNote>
    </>
  );
}

const panel: SettingsPanel = { section: 'Search', order: 40, Component: SearchEngines as SettingsPanel['Component'] };
export default panel;
