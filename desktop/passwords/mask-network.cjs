'use strict';
// How the mask service reaches its provider. One Electron session of its own ('acira-masks': no extensions, no cookies kept, no cache), so an
// extension watching a profile's requests never sees the API key in the header. Before each call it is given the route the profile's pages run
// with (its proxy, or an extension's while one controls it), the same rule the update check follows (update-route.cjs): a route that is not
// confirmed yet sends nothing. Calls run one at a time so two profiles with different routes can't swap the proxy under each other.
const {MaskError}=require('./mask-providers.cjs');
const {tr}=require('./text.cjs');

const UNCONFIRMED=()=>new MaskError('network',tr('pw.mask.err.route','The connection settings aren’t confirmed yet, so Acira sent nothing. Try again in a moment.'));

/** routeOf(profileId) -> Electron proxy config | null (no profile known: the system route); throws when the profile's route is not confirmed. */
function createMaskFetch({session,routeOf}){
 let applied=null,lane=Promise.resolve();
 return async function fetchFor(profileId){
  let config;try{config=routeOf(profileId);}catch{throw UNCONFIRMED();}
  return (url,init)=>{
   const run=async()=>{
    const wanted=config||{mode:'system'},key=JSON.stringify(wanted);// no profile route known: the system's, never the previous profile's
    if(key!==applied){try{await session.setProxy(wanted);await session.closeAllConnections();}catch{throw UNCONFIRMED();}applied=key;}
    return session.fetch(url,init);
   };
   const next=lane.then(run,run);lane=next.catch(()=>{});return next;
  };
 };
}

/** The profile's route as update-route.cjs reads it: its live proxy status when a session is open, else its saved choice. */
function createProfileRoute({getProfile,liveStatus,liveRoute,savedChoice,toNative}){
 return profileId=>{
  const profile=getProfile(profileId);if(!profile||profile.private)return null;
  let status=null;try{status=liveStatus(profile);}catch{/* no session is open for it yet: its saved choice */}
  if(!status)return toNative(savedChoice(profile));
  if(status.error||status.applied===false||status.busy)throw new Error('unconfirmed');
  return liveRoute(profile);
 };
}
module.exports={createMaskFetch,createProfileRoute};
