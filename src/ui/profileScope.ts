import type {BrowserAction,BrowserSnapshot} from '../runtime/types';
import {lookOf,profileHasSetting,profileSettingPatch,type ProfileSettings,type ProfileSettingsPatch} from '../runtime/profileSettings';
import {effectiveProviders} from '../runtime/searchProviders';

export function profileScopeOwner(state:BrowserSnapshot){
  return state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId&&!profile.private);
}
export function scopedSettingAction(state:BrowserSnapshot,key:keyof ProfileSettings,value:string):BrowserAction|null{
  const profile=profileScopeOwner(state);
  return profile&&profileHasSetting(profile.settings,key)?{type:'browser.profile.settings',id:profile.id,patch:profileSettingPatch(key,value)}:null;
}
export function profileScopeAction(state:BrowserSnapshot,key:keyof ProfileSettings,own:boolean):BrowserAction|null{
  const profile=profileScopeOwner(state);if(!profile)return null;
  const value=key==='searchProviderId'?effectiveProviders(state.settings.searchProviders??undefined,state.settings.searchEngine).defaultId:key==='appearance'||key==='searchEngine'?state.settings[key]:undefined;
  /* 13.6: Applies to is one switch for the profile's whole look: its Light/Dark/Auto and its Finish and custom colours. This profile keeps what it shows now; All profiles drops all of it. */
  const patch:ProfileSettingsPatch={...profileSettingPatch(key,own?value??null:null),...(key==='appearance'?{look:own?lookOf(state.settings):null}:{})};
  return {type:'browser.profile.settings',id:profile.id,patch};
}
