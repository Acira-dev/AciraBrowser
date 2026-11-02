'use strict';
// Which extension menu items show for a right-click and how they are laid out: Chromium's rules (render_view_context_menu.cc
// ExtensionContextAndPatternMatch / MenuItemMatchesParams, menu_manager.cc) over the store; output is Electron menu templates that
// context-commands.cjs turns into Acira's own menu (with a native Menu as the fallback).
const {matchesPattern}=require('../../user-scripts.cjs');
const {keyOf}=require('./store.cjs');

const ACTION_CONTEXTS=['action','browser_action','page_action'];
const ACTION_MENU_TOP_LEVEL_LIMIT=6;   // contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT
const TITLE_MAX=75,SELECTION_MAX=50;     // Chromium's kMaxExtensionItemTitleLength and kMaxSelectionTextLength

const matchesAny=(patterns,url)=>!patterns.length||(typeof url==='string'&&url!==''&&patterns.some(pattern=>matchesPattern(pattern,url)));
const mediaOf=params=>(['image','video','audio'].includes(params?.mediaType)?params.mediaType:null);

/** Chromium's ExtensionContextAndPatternMatch + document pattern for a page right-click. params: Electron's context-menu params. */
function matchesPage(item,params){
 if(item.visible===false)return false;
 const contexts=item.contexts,has=name=>contexts.includes(name);
 const link=params.linkURL||'',selection=String(params.selectionText||''),media=mediaOf(params),inFrame=!!params.frameURL;
 let hit=false;
 // Target URL patterns apply to link and media targets only.
 if(has('all')||selection&&has('selection')||params.isEditable&&has('editable')||inFrame&&has('frame'))hit=true;
 else if(media&&has(media)&&matchesAny(item.targetUrlPatterns,params.srcURL))hit=true;
 else if(link&&has('link')&&matchesAny(item.targetUrlPatterns,link))hit=true;
 else if(has('page')&&!selection&&!params.isEditable&&!media&&!link)hit=true;
 if(!hit)return false;
 return matchesAny(item.documentUrlPatterns,params.frameURL||params.pageURL||'');
}
/** The action button's menu: items with an action context (Chromium does not count "all" here). */
const matchesAction=item=>item.visible!==false&&item.contexts.some(context=>ACTION_CONTEXTS.includes(context));

/** The title shown: %s is the selection (50 characters at most), the title is cut at 75, & is a literal ampersand. */
function titleOf(item,params){
 let title=item.title;
 if(title.includes('%s')){
  let selection=String(params?.selectionText||'').replace(/\s+/g,' ').trim();
  if(selection.length>SELECTION_MAX)selection=selection.slice(0,SELECTION_MAX-1)+'…';
  title=title.split('%s').join(selection);
 }
 if(title.length>TITLE_MAX)title=title.slice(0,TITLE_MAX-1)+'…';
 return title.replaceAll('&','&&');
}

/**
 * One extension's items for one right-click as menu templates.
 *   store, extension: {id, name}, show(item) -> boolean, params (page right-click, for %s), click(item) -> function, icon: {image, url}
 * Several top-level items go under one row named after the extension (Chromium's grouping); a single one carries the extension's icon.
 */
function buildTemplates({store,extension,show,params,click,icon={},limit=Infinity,group=true}){
 const shown=new Map();
 for(const item of store.list(extension.id))if(show(item))shown.set(keyOf(item.id),item);
 // A child shows only under a parent that shows.
 const live=item=>{for(let at=item,guard=0;at&&guard<64;guard++){if(at.parentId===undefined)return true;at=shown.get(keyOf(at.parentId));}return false;};
 const kids=item=>[...shown.values()].filter(child=>child.parentId!==undefined&&keyOf(child.parentId)===keyOf(item.id)&&live(child));
 const template=(item,depth)=>{
  if(item.type==='separator')return {id:`ext:${extension.id}:${keyOf(item.id)}`,type:'separator'};
  const out={id:`ext:${extension.id}:${keyOf(item.id)}`,label:titleOf(item,params),enabled:item.enabled!==false,type:item.type==='normal'?'normal':item.type};
  if(item.type==='checkbox'||item.type==='radio')out.checked=!!item.checked;
  const sub=depth<4?kids(item):[];
  if(sub.length)out.submenu=sub.map(child=>template(child,depth+1));
  else out.click=click(item);
  return out;
 };
 const top=[...shown.values()].filter(item=>item.parentId===undefined).slice(0,limit);
 if(!top.length)return [];
 const withIcon=row=>{if(icon.image)row.icon=icon.image;if(icon.url)row.iconURL=icon.url;return row;};
 if(!group)return top.map(item=>template(item,0));
 if(top.length>1)return [withIcon({id:`ext:${extension.id}:group`,label:String(extension.name||'').replaceAll('&','&&').slice(0,TITLE_MAX),enabled:true,type:'submenu',submenu:top.map(item=>template(item,1))})];
 return [withIcon(template(top[0],0))];
}

module.exports={matchesPage,matchesAction,titleOf,buildTemplates,ACTION_MENU_TOP_LEVEL_LIMIT,mediaOf};
