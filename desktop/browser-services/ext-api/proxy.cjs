'use strict';
// chrome.proxy for extensions (docs/launch/EXTENSION_WORK_PACKAGES.md, package P6).
//   proxy.settings.get / set / clear / onChange   Chrome's ChromeSetting rules over the profile's extension-settings store: the extension
//                                                 installed last wins, levelOfControl says who holds it
//   proxy.onProxyError                            apply failures and PAC scripts that cannot compile (Chromium reports the script's own run-time
//                                                 errors from inside its network stack, which Electron does not surface: not forwarded)
// The proxy itself is applied by proxy-settings.cjs (`host.reapply`), the one place that calls session.setProxy for a profile, so the person's
// own choice comes back the moment the extension clears its value, is disabled or is removed. Tor sessions are never touched: they have no
// profile store, their route is the Tor client, and every call on a Tor session answers not_controllable.
const chromeSettings=require('../extension-chrome-settings.cjs');
const {installSettings,pushWebRtcPolicy}=require('./_settings.cjs');
const convert=require('./proxy/convert.cjs');

module.exports={
 namespaces:['proxy'],
 install(api,options={}){
  let settings=null;
  const definition={
   path:'proxy.settings',key:'proxy',
   validate:value=>convert.validate(value),
   fixed:ctx=>!!ctx.session.__aciraTor,
   signature:ctx=>JSON.stringify(chromeSettings.proxyOverride(api.storeKey,ctx.session)?.native||null),
   resolve:(winner,ctx)=>(winner!==undefined?winner:chromeSettings.userProxyConfig(ctx.session)),
   async apply(ctx){
    const session=ctx.session;
    if(session.__aciraTor)return;
    const host=chromeSettings.hostFor(session),override=chromeSettings.proxyOverride(api.storeKey,session);
    if(host&&typeof host.reapply==='function')await host.reapply();
    else{await session.setProxy(override?override.native:{mode:'system'});if(typeof session.closeAllConnections==='function')await session.closeAllConnections();}
    pushWebRtcPolicy(session,{contents:options.contents});
    reportErrors(override);
   }
  };
  /** A PAC script that cannot compile will never route anything: tell the extension that holds it (fatal, as Chromium does). */
  function reportErrors(override){
   if(!override)return;
   const message=convert.pacSyntaxError(override.config);
   if(message)api.emit(override.extensionId,'proxy.onProxyError',{fatal:true,error:'net::ERR_PAC_SCRIPT_FAILED',details:message});
  }
  settings=installSettings(api,[definition],options);
  return {forget:id=>settings.forget(id),dispose:()=>settings.dispose()};
 }
};
