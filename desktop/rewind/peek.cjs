'use strict';
// Peek: a link opens in a floating preview over the current page, without becoming a tab. Behaviour follows Zen's
// Glance (zen-browser/desktop@2ad19452 src/zen/glance, MPL-2.0; behaviour studied, no code copied): one-modifier
// click (Alt like Zen, or Shift like Arc), a drag is not a click, Esc or a click outside closes, it closes with its tab,
// and it can be expanded into a tab or a split. One peek per window: a native WebContentsView in the source tab's own
// profile session (so blocking, cookies and private ephemerality are the tab's), over a transparent frame view that
// dims the page, draws the card and its header (back, reload, title and address, Open in split view, Open as tab,
// Close), and grows the card from the link. Popups and downloads never escape a peek; permission prompts are refused
// (the page is not a tab yet), so "Open as tab" is the way to grant them.
const path=require('node:path');
const FRAME=path.join(__dirname,'peek-frame.html'),FRAME_PRELOAD=path.join(__dirname,'peek-frame-preload.cjs');
const WIDTH=.78,HEIGHT=.86,HEADER=44,RADIUS=8;
// The frame grows the card on a spring (popover.grow, bible §4 Morph) and tells main when it is formed; the page view
// appears on the formed card. These bound how long the native views wait for the frame if it is slow or gone.
const REVEAL_MS=700,EXIT_MS=460;
// The page view also waits for the page's first document (dom-ready), so the card shows its dot-matrix loader instead of a blank
// white page; a slow page shows itself after LOAD_CAP_MS anyway. COPIED_MS is how long "Link copied" stays.
const LOAD_CAP_MS=1600,COPIED_MS=1600;
// The most a preview's icon may weigh as a data URL on the state event (a tab's icons are cut down to a few KB by tab-icons).
const MAX_ICON=65536;
const darkChrome=()=>{try{return Boolean(require('electron').nativeTheme?.shouldUseDarkColors);}catch{return true;}};

