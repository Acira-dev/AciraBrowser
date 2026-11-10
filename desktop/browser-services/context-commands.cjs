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
   ...(typeof item.iconURL==='string'&&item.iconURL.startsWith('data:image/')&&item.iconURL.length<64*1024?{icon:item.iconURL}:{}),
   ...(depth?{depth}:{}),...(sub?{header:true}:{})});
  if(sub)sub.slice(0,200).forEach((child,at)=>add(child,index+'.'+at,Math.min(depth+1,3)));
 };
 template.forEach((item,index)=>add(item,String(index),0));
 return {items,run:id=>{const click=handlers.get(id);return click?click():undefined;}};
}

/** Capture actual tab/profile/frame at invocation. No renderer-supplied privileged target. */
// Rows that run a registry command show that command's live key (keyFor reads desktop/shortcut-registry.cjs); editing rows show the system keys.
const KEYED={back:'back',forward:'forward',reload:'reload',print:'print','save-page':'save-page','save-pdf':'save-pdf'};
const EDITING={'selection-copy':'C','select-all':'A'};
function createContextCommands({getContext,clipboard,openTab,openWindow,peek,command,notify=()=>{},extensionItems=()=>[],resolveSelectionSearch,keyFor=()=>undefined,dark=null,platform=process.platform,arch=process.arch}){
 function build(wc,params){
  let owner,identity,childToken;try{owner=getContext(wc);if(!owner||wc.isDestroyed()||typeof owner.profileId!=='string'||!owner.profileId||typeof owner.tabId!=='string'||!owner.tabId)return [];identity=getNativeDocumentIdentity(wc);childToken=childLifetime(wc);}catch{return [];}
  const frame=params.frame||wc.mainFrame,pageURL=wc.getURL(),frameURL=frame?.url,profileId=owner.profileId,tabId=owner.tabId,privateMode=owner.private,session=wc.session;
  const valid=()=>{try{const now=getContext(wc),native=getNativeDocumentIdentity(wc);return !wc.isDestroyed()&&now?.profileId===profileId&&now?.tabId===tabId&&now?.private===privateMode&&wc.session===session&&native.documentKey===identity.documentKey&&native.lifetime===identity.lifetime&&childLifetime(wc)===childToken&&wc.getURL()===pageURL&&frame&&!frame.isDestroyed()&&frame.url===frameURL;}catch{return false;}};
  const guard=fn=>async()=>{if(!valid())return;try{await fn();}catch(error){notify(String(error.message||error));}};
  const item=(id,label,fn,enabled=true,rest={})=>({id,label,enabled,...rest,click:guard(fn)}),sep={type:'separator'},items=[];
  const link=webURL(params.linkURL),src=webURL(params.srcURL),inline=src?null:inlineImage(params.srcURL),selection=String(params.selectionText||'').trim().slice(0,8192),flags=params.mediaFlags||{},edit=params.editFlags||{};
  const tab=(url,background=true)=>openTab({url,background,profileId,tabId,...(owner.privateTab?{privacy:owner.tor?'tor':'private'}:{})});
  const download=url=>{require('./navigation-rescue.cjs').shared.expectSave(url);if(typeof owner.downloadURL==='function')owner.downloadURL(url);else wc.downloadURL(url);};
  if(link){const cleaned=cleanLink(link);items.push(item('link-tab',tr('pagemenu.openLinkNewTab'),()=>tab(link)),item('link-foreground',tr('pagemenu.openLinkSwitch'),()=>tab(link,false)),typeof peek==='function'&&!owner.privateTab&&item('link-peek',tr('pagemenu.previewLink'),()=>peek({url:link,tabId,x:params.x,y:params.y}),true,{shortcut:'Alt+Click'}),item('link-window',tr('pagemenu.openLinkWindow'),()=>openWindow({url:link,profileId,private:!!owner.private,...(owner.tor?{tor:true}:{})})),!owner.private&&item('link-private-tab',tr('pagemenu.openLinkPrivateTab'),()=>openTab({url:link,background:false,profileId,tabId,privacy:'private'})),!owner.private&&bundledTorSupported(platform,arch)&&item('link-tor-tab',tr('pagemenu.openLinkTorTab'),()=>openTab({url:link,background:false,profileId,tabId,privacy:'tor'})),!owner.private&&item('link-private',tr('pagemenu.openLinkPrivateWindow'),()=>openWindow({url:link,private:true})),sep,item('link-save',tr('pagemenu.saveLinkAs'),()=>download(link)),item('link-copy',tr('pagemenu.copyLinkAddress'),()=>clipboard.writeText(link)),cleaned.changed&&item('link-copy-clean',tr('pagemenu.copyCleanLink'),()=>clipboard.writeText(cleaned.url)),sep);}
  if(params.mediaType==='image'||params.mediaType==='canvas'){
   items.push(src&&item('image-tab',tr('pagemenu.openImageNewTab'),()=>tab(src)),item('image-copy',tr('pagemenu.copyImage'),()=>wc.copyImageAt(params.x,params.y),!!params.hasImageContents),src&&item('image-copy-url',tr('pagemenu.copyImageAddress'),()=>clipboard.writeText(src)),src&&item('image-save',tr('pagemenu.saveImageAs'),()=>download(src),!!params.hasImageContents),!src&&params.mediaType==='image'&&inline&&item('image-save',tr('pagemenu.saveImageAs'),()=>download(inline),!!params.hasImageContents),sep);
  }
  if(['audio','video'].includes(params.mediaType)){
   const media=action=>frame.executeJavaScript(mediaScript({action,src:params.srcURL,kind:params.mediaType,x:params.x,y:params.y,main:frame===wc.mainFrame,changed:tr('pagemenu.mediaChanged')}),true).catch(()=>undefined);/* a page whose scripts are blocked (script-rules.cjs) refuses the script: the menu item does nothing, as the page itself would */
   items.push(item('media-play',flags.isPaused?tr('sidebarmedia.play'):tr('sidebarmedia.pause'),()=>media(flags.isPaused?'play':'pause'),!flags.inError),item('media-mute',flags.isMuted?tr('acirasidebar.unmute'):tr('acirasidebar.mute'),()=>media('mute'),!!flags.hasAudio,{type:'checkbox',checked:!!flags.isMuted}),item('media-loop',tr('pagemenu.loop'),()=>media('loop'),!!flags.canLoop,{type:'checkbox',checked:!!flags.isLooping}),item('media-controls',tr('pagemenu.showControls'),()=>media('controls'),!!flags.canToggleControls,{type:'checkbox',checked:!!flags.isControlsVisible}));
   if(params.mediaType==='video')items.push(item('media-pip',flags.isShowingPictureInPicture?tr('pagemenu.exitPip'):tr('pagemenu.pip'),()=>media('pip'),!!flags.canShowPictureInPicture||!!flags.isShowingPictureInPicture),item('media-fullscreen',tr('shortcutCmd.fullscreen'),()=>media('fullscreen'),!flags.inError));
   items.push(src&&item('media-tab',tr('pagemenu.openMediaNewTab'),()=>tab(src)),src&&item('media-copy-url',tr('pagemenu.copyMediaAddress'),()=>clipboard.writeText(src)),src&&item('media-save',tr('pagemenu.saveMediaAs'),()=>download(src),!!flags.canSave&&!flags.inError),sep);
  }
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
   let search;try{search=resolveSelectionSearch?resolveSelectionSearch(wc,selection):{url:selectionURL(selection,owner.searchEngine)};}catch{}const destination=webURL(search?.url),provider=typeof search?.engineName==='string'?search.engineName.slice(0,80).replaceAll('&','&&'):'',shown=selection.slice(0,45).replaceAll('&','&&')+(selection.length>45?'…':'');
   items.push(item('selection-search',destination?(provider?tr('pagemenu.searchWith',{engine:provider,text:shown}):tr('pagemenu.searchFor',{text:shown})):tr('pagemenu.searchUnavailable'),()=>destination?tab(destination,false):undefined,!!destination),sep);
  }
  if(!params.isEditable&&!link&&!selection&&!['image','audio','video','canvas'].includes(params.mediaType)){const cleaned=cleanLink(pageURL);items.push(item('back',tr('app.back'),()=>wc.navigationHistory.goBack(),wc.navigationHistory.canGoBack()),item('forward',tr('app.forward'),()=>wc.navigationHistory.goForward(),wc.navigationHistory.canGoForward()),item('reload',tr('shortcutCmd.reload'),()=>wc.reload()),cleaned.changed&&item('page-copy-clean',tr('pagemenu.copyCleanPageLink'),()=>clipboard.writeText(cleaned.url)),sep);}
  // Print and Save page act on a tab's page (browserCommand), so a Link preview's own page does not offer them: they would print or save the page it came from.
  if(!owner.preview)items.push(item('print',tr('app.print'),()=>command({type:'print',tabId})),item('save-page',tr('browsermenu.savePageAs'),()=>command({type:'save-page',tabId})),item('save-pdf',tr('pagemenu.saveAsPdf'),()=>command({type:'save-pdf',tabId})));
  /* Website appearance (13.3): the row is offered only in Always dark, on a website outside Tor. */
  {let darkState=null;try{darkState=dark?.status?.(wc)||null;}catch{}if(darkState?.supported&&darkState.enabled)items.push(item('dark-site',darkState.excluded?tr('pagemenu.darkInclude'):tr('pagemenu.darkExclude'),()=>dark.setExcluded(wc,!darkState.excluded)));}
  if(!owner.preview)items.push(sep);
  const extra=extensionItems(wc,params)||[];if(extra.length)items.push(...extra,sep);
  items.push(item('inspect',tr('pagemenu.inspect'),()=>{if(!wc.isDevToolsOpened())wc.openDevTools({mode:'detach'});wc.inspectElement(params.x,params.y);}));
  return compact(items);
 }
 /** The same items as plain data for Acira's own menu (bible §4: context menus share the menu material and motion),
  * plus a runner keyed by item id. Null when an item needs a native submenu (extensions), so the caller falls back. */
 function menu(wc,params){const template=build(wc,params);if(!template.length)return null;return menuData(template,{keyFor,platform});}
 return {build,menu,popup(wc,params,Menu,window){const template=build(wc,params);if(template.length)Menu.buildFromTemplate(template).popup({window,frame:params.frame||undefined,sourceType:params.menuSourceType});}};
}

// Fixed script only; URL/action are serialized data. A child frame with repeated matching
// media refuses an ambiguous target instead of acting on the active tab's first video.
function mediaScript(options){return `(${async function(o){const matches=[...document.querySelectorAll(o.kind)].filter(e=>e.currentSrc===o.src||e.src===o.src);const point=o.main?document.elementFromPoint(o.x,o.y)?.closest(o.kind):null;const target=point&&matches.includes(point)?point:matches.length===1?matches[0]:null;if(!target)throw new Error(o.changed||'The media target changed. Open its menu again.');switch(o.action){case 'play':await target.play();break;case 'pause':target.pause();break;case 'mute':target.muted=!target.muted;break;case 'loop':target.loop=!target.loop;break;case 'controls':target.controls=!target.controls;break;case 'pip':if(document.pictureInPictureElement)await document.exitPictureInPicture();else await target.requestPictureInPicture();break;case 'fullscreen':await target.requestFullscreen();break;}return true;}})(${JSON.stringify(options)})`;}
module.exports={createContextCommands,compact,selectionURL,webURL,inlineImage,mediaScript,menuData};
