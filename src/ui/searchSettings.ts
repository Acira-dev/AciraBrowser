import type {BrowserSnapshot} from '../runtime/types';
import {effectiveProviders,type SearchProviders} from '../runtime/searchProviders';

export const currentSearchProviders=(state:BrowserSnapshot)=>effectiveProviders(state.settings.searchProviders??undefined,state.settings.searchEngine);
export const sharedProvidersConfigured=(state:BrowserSnapshot)=>state.sharedSearchProvidersConfigured??Boolean(state.settings.searchProviders);
/** Provider-list edits are shared, even when this renderer sees a profile's own default. */
export function sharedProviderList(state:BrowserSnapshot,engines:SearchProviders['engines']):SearchProviders{
  const shared=state.sharedSearchProviderId??currentSearchProviders(state).defaultId;
  return {engines,defaultId:engines.some(engine=>engine.id===shared)?shared:engines[0].id};
}
