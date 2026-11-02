'use strict';
// Close guard (R4-35, R4-36): what Acira asks before it throws a person's work away.
//   R4-35  a page that has unsaved changes (it asked for a "leave this site?" prompt on beforeunload) is never closed silently:
//          closing its tab, the window or the whole browser shows ONE card that names the sites, with Close anyway / Cancel.
//   R4-36  closing the browser with several tabs open asks "Close Acira? 6 tabs in 2 windows" (Close / Cancel, Don't ask again).
//          The setting is Settings > Tabs > "Ask before closing the browser" (askBeforeClosing, on by default).
// Both are the same card (desktop/site-prompt.cjs, centred), so when both apply it is one prompt. Everything that decides is a
// pure function here (tests/close-guard.test.cjs); main.cjs lends the coordinator its windows.
//
// Why a probe: Electron closes a page with webContents.close({waitForBeforeUnload:true}), which destroys a page that has no
// handler. A window with ten tabs therefore cannot be asked page by page without closing the quiet ones first, and Cancel would
// be too late. The probe runs the page's own beforeunload handlers in place (the page stays open) and reports which of them
// asked to be confirmed, so the card can list every site once, before anything closes. A page the probe missed (a handler in a
// frame, one that appeared late) still asks through the normal close path, so nothing is ever closed silently.
const NEW_TAB='acira://new';
const LISTED=4,APPROVAL_MS=120000,QUIT_WINDOW_MS=10000,PROBE_MS=700;

/** Runs in the page: dispatches beforeunload the way Chromium does and answers whether a handler asked to confirm. A constant
 * script (never page content). BeforeUnloadEvent has no constructor, createEvent builds one; a plain Event is the fallback. */
const PROBE_SCRIPT="(()=>{try{let e;try{e=document.createEvent('BeforeUnloadEvent');e.initEvent('beforeunload',false,true);}catch{e=new Event('beforeunload',{cancelable:true});}window.dispatchEvent(e);return e.defaultPrevented===true||(typeof e.returnValue==='string'&&e.returnValue!=='');}catch{return false;}})()";

const isBlank=tab=>!tab||!tab.url||tab.url===NEW_TAB;
/** The site a page is on, as the person reads it ("docs.example.com": no www, no port); '' when the address has no host. */
function siteOf(url){try{return new URL(String(url)).hostname.replace(/^www\./,'');}catch{return '';}}

/** Does this page have unsaved changes? `contents` is a webContents. Never rejects; a page that does not answer in time counts as quiet. */
async function probePage(contents,{timeout=PROBE_MS}={}){
  try{
    if(!contents||contents.isDestroyed())return false;
    const url=contents.getURL();if(!/^(?:https?|file):/i.test(url))return false;
    let timer;const late=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeout);timer.unref?.();});
    try{return (await Promise.race([Promise.resolve(contents.executeJavaScript(PROBE_SCRIPT,false)).catch(()=>false),late]))===true;}finally{clearTimeout(timer);}
  }catch{return false;}
}

/** How many tabs, in how many windows. `windows` is [{tabs:[{url}]}]. `real` leaves out the tabs that show the new-tab page. */
function tally(windows){
  let tabs=0,real=0;for(const window of windows)for(const tab of window.tabs||[]){tabs+=1;if(!isBlank(tab))real+=1;}
  return {tabs,real,windows:windows.length};
}
/** Closing the browser asks only with the setting on, with at least two tabs, and never when all that is open is blank. Pure. */
function shouldConfirm({enabled=true,windows}){
  const count=tally(windows);return enabled!==false&&count.tabs>=2&&count.real>=1;
}

const MARK_SITES=8;
/** The distinct sites that are open, in tab order and without the blank tabs: the icons under "Close Acira?" (the card shows the
 * first eight and "+N"). `windows` is [{tabs:[{url}]}]. */
