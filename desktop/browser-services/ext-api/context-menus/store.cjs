'use strict';
// The items one profile's extensions created with chrome.contextMenus: Chromium's rules (extensions/browser/api/context_menus, menu_manager.cc)
// and its exact error texts, no UI. Menus are built from it by build.cjs; the package (../context-menus.cjs) answers create/update/remove.
const {parsePattern}=require('../../user-scripts.cjs');

const CONTEXTS=['all','page','frame','selection','link','editable','image','video','audio','launcher','browser_action','page_action','action','tab'];
const TYPES=['normal','checkbox','radio','separator'];
const ERR={
 notFound:id=>`Cannot find menu item with id ${id}`,
 duplicate:id=>`Cannot create item with duplicate id ${id}`,
 title:'All menu items except for separators must have a title.',
 checked:'Only items with type "radio" or "checkbox" can be checked.',
 parentNormal:'Parent items must have type "normal"',
 pattern:pattern=>`Invalid url pattern '${pattern}'`,
 launcher:"Only packaged apps are allowed to use 'launcher' context",
 idRequired:'Extensions using event pages or Service Workers must pass an id parameter to chrome.contextMenus.create',
 onclick:'Extensions using event pages or Service Workers cannot pass an onclick parameter to chrome.contextMenus.create. Instead, use the chrome.contextMenus.onClicked event.'
};
const MAX_ITEMS=2000;   // per extension (Chromium has no limit; a runaway loop must not exhaust memory)
const keyOf=id=>(typeof id==='number'?`n${id}`:`s${id}`);

function patternList(value){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value))return [];
 for(const pattern of value)if(typeof pattern!=='string'||!parsePattern(pattern))throw new Error(ERR.pattern(pattern));
 return value.slice(0,1000);
}
function contextList(value){
 if(value===undefined||value===null)return ['page'];
 const list=(Array.isArray(value)?value:[value]).filter(context=>CONTEXTS.includes(context));
 if(list.includes('launcher'))throw new Error(ERR.launcher);
 return list.length?[...new Set(list)]:['page'];
}

