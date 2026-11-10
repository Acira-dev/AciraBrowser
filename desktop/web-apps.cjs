'use strict';
// Stream G · F52 "Install as app". Installability follows Chromium's rules (re-implemented from
// components/webapps/browser/installable/installable_evaluator.cc, BSD-3, behaviour only): a manifest with a name or
// short_name, a valid same-origin start_url (defaults to the page), an icon of purpose "any" that is >= 144px, "any"
// sized or SVG, and display standalone | fullscreen | minimal-ui | window-controls-overlay | tabbed. Every other https
// site can still be installed as a shortcut app (page title, favicon, origin scope).
// Installed apps run in their profile's session. A Start-menu and a desktop shortcut start Acira with
// `--acira-app=<id> <start url>`; main (cold start and second instance) opens that app's own window instead of a tab.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,shell,nativeImage}=require('electron');
const {deviceSafe}=require('./download-preferences.cjs'); // Windows device names (Aux, Con, Nul...) cannot name a shortcut file

const DISPLAY=new Set(['standalone','fullscreen','minimal-ui','window-controls-overlay','tabbed']);
const MIN_ICON=144,MAX_MANIFEST=128*1024,MAX_ICON=1024*1024,ICON=256;
const ARG='--acira-app=';
/** The installed app id a launch names (`--acira-app=<20 hex>`), or null. Pure: main checks argv with it before any
 * service exists, and the external-link intake uses it to leave the shortcut's start URL alone. */
