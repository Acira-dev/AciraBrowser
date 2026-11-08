'use strict';
// The update check and Acira's own update download leave by the route of the profile the person browses with (its proxy), not around it. Both use
// electron-updater's own session ('electron-updater'), which never saw a profile's proxy: with a fixed proxy set, they went direct and showed the
// person's address to the release host. Before every check and download, main gives that session the route the profile's pages run with: the
// person's choice, or an extension's while one controls the proxy (chrome.proxy.settings; any mode it can set, PAC included). A route that is known but
// not confirmed (still being applied, or failed) sends nothing; no profile at all keeps the system route.
// The profile is picked like the other main-process lookups (usage facts, the uninstaller's route): the default profile, else the last ordinary
// window's, else the first; never a private one. A profile with no open session yet follows its saved choice. Only what main's shared state carries
// is read (sharedFields in main.cjs: browserProfiles, settings); tests/update-route.test.cjs builds that state from main's own list.
const UNCONFIRMED='The connection settings are not confirmed yet, so Acira did not look for an update. It tries again later.';
function createUpdateRoute({session,getSharedState,getLastProfileId=()=>undefined,liveStatus,liveRoute,savedChoice,toNative}){
 let last=null;
 const profileOf=()=>{
  const shared=getSharedState(),profiles=(shared?.browserProfiles||[]).filter(profile=>profile&&typeof profile.id==='string'&&!profile.private);
  const id=[shared?.settings?.defaultProfileId,getLastProfileId()].find(candidate=>profiles.some(profile=>profile.id===candidate))??profiles[0]?.id;
  return profiles.find(profile=>profile.id===id)||null;
 };
 /** Electron's proxy configuration for the update traffic, or null for no profile; throws when the profile's route is not confirmed. */
 const routeOf=()=>{
  const profile=profileOf();if(!profile)return null;
  let status=null;try{status=liveStatus(profile);}catch{/* no session is open for it yet: its saved choice */}
  if(!status)return toNative(savedChoice(profile));
  if(status.error||status.applied===false||status.busy)throw new Error('unconfirmed');
  return liveRoute(profile);
 };
 return async()=>{
  let config;try{config=routeOf();}catch{throw Object.assign(new Error(UNCONFIRMED),{code:'ERR_UPDATE_ROUTE'});}
  if(!config)return;
  const key=JSON.stringify(config);if(key===last)return;
  try{await session.setProxy(config);await session.closeAllConnections();}catch{throw Object.assign(new Error(UNCONFIRMED),{code:'ERR_UPDATE_ROUTE'});}
  last=key;
 };
}
module.exports={createUpdateRoute,UNCONFIRMED};
