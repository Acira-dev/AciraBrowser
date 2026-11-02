'use strict';
const { t } = require('../browser-services/tx.cjs');
// Routines v1 (ROUTINES_SPEC): a local library of manually run sequences of four allowlisted browser actions. The
// portable recipe and the local profile binding are stored apart; export carries only the recipe. Import is preview
// first, makes no network request and no browser change. Runs go through the window's own dispatch, one at a time.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateRecipe,validateRecipeText}=require('./routine-validation.cjs');
const fail=message=>{throw new Error(message);};
const MAX_ROUTINES=100;

function createRoutines({dir,tick=()=>new Promise(resolve=>setImmediate(resolve)),shortcuts=null}={}){
 const file=path.join(dir,'library.json');
 let library=read();const runs=new Map();// windowId -> run
 function read(){
  try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));const items=(Array.isArray(raw.routines)?raw.routines:[]).slice(0,MAX_ROUTINES).flatMap(item=>{const checked=validateRecipe(item?.recipe);if(!checked.ok||typeof item.id!=='string')return [];const last=item.lastRun&&typeof item.lastRun==='object'?{...item.lastRun,status:item.lastRun.status==='running'?'interrupted':item.lastRun.status}:null;return [{id:item.id,recipe:checked.recipe,binding:{profileId:typeof item.binding?.profileId==='string'?item.binding.profileId:'',...(typeof item.binding?.shortcut==='string'&&item.binding.shortcut.length<=40?{shortcut:item.binding.shortcut}:{})},updatedAt:Number(item.updatedAt)||0,lastRun:last}];});return items;}
  catch{return [];}
 }
 function write(){fs.mkdirSync(dir,{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify({version:1,routines:library}));fs.renameSync(tmp,file);}
 const find=id=>library.find(item=>item.id===id)||fail('This routine no longer exists.');
 const routineId=value=>{if(typeof value!=='string'||!/^rt-[0-9a-f]{16}$/.test(value))fail('Unknown routine.');return value;};
 const domains=recipe=>[...new Set(recipe.steps.flatMap(step=>step.command==='tabs.open'?step.args.items.map(i=>{try{return new URL(i.url).host;}catch{return '';}}):[]))].filter(Boolean);
 const registry=()=>typeof shortcuts==='function'?shortcuts():shortcuts;
 const commandId=id=>`routine:${id}`;
 /** One registry command per tab set ("Open tab set: Morning"), so shortcuts, menus and the command bar share it. */
 function registerCommands(){
  const r=registry();if(!r?.setDynamic)return;
  try{r.setDynamic('routine:',library.map(item=>({id:commandId(item.id),label:t('routines.label.openSet',{name:item.recipe.name}),category:'Tab sets',action:{action:'routine',id:item.id},defaults:item.binding.shortcut?[item.binding.shortcut]:[]})));}catch{}
 }
 const shortcutOf=id=>registry()?.hints?.()[commandId(id)]||'';
 const row=item=>({id:item.id,name:item.recipe.name,description:item.recipe.description||'',steps:item.recipe.steps.length,commands:item.recipe.steps.map(step=>step.command),sites:item.recipe.steps.reduce((n,step)=>n+(step.command==='tabs.open'?step.args.items.length:0),0),domains:domains(item.recipe),profileId:item.binding.profileId,shortcut:shortcutOf(item.id),lastRun:item.lastRun});
 function setShortcut(id,value){
  const item=find(routineId(id)),r=registry();if(!r)return {ok:false,errors:['Shortcuts are not available yet.']};
  if(value===null||value===''){delete item.binding.shortcut;if(r.list().some(c=>c.id===commandId(id)&&c.customized))r.reset(commandId(id));write();registerCommands();return {ok:true,shortcut:''};}
  const accel=r.canonical(value);if(!accel)return {ok:false,errors:['That key combination could not be read.']};
  const info=r.describe(accel,commandId(id));if(!info.valid)return {ok:false,errors:[info.reason]};
  if(info.conflict)return {ok:false,errors:[`${info.display} is already used by “${info.conflict.label}”.`]};
  item.binding.shortcut=accel;write();registerCommands();
  if(r.list().some(c=>c.id===commandId(id)&&c.customized))r.reset(commandId(id));
  return {ok:true,shortcut:shortcutOf(id)};
 }
 const profilesOf=state=>(state.browserProfiles||[]).filter(p=>!p.private).map(p=>({id:p.id,name:p.name}));
 function save({id,recipe,profileId},state){
  const checked=validateRecipe(recipe);if(!checked.ok)return {ok:false,errors:checked.errors};
  if(!profilesOf(state).some(p=>p.id===profileId))return {ok:false,errors:['Choose a profile before saving.']};
  let item=id?find(routineId(id)):null;
  if(!item){if(library.length>=MAX_ROUTINES)return {ok:false,errors:[`Keep at most ${MAX_ROUTINES} routines.`]};item={id:`rt-${crypto.randomBytes(8).toString('hex')}`,recipe:checked.recipe,binding:{profileId},updatedAt:Date.now(),lastRun:null};library.push(item);}
  else Object.assign(item,{recipe:checked.recipe,binding:{...item.binding,profileId},updatedAt:Date.now()});
  write();registerCommands();return {ok:true,id:item.id};
 }
 // ---- run engine -----------------------------------------------------------------------------------------------
 function status(run){return run?{runId:run.runId,routineId:run.routineId,status:run.status,current:run.current,total:run.total,completed:run.completed,message:run.message,tabIds:[...new Set(run.tabIds)]}:null;}
 async function run(item,ctx){
  const windowId=ctx.windowId,active=runs.get(windowId);
  if(active&&active.status==='running')return {...status(active),message:active.routineId===item.id?t('routines.run.alreadyHere'):t('routines.run.another'),busy:true};
  const state=ctx.state(),profileId=state.activeBrowserProfileId;
  if(!item.binding.profileId||!profilesOf(state).some(p=>p.id===item.binding.profileId))return {status:'failed',message:t('routines.run.chooseProfile'),completed:[],total:item.recipe.steps.length};
  if(item.binding.profileId!==profileId){const name=profilesOf(state).find(p=>p.id===item.binding.profileId)?.name||t('routines.run.itsProfile');return {status:'failed',message:t('routines.run.wrongProfile',{name}),completed:[],total:item.recipe.steps.length};}
  const recheck=validateRecipe(item.recipe);if(!recheck.ok)return {status:'failed',message:recheck.errors[0],completed:[],total:item.recipe.steps.length};
  const record={runId:`run-${crypto.randomBytes(6).toString('hex')}`,routineId:item.id,status:'running',current:0,total:item.recipe.steps.length,completed:[],message:'',tabIds:[],stop:false};
  runs.set(windowId,record);item.lastRun={status:'running',at:Date.now()};write();
  const refs=new Map();
  const tabOf=ref=>{const id=refs.get(ref),tab=ctx.state().tabs.find(t=>t.id===id);return tab&&tab.browserProfileId===profileId?tab:null;};
  /** In the workspace on screen (R3-57); a tab with no stamp is in the profile's first workspace. */
  const inHere=tab=>{const st=ctx.state(),own=(st.workspaces||[]).filter(w=>w.browserProfileId===tab.browserProfileId),space=tab.workspaceId&&own.some(w=>w.id===tab.workspaceId)?tab.workspaceId:own[0]?.id;return !st.activeWorkspaceId||space===st.activeWorkspaceId;};
  const label=ref=>{const id=refs.get(ref);return ctx.state().tabs.find(t=>t.id===id)?.title||ref;};
  try{
   for(const [index,step] of item.recipe.steps.entries()){
    await tick();if(record.stop){record.status='cancelled';record.message=`Stopped after ${record.completed.length} ${record.completed.length===1?'step':'steps'}.`;break;}
    record.current=index;
    if(step.command==='tabs.open'){
     for(const entry of step.args.items){
      // A tab already open in another workspace is not this routine's (R3-57): the set opens in the workspace on screen.
      const existing=ctx.state().tabs.find(t=>t.browserProfileId===profileId&&t.url===entry.url&&inHere(t));
      if(existing){refs.set(entry.ref,existing.id);record.tabIds.push(existing.id);continue;}
      const before=new Set(ctx.state().tabs.map(t=>t.id));ctx.dispatch({type:'tab.new',url:entry.url,background:true,browserProfileId:profileId});
      const fresh=ctx.state().tabs.find(t=>!before.has(t.id));if(!fresh)throw new Error(`Couldn’t open ${entry.url}.`);refs.set(entry.ref,fresh.id);record.tabIds.push(fresh.id);
     }
    }else if(step.command==='tabs.group'){
     const tabs=step.args.refs.map(ref=>tabOf(ref));const missing=step.args.refs.find((ref,i)=>!tabs[i]);if(missing)throw new Error(`${label(missing)} moved or closed. The remaining steps were stopped.`);
     const ids=tabs.filter(t=>!t.pinned).map(t=>t.id);if(!ids.length)throw new Error('Pinned tabs can’t be grouped.');
     const home=tabs[0].workspaceId||'',mine=g=>g.browserProfileId===profileId&&g.name===step.args.name&&(g.workspaceId||'')===home;
     let group=ctx.state().tabGroups.find(mine);
     if(!group){ctx.dispatch({type:'tab.group.create',tabId:ids[0],name:step.args.name,color:step.args.color});group=ctx.state().tabGroups.find(mine);}
     if(!group)throw new Error(`Couldn’t create the group “${step.args.name}”.`);
     ctx.dispatch({type:'tab.group.assign',tabIds:ids,groupId:group.id});ctx.dispatch({type:'tab.group.update',id:group.id,patch:{color:step.args.color,collapsed:false}});
    }else if(step.command==='layout.split'){
     const left=tabOf(step.args.left),right=tabOf(step.args.right);if(!left||!right)throw new Error(`${label(left?step.args.right:step.args.left)} moved or closed. The remaining steps were stopped.`);
     ctx.dispatch({type:'split.open',tabIds:[left.id,right.id],ratio:step.args.ratio});
     const split=ctx.state().windowUi.split;if(!split||!split.tabIds.includes(left.id)||!split.tabIds.includes(right.id))throw new Error('Split view needs a wider window. Widen it and run again.');
    }else if(step.command==='layout.focus'){
     ctx.dispatch({type:'ui.update',patch:{focusMode:step.args.enabled}});
    }
    record.completed.push(step.id);
   }
   if(record.status==='running'){record.status='completed';record.message='Browser setup complete. Pages may still be loading.';}
  }catch(error){
   record.status=record.completed.length?'partial':'failed';
   const done=record.completed.length;record.message=`${done} of ${record.total} steps completed. ${String(error?.message||error).slice(0,200)}${done?' Your opened tabs are still available.':''}`;
  }
  item.lastRun={status:record.status,at:Date.now(),message:record.message};try{write();}catch{}
  return status(record);
 }
 function exact(request,allowed){for(const key of Object.keys(request))if(key!=='type'&&!allowed.includes(key))fail('Unexpected routine request field.');}
 async function handle(request,ctx){
  if(ctx.privateMode)return {routines:{private:true,routines:[],profiles:[]}};
  const state=ctx.state();
  switch(request.type){
   case 'routines.list':exact(request,[]);return {routines:{routines:library.map(row),profiles:profilesOf(state),activeProfileId:state.activeBrowserProfileId,run:status(runs.get(ctx.windowId))}};
   case 'routines.get':{exact(request,['id']);const item=find(routineId(request.id));return {routines:{routine:{...row(item),recipe:item.recipe}}};}
   case 'routines.save':exact(request,['id','recipe','profileId']);return {routines:save(request,state)};
   case 'routines.delete':{exact(request,['id']);const id=routineId(request.id);library=library.filter(item=>item.id!==id);write();registerCommands();return {routines:{ok:true}};}
   case 'routines.shortcut':{exact(request,['id','accelerator']);if(request.accelerator!==null&&typeof request.accelerator!=='string')fail('Shortcut must be text.');return {routines:setShortcut(request.id,request.accelerator)};}
   case 'routines.preview':{exact(request,['text']);const checked=validateRecipeText(request.text);return {routines:checked.ok?{ok:true,recipe:checked.recipe,domains:checked.domains}:{ok:false,errors:checked.errors}};}
   case 'routines.import':{exact(request,['text','profileId']);const checked=validateRecipeText(request.text);if(!checked.ok)return {routines:{ok:false,errors:checked.errors}};return {routines:save({recipe:checked.recipe,profileId:request.profileId},state)};}
   case 'routines.export':{exact(request,['id']);const item=find(routineId(request.id));return {routines:{name:`${item.recipe.name.replace(/[^\w -]+/g,'').trim().replace(/\s+/g,'-').toLowerCase()||'routine'}.acira-routine.json`,json:JSON.stringify(item.recipe,null,2)}};}
   case 'routines.run':{exact(request,['id']);return {routines:{run:await run(find(routineId(request.id)),ctx)}};}
   case 'routines.stop':{exact(request,[]);const active=runs.get(ctx.windowId);if(active&&active.status==='running')active.stop=true;return {routines:{run:status(active)}};}
   default:fail('Unknown routine request.');
  }
 }
 async function runById(id,ctx){
  if(ctx.privateMode){ctx.dispatch({type:'toast',text:t('routines.run.privateWindow'),tone:'info'});return null;}
  const item=library.find(entry=>entry.id===id);if(!item){ctx.dispatch({type:'toast',text:t('routines.run.gone'),tone:'info'});return null;}
  const result=await run(item,ctx);
  ctx.dispatch({type:'toast',text:result.status==='completed'?`“${item.recipe.name}” is set up. Pages may still be loading.`:result.message});
  return result;
 }
 registerCommands();
 return {handle,run,runById,save,registerCommands,library:()=>library};
}
module.exports={createRoutines};