function createStore({max=MAX_ITEMS}={}){
 const byExtension=new Map();   // extension id -> Map(key -> item), insertion order is creation order
 const itemsOf=extensionId=>{if(!byExtension.has(extensionId))byExtension.set(extensionId,new Map());return byExtension.get(extensionId);};
 const find=(extensionId,id)=>byExtension.get(extensionId)?.get(keyOf(id))||null;
 const list=extensionId=>[...(byExtension.get(extensionId)?.values()||[])];
 const children=(extensionId,id)=>list(extensionId).filter(item=>item.parentId!==undefined&&keyOf(item.parentId)===keyOf(id));
 const descends=(extensionId,item,ancestorId)=>{
  for(let parent=item,guard=0;parent&&parent.parentId!==undefined&&guard<64;guard++){
   if(keyOf(parent.parentId)===keyOf(ancestorId))return true;
   parent=find(extensionId,parent.parentId);
  }
  return false;
 };
 /** Radio items in a run of siblings are one group: selecting one clears the others of its run. */
 function selectRadio(extensionId,item){
  const siblings=list(extensionId).filter(other=>(other.parentId===undefined?'':keyOf(other.parentId))===(item.parentId===undefined?'':keyOf(item.parentId)));
  const at=siblings.indexOf(item);
  for(let i=at-1;i>=0&&siblings[i].type==='radio';i--)siblings[i].checked=false;
  for(let i=at+1;i<siblings.length&&siblings[i].type==='radio';i++)siblings[i].checked=false;
  item.checked=true;
 }
 function checkParent(extensionId,parentId,self){
  if(parentId===undefined||parentId===null)return;
  const parent=find(extensionId,parentId);
  if(!parent)throw new Error(ERR.notFound(parentId));
  if(parent.type!=='normal')throw new Error(ERR.parentNormal);
  if(self&&(keyOf(parentId)===keyOf(self.id)||descends(extensionId,parent,self.id)))throw new Error(ERR.notFound(parentId));
 }

 /** create(extensionId, createProperties) -> the item. Throws Chromium's errors. */
 function create(extensionId,props){
  const id=props.id;
  if(typeof id!=='string'&&typeof id!=='number')throw new Error(ERR.idRequired);
  const existing=find(extensionId,id);
  // An item brought back from disk is replaced silently when the extension creates it again (its install code runs after an update).
  if(existing&&!existing.stale)throw new Error(ERR.duplicate(id));
  if(existing)byExtension.get(extensionId).delete(keyOf(id));
  const type=props.type===undefined?'normal':props.type;
  if(!TYPES.includes(type))throw new Error(`Invalid value for argument 1. Property 'type': Value must be one of: ${TYPES.join(', ')}.`);
  if(type!=='separator'&&(typeof props.title!=='string'||props.title===''))throw new Error(ERR.title);
  if(props.checked&&type!=='checkbox'&&type!=='radio')throw new Error(ERR.checked);
  checkParent(extensionId,props.parentId);
  const items=itemsOf(extensionId);
  if(items.size>=max)throw new Error('Too many menu items.');
  const item={id,type,title:typeof props.title==='string'?props.title:'',checked:!!props.checked,contexts:contextList(props.contexts),
   visible:props.visible!==false,enabled:props.enabled!==false,documentUrlPatterns:patternList(props.documentUrlPatterns),targetUrlPatterns:patternList(props.targetUrlPatterns)};
  if(props.parentId!==undefined&&props.parentId!==null)item.parentId=props.parentId;
  items.set(keyOf(id),item);
  if(item.type==='radio'&&item.checked)selectRadio(extensionId,item);
  return item;
 }
 /** update(extensionId, id, updateProperties). Properties not given stay. */
 function update(extensionId,id,props){
  const item=find(extensionId,id);
  if(!item)throw new Error(ERR.notFound(id));
  const next={...item};
  if(props.type!==undefined){if(!TYPES.includes(props.type))throw new Error(`Invalid value for argument 2. Property 'type': Value must be one of: ${TYPES.join(', ')}.`);next.type=props.type;}
  if(props.title!==undefined){if(typeof props.title!=='string')throw new Error(ERR.title);next.title=props.title;}
  if(next.type!=='separator'&&next.title==='')throw new Error(ERR.title);
  if(props.checked!==undefined){if(props.checked&&next.type!=='checkbox'&&next.type!=='radio')throw new Error(ERR.checked);next.checked=!!props.checked;}
  if(next.type!=='checkbox'&&next.type!=='radio')next.checked=false;
  if(props.contexts!==undefined)next.contexts=contextList(props.contexts);
  if(props.visible!==undefined)next.visible=props.visible!==false;
  if(props.enabled!==undefined)next.enabled=props.enabled!==false;
  if(props.documentUrlPatterns!==undefined)next.documentUrlPatterns=patternList(props.documentUrlPatterns);
  if(props.targetUrlPatterns!==undefined)next.targetUrlPatterns=patternList(props.targetUrlPatterns);
  if(props.parentId!==undefined){
   if(props.parentId===null)delete next.parentId;
   else{checkParent(extensionId,props.parentId,item);next.parentId=props.parentId;}
  }
  // A parent keeps type "normal" (Chromium refuses to turn a parent into a checkbox).
  if(next.type!=='normal'&&children(extensionId,id).length)throw new Error(ERR.parentNormal);
  Object.assign(item,next);
  for(const name of Object.keys(item))if(!(name in next))delete item[name];
  if(item.type==='radio'&&item.checked)selectRadio(extensionId,item);
  return item;
 }
 /** Removes the item and everything below it. */
 function remove(extensionId,id){
  const item=find(extensionId,id);
  if(!item)throw new Error(ERR.notFound(id));
  const doomed=[item];
  for(let i=0;i<doomed.length;i++)doomed.push(...children(extensionId,doomed[i].id));
  for(const gone of doomed)byExtension.get(extensionId).delete(keyOf(gone.id));
  if(!byExtension.get(extensionId).size)byExtension.delete(extensionId);
  return doomed.length;
 }
 function removeAll(extensionId){return byExtension.delete(extensionId);}
 /** A click on a checkable item: a checkbox flips, a radio is selected. Returns {wasChecked, checked}. */
 function toggle(extensionId,id){
  const item=find(extensionId,id);
  if(!item)return null;
  const wasChecked=!!item.checked;
  if(item.type==='checkbox')item.checked=!wasChecked;
  else if(item.type==='radio')selectRadio(extensionId,item);
  else return {wasChecked:false,checked:false};
  return {wasChecked,checked:!!item.checked};
 }
 /** What to keep on disk for an extension (event-page and service-worker extensions get their items back after a restart). */
 const snapshot=extensionId=>list(extensionId).map(item=>({...item}));
 /** Puts items saved by snapshot() back (validated again; a bad entry is dropped, not fatal). */
 function restore(extensionId,saved){
  byExtension.delete(extensionId);
  for(const entry of Array.isArray(saved)?saved.slice(0,max):[]){
   try{
    if(!entry||typeof entry!=='object')continue;
    const item=create(extensionId,{id:entry.id,type:entry.type,title:entry.title,checked:entry.checked,contexts:entry.contexts,visible:entry.visible,
     enabled:entry.enabled,documentUrlPatterns:entry.documentUrlPatterns,targetUrlPatterns:entry.targetUrlPatterns,parentId:entry.parentId});
    item.stale=true;
   }catch{/* skip */}
  }
 }
 return {create,update,remove,removeAll,toggle,find,list,children,snapshot,restore,has:extensionId=>byExtension.has(extensionId),extensions:()=>[...byExtension.keys()]};
}

module.exports={createStore,ERR,CONTEXTS,keyOf};
