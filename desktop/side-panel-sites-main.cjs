'use strict';
// Side panel sites, main's half (Beta 14, brief section AF): what a window gives the host in side-panel-sites.cjs, and what a panel page gets of the protections a tab's page has.
//
// A panel's page is not a tab (it is in no tab list, no Ctrl+Tab, no saved session), so ensurePage's long list does not run for it. What follows it is the part of that list that
// makes a page the same page the person would see in a tab, found by asking what each protection hangs on:
//   - hangs on the SESSION (so it is on already, by using the profile's own session): content blocking and its cosmetic rules, HTTPS-first, cookies and sign-ins, spelling, certificates,
//     downloads (main's download owner finds a panel page through `ownerOf`), permission questions (`ownsContents` in main's permission service), site data, proxy and VPN;
//   - hangs on the PAGE and is given here: zoom (isolated mode, the glide, the site's remembered zoom), the website colours (Light / Dark / Always dark), the pop-up gate and the
//     pop-up window rule, links (same site stays, another site is a tab), non-web links (the "open in app" question), the right-click menu, the browser's keys, WebRTC's address policy.
// Everything arrives through `ctx`, main's own closures, so this file holds no second copy of any of them.
const {createSidePanelSites}=require('./side-panel-sites.cjs');
const policy=require('./window-open-policy.cjs');
const runtime=require('./runtime.cjs');
const {siteOf}=require('./passwords/origin-match.cjs');

const webURL=value=>{if(typeof value!=='string'||value.length>8192)return null;try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};

