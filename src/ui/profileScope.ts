import type {BrowserAction,BrowserSnapshot} from '../runtime/types';
import {profileHasSetting,profileSettingPatch,type ProfileSettings} from '../runtime/profileSettings';
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
  const value=key==='searchProviderId'?effectiveProviders(state.settings.searchProviders??undefined,state.settings.searchEngine).defaultId:state.settings[key];
  return {type:'browser.profile.settings',id:profile.id,patch:profileSettingPatch(key,own?value??null:null)};
}
