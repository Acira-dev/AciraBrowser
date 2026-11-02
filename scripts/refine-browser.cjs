const fs=require('node:fs'),path=require('node:path');
const ts=require(path.resolve('../Browser Demo/node_modules/typescript'));
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>fs.writeFileSync(p,s);
const old=read('src/runtime/types.ts'),ast=ts.createSourceFile('types.ts',old,99,true);
const keep=new Set(['BrowserStyle','SearchEngine','Appearance','BrowserProfile','TabGroupColor','TabGroup','ClosedTabSession','StylePreference','Rectangle','BrowserLayout','BrowserCommand','BrowserEvent','ExtensionRequest','BrowserExtension','ExtensionsSnapshot','BrowserRuntime']);
let types=ast.statements.filter(n=>keep.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
types=types.replace("id: string; name: string; color: string; partition: string","id: string; name: string; color: string; partition: string; private?: boolean");
types=types.replaceAll("'focus-composer' | ",'').replaceAll("| 'focus-composer'",'');
types=types.replace(/\| \{ type: 'assistant-pointer'; hovered\?:boolean \}/,'');
types=types.replace("openWindow(kind: 'mobile' | 'controls')","openWindow(kind: 'normal' | 'private')");
types+=`
export type TabContentKind='internal'|'web';
export type InternalPage='home'|'history'|'settings'|'downloads'|'bookmarks';
export interface TabSession {id:string;title:string;url:string;contentKind:TabContentKind;browserProfileId:string;profileId:string;workspaceId?:string;history:string[];historyIndex:number;pinned:boolean;group:string;searchDraft:string;loading:boolean;audible?:boolean;muted?:boolean;progress?:number;favicon:string;canGoBack:boolean;canGoForward:boolean;error:string|null;zoom:number;requestedUrl?:string;findMatches?:number;findActiveMatch?:number}
export interface Settings {interfaceScale:number;style:BrowserStyle;appearance:Appearance;accentColor:string;browserTint:string;colorPreset:string;stylePreferences:Record<BrowserStyle,StylePreference>;automaticCompact:boolean;compactTabTitles:boolean;pinExpanded:boolean;searchEngine:SearchEngine;addressSuggestions:boolean;showHome:boolean;sidebarWidth:number;reducedMotion:boolean;reducedTransparency:boolean;verticalTabs:boolean;bookmarksBar:boolean;bookmarksOnNewTabOnly:boolean;zoom:number;workspace:string;panelWidth:number;blocking:boolean;onboardingComplete:boolean}
export interface WindowUi{focusMode:boolean;workspaceOpen:boolean;webWorkspaceOpen:boolean;split:{tabIds:[string,string];ratio:number}|null}
export interface BookmarkNode{id:string;browserProfileId:string;parentId:string|null;title:string;url?:string;position:number;createdAt:number;importBatchId?:string}
export interface HistoryVisit{id:string;title:string;url:string;time:string;profileId:string;browserProfileId?:string;importBatchId?:string}
export interface BrowserDownload{id:string;browserProfileId?:string;tabId?:string;name:string;size:string;status:string;path?:string;receivedBytes?:number;totalBytes?:number;startedAt?:number}
export interface BrowserSnapshot{schemaVersion:3;revision:number;windowUi:WindowUi;originZooms:Record<string,Record<string,number>>;tabGroups:TabGroup[];tabs:TabSession[];closedTabs:ClosedTabSession[];activeTabId:string;activeProfileId:string;browserProfiles:BrowserProfile[];activeBrowserProfileId:string;bookmarks:string[];bookmarkNodes:BookmarkNode[];browsingHistory:HistoryVisit[];downloads:BrowserDownload[];workspaces:{id:string;name:string;browserProfileId:string}[];activeWorkspaceId:string;settings:Settings;toast:{id:number;text:string}|null}
export type BrowserAction=
 | {type:'tab.group.create';tabId:string;name:string;color?:TabGroupColor}
 | {type:'tab.group.update';id:string;patch:Partial<Pick<TabGroup,'name'|'color'|'collapsed'>>}
 | {type:'tab.group.remove';id:string}
 | {type:'tab.group.assign';tabIds:string[];groupId:string|null}
 | {type:'tab.drop';from:string;to?:string;groupId?:string|null;position?:'before'|'after';wholeGroup?:boolean}
 | {type:'settings.update';patch:Partial<Settings>}
 | {type:'ui.update';patch:Partial<Pick<WindowUi,'focusMode'|'workspaceOpen'|'webWorkspaceOpen'>>}
 | {type:'split.open';tabIds:[string,string];ratio?:number}|{type:'split.close'}|{type:'split.ratio';ratio:number}
 | {type:'tab.new';url?:string;background?:boolean;browserProfileId?:string;afterId?:string}
 | {type:'tab.select'|'tab.duplicate'|'tab.pin'|'tab.close';id:string}
 | {type:'tab.mute';id:string;muted:boolean}|{type:'tab.restore'}
 | {type:'tab.navigate';url:string;tabId?:string}|{type:'tab.history';direction:-1|1}|{type:'tab.reorder';from:string;to:string}
 | {type:'tab.update';id:string;patch:Partial<Pick<TabSession,'searchDraft'|'group'>>}
 | {type:'browser.profile.select';id:string;tabId?:string}|{type:'browser.profile.create';name:string}
 | {type:'browser.event';event:BrowserEvent}|{type:'bookmark.toggle';url:string}|{type:'history.remove';id:string}|{type:'toast';text:string};
`;
write('src/runtime/types.ts',types);
let session=read('src/runtime/sessionState.ts');session=session.slice(0,session.indexOf('/** Waiting for an approval'));session=session.replace(',assistantOpen:false','').replace(/assistantOpen:raw.assistantOpen===true,/,'');session=session.replace(/export function normalizedDemo[\s\S]*?(?=export function webOrigin)/,'');session+=`export function shouldPersistSnapshot(previous:BrowserSnapshot,next:BrowserSnapshot):boolean{return previous!==next;}\n`;write('src/runtime/sessionState.ts',session);
let nav=read('src/runtime/navigation.ts');
nav=nav.replace("import { STORES, STORE_PAGE_LABELS, parseStoreUrl } from './stores';",'');
nav=nav.replace(/export type FixturePage[\s\S]*?const searchUrls:/,"export interface NavigationTarget {url:string;contentKind:TabContentKind;query?:string;error?:string}\nexport const INTERNAL_PAGES:readonly InternalPage[]=['home','history','settings','downloads','bookmarks'];\nconst searchUrls:");
nav=nav.replace(/export function fixtureUrl[\s\S]*?(?=export function resolveNavigation)/,'');
nav=nav.replace(/      const fixture =[\s\S]*?(?=      if \(INTERNAL_PAGES)/,'');
nav=nav.replace(/      const fixture = legacyFixtures[\s\S]*?return \{ url: parsed.toString\(\), contentKind: 'web' \};/,"      return { url: parsed.toString(), contentKind: 'web' };");
nav=nav.slice(0,nav.indexOf('export function navigationTitle'))+`export function navigationTitle(url:string):string{if(url.startsWith('acira://'))return ({new:'New tab',home:'Workspace',history:'History',settings:'Settings',downloads:'Downloads',bookmarks:'Bookmarks'} as Record<string,string>)[url.slice(8)]||'Acira';try{return new URL(url).hostname;}catch{return 'New tab';}}\n`;
write('src/runtime/navigation.ts',nav);
let sites=read('src/runtime/sites.ts');sites=sites.replace("import { migrateFixtureUrl, navigationTitle } from './navigation';","import {navigationTitle} from './navigation';").replace("import { STORES, parseStoreUrl } from './stores';",'');sites=sites.replace(/  const url = migrateFixtureUrl\(input\);[\s\S]*?(?=  if \(url.startsWith\('acira:\/\/'\)\))/,"  const url=input;\n");sites=sites.slice(0,sites.indexOf('const previousDefaults'));write('src/runtime/sites.ts',sites);
let app=read('src/App.tsx');
app=app.replace('const [false, setEnabled]','const [systemPreference, setEnabled]').replace('}, [query]); return false;','}, [query]); return systemPreference;');
app=app.replaceAll('state.demo.speed','1').replace(/state.experience.layout !== 'browse' && \(true\) && /,'');
app=app.replace(/    const account =[^\n]*\n/,'').replace(/    const aiToggle =[^\n]*\n/,'');
app=app.replaceAll('{aiToggle}','');
app=app.replace(/    const tabStatus =[^\n]*\n/,'');
app=app.replace(/\$\{tabAgent && !addressFocused \? ' has-agent-state' : ''\}/,'').replace(/ data-attention=\{tabAgent\?\.attention \|\| undefined\}/,'');
app=app.replace(/\{tabAgent && <div className="address-agent"[\s\S]*?<\/div>\}/,'');
app=app.replace(/if \(t.agentLink\) \{[\s\S]*?\} const effectiveUrl = t.url;/,'const effectiveUrl = t.url;');
app=app.replace(/ onStartTask=\{prompt => dispatch\(\{ type: 'run.start', prompt, tabId: t.id \}\)\}/g,'');
app=app.replace(/return INTERNAL_PAGES.includes\(page\) \?[\s\S]*?(?=; \};)/,"return <BrowserSettings state={{...state,activeTabId:t.id}} dispatch={dispatch} onNavigate={u=>navigate(u,t.id)}/>");
app=app.replace(/const agent = null; return/,'return').replace(/\{agent \? <span className="tab-agent-icon"[\s\S]*?: t.loading/,'{t.loading').replace(/\{!t.pinned && agent && [\s\S]*?<\/span>\}/,'');
app=app.replaceAll('state.browserProfiles.length + state.accounts.length','state.browserProfiles.length');
app=app.replace(/const navItems =[^\n]*/,"const navItems = baseNavItems;");
app=app.replace(/    const preferred =[^\n]*\n/,'');
app=app.replace(' data-ai-enabled','');
app=app.replaceAll('Acira demo page','Acira page').replaceAll('Local synthetic content','Browser page');
app=app.replace(/<BrowserMenu aiEnabled=\{false\}/,'<BrowserMenu');
app=app.replace(/ ask=\{\(\) => onOpen\?\.\('assistant'\)\}/,'');
app=app.replace(/ workspace=\{null\}/,'');
app=app.replace(/<BrowserMenu aiEnabled(?= )/,'<BrowserMenu');
write('src/App.tsx',app);
let frost=read('src/features/FrostWorkspace.tsx');
frost=frost.replace(/    const status = agentTabStatus\(state, tab\);/,'');
frost=frost.replace(/\{status \? [\s\S]*? : tab.loading/,'{tab.loading');
frost=frost.replace('onStartTask }: Props','}: Props').replace(/    onStartTask: \(prompt: string\) => void;\n/,'');
frost=frost.replace(/    const ask =[^\n]*\n/,'').replace(/const draft = mode === 'agent' \? ask : search;/,'const draft = search;');
frost=frost.replace(/    const chooseMode =[^\n]*\n/,'');frost=frost.replace(/if \(mode === 'agent'\)\s+onStartTask\(value\);\s+else /g,'');
frost=frost.replaceAll("mode === 'agent' ? 'Ask Acira' : 'Search the web or enter a URL'","'Search the web or enter a URL'").replaceAll("mode === 'agent' ? 'Ask Acira to work on a task…' : 'Search or enter a URL'","'Search or enter a URL'").replaceAll("mode === 'agent' ? 'Start task' : 'Submit search'","'Submit search'");
frost=frost.replace(/    const tasks = \[\];\n/,'').replace(/\{tasks.length > 0 && [\s\S]*?<\/section>\}/,'');
frost=frost.replace(/const enabled = false, mode = 'search';/,"const mode='search';");
write('src/features/FrostWorkspace.tsx',frost);
let menu=read('src/components/BrowserMenu.tsx');menu=menu.replace('aiEnabled=true,','').replace('ask,','').replace(',workspace','').replace('  aiEnabled?:boolean;','  ').replace('ask:()=>void;','').replace('zoom:ReactNode;workspace:ReactNode','zoom:ReactNode');menu=menu.replace(/\{aiEnabled&&row\('Ask Acira'[^\n]*?\)\}/,'').replace(/    \{aiEnabled&&<>[\s\S]*?<\/>\}/,'');write('src/components/BrowserMenu.tsx',menu);
let popup=read('src/ui/popup.ts').replace('state.browserProfiles.length+state.accounts.length','state.browserProfiles.length');write('src/ui/popup.ts',popup);
let buffered=read('src/ui/useBufferedDraft.ts').replace("field:'draft'|'searchDraft'='draft'","field:'searchDraft'='searchDraft'");write('src/ui/useBufferedDraft.ts',buffered);
// Preserve exact licensed font weights as source assets; no runtime package dependency is needed.
fs.mkdirSync('public/fonts',{recursive:true});let fontCss='';
for(const family of ['inter']){let root=path.resolve('../Browser Demo/experiments/light-glass/node_modules/@fontsource',family);if(!fs.existsSync(root))root=path.resolve('../Browser Demo/node_modules/@fontsource',family);for(const weight of [400,500,600]){const filename=family+'-latin-'+weight+'-normal.woff2';fs.copyFileSync(path.join(root,'files',filename),path.join('public/fonts',filename));fontCss+=`@font-face{font-family:'${family==='geist'?'Geist':'Inter'}';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${filename}') format('woff2');}\n`;}fs.copyFileSync(path.join(root,'LICENSE'),path.join('public/fonts',family+'-LICENSE.txt'));}
write('src/fonts.css',fontCss);let entry=read('src/main.tsx').replace(/^import '@fontsource[^\n]+\n/gm,'');entry="import './fonts.css';\n"+entry;entry=entry.replace('The demo couldn’t display this view.','Acira couldn’t display this view.').replace(/<button className="btn" onClick=\{async[\s\S]*?Reset sample session<\/button>/,'').replace('or reset the sample session if it still cannot open.','or restart Acira if it still cannot open.');write('src/main.tsx',entry);
const p=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));for(const name of ['@fontsource/geist','@fontsource/inter']){delete p.dependencies[name];delete lock.packages['node_modules/'+name];}lock.packages[''].dependencies=p.dependencies;write('package.json',JSON.stringify(p,null,2)+'\n');write('package-lock.json',JSON.stringify(lock,null,2)+'\n');
console.log('Browser-only contracts and renderer migration written.');
