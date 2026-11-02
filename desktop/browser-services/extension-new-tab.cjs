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
  const want=current(),win=getWindow(),bounds=pageBounds();
  if(!want||!win||win.isDestroyed()||!bounds){hide();return null;}
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

module.exports={createNewTabOverride,overrideFor};