function createWindowSidePanelSites(ctx){
 const hostOf=()=>host;
 const stays=(from,to)=>runtime.staysInPanel(from,to,hostname=>{try{return siteOf(hostname);}catch{return null;}});
 let host=null;
 /** What a panel page does that a tab's page does, in the tab's own order. */
 function attachPage(wc,{site,rec}){
  const profileId=ctx.profileId();
  try{wc.setZoomMode('isolated');}catch{}
  try{ctx.ensureLimits(wc);ctx.zoomGlide.watch(wc);}catch{}
  try{wc.setWebRTCIPHandlingPolicy(ctx.webRtcPolicy(wc.session));}catch{}
  try{ctx.siteAppearance.attach(wc,{id:'side-panel-'+site.id,browserProfileId:profileId,privacy:undefined});}catch{}
  try{ctx.popupGate.attach(wc);}catch{}
  /* the site's remembered zoom (the profile's per-site zoom the tabs share) */
  wc.on('dom-ready',()=>{try{const zoom=ctx.zoomFor(profileId,wc.getURL());if(zoom&&!wc.isDestroyed())ctx.setPageZoom(wc,zoom);}catch{}});
  /* a panel is at home in a narrow column: thin scrollbars have no end buttons to be cut by the rounded corner (Peek does the same) */
  wc.on('dom-ready',()=>{if(wc.isDestroyed())return;wc.insertCSS('html{scrollbar-width:thin}',{cssOrigin:'user'}).catch(()=>{});});
  wc.on('update-target-url',(_event,url)=>{rec.hoverUrl=url;});
  /* Links. The same site stays; any other site is a normal tab and the panel stays. A pop-up window a site needs for signing in opens as it does from a tab. */
  /* a tab this page opens is the panel's doing, not a switch the person made (the close-on-switch setting leaves the panel open for it) */
  const openTab=(url,background=false)=>{if(webURL(url))hostOf().fromPanel(()=>void ctx.openTab(url,{background}));};
  wc.setWindowOpenHandler(details=>{
   if(ctx.closing())return {action:'deny'};
   const url=webURL(details.url);
   if(!url){if(!/^https?:/i.test(details.url||'')&&ctx.popupGate.recent(wc))void ctx.externalProtocol(details.url,wc);return {action:'deny'};}
   if(!ctx.popupGate.allow(wc,details))return {action:'deny'};
   const route=policy.routeWindowOpen(details,{link:!!(rec.hoverUrl&&rec.hoverUrl===details.url&&!details.features),privateTab:false,tor:false,openInFront:true,sameSession:true});
   if(route.route==='deny')return {action:'deny'};
   if(route.route==='window'||route.route==='tab-with-opener'&&details.features){
    /* sign-in and payment windows: a real pop-up window in the panel page's own session, which the page keeps a handle on */
    return {action:'allow',overrideBrowserWindowOptions:{show:process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1',autoHideMenuBar:true,...policy.popupBounds(details.features,ctx.workArea()),webPreferences:{session:wc.session,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,preload:undefined}}};
   }
   if(stays(wc.getURL(),url)){setImmediate(()=>{if(!wc.isDestroyed())wc.loadURL(url).catch(()=>{});});return {action:'deny'};}
   openTab(url,route.background===true);
   return {action:'deny'};
  });
  wc.on('did-create-window',popup=>{try{ctx.trackPopup(popup,wc);}catch{}});
  wc.on('will-navigate',(event,url)=>{
   if(!/^https?:\/\//i.test(url)){event.preventDefault();if(/^file:/i.test(url))return;if(ctx.popupGate.recent(wc))void ctx.externalProtocol(url,wc);return;}
   if(!stays(wc.getURL()||site.url,url)){event.preventDefault();openTab(url);}
  });
  wc.on('will-frame-navigate',event=>{
   if(event.isMainFrame&&!/^https?:\/\//i.test(event.url)){event.preventDefault();if(ctx.popupGate.recent(wc))void ctx.externalProtocol(event.url,wc);}
  });
  /* The right-click menu: the page menu a tab has, for this page and the tab on screen (the way a link preview's is). */
  wc.on('context-menu',(_event,params)=>{try{ctx.showPageContextMenu(wc,params,ctx.activeTabId(),rec.view.getBounds(),true);}catch{/* the menu is an extra */}});
  wc.on('did-start-navigation',event=>{if(event.isMainFrame&&!event.isSameDocument)try{ctx.closePageMenuOf(wc);}catch{}});
  wc.on('destroyed',()=>{try{ctx.closePageMenuOf(wc);}catch{}});
  /* The browser's keys work from the panel too (Cmd+T, Cmd+L, Cmd+,…); the host's own Esc and Cmd+W come first and mark the event handled. */
  wc.on('before-input-event',(event,input)=>{if(event.defaultPrevented)return;try{ctx.shortcut(wc,event,input);}catch{}});
  /* focus tracking the interface uses to know where the keyboard is */
  try{ctx.trackFocus(wc);}catch{}
 }

 host=createSidePanelSites({
  WebContentsView:ctx.WebContentsView,runtime,
  getWindow:ctx.getWindow,pageBounds:ctx.pageBounds,pageRadius:ctx.pageRadius,uiScale:ctx.uiScale,
  /* a private window opens the profile's sites through the command bar (its pages use the window's own private session and are forgotten on close); a Tor window has none */
  sitesOf:profileId=>{const profile=ctx.state().browserProfiles.find(item=>item.id===profileId);if(!profile||profile.tor)return [];return profile.private?ctx.sharedSites():profile.sidePanelSites||[];},
  ephemeral:()=>ctx.isPrivate(),
  profileId:ctx.profileId,
  sessionOf:profileId=>ctx.sessionFor(profileId),
  /* the page's preload knows a panel site's page by this argument (page-input-preload.cjs wraps its Notification so that a click on a notification reaches the panel) */
  webPreferences:(profileId,site)=>{const prefs=ctx.webPreferences(profileId,site);return {...prefs,additionalArguments:[...(prefs.additionalArguments||[]),'--acira-side-panel-site']};},
  /* the window comes forward for a notification's click; a test app (a throwaway profile) also takes the click a script made, because no rig can press a system notification */
  reveal:()=>{try{ctx.reveal?.();}catch{}},testMode:()=>ctx.testMode?.()===true,
  attachPage,
  /* Beta 14: the page's sound reaches the now-playing card: main's media controls follow it like a tab's, by the site's id */
  attachMedia:(id,wc,send,options)=>ctx.attachMedia?.(id,wc,send,options),
  side:ctx.side,dark:ctx.dark,reducedMotion:ctx.reducedMotion,motionSpeed:ctx.motionSpeed,lang:ctx.lang,labels:ctx.labels,
  emit:ctx.emit,relayout:ctx.relayout,raiseAbove:ctx.raiseAbove,available:ctx.available,
  keepMinutes:()=>ctx.state().settings.sidePanelKeepMinutes,
  underPressure:ctx.underPressure,inspect:ctx.inspect,
  focusedContents:ctx.focusedContents,restoreFocus:ctx.restoreFocus,/* the keyboard goes to the site (or the card) through main's focus gate: a panel whose veil lifts while Acira is in the background records it for the window's activation instead of bringing Acira forward */
  focusPage:wc=>{try{if(typeof ctx.focus==='function')ctx.focus(wc);else wc.focus();}catch{}},
  setWidth:(id,width)=>ctx.dispatch({type:'sidepanel.width',id,width}),
  setDocked:(id,docked)=>ctx.dispatch({type:'sidepanel.dock',id,docked}),
  noteIcon:(id,wc,icons)=>ctx.noteIcon(id,wc,icons),
  /* Right click on an icon: Acira's own page menu (the one the page right-click uses), with Remove (and Reset width while the site has its own). */
  showMenu:({site,anchor})=>{
   const items=[{id:'remove',label:ctx.tm('sidepanel.remove'),enabled:true}];
   if(site.width)items.push({id:'reset-width',label:ctx.tm('sidepanel.resetWidth'),enabled:true});
   const run=item=>{if(item==='remove')ctx.dispatch({type:'sidepanel.unpin',id:site.id});else if(item==='reset-width')ctx.dispatch({type:'sidepanel.width',id:site.id,width:null});};
   ctx.showIconMenu({items,run,anchor});
  },
  openAsTab:({url,profileId})=>hostOf().fromPanel(()=>ctx.openAsTab(url,profileId)),
  /* 14.3: Close side panel when switching tabs or Favorites (Settings, off by default): the window's active tab, and the choice */
  activeTabId:()=>ctx.activeTabId(),closeOnSwitch:()=>ctx.state().settings.sidePanelCloseOnSwitch===true,
  /* Beta 14: one use of the side panel (a site opened or switched to), never which site. The name is a pending-owner count in earlier work (usage-producers.cjs); until that is merged the metrics service ignores it. */
  noteOpen:()=>{try{ctx.noteUse?.('sidePanelOpens');}catch{}},
  warn:(...args)=>console.warn(...args)
 });
 /** The download owner and the permission service find a panel page through these (main's resolvers ask every window). */
 host.ownerOf=wc=>host.owns(wc)?{profileId:ctx.profileId()}:null;
 return host;
}
module.exports={createWindowSidePanelSites,webURL};
