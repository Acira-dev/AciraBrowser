'use strict';
// Profile-wide "Clear browsing data". Only history and download records carry timestamps, so only they can honour a
// time range; cookies, site storage and cache are cleared for all time. Bookmarks and downloaded files are never touched.
const DAY=24*60*60*1000;
const RANGES=Object.freeze({hour:60*60*1000,day:DAY,week:7*DAY,month:30*DAY,all:Infinity});
const ALL_TIME_ONLY=['all'],ANY_TIME=Object.keys(RANGES);
const CAPABILITIES=Object.freeze({history:ANY_TIME,downloads:ANY_TIME,cookies:ALL_TIME_ONLY,storage:ALL_TIME_ONLY,cache:ALL_TIME_ONLY});
const SITE_STORAGES=['filesystem','indexdb','localstorage','shadercache','websql','serviceworkers','cachestorage'];
function status(){return {capabilities:CAPABILITIES,notice:'History and download records can be cleared for the last hour, day, week, 4 weeks or all time. Cookies, site storage and cached files can only be cleared for all time. Bookmarks and downloaded files are kept.'};}
function validate(request){
 const categories=request.categories,range=request.range;
 if(!Array.isArray(categories)||!categories.length||categories.length>Object.keys(CAPABILITIES).length||new Set(categories).size!==categories.length||categories.some(category=>!Object.hasOwn(CAPABILITIES,category)))throw new Error('Choose what to clear.');
 if(typeof range!=='string'||!Object.hasOwn(RANGES,range))throw new Error('Choose a time range.');
 const limited=categories.filter(category=>!CAPABILITIES[category].includes(range));
 if(limited.length)throw new Error('Cookies, site storage and cached files can only be cleared for all time. Choose "All time", or clear only history and download records for a shorter range.');
 return {categories,range};
}
async function clearBrowsingData({request,profile,privateMode,dispatch,electronSession,certificatePolicy,websiteAuth,cookieRestore,now=Date.now}){
 const {categories,range}=validate(request);
 if(privateMode||!profile||profile.private)throw new Error('Private windows keep nothing on this device. Use an ordinary profile to clear browsing data.');
 const since=range==='all'?0:now()-RANGES[range],results=[];
 if(categories.includes('history')){dispatch({type:'history.clear',since});results.push({category:'history',status:'cleared'});}
 if(categories.includes('downloads')){dispatch({type:'downloads.clear',since});results.push({category:'downloads',status:'cleared',note:'Downloaded files stay on disk.'});}
 const cookies=categories.includes('cookies'),storage=categories.includes('storage'),cache=categories.includes('cache');
 if(cookies||storage||cache){
  const session=electronSession.fromPartition(profile.partition);
  if(cookies||storage){await certificatePolicy.clearProfile(profile.id);if(!await websiteAuth.cancelSession(session))throw new Error('Website sign-in cache could not be cleared. Try again.');cookieRestore.clear(session);}
  if(cookies){await session.clearStorageData({storages:['cookies']});results.push({category:'cookies',status:'cleared'});}
  if(storage){await session.clearStorageData({storages:SITE_STORAGES});results.push({category:'storage',status:'cleared'});}
  if(cache){await session.clearCache();results.push({category:'cache',status:'cleared'});}
  if(cookies||storage)await cookieRestore.completeClear(session);
 }
 return {profileId:profile.id,range,results,reloadRequired:cookies||storage||cache,notice:'Open pages may need a reload. You are signed out of websites whose cookies were cleared.'};
}
module.exports={clearBrowsingData,status,validate,CAPABILITIES,RANGES};
