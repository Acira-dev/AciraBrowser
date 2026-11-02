'use strict';
// chrome.webNavigation in extension pages and service workers (P5; main side: web-navigation.cjs). Events come from the main process under
// 'aciraWebNavigation.*' (the engine still broadcasts its own partial 'webNavigation.*' events, which nothing here listens to, except
// onCreatedNavigationTarget, kept as the engine's). A listener added with filters {url: [UrlFilter…]} hears an event when any UrlFilter
// matches the event's URL (Chrome's URLMatcher rules: implicit leading dot for hostContains, fragment removed, default ports dropped).
module.exports={
 namespaces:['webNavigation'],
 renderer(acira){
  return {webNavigation:{factory(){
   const parse=url=>{try{return new URL(url);}catch(e){return null;}};
   const test=(value,f,prefix)=>{
    if(f[prefix+'Contains']!==undefined&&value.indexOf(f[prefix+'Contains'])<0)return false;
    if(f[prefix+'Equals']!==undefined&&value!==f[prefix+'Equals'])return false;
    if(f[prefix+'Prefix']!==undefined&&value.indexOf(f[prefix+'Prefix'])!==0)return false;
    if(f[prefix+'Suffix']!==undefined&&(value.length<f[prefix+'Suffix'].length||value.slice(value.length-f[prefix+'Suffix'].length)!==f[prefix+'Suffix']))return false;
    return true;
   };
   const urlFilterMatches=(f,u)=>{
    if(!f||typeof f!=='object')return false;
    const host=u.hostname,path=u.pathname,query=u.search.replace(/^\?/,''),noFragment=u.href.split('#')[0];
    if(f.hostContains!==undefined&&('.'+host).indexOf(f.hostContains)<0)return false;
    if(!test(host,{Equals:f.hostEquals,Prefix:f.hostPrefix,Suffix:f.hostSuffix},''))return false;
    if(!test(path,{Contains:f.pathContains,Equals:f.pathEquals,Prefix:f.pathPrefix,Suffix:f.pathSuffix},''))return false;
    if(!test(query,{Contains:f.queryContains,Equals:f.queryEquals,Prefix:f.queryPrefix,Suffix:f.querySuffix},''))return false;
    if(!test(noFragment,{Contains:f.urlContains,Equals:f.urlEquals,Prefix:f.urlPrefix,Suffix:f.urlSuffix},''))return false;
    if(f.urlMatches!==undefined){try{if(!new RegExp(f.urlMatches).test(noFragment))return false;}catch(e){return false;}}
    if(f.originAndPathMatches!==undefined){try{if(!new RegExp(f.originAndPathMatches).test(u.origin+u.pathname))return false;}catch(e){return false;}}
    if(Array.isArray(f.schemes)&&f.schemes.indexOf(u.protocol.slice(0,-1))<0)return false;
    if(Array.isArray(f.ports)){
     const port=Number(u.port||({'http:':80,'https:':443,'ws:':80,'wss:':443,'ftp:':21})[u.protocol]||0);
     if(!f.ports.some(p=>Array.isArray(p)?port>=p[0]&&port<=p[1]:port===p))return false;
    }
    return true;
   };
   const matches=(filter,details)=>{
    const list=filter&&Array.isArray(filter.url)?filter.url:null;
    if(!list||!list.length)return true;
    const u=parse(details&&details.url);if(!u)return false;
    return list.some(f=>urlFilterMatches(f,u));
   };
   const ev=name=>acira.event('aciraWebNavigation.'+name,{supportsFilters:true,matches});
   return acira.build('webNavigation',{
    functions:{getFrame:details=>acira.call('webNavigation.getFrame')(details),getAllFrames:details=>acira.call('webNavigation.getAllFrames')(details)},
    events:{onBeforeNavigate:ev('onBeforeNavigate'),onCommitted:ev('onCommitted'),onDOMContentLoaded:ev('onDOMContentLoaded'),onCompleted:ev('onCompleted'),
     onErrorOccurred:ev('onErrorOccurred'),onHistoryStateUpdated:ev('onHistoryStateUpdated'),onReferenceFragmentUpdated:ev('onReferenceFragmentUpdated'),
     onCreatedNavigationTarget:acira.event('webNavigation.onCreatedNavigationTarget',{supportsFilters:true,matches}),onTabReplaced:acira.event('aciraWebNavigation.onTabReplaced')}
   });
  }}};
 }
};
