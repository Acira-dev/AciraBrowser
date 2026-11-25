import { useState } from 'react';
import type { BrowserAction, BrowserSnapshot, Settings } from '../../../runtime/types';
import { SUGGEST_SERVICES, chooseSuggestSource, hasSuggestSource, validSuggestAddress } from '../../../runtime/searchSuggest';
import { stockEngineIds } from '../../../runtime/searchProviders';
import { currentSearchProviders } from '../../../ui/searchSettings';
import { SettingGroup, SettingNote, SettingRow, Select, Switch } from '../controls';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';

/**
 * Beta 14 (Settings, Search): search suggestions from the search engine, opt-in. A switch (off), under it ONE plain line that always names the service typed text would go
 * to, then, when on, where to get them from: the default engine's own service, a built-in service, or an address of the person's own (with %s). No nudge, no first-run prompt,
 * no hint anywhere else. What is sent, and when, is main's (desktop/search-suggest.cjs); the note below says the part a person needs: Private and Tor windows never send.
 */
function SearchSuggestions({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const s = state.settings, providers = currentSearchProviders(state), on = Boolean(s.engineSuggestions), from = s.engineSuggestionsFrom || 'engine';
  const update = (patch: Partial<Settings>) => dispatch({ type: 'settings.update', patch });
  const would = chooseSuggestSource({ ...s, engineSuggestions: true }, providers);
  const [draft, setDraft] = useState<string | null>(null);
  const address = draft ?? (s.engineSuggestionsAddress || ''), invalid = address.trim() !== '' && !validSuggestAddress(address.trim());
  const engine = providers.engines.find(item => item.id === providers.defaultId) || providers.engines[0];
  const line = hasSuggestSource(would) ? t(on ? 'searchsuggest.detailOn' : 'searchsuggest.detailOff', { name: would.name }) : t('searchsuggest.detailNone');
  return (
    <>
      <SettingGroup title={t('searchsuggest.groupTitle')}>
        <SettingRow id="engine-suggestions" title={t('searchsuggest.title')} detail={line}>
          <Switch label={t('searchsuggest.title')} checked={on} onChange={engineSuggestions => update({ engineSuggestions })} />
        </SettingRow>
        {on && (
          <SettingRow id="engine-suggestions-from" title={t('searchsuggest.from')} detail={from === 'engine' && !hasSuggestSource(would) && engine ? (stockEngineIds().includes(engine.id) ? t('searchsuggest.engineNone') : t('searchsuggest.engineNeedsAddress', { name: engine.name })) : undefined}>
            <Select value={from} label={t('searchsuggest.from')} options={[{ value: 'engine', label: t('searchsuggest.optEngine') }, { value: 'service', label: t('searchsuggest.optService') }, { value: 'custom', label: t('searchsuggest.optCustom') }]} onChange={engineSuggestionsFrom => update({ engineSuggestionsFrom })} />
          </SettingRow>
        )}
        {on && from === 'service' && (
          <SettingRow id="engine-suggestions-service" title={t('searchsuggest.service')}>
            <Select value={s.engineSuggestionsService || SUGGEST_SERVICES[0].id} label={t('searchsuggest.service')} options={SUGGEST_SERVICES.map(service => ({ value: service.id, label: service.name }))} onChange={engineSuggestionsService => update({ engineSuggestionsService })} />
          </SettingRow>
        )}
        {on && from === 'custom' && (
          <SettingRow id="engine-suggestions-address" title={t('searchsuggest.address')} stacked>
            <input className="st-input" style={{ width: '100%' }} dir="ltr" inputMode="url" spellCheck={false} aria-label={t('searchsuggest.address')} aria-invalid={invalid || undefined} placeholder="https://example.com/suggest?q=%s" value={address}
              onChange={event => { const next = event.target.value; setDraft(next); const trimmed = next.trim(); if (trimmed === '' || validSuggestAddress(trimmed)) update({ engineSuggestionsAddress: trimmed === '' ? '' : validSuggestAddress(trimmed)! }); }}
              onBlur={() => setDraft(null)} />
            {invalid && <p className="nc-message" data-bad role="alert">{t('searchsuggest.addressInvalid')}</p>}
          </SettingRow>
        )}
      </SettingGroup>
      <SettingNote>{t('searchsuggest.note')}</SettingNote>
    </>
  );
}

const panel: SettingsPanel = { section: 'Search', order: 30, Component: SearchSuggestions as SettingsPanel['Component'] };
export default panel;
