'use strict';
// Reloading a page that a form posted. Chromium holds that reload until the person agrees to send the form again (Chrome's "Confirm Form
// Resubmission") and Electron never asks, so the reload simply did not start: Cmd+R did nothing, and the Reload button turned into Stop
// with a progress line that never finished. A reload (or a same-address load, which Chromium turns into a reload) that does not start on a
// web page is exactly that case: settle the tab, ask, and on a yes reload from the page itself, which sends the form again.
const sameAddress=(a,b)=>{try{return new URL(a).href===new URL(b).href;}catch{return false;}};

/** `settle()` ends the loading the app showed for the reload, `ask()` resolves true when the person agrees, `begin()` shows the loading again. */
function guardFormResend(wc,{settle,ask,begin}){
 let asking=false;
 const held=()=>!wc.isDestroyed()&&!wc.isLoading()&&/^https?:\/\//i.test(wc.getURL());
 function check(){
  if(!held()||asking)return;
  const page=wc.getURL();asking=true;settle();
  Promise.resolve().then(ask).then(agreed=>{asking=false;if(agreed===true&&!wc.isDestroyed()&&wc.getURL()===page){begin();void Promise.resolve(wc.executeJavaScript('location.reload()')).catch(()=>{});}},()=>{asking=false;});
 }
 for(const method of ['reload','reloadIgnoringCache']){const original=wc[method].bind(wc);wc[method]=(...args)=>{original(...args);check();};}
 // Loading the address the page is already at is a reload to Chromium. Any other address (a #fragment change finishes at once) is not.
 const load=wc.loadURL.bind(wc);
 wc.loadURL=(url,...rest)=>{const before=wc.isDestroyed()?'':wc.getURL(),result=load(url,...rest);if(before&&sameAddress(String(url),before))check();return result;};
}
module.exports={guardFormResend,sameAddress};
