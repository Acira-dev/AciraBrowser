'use strict';
// Extension side of chrome.privacy (this function is copied into the preload as text: it may use only `acira` and the page's globals).
// The setting names must match privacy/table.cjs (a test checks it).
module.exports={
 namespaces:['privacy'],
 renderer(acira){
  const setting=path=>({
   functions:{
    get:details=>acira.call(path+'.get')(details),
    set:details=>acira.call(path+'.set')(details),
    clear:details=>acira.call(path+'.clear')(details)
   },
   events:{onChange:acira.event(path+'.onChange')}
  });
  const names=[
   'network.networkPredictionEnabled','network.webRTCIPHandlingPolicy',
   'services.alternateErrorPagesEnabled','services.autofillEnabled','services.autofillAddressEnabled','services.autofillCreditCardEnabled',
   'services.passwordSavingEnabled','services.safeBrowsingEnabled','services.safeBrowsingExtendedReportingEnabled',
   'services.searchSuggestEnabled','services.spellingServiceEnabled','services.translationServiceEnabled'
  ];
  const objects={};
  for(const name of names)objects[name]=setting('privacy.'+name);
  return {privacy:{factory:()=>acira.build('privacy',{objects})}};
 }
};