/** Everything the frame says in words comes from the catalogs (en.json `peek.*`), in the language of the app. */
const FALLBACK={'peek.frameLabel':'Link preview','peek.openAsTab':'Open as tab','peek.openInSplit':'Open in split view','peek.downloadNotice':'Downloads start from a tab. Open as tab to download.','app.close':'Close','app.back':'Back','error.reload':'Reload','app.stopLoading':'Stop loading','addressfield.notSecure':'Not secure','bookmarkmenu.copyLink':'Copy link','browsermenu.linkCopied':'Link copied','error.tryAgain':'Try again','peek.download':'Download','peek.downloadTitle':'This link downloads a file','nf.siteCap':'This site','nf.unreachableTitle':'This site can’t be reached','nf.notWorking':'This page isn’t working','nf.certTitle':'Your connection is not private','nf.offlineTitle':'No internet','nf.offlineMsg':'Acira can’t reach the network.','nf.dnsMsg':'{host}’s server IP address could not be found.','nf.refused':'{host} refused to connect.','nf.timedOut':'{host} took too long to respond.','nf.reset':'The connection was reset.','nf.closed':'{host} unexpectedly closed the connection.','nf.addrUnreachable':'{host} is unreachable.','nf.blockedTitle':'{host} is blocked','nf.blockedExt':'This page was blocked by an extension or content blocker.','nf.fallbackMsg':'{host} couldn’t be opened.'};
function say(id,params){try{return require('../tm.cjs').tm(id,params)||fill(FALLBACK[id],params);}catch{return fill(FALLBACK[id]||id,params);}}
const fill=(text,params)=>String(text??'').replace(/\{(\w+)\}/g,(all,key)=>params&&key in params?String(params[key]):all);
const labels=()=>({frameLabel:say('peek.frameLabel'),openAsTab:say('peek.openAsTab'),openInSplit:say('peek.openInSplit'),close:say('app.close'),back:say('app.back'),reload:say('error.reload'),stop:say('app.stopLoading'),notSecure:say('addressfield.notSecure'),copy:say('bookmarkmenu.copyLink'),copied:say('browsermenu.linkCopied'),tryAgain:say('error.tryAgain'),download:say('peek.download'),downloadTitle:say('peek.downloadTitle')});
/** A link that failed to load, in the words of the tab's error page (ui/navigationFailure.ts): a title and the reason, with Chromium's code. Pure. */
function peekFailure(code,url){
 let host='';try{host=new URL(url).host;}catch{}const site=host||say('nf.siteCap'),name=String(code||'').match(/ERR_[A-Z0-9_]+/)?.[0]||'ERR_FAILED';
 const [title,message]=/NAME_NOT_RESOLVED|DNS_|NAME_RESOLUTION_FAILED/.test(name)?['nf.unreachableTitle',say('nf.dnsMsg',{host:site})]:/INTERNET_DISCONNECTED/.test(name)?['nf.offlineTitle',say('nf.offlineMsg')]:/CONNECTION_REFUSED/.test(name)?['nf.unreachableTitle',say('nf.refused',{host:site})]:/TIMED_OUT/.test(name)?['nf.unreachableTitle',say('nf.timedOut',{host:site})]:/ADDRESS_UNREACHABLE|ADDRESS_INVALID/.test(name)?['nf.unreachableTitle',say('nf.addrUnreachable',{host:site})]:/CONNECTION_RESET/.test(name)?['nf.unreachableTitle',say('nf.reset')]:/CONNECTION_CLOSED|CONNECTION_ABORTED|EMPTY_RESPONSE/.test(name)?['nf.unreachableTitle',say('nf.closed',{host:site})]:/CERT_|SSL_/.test(name)?['nf.certTitle',say('nf.fallbackMsg',{host:site})]:/BLOCKED_BY_CLIENT/.test(name)?['nf.blockedTitle',say('nf.blockedExt')]:['nf.notWorking',say('nf.fallbackMsg',{host:site})];
 return {title:say(title,{host:site}),message,code:name,url};
}
const keys=()=>{const mod=process.platform==='darwin'?'Cmd':'Ctrl';return {close:'Esc',tab:`${mod}+Enter`,split:`${mod}+Shift+Enter`,back:'Alt+Left',reload:`${mod}+R`};};

/** The card centred in the page area: a 44px header (drawn by the frame) over the page view, which sits 1px inside the
 * card on its sides and bottom so the card's hairline shows around it. Pure; coordinates are the window's. */
function peekGeometry(page){
 if(!page||!(page.width>0)||!(page.height>0))return null;
 const width=Math.max(320,Math.min(page.width-32,Math.round(page.width*WIDTH))),height=Math.max(240,Math.round(page.height*HEIGHT));
 const x=Math.round(page.x+(page.width-width)/2),y=Math.round(page.y+(page.height-height)/2);
 return {frame:{x:page.x,y:page.y,width:page.width,height:page.height},card:{x:x-page.x,y:y-page.y,width,height},header:HEADER,view:{x:x+1,y:y+HEADER,width:width-2,height:height-HEADER-1}};
}
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
/** Where on the card a window point is (the preview grows from the clicked link), clamped to the card. Pure. */
function cardOrigin(geometry,origin){
 if(!geometry||!origin||!Number.isFinite(origin.x)||!Number.isFinite(origin.y))return null;
 const card=geometry.card,x=origin.x-geometry.frame.x-card.x,y=origin.y-geometry.frame.y-card.y;
 return {x:Math.round(clamp(x,0,card.width)),y:Math.round(clamp(y,0,card.height))};
}
/** The link's box on the card: the rectangle the card grows from and shrinks back to. A link beside the card grows it from
 * the nearest edge, so the preview never starts from where there is no card. Without a link box it is the clicked point. Pure. */