const appIdFromArgv=argv=>{const value=Array.isArray(argv)&&argv.find(arg=>typeof arg==='string'&&arg.startsWith(ARG));const id=value?value.slice(ARG.length):'';return /^[0-9a-f]{20}$/.test(id)?id:null;};
const fail=message=>{const error=new Error(message);error.expose=true;throw error;};
const text=(value,max=120)=>typeof value==='string'?value.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):'';
const sameOrigin=(a,b)=>{try{return new URL(a).origin===new URL(b).origin;}catch{return false;}};
const resolve=(value,base)=>{try{return typeof value==='string'&&value?new URL(value,base).href:'';}catch{return '';}};
const color=value=>typeof value==='string'&&/^(#[0-9a-f]{3,8}|rgba?\([^)]{3,40}\)|[a-z]{3,20})$/i.test(value.trim())?value.trim():'';
const largest=sizes=>String(sizes||'').toLowerCase().split(/\s+/).reduce((best,size)=>size==='any'?Infinity:Math.max(best,Number(size.split('x')[0])||0),0);

// Runs in an isolated world so the page cannot hand us a different answer through overridden DOM methods.
const PAGE_FACTS=`(()=>{const link=document.querySelector('link[rel~="manifest"]');
 const icons=[...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')].map(node=>({href:node.href,sizes:node.sizes&&node.sizes.value||'',type:node.type||''}));
 return {manifest:link?link.href:'',credentials:!!link&&link.crossOrigin==='use-credentials',title:document.title,url:location.href,
  theme:(document.querySelector('meta[name="theme-color"]')||{}).content||'',icons};})()`;

function createWebApps({dataDir=app.getPath('userData'),testMode=!!process.env.ACIRA_BROWSER_TEST_DATA,fetchTimeout=8000}={}){
 const store=path.join(dataDir,'web-apps.json'),iconDir=path.join(dataDir,'web-apps');
 const macApps=()=>path.join(testMode?dataDir:path.join(app.getPath('home'),'Applications'),'Acira Apps');
 function removeShortcut(link,id){if(process.platform==='darwin'){require('./browser-services/mac-web-apps.cjs').removeShortcut(macApps(),link,id);return;}try{fs.unlinkSync(link);}catch{}}
 // QA and isolated runs never touch the real Start menu or desktop.
 const shortcutDirs=()=>process.platform!=='win32'?[]:testMode?[path.join(dataDir,'web-app-shortcuts')]:[path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','Acira Apps'),app.getPath('desktop')];
 const read=()=>{try{const value=JSON.parse(fs.readFileSync(store,'utf8'));return Array.isArray(value.apps)?value.apps.filter(item=>item&&typeof item.id==='string'):[];}catch{return [];}};
 const write=apps=>{fs.mkdirSync(dataDir,{recursive:true});const temp=store+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,apps},null,1));fs.renameSync(temp,store);};
 const iconData=item=>{try{const image=nativeImage.createFromPath(item.iconPng);return image.isEmpty()?'':image.resize({width:64,height:64,quality:'best'}).toDataURL();}catch{return '';}};
 const view=item=>({id:item.id,profileId:item.profileId,name:item.name,startUrl:item.startUrl,scope:item.scope,themeColor:item.themeColor,display:item.display,kind:item.kind,installedAt:item.installedAt,shortcuts:(item.shortcuts||[]).length,inStart:process.platform==='win32'&&!testMode&&(item.shortcuts||[]).length>0,...(process.platform==='darwin'&&(item.shortcuts||[]).length?{launcher:'finder'}:{}),icon:iconData(item)});// Test runs keep launchers in the owned profile.

 async function fetchWithin(session,url,options,limit){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),fetchTimeout);
  try{const response=await session.fetch(url,{...options,signal:controller.signal,cache:'force-cache'});if(!response.ok)return null;const bytes=Buffer.from(await response.arrayBuffer());return bytes.length&&bytes.length<=limit?bytes:null;}
  catch{return null;}finally{clearTimeout(timer);}
 }

 /** What installing this page would produce, without side effects. */
 async function inspect(wc){
  if(!wc||wc.isDestroyed())fail('Open a website first.');
  const url=wc.getURL();if(!/^https:\/\//i.test(url)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url))fail('Only secure websites can be installed.');
  const facts=await wc.executeJavaScriptInIsolatedWorld(1999,[{code:PAGE_FACTS}]).catch(()=>null)||{manifest:'',icons:[],title:wc.getTitle(),url,theme:''};
  let manifest=null,manifestUrl='';
  if(facts.manifest&&sameOrigin(facts.manifest,url)||facts.manifest&&/^https:/i.test(facts.manifest)){
   manifestUrl=facts.manifest;const bytes=await fetchWithin(wc.session,manifestUrl,{credentials:facts.credentials?'include':'omit',redirect:'follow'},MAX_MANIFEST);
   try{manifest=bytes?JSON.parse(bytes.toString('utf8')):null;}catch{manifest=null;}
  }
  const base=manifestUrl||url;
  let startUrl=manifest?resolve(manifest.start_url,base):'';if(!startUrl||!sameOrigin(startUrl,url))startUrl=url;
  let scope=manifest?resolve(manifest.scope,base):'';if(!scope||!sameOrigin(scope,startUrl)||!startUrl.startsWith(scope))scope=new URL('.',startUrl).href;
  const id=manifest&&resolve(manifest.id,new URL(startUrl).origin)||startUrl;
  const name=text(manifest&&(manifest.name||manifest.short_name))||text(facts.title)||new URL(url).hostname;
  const display=manifest&&DISPLAY.has(manifest.display)?manifest.display:(manifest&&Array.isArray(manifest.display_override)?manifest.display_override.find(mode=>DISPLAY.has(mode)):'')||'';
  const manifestIcons=manifest&&Array.isArray(manifest.icons)?manifest.icons.filter(icon=>icon&&typeof icon.src==='string'&&(!icon.purpose||String(icon.purpose).split(/\s+/).includes('any'))).map(icon=>({href:resolve(icon.src,base),size:largest(icon.sizes),svg:/svg/i.test(icon.type||'')||/\.svg(\?|$)/i.test(icon.src)})):[];
  const primary=manifestIcons.filter(icon=>icon.href&&(icon.size>=MIN_ICON||icon.svg));
  const installable=!!manifest&&!!name&&!!display&&primary.length>0;
  // Raster icons first (the shortcut needs pixels), biggest that is still sensible; the page's own favicons last.
  const candidates=[...primary.filter(icon=>!icon.svg).sort((a,b)=>Math.abs(a.size-ICON)-Math.abs(b.size-ICON)),...manifestIcons.filter(icon=>!icon.svg&&!primary.includes(icon)),...(facts.icons||[]).map(icon=>({href:icon.href,size:largest(icon.sizes),svg:/svg/i.test(icon.type)||/\.svg(\?|$)/i.test(icon.href)})).filter(icon=>!icon.svg).sort((a,b)=>b.size-a.size)].filter(icon=>icon.href&&/^https?:/i.test(icon.href));
  const appId=crypto.createHash('sha256').update(id).digest('hex').slice(0,20);
  return {id:appId,manifestId:id,kind:installable?'app':'shortcut',installable,name,startUrl,scope,display:display||'browser',themeColor:color(manifest&&manifest.theme_color)||color(facts.theme),
   backgroundColor:color(manifest&&manifest.background_color),manifestUrl,iconUrls:candidates.slice(0,6).map(icon=>icon.href),installed:read().some(item=>item.id===appId)};
 }

 /** The app's icon: the first site icon that loads, else Acira's own. Never throws: with no icon at all the app is installed without one.
  * 13.5: the fallback asked Electron for size 'large', which macOS does not support: the request aborted the whole browser (SIGTRAP) when a site had
  * no usable icon (none, SVG only, or a fetch past the time limit). The Mac asks for 'normal', as browser-icons.cjs does; 'large' stays where it is
  * supported (32 px on Windows, 48 px on Linux). */
 const fallbackIconSize=()=>process.platform==='darwin'?'normal':'large';
 async function pickIcon(session,urls){
  for(const url of urls){try{const bytes=await fetchWithin(session,url,{credentials:'omit',redirect:'follow'},MAX_ICON);if(!bytes)continue;const image=nativeImage.createFromBuffer(bytes);if(!image.isEmpty())return image;}catch{/* an unreadable icon is a miss */}}
  const fallback=await Promise.resolve().then(()=>app.getFileIcon(process.execPath,{size:fallbackIconSize()})).catch(()=>null);
  try{return fallback&&!fallback.isEmpty()?fallback:null;}catch{return null;}
 }
 const pngToIco=png=>{const header=Buffer.alloc(6),entry=Buffer.alloc(16);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);entry.writeUInt8(0,0);entry.writeUInt8(0,1);entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(png.length,8);entry.writeUInt32LE(22,12);return Buffer.concat([header,entry,png]);};
 const fileName=name=>(name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').replace(/[. ]+$/,'').trim()||'Acira app').slice(0,60);
 // Unpacked runs name the main script: getAppPath() is its folder (desktop/), which has no package.json to start from.
 function launchArgs(item){const quoted=value=>'"'+String(value).replace(/"/g,'')+'"';return [app.isPackaged?'':quoted(path.join(__dirname,'main.cjs')),ARG+item.id,quoted(item.startUrl)].filter(Boolean).join(' ');}
 /** The first shortcut name in the folder that nothing uses: "Mail.lnk", then "Mail (Acira).lnk", "Mail (Acira 2).lnk"... A file there already is another app's (two apps called Mail: two accounts, a generic page title) or the person's own: never written over. An earlier install of this same app was removed before this runs. */
 function freeShortcut(dir,name){const base=deviceSafe(fileName(name),'win32');let target=path.join(dir,base+'.lnk');for(let n=0;fs.existsSync(target)&&n<100;n++)target=path.join(dir,base+(n?` (Acira ${n+1})`:' (Acira)')+'.lnk');return target;}
 function writeShortcuts(item){
  if(process.platform==='darwin'){try{return [require('./browser-services/mac-web-apps.cjs').writeShortcut({root:macApps(),item,executable:process.execPath,packaged:app.isPackaged,mainFile:path.join(__dirname,'main.cjs'),testProfile:testMode?dataDir:null})];}catch{fail('The Mac app could not be created. Check that your Applications folder is writable.');}}
  const written=[];for(const dir of shortcutDirs()){try{fs.mkdirSync(dir,{recursive:true});const target=freeShortcut(dir,item.name);
   if(process.platform==='win32'&&shell.writeShortcutLink(target,'create',{target:process.execPath,args:launchArgs(item),description:`${item.name} — Acira app`,icon:item.iconIco,iconIndex:0,appUserModelId:'Acira.WebApp.'+item.id}))written.push(target);}catch{/* a missing folder or policy block leaves that shortcut out */}}
  return written;
 }

 async function install(wc,{profileId,privateMode}){
  if(privateMode)fail('Apps can’t be installed from a private window.');
  if(typeof profileId!=='string'||!profileId)fail('Choose a profile first.');
  const facts=await inspect(wc);
  fs.mkdirSync(iconDir,{recursive:true});
  const image=await pickIcon(wc.session,facts.iconUrls),png=image?image.resize({width:ICON,height:ICON,quality:'best'}).toPNG():null;
  const iconPng=path.join(iconDir,facts.id+'.png'),iconIco=path.join(iconDir,facts.id+'.ico');
  if(png){fs.writeFileSync(iconPng,png);fs.writeFileSync(iconIco,pngToIco(png));}
  const apps=read().filter(item=>item.id!==facts.id);
  const previous=read().filter(item=>item.id===facts.id);if(process.platform!=='darwin')for(const old of previous)for(const link of old.shortcuts||[])removeShortcut(link,old.id);
  const item={id:facts.id,manifestId:facts.manifestId,profileId,name:facts.name,startUrl:facts.startUrl,scope:facts.scope,display:facts.display,kind:facts.kind,themeColor:facts.themeColor,backgroundColor:facts.backgroundColor,iconPng:png?iconPng:'',iconIco:png?iconIco:'',installedAt:new Date().toISOString(),shortcuts:[]};
  item.shortcuts=writeShortcuts(item);apps.push(item);write(apps);
  if(process.platform==='darwin')for(const old of previous)for(const link of old.shortcuts||[])if(!item.shortcuts.includes(link))removeShortcut(link,old.id);
  return view(item);
 }
 function uninstall(id){
  const apps=read(),item=apps.find(entry=>entry.id===id);if(!item)fail('That app is no longer installed.');
  for(const link of item.shortcuts||[])removeShortcut(link,item.id);
  for(const file of [item.iconPng,item.iconIco])if(file)try{fs.unlinkSync(file);}catch{/* best effort */}
  write(apps.filter(entry=>entry.id!==id));return {removed:id};
 }
 /** Startup / second instance: the installed app a launch argument names, if any. */
 function fromArgv(argv=[]){const id=appIdFromArgv(argv);return id?read().find(item=>item.id===id)||null:null;}
 /** What an app window needs: its name, profile, start page, icon and the taskbar identity its shortcut carries. */
 function windowDetails(item){return {id:item.id,name:item.name,profileId:item.profileId,startUrl:item.startUrl,scope:item.scope,iconPng:item.iconPng||'',iconIco:item.iconIco||'',appUserModelId:'Acira.WebApp.'+item.id,relaunchCommand:'"'+process.execPath+'" '+launchArgs(item)};}

 /** Native channel: {type:'webapps.inspect'|'webapps.install', tabId?} · {type:'webapps.list'} · {type:'webapps.uninstall', id}. */
 async function handle(request,context){
  const fields=Object.keys(request).filter(key=>key!=='type');
  const only=allowed=>{if(fields.some(key=>!allowed.includes(key)))fail('Unexpected request field.');};
  const page=()=>{const tabId=request.tabId===undefined?context.activeTabId:request.tabId;if(typeof tabId!=='string')fail('Choose a tab.');return context.page(tabId);};
  switch(request.type){
   case 'webapps.inspect':only(['tabId']);return {webApps:{candidate:await inspect(page())}};
   case 'webapps.install':only(['tabId']);return {webApps:{installed:await install(page(),{profileId:context.profileId,privateMode:context.privateMode}),apps:read().map(view)}};
   case 'webapps.list':only([]);return {webApps:{apps:read().map(view)}};
   case 'webapps.uninstall':only(['id']);if(typeof request.id!=='string'||!/^[0-9a-f]{20}$/.test(request.id))fail('Unknown app.');uninstall(request.id);return {webApps:{apps:read().map(view)}};
   default:fail('Unknown app request.');
  }
 }
 return {inspect,install,uninstall,list:()=>read().map(view),fromArgv,windowDetails,handle,launchArgs,writeShortcuts};
}
module.exports={createWebApps,appIdFromArgv,WEB_APP_ARG:ARG};
