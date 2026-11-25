'use strict';
// Answers cookie banners with "reject" (or "necessary only") in every frame, cross-site frames included: Sourcepoint, TrustArc and some Didomi set-ups draw their
// banner in a frame of their own. DuckDuckGo's autoconsent (MPL-2.0, see LICENSE.autoconsent.txt) finds the consent manager and runs its opt-out steps.
// Acira never opts in: it only ever asks for opt-out, rules that only hide a banner are off, and a banner that offers no free reject is left as the site drew it:
// autoconsent finds it and waits, and this script answers only when the banner's own text has no price or subscription in it (pay or consent: spiegel.de's PUR,
// derstandard.at, El País's "Rechazar y suscribirse", where a reject through the consent tool left an empty wall and a locked page).
// Built into autoconsent-preload.cjs by scripts/build-ui-preload.mjs (a sandboxed preload cannot require the library); the rules for this frame come from the main
// process (autoconsent-rules.cjs), and only while "Answer cookie banners" is on for the page.
const {ipcRenderer,webFrame}=require('electron');
/* frame-boot client (frame-boot.cjs) */const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};/* end frame-boot client */
if(/^https?:/.test(location.href)){
 let setup=null;
 try{setup=bootAnswer('acira:autoconsent-setup',process.isMainFrame);}catch{/* A closing window. */}
 if(setup&&(typeof setup.rules==='string'||(setup.lazy&&typeof setup.lazy.prehide==='string'))){
  let AutoConsent=null;const library=()=>AutoConsent||(AutoConsent=require('@duckduckgo/autoconsent').default);
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
   if(PAY.test(bannerText())){try{consent.undoPrehide();}catch{}ipcRenderer.send('acira:autoconsent-event',{type:'payOrConsent',cmp:String(consent.foundCmp?.name||'').slice(0,80),mainFrame:process.isMainFrame});release();return;}
   void consent.receiveMessageCallback({type:'optOut'});
  }
  // After a reject, a site whose wall stays up until it reloads (El País: the reject is stored, but its empty "acceptation" wall and scroll lock remain): reload
  // once. The main process allows one reload per tab and site a minute, so a site that locks again is never reloaded in a loop.
  const locked=()=>{const root=document.documentElement,body=document.body;if(!body)return false;const rs=getComputedStyle(root),bs=getComputedStyle(body),closed=style=>/^(hidden|clip)$/.test(style.overflowY);return (bs.position==='fixed'||closed(rs)||closed(bs))&&Math.max(root.scrollHeight,body.scrollHeight)>innerHeight*1.2;};
  const dialogOpen=()=>[...document.querySelectorAll(CMP_BOXES)].some(node=>{const box=node.getBoundingClientRect();return box.width>80&&box.height>40&&getComputedStyle(node).visibility!=='hidden'&&textOf(node).trim().length>0;});
  let settled=false;
  function afterAnswer(){if(settled||!process.isMainFrame)return;settled=true;setTimeout(()=>{if(locked()&&!dialogOpen())ipcRenderer.send('acira:autoconsent-event',{type:'stillLocked',cmp:String(consent?.foundCmp?.name||'').slice(0,80),mainFrame:true});},2500);}
  // Rule snippets that need the page's own world (a consent manager's JavaScript API) run there; the code is the library's own, never the page's.
  // Speed pass (RAM): once this document's answering is over nothing in the library runs again, but its ~490 parsed rules stayed in every page's process for the
  // page's whole life. They are let go after "nothing detected", a few seconds after an answer (afterAnswer still reads the tool's name), or once a pay-or-consent
  // banner has been left as the site drew it. The library is only ever driven by this script, so nothing changes for the page.
  const release=(wait=0)=>setTimeout(()=>{consent=null;},wait);
  const send=message=>{
   if(!message||typeof message!=='object')return;
   if(message.type==='report'){const life=message.state&&message.state.lifecycle;if(life==='nothingDetected')release();else if(life==='done')release(4000);return;}
   if(message.type==='eval'){void webFrame.executeJavaScript(String(message.code)).then(result=>!!result,()=>false).then(result=>consent?.receiveMessageCallback({type:'evalResp',id:message.id,result}));return;}
   if(message.type==='popupFound')setTimeout(decide,0);
   if(message.type==='optOutResult'&&message.result===true)afterAnswer();
   if(['cmpDetected','popupFound','optOutResult','autoconsentDone','autoconsentError'].includes(message.type))ipcRenderer.send('acira:autoconsent-event',{type:message.type,cmp:typeof message.cmp==='string'?message.cmp.slice(0,80):'',result:message.result===true,isCosmetic:message.isCosmetic===true,mainFrame:process.isMainFrame});
  };
  // The library's prehide appends its rule with `styleEl.innerText += rule`. Reading innerText makes the page bring its style and layout up to date at that moment,
  // and in this preload the document does not exist yet when the library starts, so prehide waits for DOMContentLoaded: every page paid one forced full layout
  // there (a speed pass: 6 ms on a large page, 1.6 ms on an article, consent banner or not). The same rule, written to the same <style id="autoconsent-prehide">,
  // through textContent, which reads nothing from layout. The library's undoPrehide removes that element as before. (A <style> is never rendered: its innerText is its text.)
  const prehideWrite=selector=>{
   const id='autoconsent-prehide';let styleEl=document.querySelector('style#'+id);
   if(!(styleEl instanceof HTMLStyleElement)){const parent=document.head||document.getElementsByTagName('head')[0]||document.documentElement;styleEl=document.createElement('style');styleEl.id=id;parent.appendChild(styleEl);}
   styleEl.textContent+=`${selector} { opacity: 0 !important; z-index: -1 !important; pointer-events: none !important; } `;
   return selector.length>0;
  };
  const config=setup.config,lazy=setup.lazy,rulesText=setup.rules;
  // The rule text (about 190 KB in a page's main frame) is not needed once the library has read it: it is let go here, and from the frame's cached boot answer too.
  setup=null;try{const boot=globalThis[Symbol.for('acira.frame-boot')];if(boot)delete boot['acira:autoconsent-setup'];}catch{/* no boot answer cached */}
  if(typeof rulesText==='string'){
   try{consent=new (library())(send,config,{compact:JSON.parse(rulesText)});}catch{/* Rules this build cannot read: the banner stays. */}
   if(consent&&consent.domActions&&typeof consent.domActions.prehide==='function')consent.domActions.prehide=prehideWrite;
  }else{
   // Beta 14 speed pass (RAM), lazy answering: the library and its ~500 rules cost every page 3-4 MB, and most pages have no consent tool. A page's main frame gets
   // instead the library's own prehide list and what its rules look for first (CSS, two xpaths, a few of its page-world snippets, the Admiral notice's words;
   // autoconsent-lazy.cjs in main). It hides the same boxes at the same moment, looks on the library's own schedule, and only when something turns up asks for
   // the rules and hands over to the library, which then runs exactly as before from its own first detection (and hides the box again while it answers).
   let loaded=false,shown=false,valid=null;
   const unhide=()=>{shown=true;try{const el=document.querySelector('style#autoconsent-prehide');if(el)el.remove();}catch{/* gone */}};
   // Each selector is asked on its own, as the library asks them. Joined into one list they would cost more, not less: a single selector keeps Blink's fast
   // paths (one that names an #id absent from the page ends at once), a list matches every element against every selector (14 ms a load on the bench's heavy
   // page against the library's 4); and one rule (google-consent-standalone) leaves a bracket open, which breaks any list it is in. One the page cannot read
   // is skipped, as the library skips it.
   const cssFound=()=>{
    if(!valid){valid=[];let hit=false;for(const s of lazy.detect)try{if(document.querySelector(s))hit=true;valid.push(s);}catch{/* the library skips it too */}return hit;}
    for(const s of valid)if(document.querySelector(s))return true;
    return false;
   };
   const found=async()=>{
    if(cssFound())return true;
    for(const x of lazy.xpath)try{if(document.evaluate(x,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue)return true;}catch{/* the library skips it too */}
    if(lazy.text.length){const t=document.body?.textContent||'';if(lazy.text.some(words=>words.every(word=>t.includes(word))))return true;}
    for(const code of lazy.evals){try{if(await webFrame.executeJavaScript(String(code)))return true;}catch{/* false, as for the library */}}
    return false;
   };
   const load=()=>{
    loaded=true;
    let rules=null;try{rules=ipcRenderer.sendSync('acira:autoconsent-rules');}catch{/* a closing window */}
    if(typeof rules!=='string'){unhide();return;}
    try{
     // Made after the document exists, the library's constructor would prehide before its own domActions exist: it is made without a config, given the same
     // prehide as above, then initialised by its own init path. The page hid the library's list at DOMContentLoaded and shows it again on the library's own
     // schedule (timeout below), so the library starts without hiding it a second time and is told whether it is still hidden; from then on it hides it again
     // itself when it finds an open banner (handlePopup) and shows it after its answer, exactly as when it ran from the start.
     consent=new (library())(send,null,{compact:JSON.parse(rules)});
     if(consent.domActions&&typeof consent.domActions.prehide==='function')consent.domActions.prehide=prehideWrite;
     consent.initialize({...config,enablePrehide:false},null);consent.config.enablePrehide=config.enablePrehide!==false;
     if(!shown)consent.updateState({prehideOn:true});
    }catch{consent=null;unhide();}
   };
   // The library's own schedule (17.2.0 findCmp): when the page is idle after DOMContentLoaded it looks; then again after 500 ms; from then on after 500 ms AND a
   // change in the page, giving up after its retries or after 60 s without a change, when it shows what it hid ("nothing detected").
   const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   const mutation=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{observer.disconnect();reject(new Error('quiet'));},60000);const observer=new MutationObserver(()=>{clearTimeout(timer);observer.disconnect();resolve(true);});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});});
   const look=async()=>{
    let attempts=0;
    for(let retries=config.detectRetries??20;;retries--){
     attempts++;
     const changed=mutation();changed.catch(()=>{});
     if(await found()){load();return;}
     if(retries<=0)break;
     try{await Promise.all(attempts>1?[wait(500),changed]:[wait(500)]);}catch{break;}
    }
    if(!loaded)unhide();
   };
   // The library's prehide timeout, counted from DOMContentLoaded as the library counts it: the list is shown again then unless an answer is running.
   const timeout=()=>{const state=consent&&consent.state;if(!state){unhide();return;}if(state.prehideOn&&!['runningOptOut','runningOptIn'].includes(state.lifecycle)){shown=true;consent.undoPrehide();}};
   const begin=()=>{if(config.enablePrehide!==false&&!config.visualTest){prehideWrite(lazy.prehide);setTimeout(timeout,config.prehideTimeout||2000);}else shown=true;const idle=globalThis.requestIdleCallback;if(idle)idle(()=>void look(),{timeout:500});else setTimeout(()=>void look(),0);};
   if(document.documentElement&&document.readyState!=='loading')begin();else window.addEventListener('DOMContentLoaded',begin,{once:true});
  }
 }
}
