'use strict';
// Extension side of chrome.proxy (this function is copied into the preload as text: it may use only `acira` and the page's globals).
module.exports={
 namespaces:['proxy'],
 renderer(acira){
  return {proxy:{factory:()=>acira.build('proxy',{
   events:{onProxyError:acira.event('proxy.onProxyError')},
   objects:{settings:{
    functions:{
     get:details=>acira.call('proxy.settings.get')(details),
     set:details=>acira.call('proxy.settings.set')(details),
     clear:details=>acira.call('proxy.settings.clear')(details)
    },
    events:{onChange:acira.event('proxy.settings.onChange')}
   }}
  })}};
 }
};
