// One-time source migration. The compiler is read only; generated application files are local.
const fs=require('node:fs'),path=require('node:path');
const ts=require(path.resolve('../Browser Demo/node_modules/typescript'));
const write=(file,text)=>fs.writeFileSync(file,text.replaceAll('DemoSnapshot','BrowserSnapshot').replaceAll('DemoAction','BrowserAction').replaceAll('DemoRuntime','BrowserRuntime').replaceAll('reduceDemo','reduceBrowser').replaceAll('useDemo','useBrowser'));
const read=file=>fs.readFileSync(file,'utf8');
function fold(file,removeFunctions=[]){
 let source=read(file);
 source=source.replace(/quietUiSnapshot\((\{[\s\S]*?\})\);const \[systemDark/,'$1;const [systemDark');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const transform=context=>{
  const f=context.factory;
  const val=node=>node?.kind===ts.SyntaxKind.TrueKeyword?true:node?.kind===ts.SyntaxKind.FalseKeyword?false:undefined;
  const visit=node=>{
   if(ts.isFunctionDeclaration(node)&&removeFunctions.includes(node.name?.text))return undefined;
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['aiEnabled','isAiInternalUrl'].includes(node.expression.text))return f.createFalse();
   if(ts.isIdentifier(node)&&['enabled','assistantVisible','agentChat','showWorkspace'].includes(node.text)&&!(ts.isVariableDeclaration(node.parent)&&node.parent.name===node)&&!(ts.isPropertyAccessExpression(node.parent)&&node.parent.name===node)&&!(ts.isPropertyAssignment(node.parent)&&node.parent.name===node))return f.createFalse();
   node=ts.visitEachChild(node,visit,context);
   if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken&&val(node.operand)!==undefined)return val(node.operand)?f.createFalse():f.createTrue();
   if(ts.isConditionalExpression(node)&&val(node.condition)!==undefined)return val(node.condition)?node.whenTrue:node.whenFalse;
   if(ts.isBinaryExpression(node)){
    const left=val(node.left),right=val(node.right),op=node.operatorToken.kind;
    if(op===ts.SyntaxKind.AmpersandAmpersandToken){if(left===false||right===false)return f.createFalse();if(left===true)return node.right;if(right===true)return node.left;}
    if(op===ts.SyntaxKind.BarBarToken){if(left===true||right===true)return f.createTrue();if(left===false)return node.right;if(right===false)return node.left;}
   }
   if(ts.isIfStatement(node)&&val(node.expression)!==undefined)return val(node.expression)?node.thenStatement:node.elseStatement;
   if(ts.isJsxExpression(node)&&val(node.expression)===false)return undefined;
   return node;
  };
  return root=>ts.visitNode(root,visit);
 };
 const out=ts.transform(ast,[transform]);write(file,ts.createPrinter().printFile(out.transformed[0]));out.dispose();
}