function cardLink(geometry,origin){
 if(!geometry||!origin||!Number.isFinite(origin.x)||!Number.isFinite(origin.y))return null;
 const card=geometry.card,r=origin.rect,box=r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0?r:{x:origin.x,y:origin.y,width:1,height:1};
 const left=box.x-geometry.frame.x-card.x,top=box.y-geometry.frame.y-card.y;
 const x0=clamp(left,0,card.width-1),y0=clamp(top,0,card.height-1),x1=clamp(left+box.width,x0+1,card.width),y1=clamp(top+box.height,y0+1,card.height);
 return {x:Math.round(x0),y:Math.round(y0),width:Math.max(1,Math.round(x1-x0)),height:Math.max(1,Math.round(y1-y0))};
}
const webURL=value=>{if(typeof value!=='string'||value.length>4096)return null;try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};

/** What a key means while a peek is open, from either of its views. Esc closes, Ctrl+Enter keeps it as a tab (Ctrl+Shift+Enter
 * beside this page), Ctrl+W closes, Alt+Left goes back, F5 and Ctrl+R reload. Pure. */
function peekKey(input,platform=process.platform){
 if(!input||input.type!=='keyDown'||input.isAutoRepeat)return null;
 const mod=platform==='darwin'?input.meta:input.control,plain=!input.control&&!input.alt&&!input.meta&&!input.shift,key=String(input.key||'');
 if(key==='Escape'&&plain)return 'close';
 if(key==='Enter'&&mod&&!input.alt)return input.shift?'split':'tab';
 if((key==='w'||key==='W')&&mod&&!input.alt&&!input.shift)return 'close';
 if(key==='ArrowLeft'&&input.alt&&!mod&&!input.shift)return 'back';
 if(key==='F5'&&!input.alt&&!input.control&&!input.meta)return 'reload';
 if((key==='r'||key==='R')&&mod&&!input.alt&&!input.shift)return 'reload';
 return null;
}

