'use strict';
// chrome_url_overrides.newtab, as an explicit choice: Settings › Extensions › "Use as New Tab page" (off by default, one extension per profile).
// The tab stays Acira's New Tab (acira://new) in the tab model, so the address bar stays empty and focused as on every New Tab; the extension's
// page is shown over the page area in a native view of the profile's session while such a tab is active. Private and Tor windows, split view,
// first-run setup and the window reveal always keep Acira's own page. A link the page follows opens in that tab (the tab becomes the website);
// a new-window link opens a new tab. Each New Tab gets a fresh copy of the page, as in Chrome.

/** Whether the override shows now, and which page. Pure: every input is passed in. */
function overrideFor({tab,privateMode=false,torMode=false,split=false,visible=true,setup=false,choice=null}){
 if(privateMode||torMode||split||!visible||setup||!choice||!tab)return null;
 if(tab.contentKind==='web'||tab.error||tab.url!=='acira://new'||tab.privacy||tab.private)return null;
 if(typeof choice.url!=='string'||!/^chrome-extension:\/\/[a-p]{32}\//.test(choice.url))return null;
 return {tabId:tab.id,profileId:tab.browserProfileId,extensionId:choice.extensionId,url:choice.url};
}

function createNewTabOverride({WebContentsView,getWindow,pageBounds,radius=()=>8,current,sessionFor,navigateTab,openTab,raiseAbove=null}){
 let shown=null;// {view, key, tabId, url}
 const external=target=>{try{const u=new URL(target);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
 function hide(){if(shown)shown.view.setVisible(false);}
 function dispose(){if(!shown)return;const win=getWindow(),view=shown.view;shown=null;try{if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}}
 function raise(view){
  const win=getWindow();if(!win||win.isDestroyed())return;const children=win.contentView.children,others=children.filter(v=>v!==view);
  const above=raiseAbove?raiseAbove(others):undefined,at=typeof above==='number'&&above>=0&&above<=others.length?above:others.length;
  if(children.indexOf(view)===at)return;if(at===others.length)win.contentView.addChildView(view);else win.contentView.addChildView(view,at);
 }
 function sync(){
  // pageBounds() only while the override is wanted: main.cjs's version trims for a docked side panel, and that call remembers the page card the panel sits beside, which a page view (a split) must keep.
  const want=current(),win=getWindow();
  if(!want||!win||win.isDestroyed()){hide();return null;}
  const bounds=pageBounds();
  if(!bounds){hide();return null;}
  const key=want.profileId+'|'+want.extensionId;
  if(shown&&shown.key!==key)dispose();
  if(!shown){
   const session=sessionFor(want.profileId);if(!session){hide();return null;}
   const view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false}});
   const origin=want.url.slice(0,want.url.indexOf('/','chrome-extension://'.length)+1);
   shown={view,key,tabId:null,url:null};const mine=shown;
   view.webContents.setWindowOpenHandler(details=>{if(external(details.url))void openTab(details.url);return {action:'deny'};});
   view.webContents.on('will-navigate',(event,target)=>{const to=typeof target==='string'?target:event?.url;if(String(to||'').startsWith(origin))return;event.preventDefault?.();if(external(to)&&mine.tabId)void navigateTab(mine.tabId,to);});
   view.webContents.on('will-redirect',(event,target)=>{const to=typeof target==='string'?target:event?.url;if(String(to||'').startsWith(origin))return;event.preventDefault?.();if(external(to)&&mine.tabId)void navigateTab(mine.tabId,to);});
  }
  raise(shown.view);
  shown.view.setBounds(bounds);shown.view.setBorderRadius?.(Math.round(radius()));
  if(shown.tabId!==want.tabId||shown.url!==want.url){shown.tabId=want.tabId;shown.url=want.url;shown.view.webContents.loadURL(want.url).catch(()=>{});}
  shown.view.setVisible(true);
  return {tabId:want.tabId,url:want.url};
 }
 return {sync,hide,dispose,current:()=>shown?{tabId:shown.tabId,url:shown.url,webContents:shown.view.webContents}:null};
}

/** Does an extension's request for a tab ask for the New Tab page? Chrome: no address at all (chrome.tabs.create({})) or one of the New Tab addresses. An explicit about:blank is a blank page, not this. */
function asksForNewTab(address){
 if(address===undefined||address===null)return true;
 const text=String(address).trim();
 return text===''||/^(?:chrome:\/\/(?:newtab|new-tab-page)\/?|about:newtab|chrome-search:\/\/local-ntp\/local-ntp\.html)$/i.test(text);
}

/** The page area the override view fills: what the page view of an ordinary tab gets (main.cjs trims page views for a docked extension side panel),
 * so the panel keeps its width instead of lying under the extension's page. `trim(bounds, page)` and `clamp(bounds)` are main.cjs's own. Pure. */
function overrideBounds({layout,authActive=false,trim=bounds=>bounds,clamp=bounds=>bounds}){
 if(!layout||layout.visible===false||authActive)return null;
 const page=layout.pageBounds;if(!page)return null;
 return clamp(trim(page,page));
}

module.exports={createNewTabOverride,overrideFor,asksForNewTab,overrideBounds};