function openSites(windows){
  const seen=new Set(),hosts=[];
  for(const window of windows)for(const tab of window.tabs||[]){if(isBlank(tab))continue;const host=/^acira:\/\//.test(tab.url)?'acira://'+siteOf(tab.url):siteOf(tab.url);if(host&&!seen.has(host)){seen.add(host);hosts.push(host);}}
  return hosts;
}
/** The sites of the unsaved tabs as the card draws them: one row each (a site with two tabs is one row), at most four, then "and N more". */
function unsavedRows(unsaved,say){
  const sites=[...new Set(unsaved.map(item=>item.host||say('closeGuard.thisPage')))];
  return {hosts:sites.slice(0,LISTED),more:Math.max(0,sites.length-LISTED)};
}

/** The card for one question, in the shape of dialog.showMessageBox (+ `site`). `scope` is what is being closed: 'tab', 'tabs',
 * 'window' or 'quit'; `confirm` adds the "Close Acira?" question; `unsaved` is [{id,host}]; `sites` are the open sites
 * (openSites). The card is the "close" variant of the site prompt (R4-47/49): the Acira mark above a short title, a row of the
 * open sites' icons or the unsaved sites as tidy rows (icon + readable name), one line of body copy, and the buttons with the
 * primary one last. Closing the browser asks "Close Acira?" (Cancel, Close Acira; Enter closes) and sits in the middle of the
 * page. Unsaved work asks "Leave without saving?" (Close anyway, Keep editing; Enter and Esc keep editing); closing a tab,
 * tabs or a window puts that card up by the tab strip (`top`), a quit keeps it in the middle. Pure. */
function closePrompt({scope,confirm=false,unsaved=[],tabs=0,windows=0,sites=[]},say){
  const count=unsaved.length,cancel=say('main.cancel');
  if(confirm&&!count){
    const shown=sites.slice(0,MARK_SITES);
    return {type:'question',message:say('closeGuard.quitTitle'),detail:say('closeGuard.quitDetail',{tabs,windows}),
      buttons:[say('closeGuard.close'),cancel],defaultId:0,cancelId:1,
      site:{centered:true,variant:'close',host:'',app:true,strip:{hosts:shown,more:Math.max(0,sites.length-shown.length)}}};
  }
  const buttons=[say('closeGuard.closeAnyway'),say('closeGuard.keepEditing')];
  const site={centered:true,variant:'close',host:'',app:true,list:unsavedRows(unsaved,say),body:say('closeGuard.leaveBody')};
  if(confirm){
    return {type:'warning',message:say('closeGuard.quitTitle'),detail:say('closeGuard.quitDetail',{tabs,windows}),buttons,defaultId:1,cancelId:1,
      site:{...site,caption:count>1?say('closeGuard.leaveMany'):''}};
  }
  return {type:'warning',message:say(count>1?'closeGuard.leaveMany':'closeGuard.leaveTitle'),detail:'',buttons,defaultId:1,cancelId:1,
    site:scope==='quit'?site:{...site,top:true}};
}

/** The coordinator. `getControllers()` are the browser windows; each lends: state {tabs, settings}, privateMode, webApp, closing,
 * window, unsavedTabs(ids?) -> [{id,url}], approveLeave(ids), ask(options) -> {response, muted?, dismissed?} and commitAction(action). */
function createCloseGuard({getControllers,say,now=Date.now}){
  let approvedUntil=0,quitAt=0,asking=false;
  const live=controller=>Boolean(controller)&&!controller.closing;
  /** A window that stepped aside for another profile's window (main's switchProfileHere) is hidden: it is not on screen. */
  const onScreen=controller=>live(controller)&&!controller.switchedAway;
  const settingOn=controller=>controller?.state?.settings?.askBeforeClosing!==false;
  const windowOf=controller=>({tabs:controller.state?.tabs||[]});
  const counted=controller=>!controller.webApp;

  /** Asks one question on `host`; one at a time (a second × while the card is up is ignored). */
  async function ask(host,options,{mute=false}={}){
    if(asking)return {proceed:false,dontAsk:false};
    asking=true;
    try{
      const withMute=mute?{...options,checkboxLabel:say('closeGuard.dontAsk'),site:{...options.site,mute:{label:say('closeGuard.dontAsk')}}}:options;
      const choice=await host.ask(withMute);
      const proceed=Boolean(choice)&&!choice.dismissed&&choice.response===0;
      return {proceed,dontAsk:proceed&&mute&&Boolean(choice.muted||choice.checkboxChecked)};
    }catch{return {proceed:false,dontAsk:false};}
    finally{asking=false;}
  }
  async function unsavedOf(controller,ids){
    let found=[];try{found=await controller.unsavedTabs(ids)||[];}catch{}
    return found.map(item=>({id:item.id,host:siteOf(item.url),windowId:controller.windowId}));
  }
  /** "Don't ask again": the setting is shared, so it is written through an ordinary window when there is one. */
  function turnOff(host){
    const writer=[...getControllers()].find(c=>live(c)&&!c.privateMode&&!c.webApp)||host;
    try{writer.commitAction({type:'settings.update',patch:{askBeforeClosing:false}});}catch{}
  }
  const approve=()=>{approvedUntil=now()+APPROVAL_MS;};
  const pickHost=list=>list.find(c=>c.window&&!c.window.isDestroyed?.()&&c.window.isFocused?.())||list.find(c=>!c.privateMode&&!c.webApp&&!c.switchedAway)||list.find(c=>!c.switchedAway)||list[0];

  return {
    /** A window is closing (×, Alt+F4, the taskbar, Ctrl+Shift+W). Resolves true to go on, false when the person said Cancel.
     * The last window closing is the browser closing, so it also asks "Close Acira?" unless the quit was already asked. Windows
     * that stepped aside for another profile do not count: closing the last one on screen closes them too (main quits), so
     * their unsaved work is asked about on this card, and they then close without asking. */
    async confirmWindowClose(controller){
      if(now()<approvedUntil)return true;
      const others=[...getControllers()].filter(c=>c!==controller&&live(c));
      const last=!others.some(onScreen),behind=last?others:[];
      const perWindow=await Promise.all([controller,...behind].map(async c=>({controller:c,unsaved:await unsavedOf(c)})));
      const unsaved=perWindow.flatMap(item=>item.unsaved);
      const windows=[windowOf(controller)];
      const confirm=last&&!quitBegan()&&counted(controller)&&shouldConfirm({enabled:settingOn(controller),windows});
      if(!confirm&&!unsaved.length){if(behind.length)approve();return true;}
      const verdict=await ask(controller,closePrompt({scope:last?'quit':'window',confirm,unsaved,sites:openSites(windows),...tally(windows)},say),{mute:confirm&&!unsaved.length});
      if(!verdict.proceed)return false;
      if(verdict.dontAsk)turnOff(controller);
      for(const item of perWindow)item.controller.approveLeave(item.unsaved.map(entry=>entry.id));
      if(behind.length)approve();
      return true;
    },
    /** The browser is being closed on purpose (Ctrl+Shift+Q, Quit). Asks once for every window; resolves true when it may close. */
    async confirmQuit(){
      const list=[...getControllers()].filter(live);
      if(!list.length||now()<approvedUntil)return true;
      const host=pickHost(list);
      const perWindow=await Promise.all(list.map(async controller=>({controller,unsaved:await unsavedOf(controller)})));
      const unsaved=perWindow.flatMap(item=>item.unsaved);
      const windows=list.filter(counted).map(windowOf);
      const confirm=shouldConfirm({enabled:settingOn(host),windows});
      if(!confirm&&!unsaved.length){approve();return true;}
      const verdict=await ask(host,closePrompt({scope:'quit',confirm,unsaved,sites:openSites(windows),...tally(windows)},say),{mute:confirm&&!unsaved.length});
      if(!verdict.proceed)return false;
      if(verdict.dontAsk)turnOff(host);
      for(const item of perWindow)item.controller.approveLeave(item.unsaved.map(entry=>entry.id));
      approve();return true;
    },
    /** Several tabs of one window are closing at once (Close other tabs, Close tabs to the right): one card for the unsaved ones. */
    async confirmTabsClose(controller,ids){
      if(now()<approvedUntil)return true;
      const unsaved=await unsavedOf(controller,ids);
      if(!unsaved.length)return true;
      const verdict=await ask(controller,closePrompt({scope:'tabs',unsaved},say));
      if(!verdict.proceed)return false;
      controller.approveLeave(unsaved.map(item=>item.id));return true;
    },
    /** An app-level quit began (before-quit): window closes that follow are part of it and do not ask "Close Acira?" again. */
    noteQuit(){quitAt=now()||1;},
    /** A close was called off (a page asked to stay): the approval is spent. */
    revoke(){approvedUntil=0;},
    approved:()=>now()<approvedUntil,
  };
  function quitBegan(){return quitAt>0&&now()-quitAt<QUIT_WINDOW_MS;}
}

module.exports={createCloseGuard,closePrompt,shouldConfirm,tally,siteOf,probePage,unsavedRows,openSites,PROBE_SCRIPT,NEW_TAB,LISTED,APPROVAL_MS,QUIT_WINDOW_MS};
