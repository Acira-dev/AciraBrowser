'use strict';
// Answers cookie banners with "reject" (or "necessary only") in every frame, cross-site frames included: Sourcepoint, TrustArc and some Didomi set-ups draw their
// banner in a frame of their own. DuckDuckGo's autoconsent (MPL-2.0, see LICENSE.autoconsent.txt) finds the consent manager and runs its opt-out steps.
// Acira never opts in: it only ever asks for opt-out, rules that only hide a banner are off, and a banner that offers no free reject is left as the site drew it:
// autoconsent finds it and waits, and this script answers only when the banner's own text has no price or subscription in it (pay or consent: spiegel.de's PUR,
// derstandard.at, El País's "Rechazar y suscribirse", where a reject through the consent tool left an empty wall and a locked page).
// Built into autoconsent-preload.cjs by scripts/build-ui-preload.mjs (a sandboxed preload cannot require the library); the rules for this frame come from the main
// process (autoconsent-rules.cjs), and only while "Answer cookie banners" is on for the page.
const {ipcRenderer,webFrame}=require('electron');
if(/^https?:/.test(location.href)){
 let setup=null;
 try{setup=ipcRenderer.sendSync('acira:autoconsent-setup',process.isMainFrame);}catch{/* A closing window. */}
 if(setup&&typeof setup.rules==='string'){
  const AutoConsent=require('@duckduckgo/autoconsent').default;
  let consent=null;
  const PAY=/(?:€|£|\$|\bchf|\beur)\s?\d|\d(?:[.,]\d{1,2})?\s?(?:€|£|\$|eur\b|euro)|\b(?:pur[- ]?abo|werbefrei|ohne werbung|abo(?:nnieren|nnement)?\b|abonn(?:ez|ement|er|ieren)|abbona(?:ti|mento|rsi|menti)|suscr[ií][bp]|subscri(?:be|ption)|ad[- ]?free|sans pub|senza pubblicit|sin publicidad|zonder advertenties|reklamefri)/i;
  const CMP_BOXES='#didomi-host,#didomi-popup,#didomi-notice,#onetrust-banner-sdk,#onetrust-pc-sdk,#iubenda-cs-banner,#CybotCookiebotDialog,#usercentrics-root,#usercentrics-cmp-ui,#qc-cmp2-container,#cmpbox,.cmpbox,#truste-consent-track,.fc-consent-root,[id^="sp_message_container_"],[role="dialog"],[aria-modal="true"],dialog[open]';
  const textOf=node=>((node.innerText||'')+' '+(node.shadowRoot?.textContent||'')).slice(0,4000);
  // What the banner says: a frame of its own is all banner; in a page, the boxes the rule itself looks for, or a known consent tool's box, or an open dialog.
  function bannerText(){
   if(!process.isMainFrame)return (document.body?.innerText||'').slice(0,6000);
   const selectors=[],rule=consent?.foundCmp?.rule;
   for(const step of [...(rule?.detectPopup||[]),...(rule?.detectCmp||[])])for(const key of ['visible','exists','waitForVisible'])if(typeof step?.[key]==='string'&&!step[key].startsWith('xpath/'))selectors.push(step[key]);
   let text='';for(const selector of [...selectors,CMP_BOXES])try{for(const node of document.querySelectorAll(selector)){if(node.getClientRects().length)text+=' '+textOf(node);if(text.length>6000)return text;}}catch{}
   return text;
  }
  function decide(tries=0){
   if(!consent)return;if(!consent.foundCmp&&tries<20){setTimeout(()=>decide(tries+1),25);return;}
   if(PAY.test(bannerText())){try{consent.undoPrehide();}catch{}ipcRenderer.send('acira:autoconsent-event',{type:'payOrConsent',cmp:String(consent.foundCmp?.name||'').slice(0,80),mainFrame:process.isMainFrame});return;}
   void consent.receiveMessageCallback({type:'optOut'});
  }
  // After a reject, a site whose wall stays up until it reloads (El País: the reject is stored, but its empty "acceptation" wall and scroll lock remain): reload
  // once. The main process allows one reload per tab and site a minute, so a site that locks again is never reloaded in a loop.
  const locked=()=>{const root=document.documentElement,body=document.body;if(!body)return false;const rs=getComputedStyle(root),bs=getComputedStyle(body),closed=style=>/^(hidden|clip)$/.test(style.overflowY);return (bs.position==='fixed'||closed(rs)||closed(bs))&&Math.max(root.scrollHeight,body.scrollHeight)>innerHeight*1.2;};
  const dialogOpen=()=>[...document.querySelectorAll(CMP_BOXES)].some(node=>{const box=node.getBoundingClientRect();return box.width>80&&box.height>40&&getComputedStyle(node).visibility!=='hidden'&&textOf(node).trim().length>0;});
  let settled=false;
  function afterAnswer(){if(settled||!process.isMainFrame)return;settled=true;setTimeout(()=>{if(locked()&&!dialogOpen())ipcRenderer.send('acira:autoconsent-event',{type:'stillLocked',cmp:String(consent?.foundCmp?.name||'').slice(0,80),mainFrame:true});},2500);}
  // Rule snippets that need the page's own world (a consent manager's JavaScript API) run there; the code is the library's own, never the page's.
  const send=message=>{
   if(!message||typeof message!=='object')return;
   if(message.type==='eval'){void webFrame.executeJavaScript(String(message.code)).then(result=>!!result,()=>false).then(result=>consent?.receiveMessageCallback({type:'evalResp',id:message.id,result}));return;}
   if(message.type==='popupFound')setTimeout(decide,0);
   if(message.type==='optOutResult'&&message.result===true)afterAnswer();
   if(['cmpDetected','popupFound','optOutResult','autoconsentDone','autoconsentError'].includes(message.type))ipcRenderer.send('acira:autoconsent-event',{type:message.type,cmp:typeof message.cmp==='string'?message.cmp.slice(0,80):'',result:message.result===true,isCosmetic:message.isCosmetic===true,mainFrame:process.isMainFrame});
  };
  try{consent=new AutoConsent(send,setup.config,{compact:JSON.parse(setup.rules)});}catch{/* Rules this build cannot read: the banner stays. */}
 }
}
