import type { BrowserAction,BrowserSnapshot,TabSession } from './types';
import { validProfileEmail,validProfilePicture } from './browserProfiles';

/** Pure reducer helpers for profile lifecycle and bulk tab closing. Native side effects (closing pages, wiping the
 *  partition) are run by desktop/profile-lifecycle.cjs before/after these state changes are committed. */
export type ProfileAction=Extract<BrowserAction,{type:'browser.profile.rename'|'browser.profile.update'|'browser.profile.remove'}>;
export type BulkCloseAction={type:'tab.close.others'|'tab.close.left'|'tab.close.right';id:string};

export function renameProfile(s:BrowserSnapshot,action:Extract<ProfileAction,{type:'browser.profile.rename'}>,toast:(text:string,tone?:'error')=>void):boolean {
  const profile=s.browserProfiles.find(p=>p.id===action.id&&!p.private);
  if(!profile)return false;
  const name=action.name.trim();
  if(!name||name.length>40){toast('Enter a profile name with 1 to 40 characters.','error');return true;}
  profile.name=name;
  if(action.color&&/^#[\da-f]{6}$/i.test(action.color))profile.color=action.color;
  toast(`Profile renamed to ${name}.`);
  return true;
}

/** Color (#rrggbb), avatar (one emoji or initial), picture (image data URL), email (display only); null clears the last three.
 *  `default:true` makes this the profile Acira opens with when no window can lend one; `default:false` only clears it if it is this one; removing the default profile hands it to the first profile left.
 *  Validated at the native boundary (desktop/validation.cjs); the checks here keep restored or hand-edited data harmless too. */
export function updateProfile(s:BrowserSnapshot,action:Extract<ProfileAction,{type:'browser.profile.update'}>):boolean {
  const profile=s.browserProfiles.find(p=>p.id===action.id&&!p.private);
  if(!profile)return false;
  if(action.color&&/^#[\da-f]{6}$/i.test(action.color))profile.color=action.color;
  if(action.avatar===null)delete profile.avatar;else if(typeof action.avatar==='string'&&action.avatar&&action.avatar.length<=16)profile.avatar=action.avatar;
  if(action.picture===null)delete profile.picture;else if(validProfilePicture(action.picture))profile.picture=action.picture;
  if(action.email===null)delete profile.email;else if(validProfileEmail(action.email))profile.email=action.email.trim();
  if(action.default===true)s.settings.defaultProfileId=profile.id;else if(action.default===false&&s.settings.defaultProfileId===profile.id)delete s.settings.defaultProfileId;
  return true;
}

/** Drops a profile and everything the browser keeps for it. At least one ordinary profile must remain. */
export function removeProfile(s:BrowserSnapshot,action:Extract<ProfileAction,{type:'browser.profile.remove'}>,toast:(text:string,tone?:'error')=>void,fallbackTab:(profileId:string)=>TabSession):boolean {
  const profile=s.browserProfiles.find(p=>p.id===action.id&&!p.private);
  if(!profile)return false;
  const rest=s.browserProfiles.filter(p=>p.id!==profile.id&&!p.private);
  if(!rest.length){toast('Keep at least one profile.','error');return true;}
  s.browserProfiles=s.browserProfiles.filter(p=>p.id!==profile.id);
  if(s.settings.defaultProfileId===profile.id)s.settings.defaultProfileId=rest[0].id;
  s.tabs=s.tabs.filter(tab=>tab.browserProfileId!==profile.id);
  s.closedTabs=s.closedTabs.filter(tab=>tab.browserProfileId!==profile.id);
  if(s.closedPrivateTabs)s.closedPrivateTabs=s.closedPrivateTabs.filter(tab=>tab.browserProfileId!==profile.id);
  s.tabGroups=s.tabGroups.filter(group=>group.browserProfileId!==profile.id);
  s.workspaces=s.workspaces.filter(item=>item.browserProfileId!==profile.id);
  if(!s.workspaces.some(item=>item.id===s.activeWorkspaceId))s.activeWorkspaceId=s.workspaces[0]?.id||'';
  s.bookmarkNodes=s.bookmarkNodes.filter(item=>item.browserProfileId!==profile.id);
  s.browsingHistory=s.browsingHistory.filter(item=>item.browserProfileId!==profile.id);
  s.downloads=s.downloads.filter(item=>item.browserProfileId!==profile.id);
  delete s.originZooms[profile.id];
  if(!s.tabs.length)s.tabs.push(fallbackTab(rest[0].id));
  if(!s.tabs.some(tab=>tab.id===s.activeTabId))s.activeTabId=s.tabs[0].id;
  toast(`${profile.name} profile removed.`);
  return true;
}

/** Tab ids a bulk close would close: never the anchor, never pinned tabs, never another profile's tabs. */
export function bulkCloseTargets(s:BrowserSnapshot,action:BulkCloseAction):string[] {
  const index=s.tabs.findIndex(tab=>tab.id===action.id);
  if(index<0)return [];
  const anchor=s.tabs[index];
  // Never another profile's tabs, and never another workspace's (R3-57: a workspace's tabs are its own).
  return s.tabs.filter((tab,i)=>tab.id!==anchor.id&&!tab.pinned&&tab.browserProfileId===anchor.browserProfileId&&(tab.workspaceId??'')===(anchor.workspaceId??'')&&(action.type==='tab.close.others'||(action.type==='tab.close.left'?i<index:i>index))).map(tab=>tab.id);
}