let app=read('src/App.tsx');
app=app.replace(/const reading=useRef<[\s\S]*?const workspaceOpen=/,'const workspaceOpen=');
app=app.replace(/const toggleAssistant=\(\)=>\{[\s\S]*?const open=/,'const open=');
app=app.replace("if(kind==='assistant'){toggleAssistant();return;}",'');
app=app.replace("const pending=attentionItems(state).length;","const pending=0;");
app=app.replace(/const baseNavItems=.*? as const;/,"const baseNavItems=[['home','Workspace',Home],['history','History',History],['settings','Settings',Settings2]] as const;");
app=app.replace(/\{view==='mobile'\?[\s\S]*?<Toast state=\{state\}\/>/,"{view==='overlay'?<NativeOverlay state={state} dispatch={dispatch} dark={dark}/>:<Browser state={state} dispatch={dispatch} dark={dark}/>}<Toast state={state}/>");
app=app.replace(/\{!view&&aiEnabled\(state\)&&state.closeRequest&&<CloseTaskDialog[^>]*\/>\}/,'');
app=app.replaceAll("'--motion-scale':1/state.demo.speed","'--motion-scale':1");
app=app.replaceAll('speed={state.demo.speed}','speed={1}').replaceAll('motionSpeed:state.demo.speed','motionSpeed:1');
app=app.replace(/const renderPage=[\s\S]*?(?=const [a-zA-Z]|return <div)/,match=>match); // Other page routing is retained until typed replacement below.
write('src/App.tsx',app);
fold('src/App.tsx',['AssistantSurface','NativeAssistant','AgentPanel','Mobile','DemoControls']);
let frost=read('src/features/FrostWorkspace.tsx');
frost=frost.replace(/const runRow =[\s\S]*?const openSaved =/,'const openSaved =');
frost=frost.replace(/const manage:.*?;\r?\n/,'').replace(/const running =.*?;\r?\n/,'').replace(/const recent =.*?;\r?\n/,'');
write('src/features/FrostWorkspace.tsx',frost);fold('src/features/FrostWorkspace.tsx',['EditorAssistant','ModeMenuSurface']);

// Rename the ordinary shared contracts before replacing the simulation store.
for(const dir of ['src','tests'])for(const file of walk(dir).filter(f=>/\.(ts|tsx)$/.test(f)))write(file,read(file));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]);}
// Preserve only browser cases from the old reducer. These are adapted below, not a disabled simulation.
const old=read('src/runtime/core.ts'),ast=ts.createSourceFile('core.ts',old,99,true);
let clauses=[];const find=node=>{if(ts.isSwitchStatement(node)&&node.expression.getText(ast)==='action.type')clauses=node.caseBlock.clauses;ts.forEachChild(node,find);};find(ast);
const allowed=new Set(['ui.update','split.open','split.close','split.ratio','tab.new','tab.select','tab.pin','tab.reorder','tab.mute','tab.navigate','tab.history','browser.profile.create','browser.event','history.remove','toast']);
let cases=clauses.filter(c=>ts.isCaseClause(c)&&allowed.has(c.expression.text)).map(c=>c.getText(ast)).join('\n');
cases=cases.replace(/if\(target.contentKind==='web'&&tab.url!==target.url\)for\(const run[\s\S]*?a=>a.runId===run.id\);\}/,'');
cases=cases.replace(/if\(target.contentKind==='fixture'\)[^\n]*\n/,'');
cases=cases.replace(/\|\|update.type==='assistant-pointer'/g,'');
const native=old.slice(old.indexOf('function nativeHistory'),old.indexOf('const color ='));
write('src/runtime/core.ts',`import type {BrowserAction,BrowserSnapshot,TabSession,Settings,StylePreference} from './types';
import {resolveNavigation,navigationTitle} from './navigation';
import {palettePreference,defaultAppearancePalette} from './appearancePalettes';
import {applyTabGroupAction,reconcileTabGroups,groupForTab} from './tabGroups';
import {defaultWindowUi,windowUiState,originZoom,setOriginZoom,HISTORY_LIMIT} from './sessionState';
import {normalizeBrowserProfiles} from './browserProfiles';
export {themeTokens} from '../ui/theme';
export {resolveNavigation} from './navigation';
export {bookmarksTogglePatch,workspacePreferenceKey,workspaceIsOpen} from './browserChrome';
export {shouldPersistSnapshot,HISTORY_LIMIT} from './sessionState';
const uid=(_s:BrowserSnapshot,prefix:string)=>prefix+'-'+crypto.randomUUID();
const toast=(s:BrowserSnapshot,text:string)=>{s.toast={id:Date.now(),text};};
const timeLabel=(_s:BrowserSnapshot)=>new Date().toISOString();
const finite=(v:unknown,f:number)=>typeof v==='number'&&Number.isFinite(v)?v:f;
const tabProgress=(v:unknown,f?:number)=>v===undefined?undefined:typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(1,v)):f;
const pageTitle=navigationTitle;
export function makeTab(id:string,profileId='',url='acira://new',browserProfileId='profile-personal',_experience?:unknown):TabSession {
 const target=resolveNavigation(url);return {id,title:pageTitle(target.url),url:target.url,contentKind:target.contentKind,browserProfileId,history:[target.url],historyIndex:0,profileId,pinned:false,group:'',searchDraft:'',loading:false,favicon:'',canGoBack:false,canGoForward:false,error:target.error||null,zoom:100};
}
export function createInitialState():BrowserSnapshot {
 return {schemaVersion:3,revision:0,windowUi:{...defaultWindowUi(),workspaceOpen:true,webWorkspaceOpen:true},originZooms:{},tabGroups:[],tabs:[makeTab('tab-home')],closedTabs:[],activeTabId:'tab-home',activeProfileId:'',browserProfiles:[{id:'profile-personal',name:'Personal',color:'#62666d',partition:'persist:acira-browser-personal'}],activeBrowserProfileId:'profile-personal',browsingHistory:[],bookmarks:[],bookmarkNodes:[],downloads:[],workspaces:[{id:'workspace-default',name:'My workspace',browserProfileId:'profile-personal'}],activeWorkspaceId:'workspace-default',settings:{interfaceScale:100,style:'acira',appearance:'system',...palettePreference(defaultAppearancePalette),stylePreferences:{acira:{appearance:'system',...palettePreference(defaultAppearancePalette)}},automaticCompact:false,compactTabTitles:true,pinExpanded:false,searchEngine:'google',addressSuggestions:true,showHome:false,sidebarWidth:248,reducedMotion:false,reducedTransparency:false,verticalTabs:false,bookmarksBar:false,bookmarksOnNewTabOnly:true,zoom:100,workspace:'My workspace',panelWidth:360,blocking:true,onboardingComplete:false},toast:null};
}
${native}
const currentTab=(s:BrowserSnapshot)=>s.tabs.find(t=>t.id===s.activeTabId)!;
const syncProfiles=(s:BrowserSnapshot)=>{s.activeBrowserProfileId=currentTab(s).browserProfileId;s.activeProfileId='';s.bookmarks=s.bookmarkNodes.filter(b=>b.browserProfileId===s.activeBrowserProfileId&&b.url).map(b=>b.url!);};
const localHistoryFlags=(tab:TabSession)=>{if(tab.contentKind!=='web'){tab.canGoBack=tab.historyIndex>0;tab.canGoForward=tab.historyIndex<tab.history.length-1;}};
export function persistedSnapshot(state:BrowserSnapshot):BrowserSnapshot {const s=structuredClone(state);s.toast=null;s.tabs=s.tabs.filter(t=>!s.browserProfiles.find(p=>p.id===t.browserProfileId)?.private);s.closedTabs=s.closedTabs.filter(t=>!s.browserProfiles.find(p=>p.id===t.browserProfileId)?.private);s.browserProfiles=s.browserProfiles.filter(p=>!p.private);s.browsingHistory=s.browsingHistory.filter(v=>s.browserProfiles.some(p=>p.id===v.browserProfileId));for(const tab of [...s.tabs,...s.closedTabs]){tab.loading=false;tab.audible=false;delete tab.progress;delete tab.requestedUrl;}if(!s.tabs.length)s.tabs=[makeTab('tab-home')];if(!s.tabs.some(t=>t.id===s.activeTabId))s.activeTabId=s.tabs[0].id;syncProfiles(s);return s;}
export function restoreSnapshot(value:unknown):BrowserSnapshot {const base=createInitialState();if(!value||typeof value!=='object')return base;const raw=value as Partial<BrowserSnapshot>;const profiles=normalizeBrowserProfiles(raw.browserProfiles,base.browserProfiles);const s={...base,...raw,browserProfiles:profiles,settings:{...base.settings,...raw.settings},toast:null} as BrowserSnapshot;s.tabs=(raw.tabs||[]).filter(t=>profiles.some(p=>p.id===t.browserProfileId)&&!resolveNavigation(t.url).error).map(t=>({...makeTab(t.id,'',t.url,t.browserProfileId),...t,loading:false,audible:false,progress:undefined,requestedUrl:undefined}));if(!s.tabs.length)s.tabs=base.tabs;if(!s.tabs.some(t=>t.id===s.activeTabId))s.activeTabId=s.tabs[0].id;s.closedTabs=(raw.closedTabs||[]).filter(t=>profiles.some(p=>p.id===t.browserProfileId));s.windowUi=windowUiState(raw.windowUi,s.tabs,s.activeTabId);reconcileTabGroups(s);syncProfiles(s);return s;}
export const migrateSnapshot=restoreSnapshot;
export function reduceBrowser(previous:BrowserSnapshot,action:BrowserAction):BrowserSnapshot {
 if(action.type==='browser.event'&&!['state','find-result','download'].includes(action.event.type))return previous;
 const s=structuredClone(previous);s.revision++;const t=currentTab(s);
 if(applyTabGroupAction(s,action)){if(groupForTab(s,currentTab(s))?.collapsed){const fallback=makeTab(uid(s,'tab'),'',undefined,s.activeBrowserProfileId);s.tabs.push(fallback);s.activeTabId=fallback.id;}syncProfiles(s);s.windowUi=windowUiState(s.windowUi,s.tabs,s.activeTabId);return s;}
 switch(action.type){
 ${cases}
 case 'settings.update': {const patch={...action.patch};if(patch.pinExpanded)patch.automaticCompact=false;if(patch.automaticCompact)patch.pinExpanded=false;Object.assign(s.settings,patch);s.settings.stylePreferences={acira:{appearance:s.settings.appearance,accentColor:s.settings.accentColor,browserTint:s.settings.browserTint,colorPreset:s.settings.colorPreset}};break;}
 case 'tab.close': {const i=s.tabs.findIndex(x=>x.id===action.id);if(i<0)return previous;const [tab]=s.tabs.splice(i,1);if(!s.browserProfiles.find(p=>p.id===tab.browserProfileId)?.private)s.closedTabs.unshift({...tab,closedIndex:i});s.closedTabs=s.closedTabs.slice(0,50);if(!s.tabs.length)s.tabs.push(makeTab(uid(s,'tab'),'',undefined,tab.browserProfileId));if(s.activeTabId===tab.id)s.activeTabId=s.tabs[Math.min(i,s.tabs.length-1)].id;break;}
 case 'tab.restore': {const tab=s.closedTabs.shift();if(tab){s.tabs.splice(Math.min(tab.closedIndex??s.tabs.length,s.tabs.length),0,tab);s.activeTabId=tab.id;}break;}
 case 'tab.duplicate': {const original=s.tabs.find(x=>x.id===action.id);if(original){const tab={...structuredClone(original),id:uid(s,'tab'),loading:false,progress:undefined,audible:false};s.tabs.splice(s.tabs.indexOf(original)+1,0,tab);s.activeTabId=tab.id;}break;}
 case 'tab.update': {const tab=s.tabs.find(x=>x.id===action.id);if(tab)Object.assign(tab,action.patch);break;}
 case 'browser.profile.select': {const profile=s.browserProfiles.find(p=>p.id===action.id);if(!profile)return previous;let tab=s.tabs.find(x=>x.browserProfileId===profile.id);if(!tab){tab=makeTab(uid(s,'tab'),'',undefined,profile.id);s.tabs.push(tab);}s.activeTabId=tab.id;break;}
 case 'bookmark.toggle': {if(!/^https?:\\/\\//i.test(action.url)||s.browserProfiles.find(p=>p.id===t.browserProfileId)?.private)break;const found=s.bookmarkNodes.find(b=>b.url===action.url&&b.browserProfileId===t.browserProfileId);if(found)s.bookmarkNodes=s.bookmarkNodes.filter(b=>b.id!==found.id);else s.bookmarkNodes.push({id:uid(s,'bookmark'),browserProfileId:t.browserProfileId,parentId:null,title:s.tabs.find(v=>v.url===action.url)?.title||pageTitle(action.url),url:action.url,position:s.bookmarkNodes.length,createdAt:Date.now()});toast(s,found?'Bookmark removed':'Page bookmarked');break;}
 }
 s.browsingHistory=s.browsingHistory.filter(v=>!s.browserProfiles.find(p=>p.id===v.browserProfileId)?.private).slice(0,HISTORY_LIMIT);
 reconcileTabGroups(s);s.windowUi=windowUiState(s.windowUi,s.tabs,s.activeTabId);syncProfiles(s);return s;
}
`);
console.log('Foundation migration written.');
