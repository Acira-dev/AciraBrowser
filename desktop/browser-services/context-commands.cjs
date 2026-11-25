'use strict';

// Separator normalization and image-copy behavior adapted from electron-context-menu,
// MIT, Copyright Sindre Sorhus. Full notice: LICENSE.electron-context-menu.txt.
const {cleanLink}=require('./clean-link.cjs');
const {bundledTorSupported}=require('../platform.cjs');
const {t:tr}=require('./tx.cjs');
const {getNativeDocumentIdentity}=require('./native-document-key.cjs');
const FRAME_REVISION=Symbol.for('acira.native.context-menu-child-lifetime-v1');
function childLifetime(wc){
 if(!wc[FRAME_REVISION]){
  const value={token:Object.freeze({}),session:wc.session,closed:false};Object.defineProperty(wc,FRAME_REVISION,{value});
  wc.on('did-start-navigation',(event,_url,_inPlace,isMainFrame)=>{if(!value.closed&&(event?.isMainFrame??isMainFrame)===false)value.token=Object.freeze({});});
  wc.once('destroyed',()=>{value.closed=true;value.token=null;value.session=null;});
 }
 const value=wc[FRAME_REVISION];if(value.closed||value.session!==wc.session||!value.token)throw new Error('The context menu frame is no longer current.');return value.token;
}
const webURL=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
/** An image whose address is its own bytes (data:) or a handle the page made (blob:). It is no address to open in a tab or copy, but Save image as works for it, as in Chrome. */
const inlineImage=value=>{const text=typeof value==='string'?value:'';return text.length>0&&text.length<=64*1024*1024&&(/^data:image\//i.test(text)||/^blob:/i.test(text))?text:null;};
function compact(items){const result=[];for(const item of items){if(!item||item.visible===false||item.type==='separator'&&(!result.length||result.at(-1).type==='separator'))continue;result.push(item);}if(result.at(-1)?.type==='separator')result.pop();return result;}
// A Google search is Chromium's own form (q=…&sourceid=chrome&ie=UTF-8), as from the address bar (src/runtime/searchLanguage.ts asBrowserSearch).
const selectionURL=(text,engine)=>{const url=new URL(({google:'https://www.google.com/search',duckduckgo:'https://duckduckgo.com/',bing:'https://www.bing.com/search'})[engine]||'https://www.google.com/search');url.searchParams.set('q',text);if(url.hostname==='www.google.com'){url.searchParams.set('sourceid','chrome');url.searchParams.set('ie','UTF-8');}return url.href;};

/** Beta 14: the ONE way a feature adds rows to the page right-click menu (Take screenshot, Zap, Search an image, DevTools in the tab): register once from the feature's own
 * module and never edit build() below. A registration is {id, slot, rows, replaces}:
 *  - slot is where the rows sit: 'link' (after the link rows), 'image' (after the image rows), 'media' (after the audio and video rows), 'selection' (after the selected-text rows),
 *    'page' (after Print / Save page / Save as PDF, before the extension rows), 'inspect' (last, just before Inspect). A slot's rows come in registration order.
 *  - rows(ctx) returns an array of rows (or nothing: the feature has no row for this click). It decides from ctx.params (the click: mediaType, srcURL, linkURL, selectionText ...) and
 *    ctx.owner (privateMode, tor, preview ...). ctx.item(id, label, fn, enabled, rest) makes a row whose fn is dropped when the page has moved on since the menu opened (a navigation,
 *    another profile, a replaced session); a row made any other way gets the same guard. ctx.sep is a separator. ctx also carries wc, frame, pageURL, tabId, profileId, tab(url, background),
 *    download(url), command(request) (the browser command channel), notify(text), clipboard, keyFor(commandId) (the live key of a registry command, for a row's `shortcut`), tr, platform.
 *  - replaces: ids of built-in rows this feature takes over (DevTools takes over 'inspect'); they go only when rows() returned something for this click.
 * A row needs a string id and label; a repeated id, a row with neither, or a rows() that throws is skipped, never breaking the menu. Registering an id again replaces its
 * registration. Returns the function that removes it. */
const PAGE_MENU_SLOTS=Object.freeze(['link','image','media','selection','page','inspect']);
const pageMenu=new Map();
function registerPageMenu({id,slot='page',rows,replaces=[]}={}){
 if(typeof id!=='string'||!id||typeof rows!=='function'||!PAGE_MENU_SLOTS.includes(slot))throw new TypeError('registerPageMenu needs an id, a slot ('+PAGE_MENU_SLOTS.join(', ')+') and a rows(ctx) function');
 const entry={id,slot,rows,replaces:(Array.isArray(replaces)?replaces:[replaces]).map(String)};pageMenu.set(id,entry);
 return ()=>{if(pageMenu.get(id)===entry)pageMenu.delete(id);};
}

/** Menu templates as plain rows for Acira's own menu. A submenu (an extension's items) is laid out as a heading row followed by its rows one step in, to three
 * levels; an extension item with a check or radio mark keeps the menu closing on click (rows with checked toggle in place), and an extension icon is a data URL. */
const MAX_EXTENSION_ROWS=24;   // the overlay accepts 48 rows in all (desktop/validation.cjs)
function menuData(template,{keyFor=()=>undefined,platform=process.platform}={}){
 const handlers=new Map(),items=[];let extensionRows=0;
 const add=(item,index,depth)=>{
  if(!item)return;
  if(item.type==='separator'){items.push({type:'separator'});return;}
  const id=String(item.id||'item-'+index).slice(0,200),sub=Array.isArray(item.submenu)?item.submenu:null,own=id.startsWith('ext:');
  if(own&&++extensionRows>MAX_EXTENSION_ROWS)return;
  if(!sub&&typeof item.click==='function')handlers.set(id,item.click);
  const key=typeof item.shortcut==='string'?item.shortcut:KEYED[id]?keyFor(KEYED[id]):EDITING[id]?(platform==='darwin'?'⌘':'Ctrl+')+EDITING[id]:undefined;
  items.push({id,label:String(item.label||'').replaceAll('&&','&').slice(0,200),enabled:item.enabled!==false&&!(sub&&!own),
   ...(!own&&item.type==='checkbox'?{checked:!!item.checked}:{}),
   ...(own&&(item.type==='checkbox'||item.type==='radio')?{mark:item.checked?(item.type==='radio'?'dot':'check'):'none'}:{}),
   ...(typeof key==='string'?{shortcut:key.slice(0,40)}:{}),
   ...(!own&&typeof item.detail==='string'&&item.detail?{detail:item.detail.slice(0,160)}:{}),
   ...(typeof item.iconURL==='string'&&item.iconURL.startsWith('data:image/')&&item.iconURL.length<64*1024?{icon:item.iconURL}:{}),
   ...(depth?{depth}:{}),...(sub||(!own&&item.header===true)?{header:true}:{})});
  if(sub)sub.slice(0,200).forEach((child,at)=>add(child,index+'.'+at,Math.min(depth+1,3)));
 };
 template.forEach((item,index)=>add(item,String(index),0));
 return {items,run:id=>{const click=handlers.get(id);return click?click():undefined;}};
}

/** 14.1 (a Discord ask): selected text that is a web address offers "Go to <address>" instead of "Search for …", Chromium's rule
 * (render_view_context_menu.cc AppendSearchProvider): the selection, its whitespace collapsed, goes through the address bar's own classifier
 * (`classify`, main's resolveNavigation: the same text typed and Enter); a search keeps the search row; an address with a web scheme is "Go to",
 * opened in a new foreground tab like the search; the clicked link's own address adds nothing (the link rows already open it).
 * Returns {url, httpsFirst} for "Go to", null for the search row, false for no row at all (the link's own address). Anything the classifier
 * refuses (javascript:, file:, data:, chrome:, acira:, an address with a user name and password) or cannot classify is never "Go to":
 * it keeps today's search row (Chromium shows nothing there; dropping the search would take a row away). */
function selectionAddress(classify,wc,selection,owner,link){
 if(typeof classify!=='function')return null;
 const text=selection.replace(/\s+/g,' ').trim();if(!text||text.length>2048)return null;
 let target;try{target=classify(wc,text,owner);}catch{return null;}
 if(!target||target.error||target.contentKind!=='web'||typeof target.query==='string')return null;
 const url=webURL(target.url);if(!url)return null;
 if(link&&url===link)return false;
 return {url,httpsFirst:target.httpsFirst===true};
}

/** Capture actual tab/profile/frame at invocation. No renderer-supplied privileged target. */
// Rows that run a registry command show that command's live key (keyFor reads desktop/shortcut-registry.cjs); editing rows show the system keys.
const KEYED={back:'back',forward:'forward',reload:'reload',print:'print','save-page':'save-page','save-pdf':'save-pdf'};
const EDITING={'selection-copy':'C','select-all':'A'};
function createContextCommands({getContext,clipboard,openTab,openWindow,peek,command,pinSidePanel=null,notify=()=>{},extensionItems=()=>[],resolveSelectionSearch,classifySelection=null,keyFor=()=>undefined,dark=null,platform=process.platform,arch=process.arch,inspectElement=null}){
 function build(wc,params){
  let owner,identity,childToken;try{owner=getContext(wc);if(!owner||wc.isDestroyed()||typeof owner.profileId!=='string'||!owner.profileId||typeof owner.tabId!=='string'||!owner.tabId)return [];identity=getNativeDocumentIdentity(wc);childToken=childLifetime(wc);}catch{return [];}
  const frame=params.frame||wc.mainFrame,pageURL=wc.getURL(),frameURL=frame?.url,profileId=owner.profileId,tabId=owner.tabId,privateMode=owner.private,session=wc.session;
  const valid=()=>{try{const now=getContext(wc),native=getNativeDocumentIdentity(wc);return !wc.isDestroyed()&&now?.profileId===profileId&&now?.tabId===tabId&&now?.private===privateMode&&wc.session===session&&native.documentKey===identity.documentKey&&native.lifetime===identity.lifetime&&childLifetime(wc)===childToken&&wc.getURL()===pageURL&&frame&&!frame.isDestroyed()&&frame.url===frameURL;}catch{return false;}};
  const guard=fn=>async()=>{if(!valid())return;try{await fn();}catch(error){notify(String(error.message||error));}};
  const item=(id,label,fn,enabled=true,rest={})=>({id,label,enabled,...rest,click:guard(fn)}),sep={type:'separator'},items=[];
  const link=webURL(params.linkURL),src=webURL(params.srcURL),inline=src?null:inlineImage(params.srcURL),selection=String(params.selectionText||'').trim().slice(0,8192),flags=params.mediaFlags||{},edit=params.editFlags||{};
  const tab=(url,background=true,extra={})=>openTab({url,background,profileId,tabId,...(owner.privateTab?{privacy:owner.tor?'tor':'private'}:{}),...extra});
  const download=url=>{const rescue=require('./navigation-rescue.cjs').shared;rescue.expectSave(url);rescue.markSaveAs(url);/* "Save … as…": it asks where, whatever the setting says (Beta 14, D2) */if(typeof owner.downloadURL==='function')owner.downloadURL(url);else wc.downloadURL(url);};
  /* the rows other features registered (registerPageMenu above) for this slot */
  const contributed=new Set(),replaced=new Set(),taken=new Set(),made=new WeakSet();
  const own=(id,label,fn,enabled=true,rest={})=>{const row=item(id,label,fn,enabled,rest);made.add(row);return row;};
  const contribute=slot=>{
   for(const entry of pageMenu.values()){
    if(entry.slot!==slot)continue;
    let rows;try{rows=entry.rows({wc,params,owner,frame,pageURL,profileId,tabId,privateMode,item:own,sep,tab,download,command,notify,clipboard,keyFor,tr,platform});}catch{continue;}
    let added=false;
    for(const row of Array.isArray(rows)?rows:[]){
     if(!row||typeof row!=='object')continue;
     if(row.type==='separator'){items.push(sep);continue;}
     if(typeof row.id!=='string'||!row.id||typeof row.label!=='string'||taken.has(row.id))continue;
     taken.add(row.id);const made1=made.has(row)?row:{...row,click:typeof row.click==='function'?guard(row.click):undefined};contributed.add(made1);items.push(made1);added=true;
    }
    if(added)for(const id of entry.replaces)replaced.add(id);
   }
  };
  if(link){const cleaned=cleanLink(link);items.push(item('link-tab',tr('pagemenu.openLinkNewTab'),()=>tab(link)),item('link-foreground',tr('pagemenu.openLinkSwitch'),()=>tab(link,false)),typeof peek==='function'&&!owner.privateTab&&item('link-peek',tr('pagemenu.previewLink'),()=>peek({url:link,tabId,x:params.x,y:params.y}),true,{shortcut:'Alt+Click'}),item('link-window',tr('pagemenu.openLinkWindow'),()=>openWindow({url:link,profileId,private:!!owner.private,...(owner.tor?{tor:true}:{})})),!owner.private&&item('link-private-tab',tr('pagemenu.openLinkPrivateTab'),()=>openTab({url:link,background:false,profileId,tabId,privacy:'private'})),!owner.private&&bundledTorSupported(platform,arch)&&item('link-tor-tab',tr('pagemenu.openLinkTorTab'),()=>openTab({url:link,background:false,profileId,tabId,privacy:'tor'})),!owner.private&&item('link-private',tr('pagemenu.openLinkPrivateWindow'),()=>openWindow({url:link,private:true})),sep,item('link-save',tr('pagemenu.saveLinkAs'),()=>download(link)),item('link-copy',tr('pagemenu.copyLinkAddress'),()=>clipboard.writeText(link)),cleaned.changed&&item('link-copy-clean',tr('pagemenu.copyCleanLink'),()=>clipboard.writeText(cleaned.url)),sep);}
  contribute('link');
  if(params.mediaType==='image'||params.mediaType==='canvas'){
   items.push(src&&item('image-tab',tr('pagemenu.openImageNewTab'),()=>tab(src)),item('image-copy',tr('pagemenu.copyImage'),()=>wc.copyImageAt(params.x,params.y),!!params.hasImageContents),src&&item('image-copy-url',tr('pagemenu.copyImageAddress'),()=>clipboard.writeText(src)),src&&item('image-save',tr('pagemenu.saveImageAs'),()=>download(src),!!params.hasImageContents),!src&&params.mediaType==='image'&&inline&&item('image-save',tr('pagemenu.saveImageAs'),()=>download(inline),!!params.hasImageContents),sep);
  }
  contribute('image');
  if(['audio','video'].includes(params.mediaType)){
   const media=action=>frame.executeJavaScript(mediaScript({action,src:params.srcURL,kind:params.mediaType,x:params.x,y:params.y,main:frame===wc.mainFrame,changed:tr('pagemenu.mediaChanged')}),true).catch(()=>undefined);/* a page whose scripts are blocked (script-rules.cjs) refuses the script: the menu item does nothing, as the page itself would */
   items.push(item('media-play',flags.isPaused?tr('sidebarmedia.play'):tr('sidebarmedia.pause'),()=>media(flags.isPaused?'play':'pause'),!flags.inError),item('media-mute',flags.isMuted?tr('acirasidebar.unmute'):tr('acirasidebar.mute'),()=>media('mute'),!!flags.hasAudio,{type:'checkbox',checked:!!flags.isMuted}),item('media-loop',tr('pagemenu.loop'),()=>media('loop'),!!flags.canLoop,{type:'checkbox',checked:!!flags.isLooping}),item('media-controls',tr('pagemenu.showControls'),()=>media('controls'),!!flags.canToggleControls,{type:'checkbox',checked:!!flags.isControlsVisible}));
   if(params.mediaType==='video')items.push(item('media-pip',flags.isShowingPictureInPicture?tr('pagemenu.exitPip'):tr('pagemenu.pip'),()=>media('pip'),!!flags.canShowPictureInPicture||!!flags.isShowingPictureInPicture),item('media-fullscreen',tr('shortcutCmd.fullscreen'),()=>media('fullscreen'),!flags.inError));
   items.push(src&&item('media-tab',tr('pagemenu.openMediaNewTab'),()=>tab(src)),src&&item('media-copy-url',tr('pagemenu.copyMediaAddress'),()=>clipboard.writeText(src)),src&&item('media-save',tr('pagemenu.saveMediaAs'),()=>download(src),!!flags.canSave&&!flags.inError),sep);
  }
  contribute('media');
  if(params.isEditable){
   if(params.formControlType!=='input-password'&&typeof params.misspelledWord==='string'&&params.misspelledWord.length>0&&params.misspelledWord.length<=128&&!/[\s\u0000-\u001f\u007f]/u.test(params.misspelledWord)){
    for(const word of (Array.isArray(params.dictionarySuggestions)?params.dictionarySuggestions:[]).filter(word=>typeof word==='string'&&word.length>0&&word.length<=128).slice(0,6))items.push(item('spelling-'+word,word.replaceAll('&','&&'),()=>wc.replaceMisspelling(word)));
    let canLearn=false;try{canLearn=owner.private===false&&wc.session.isPersistent()===true&&typeof wc.session.addWordToSpellCheckerDictionary==='function';}catch{}
    items.push(item('spelling-learn',owner.private===true?tr('pagemenu.addToDictionaryPrivate'):tr('pagemenu.addToDictionary'),()=>{
     if(!canLearn||wc.session.isPersistent()!==true)return;
     if(wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)!==true)throw new Error(tr('pagemenu.dictionaryError'));
    },canLearn,{toolTip:tr('pagemenu.dictionaryTip')}),sep);
   }
   for(const [id,label,method,flag]of [['undo',tr('toast.undo'),'undo','canUndo'],['redo',tr('pagemenu.redo'),'redo','canRedo'],['cut',tr('pagemenu.cut'),'cut','canCut'],['copy',tr('pagemenu.copy'),'copy','canCopy'],['paste',tr('pagemenu.paste'),'paste','canPaste'],['paste-plain',tr('pagemenu.pastePlain'),'pasteAndMatchStyle','canPaste'],['select-all',tr('pagemenu.selectAll'),'selectAll','canSelectAll']])items.push(item(id,label,()=>wc[method](),!!edit[flag]));
   items.push(sep);
  }else if(selection)items.push(item('selection-copy',tr('pagemenu.copy'),()=>clipboard.writeText(selection)),item('select-all',tr('pagemenu.selectAll'),()=>wc.selectAll(),edit.canSelectAll!==false),sep);
  if(selection&&params.formControlType!=='input-password'){
   const shown=selection.slice(0,45).replaceAll('&','&&')+(selection.length>45?'…':''),address=selectionAddress(classifySelection,wc,selection,owner,link);
   if(address)items.push(item('selection-goto',tr('pagemenu.goTo',{text:shown}),()=>tab(address.url,false,address.httpsFirst?{httpsFirst:true}:{})),sep);
   else if(address===null){
    /* a Tor tab searches with DuckDuckGo whatever the profile's engine (src/runtime/navigation.ts searchFor), as a search typed in it does */
    let search;try{search=resolveSelectionSearch?resolveSelectionSearch(wc,selection):{url:selectionURL(selection,owner.tor?'duckduckgo':owner.searchEngine)};}catch{}const destination=webURL(search?.url),provider=typeof search?.engineName==='string'?search.engineName.slice(0,80).replaceAll('&','&&'):'';
    items.push(item('selection-search',destination?(provider?tr('pagemenu.searchWith',{engine:provider,text:shown}):tr('pagemenu.searchFor',{text:shown})):tr('pagemenu.searchUnavailable'),()=>destination?tab(destination,false):undefined,!!destination),sep);
   }
  }
  contribute('selection');
  if(!params.isEditable&&!link&&!selection&&!['image','audio','video','canvas'].includes(params.mediaType)){const cleaned=cleanLink(pageURL);items.push(item('back',tr('app.back'),()=>wc.navigationHistory.goBack(),wc.navigationHistory.canGoBack()),item('forward',tr('app.forward'),()=>wc.navigationHistory.goForward(),wc.navigationHistory.canGoForward()),item('reload',tr('shortcutCmd.reload'),()=>wc.reload()),cleaned.changed&&item('page-copy-clean',tr('pagemenu.copyCleanPageLink'),()=>clipboard.writeText(cleaned.url)),sep);}
  // Print and Save page act on a tab's page (browserCommand), so a Link preview's own page does not offer them: they would print or save the page it came from.
  if(!owner.preview)items.push(item('print',tr('app.print'),()=>command({type:'print',tabId})),item('save-page',tr('browsermenu.savePageAs'),()=>command({type:'save-page',tabId})),item('save-pdf',tr('pagemenu.saveAsPdf'),()=>command({type:'save-pdf',tabId})));
  /* Beta 14 (AF): pin this page to the side panel (a web page of an ordinary profile, not a private or Tor tab). */
  if(!owner.preview&&typeof pinSidePanel==='function'&&!owner.private&&!owner.privateTab&&!owner.tor&&webURL(pageURL))items.push(item('side-panel-add',tr('sidepanel.add'),()=>pinSidePanel({tabId})));
  /* Website appearance (13.3): the row is offered only in Always dark, on a website outside Tor. */
  {let darkState=null;try{darkState=dark?.status?.(wc)||null;}catch{}if(darkState?.supported&&darkState.enabled)items.push(item('dark-site',darkState.excluded?tr('pagemenu.darkInclude'):tr('pagemenu.darkExclude'),()=>dark.setExcluded(wc,!darkState.excluded)));}
  contribute('page');
  if(!owner.preview)items.push(sep);
  const extra=extensionItems(wc,params)||[];if(extra.length)items.push(...extra,sep);
  contribute('inspect');
  items.push(item('inspect',tr('pagemenu.inspect'),()=>{/* Beta 14: a tab's Developer tools open inside the tab (desktop/devtools-dock.cjs) and select this element; a page that is no tab's (a link preview) keeps its own window */if(inspectElement&&inspectElement(wc,params.x,params.y))return;if(!wc.isDevToolsOpened())wc.openDevTools({mode:'detach'});wc.inspectElement(params.x,params.y);}));
  return compact(replaced.size?items.filter(row=>contributed.has(row)||!replaced.has(row?.id)):items);
 }
 /** The same items as plain data for Acira's own menu (bible §4: context menus share the menu material and motion),
  * plus a runner keyed by item id. Null when an item needs a native submenu (extensions), so the caller falls back. */
 function menu(wc,params){const template=build(wc,params);if(!template.length)return null;return menuData(template,{keyFor,platform});}
 return {build,menu,popup(wc,params,Menu,window){const template=build(wc,params);if(template.length)Menu.buildFromTemplate(template).popup({window,frame:params.frame||undefined,sourceType:params.menuSourceType});}};
}

// Fixed script only; URL/action are serialized data. A child frame with repeated matching
// media refuses an ambiguous target instead of acting on the active tab's first video.
function mediaScript(options){return `(${async function(o){const matches=[...document.querySelectorAll(o.kind)].filter(e=>e.currentSrc===o.src||e.src===o.src);const point=o.main?document.elementFromPoint(o.x,o.y)?.closest(o.kind):null;const target=point&&matches.includes(point)?point:matches.length===1?matches[0]:null;if(!target)throw new Error(o.changed||'The media target changed. Open its menu again.');switch(o.action){case 'play':await target.play();break;case 'pause':target.pause();break;case 'mute':target.muted=!target.muted;break;case 'loop':target.loop=!target.loop;break;case 'controls':target.controls=!target.controls;break;case 'pip':if(document.pictureInPictureElement)await document.exitPictureInPicture();else await target.requestPictureInPicture();break;case 'fullscreen':await target.requestFullscreen();break;}return true;}})(${JSON.stringify(options)})`;}
module.exports={createContextCommands,registerPageMenu,PAGE_MENU_SLOTS,compact,selectionURL,selectionAddress,webURL,inlineImage,mediaScript,menuData};