function createPeek({WebContentsView,getWindow,getState,dispatch,emit=()=>{},download=()=>{},pageBounds,configure=()=>{},pagePreload,partitionOf,reducedMotion=()=>false,motionSpeed=()=>'premium',accent=()=>undefined,tabsWebPreferences={},focusSource=()=>{},resolveIcon=()=>{},storedIcon=()=>'',contextMenu=()=>{},copyText=text=>require('electron').clipboard.writeText(text)}){
 let current=null;const adopted=new Map();
 /** The icon this computer already keeps for the link's site (the favicon store), so a site seen before shows its icon at once; '' when there is none. */
 const stored=(profileId,url)=>{try{const icon=storedIcon(profileId,url);return typeof icon==='string'&&icon.length<=MAX_ICON?icon:'';}catch{return '';}};
 const accentOf=()=>{const value=accent();return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:'#3b6eea';};
 const frameState=p=>({geometry:p.geometry,title:p.wc.isDestroyed()?'':p.wc.getTitle(),url:p.wc.isDestroyed()?p.url:p.wc.getURL(),loading:!p.wc.isDestroyed()&&p.wc.isLoading(),canGoBack:!p.wc.isDestroyed()&&p.wc.navigationHistory.canGoBack(),notice:p.notice||'',link:cardLink(p.geometry,p.origin),speed:reducedMotion()?'off':motionSpeed(),reducedMotion:reducedMotion(),revealed:Boolean(p.revealed),failure:p.failure||null,download:p.download?{name:p.download.name,url:p.download.url}:null,copied:Boolean(p.copiedAt&&Date.now()-p.copiedAt<COPIED_MS),dark:darkChrome(),accent:accentOf(),labels:labels(),keys:keys()});
 const publish=()=>{const p=current;emit({type:'peek-state',peek:p?{sourceTabId:p.sourceTabId,url:p.wc.isDestroyed()?p.url:p.wc.getURL()||p.url,title:p.wc.isDestroyed()?'':p.wc.getTitle(),loading:!p.wc.isDestroyed()&&p.wc.isLoading(),canGoBack:!p.wc.isDestroyed()&&p.wc.navigationHistory.canGoBack(),favicon:p.favicon||'',bounds:p.geometry?.view||null}:null});if(p&&!p.frame.webContents.isDestroyed())p.frame.webContents.send('acira:peek-frame-state',frameState(p));};
 /** The page view shows once the frame's card has formed (or the frame took too long). */
 function reveal(p){clearTimeout(p.revealTimer);clearTimeout(p.capTimer);if(current!==p||p.wc.isDestroyed()||p.revealed)return;p.revealed=true;p.view.setVisible?.(!p.failure&&!p.download);publish();}
 /** Formed (the card is open, or the frame is slow) and painted (the page has a document, or it is slow): then the page shows. */
 function maybeReveal(p){if(current!==p||!p.formed)return;if(p.painted){reveal(p);return;}if(!p.capTimer)p.capTimer=setTimeout(()=>reveal(p),LOAD_CAP_MS);}
 function place(){
  const p=current,win=getWindow();if(!p||!win||win.isDestroyed())return;
  const geometry=peekGeometry(pageBounds());if(!geometry){close();return;}
  p.geometry=geometry;p.frame.setBounds(geometry.frame);p.view.setBounds(geometry.view);publish();
 }
 /** Keep both views above the page views (layout re-adds those) and follow the page area. */
 function relayout(){if(!current)return;const win=getWindow();if(!win||win.isDestroyed())return;const visible=pageBounds()&&getState().tabs.some(t=>t.id===current.sourceTabId);if(!visible){close();return;}raise();place();}
 function raise(){const p=current,win=getWindow();if(!p||!win)return;const children=win.contentView.children;if(children.at(-1)===p.view&&children.at(-2)===p.frame)return;win.contentView.addChildView(p.frame);win.contentView.addChildView(p.view);}
 /** One meaning for a key or a header button, whichever view it came from. */
 function act(p,action){
  if(current!==p||p.wc.isDestroyed())return;
  if(action==='close')close();else if(action==='tab'&&p.download){/* a file link has no page to keep: the tab opens the link itself */const {url}=p.download;close();dispatch({type:'tab.new',url,browserProfileId:p.profileId,afterId:p.sourceTabId});}
  else if(action==='tab')promote('tab');else if(action==='split')promote('split');
  else if(action==='back'){if(p.wc.navigationHistory.canGoBack())p.wc.navigationHistory.goBack();}
  else if(action==='reload')p.wc.reload();else if(action==='stop')p.wc.stop();
  else if(action==='retry'){if(p.failure)p.wc.loadURL(p.failure.url||p.url).catch(()=>{});}
  else if(action==='download'){if(p.download){const {url}=p.download,source=p.sourceTabId;close();download(source,url);}}
  else if(action==='copy'){try{copyText(webURL(p.wc.getURL())||p.url);}catch{return;}p.copiedAt=Date.now();const copied=say('browsermenu.linkCopied');p.notice=copied;publish();clearTimeout(p.copiedTimer);p.copiedTimer=setTimeout(()=>{if(current===p&&p.notice===copied){p.notice='';publish();}},COPIED_MS);}
 }
 function open({url,sourceTabId,origin=null}){
  const target=webURL(url),state=getState(),source=state.tabs.find(t=>t.id===sourceTabId);const win=getWindow();
  if(source?.privacy)return {ok:false,code:'private'};
  if(!target||!source||!win||win.isDestroyed())return {ok:false,code:'invalid'};
  if(current&&current.sourceTabId===sourceTabId){current.wc.loadURL(target).catch(()=>{});return {ok:true,replaced:true};}
  if(current)close();
  const partition=partitionOf(source.browserProfileId);if(!partition)return {ok:false,code:'invalid'};
  const frame=new WebContentsView({webPreferences:{preload:FRAME_PRELOAD,contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'acira-peek-frame'}});
  frame.setBackgroundColor('#00000000');
  const view=new WebContentsView({webPreferences:{...(typeof tabsWebPreferences==='function'?tabsWebPreferences():tabsWebPreferences),partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,preload:pagePreload,disableHtmlFullscreenWindowResize:true}});
  view.setBorderRadius?.(RADIUS);
  const wc=view.webContents,p={frame,view,wc,url:target,sourceTabId,profileId:source.browserProfileId,geometry:null,notice:'',origin,favicon:stored(source.browserProfileId,target),listeners:[]};current=p;
  const on=(emitter,name,fn)=>{emitter.on(name,fn);p.listeners.push(()=>emitter.removeListener(name,fn));};
  configure(wc.session,source.browserProfileId);
  wc.setWebRTCIPHandlingPolicy?.('default_public_interface_only');
  // A link that asks for a new tab stays in the peek; real popups are refused (nothing escapes).
  // Thin scrollbars have no end buttons, so nothing is cut at the rounded corner (QA M33). Kept for removal on promotion.
  const thin=()=>{if(wc.isDestroyed())return;wc.insertCSS('html{scrollbar-width:thin}',{cssOrigin:'user'}).then(key=>{if(current===p&&!wc.isDestroyed())p.thinKey=key;else if(!wc.isDestroyed())wc.removeInsertedCSS(key).catch(()=>{});},()=>{});};
  on(wc,'dom-ready',thin);
  for(const name of ['dom-ready','did-fail-load'])on(wc,name,()=>{p.painted=true;maybeReveal(p);});
  // A link that fails shows the card's own error state (the address, the reason, Try again) instead of a blank page, and a link that
  // downloads says so (Download from the source tab, or Open as tab): the page view stays hidden while either shows.
  on(wc,'did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame!==true||code===-3||current!==p)return;p.failure=peekFailure(description,webURL(url)||p.url);p.view.setVisible?.(false);publish();});
  // Try again or a link that works: the card shows its loader until the next document, as on opening.
  on(wc,'did-start-navigation',(event,_url,inPlace,isMainFrame)=>{const main=event?.isMainFrame??isMainFrame,same=event?.isSameDocument??inPlace;if(!main||same||current!==p||!p.failure&&!p.download)return;p.failure=null;p.download=null;p.revealed=false;p.painted=false;clearTimeout(p.capTimer);p.capTimer=null;publish();});
  wc.setWindowOpenHandler(details=>{const next=webURL(details.url);if(next&&['foreground-tab','background-tab','default'].includes(details.disposition)&&details.disposition!=='new-window')setImmediate(()=>{if(current===p&&!wc.isDestroyed())wc.loadURL(next).catch(()=>{});});return {action:'deny'};});
  on(wc.session,'will-download',(event,item,source)=>{if(source!==wc)return;let name='',url='';try{name=item.getFilename();url=item.getURL();}catch{/* a bare item */}item.cancel();if(current!==p)return;p.download={name:String(name||'').slice(0,255),url:webURL(url)||p.url};p.view.setVisible?.(false);publish();});
  // Keys work from the page and from the frame: Esc closes, Ctrl+Enter keeps it as a tab, Ctrl+Shift+Enter beside this page.
  const keyed=(event,input)=>{const action=peekKey(input);if(!action)return;event.preventDefault();act(p,action);};
  on(wc,'before-input-event',keyed);
  // Right-click inside the preview: the same page menu a tab has (links, images, text, back/reload, Inspect), for the preview's profile and the tab it came from.
  on(wc,'context-menu',(_event,params)=>{if(current!==p||wc.isDestroyed()||p.failure||p.download)return;try{contextMenu({wc,params,sourceTabId:p.sourceTabId,bounds:p.view.getBounds()});}catch{/* the menu is an extra: the preview goes on */}});
  // The preview's own site icon, for the marker card beside the source's icon in the sidebar (a favorite's tile, a tab's row). It is picked the way a tab's
  // is (tab-icons: the page's own icon set, the one sharp enough for the card) and cleared when the preview goes to another document.
  on(wc,'did-navigate',()=>{p.iconSequence=(p.iconSequence||0)+1;p.favicon=stored(p.profileId,wc.getURL());});
  on(wc,'page-favicon-updated',(_event,favicons)=>{
   const announced=(Array.isArray(favicons)?favicons:[]).filter(f=>typeof f==='string'&&/^https?:/.test(f)),sequence=p.iconSequence=(p.iconSequence||0)+1;
   try{resolveIcon(wc,{announced,pageUrl:wc.getURL(),current:()=>current===p&&!wc.isDestroyed()&&p.iconSequence===sequence,deliver:found=>{if(current!==p||p.iconSequence!==sequence)return;p.favicon=found&&typeof found.data==='string'&&found.data.length<=MAX_ICON?found.data:'';publish();}});}catch{/* the card keeps the globe */}
  });
  for(const name of ['did-navigate','did-navigate-in-page','page-title-updated','did-start-loading','did-stop-loading'])on(wc,name,()=>{if(current===p)publish();});
  frame.webContents.ipc.on('acira:peek-frame',(_event,command)=>{if(command==='gone'){p.gone?.();return;}if(current!==p)return;if(command==='ready')publish();else if(command==='entered'){p.formed=true;maybeReveal(p);}else act(p,command);});
  frame.webContents.on('before-input-event',keyed);
  win.contentView.addChildView(frame);win.contentView.addChildView(view);
  view.setVisible?.(false);p.revealTimer=setTimeout(()=>{p.formed=true;maybeReveal(p);},reducedMotion()?0:REVEAL_MS);
  frame.webContents.loadFile(FRAME).catch(()=>{});
  place();wc.loadURL(target).catch(()=>{});wc.focus();
  return {ok:true};
 }
 function detach(p){for(const off of p.listeners.splice(0))try{off();}catch{}const win=getWindow();try{win?.contentView.removeChildView(p.frame);}catch{}if(!p.frame.webContents.isDestroyed())p.frame.webContents.close();}
 function close(){const p=current;if(!p)return false;current=null;clearTimeout(p.revealTimer);clearTimeout(p.capTimer);clearTimeout(p.copiedTimer);
  // Keyboard focus goes back to the page the peek came from (it was inside the views being removed).
  const hadFocus=[p.wc,p.frame.webContents].some(wc=>wc&&!wc.isDestroyed?.()&&wc.isFocused?.());
  // The page goes at once; the frame shrinks its card back into the link (exit ~⅔ of enter) and is removed when it says so.
  const frame=p.frame,leaving=!reducedMotion()&&!frame.webContents.isDestroyed();
  if(leaving){for(const off of p.listeners.splice(0))try{off();}catch{}let done=false;p.gone=()=>{if(done)return;done=true;clearTimeout(timer);detach(p);};const timer=setTimeout(p.gone,EXIT_MS);frame.webContents.send('acira:peek-frame-state',{...frameState(p),leaving:true,reducedMotion:false});}
  else detach(p);
  try{getWindow()?.contentView.removeChildView(p.view);}catch{}if(!p.wc.isDestroyed())p.wc.close();if(hadFocus)focusSource(p.sourceTabId);publish();return true;}
 /** "Open as tab" keeps the same WebContents (history, scroll, form state intact); "Open in split" puts it beside the source. */
 function promote(mode){
  const p=current;if(!p||p.wc.isDestroyed())return {ok:false,code:'closed'};
  const url=webURL(p.wc.getURL())||p.url,title=p.wc.getTitle();
  current=null;clearTimeout(p.revealTimer);clearTimeout(p.capTimer);clearTimeout(p.copiedTimer);detach(p);if(p.thinKey)p.wc.removeInsertedCSS(p.thinKey).catch(()=>{});p.view.setVisible?.(true);p.wc.setWindowOpenHandler(()=>({action:'deny'}));p.view.setBorderRadius?.(0);
  const before=new Set(getState().tabs.map(t=>t.id));
  // ensurePage takes this view instead of creating one; the reducer only learns the address.
  const claim={view:p.view,url};adopted.set('next',claim);
  dispatch({type:'tab.new',url,background:mode==='split',browserProfileId:p.profileId,afterId:p.sourceTabId});
  const fresh=getState().tabs.find(t=>!before.has(t.id));
  if(!fresh){adopted.delete('next');try{getWindow()?.contentView.removeChildView(p.view);}catch{}p.wc.close();publish();return {ok:false,code:'failed'};}
  if(adopted.get('next')===claim){adopted.delete('next');adopted.set(fresh.id,claim);}
  if(title)dispatch({type:'tab.update',id:fresh.id,patch:{title}});
  if(mode==='split'){const split=getState().windowUi?.split;if(split?.tabIds.includes(p.sourceTabId)&&split.tabIds.length<4)dispatch({type:'split.add',tabId:fresh.id});else dispatch({type:'split.open',tabIds:[p.sourceTabId,fresh.id]});
   // The peeked page is the one being read: it becomes the current pane, so the toolbar, Ctrl+W and Close tab all mean it (founder bug 27 Oct:
   // it stayed in the background and closing "it" closed the page it came from).
   if(getState().windowUi?.split?.tabIds.includes(fresh.id))dispatch({type:'tab.select',id:fresh.id});}
  publish();
  // The keyboard stays with the page (the header button that promoted it is gone with the frame).
  if(!p.wc.isDestroyed())p.wc.focus();
  // A claim nobody took (e.g. the page area is hidden) must not leak the view.
  setTimeout(()=>{const left=adopted.get(fresh.id);if(left===claim){adopted.delete(fresh.id);try{getWindow()?.contentView.removeChildView(p.view);}catch{}if(!p.wc.isDestroyed())p.wc.close();}},10000);
  return {ok:true,tabId:fresh.id};
 }
 /** Called by ensurePage: the peek's own view when this tab was just promoted from it. */
 function adopt(tabId){const claim=adopted.get(tabId)||adopted.get('next');if(!claim)return null;adopted.delete(tabId);if(adopted.get('next')===claim)adopted.delete('next');return claim.view.webContents.isDestroyed()?null:claim.view;}
 /** After every committed action: a peek belongs to its tab and closes when that tab is closed or left. */
 function onState(state){if(current&&state.activeTabId!==current.sourceTabId)close();}
 /** Alt+click, Shift+click or a hold inside a peek replaces it; from a tab it opens one. */
 function fromPage(sender,url,ownerTabId,origin=null){if(current&&sender===current.wc){const target=webURL(url);if(target)current.wc.loadURL(target).catch(()=>{});return true;}if(ownerTabId)return open({url,sourceTabId:ownerTabId,origin}).ok;return false;}
 function handle(request){
  if(!request||typeof request!=='object'||typeof request.type!=='string')throw new Error('Invalid peek request.');
  const allowed={'peek.open':['url','tabId'],'peek.close':[],'peek.promote':[],'peek.split':[],'peek.state':[]}[request.type];
  if(!allowed)throw new Error('Unknown peek request.');for(const key of Object.keys(request))if(key!=='type'&&!allowed.includes(key))throw new Error('Unexpected peek request field.');
  if(request.type==='peek.open'){const state=getState();return open({url:request.url,sourceTabId:typeof request.tabId==='string'?request.tabId:state.activeTabId});}
  if(request.type==='peek.close')return {ok:close()};
  if(request.type==='peek.promote')return promote('tab');
  if(request.type==='peek.split')return promote('split');
  const p=current;return {ok:true,peek:p?{sourceTabId:p.sourceTabId,url:p.wc.getURL()||p.url,title:p.wc.getTitle(),loading:p.wc.isLoading(),favicon:p.favicon||'',bounds:p.geometry?.view||null}:null};
 }
 /** The tab a preview page came from, when `wc` is the open preview's own page; null for any other contents (the context menu and the downloads act for that tab). */
 function sourceOf(wc){return current&&current.wc===wc&&!wc.isDestroyed()?current.sourceTabId:null;}
 /** The preview's own page while it holds the screen (shown, no error or download card): where the keyboard goes back to when a menu or popup over it closes. */
 function focusTarget(){const p=current;return p&&p.revealed&&!p.failure&&!p.download&&!p.wc.isDestroyed()?p.wc:null;}
 return {open,close,promote,adopt,relayout,onState,fromPage,handle,sourceOf,focusTarget,get active(){return Boolean(current);},get webContents(){return current?.wc||null;}};
}
module.exports={createPeek,peekGeometry,cardOrigin,cardLink,peekKey,peekFailure,HEADER};
