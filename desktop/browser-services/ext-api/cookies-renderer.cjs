'use strict';
// Extension side of chrome.cookies (this function is copied into the preload as text: it may use only `acira` and the page's globals).
// onChanged travels as 'acira.cookies.onChanged' so the engine's own broadcast of 'cookies.onChanged' (every extension, no permission check)
// reaches nobody.
module.exports={
 namespaces:['cookies'],
 renderer(acira){
  return {cookies:{factory:()=>acira.build('cookies',{
   functions:{
    get:details=>acira.call('cookies.get')(details),
    getAll:details=>acira.call('cookies.getAll')(details),
    set:details=>acira.call('cookies.set')(details),
    remove:details=>acira.call('cookies.remove')(details),
    getAllCookieStores:()=>acira.call('cookies.getAllCookieStores')()
   },
   events:{onChanged:acira.event('acira.cookies.onChanged')}
  })}};
 }
};
