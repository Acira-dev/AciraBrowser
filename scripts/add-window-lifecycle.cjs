const fs=require('node:fs');let source=fs.readFileSync('desktop/main.cjs','utf8');
const uiLine=source.match(/^const uiScale=[^\n]*\n/m)[0],scaleFunction=source.match(/^function updateInterfaceScale[^\n]*\n/m)[0];source=source.replace(uiLine,'').replace(scaleFunction,'');
const split=source.indexOf('const statePath=');let top=source.slice(0,split),body=source.slice(split);
top=top.replace("app.on('second-instance',()=>showMain());","app.on('second-instance',()=>[...controllers][0]?.show());");
body=body.replaceAll('ipcMain.handle(', 'bridge.handle(').replaceAll('ipcMain.on(', 'bridge.on(');
const protocolStart=body.indexOf("protocol.handle('acira-browser-ui'"),databaseStart=body.indexOf('database=new BrowserDatabase',protocolStart);
const protocolCode=body.slice(protocolStart,databaseStart);body=body.slice(0,protocolStart)+body.slice(databaseStart);
const dbStart=body.indexOf('database=new BrowserDatabase'),dbEnd=body.indexOf('// Electron\'s default Windows/Linux menu',dbStart);
body=body.slice(0,dbStart)+`if(!privateMode&&restore){const saved=database.readWindow(windowId);if(saved)state=restoreSnapshot(saved);}if(privateMode){const profile={id:'private-'+randomUUID(),name:'Incognito',color:'#62666d',partition:'acira-private-'+randomUUID(),private:true};state=createInitialState();state.browserProfiles=[profile];state.activeBrowserProfileId=profile.id;state.tabs=[require('./runtime.cjs').makeTab('tab-'+randomUUID(),'',undefined,profile.id)];state.activeTabId=state.tabs[0].id;state.bookmarkNodes=[];state.browsingHistory=[];state.downloads=[];state.workspaces=[];}else if(sharedState){applyShared(sharedState);}if(profileId&&state.browserProfiles.some(p=>p.id===profileId)){state.activeBrowserProfileId=profileId;state.tabs=state.tabs.filter(t=>t.browserProfileId===profileId);if(!state.tabs.length)state.tabs=[require('./runtime.cjs').makeTab('tab-'+randomUUID(),'',undefined,profileId)];state.activeTabId=state.tabs[0].id;}if(!privateMode)publishShared();\n`+body.slice(dbEnd);
body=body.replace("app.whenReady().then(async()=>{if(!primaryInstance)return;","async function start(){");
body=body.replace("database?.saveWindow('main',persistedSnapshot(state));","if(!privateMode)database?.saveWindow(windowId,persistedSnapshot(state));");
body=body.replace("state=next;broadcast();emitBrowser(event);","state=next;if(!privateMode)publishShared();broadcast();emitBrowser(event);");
body=body.replace("const meaningful=typeof shouldPersistSnapshot", "if(!privateMode)publishShared();const meaningful=typeof shouldPersistSnapshot");
body=body.replace("function dispatch(action){const leavingId", "function dispatch(action){if(action.type==='browser.profile.select'&&action.id!==state.activeBrowserProfileId&&!privateMode){const existing=[...controllers].find(c=>!c.privateMode&&c.profileId===action.id);if(existing)existing.show();else createBrowserWindow({profileId:action.id});return state;}const leavingId");
body=body.replace("if(!tab)throw new Error('Unknown tab');","if(!tab)throw new Error('Unknown tab');");
body=body.replace("mainWindow=null;app.quit();});});", "const privateProfile=privateMode?state.browserProfiles[0]:null;mainWindow=null;controllers.delete(controller);bridge.dispose();if(privateProfile){permissionService.clearPrivate(privateProfile.id);const ses=require('electron').session.fromPartition(privateProfile.partition);void ses.clearStorageData().finally(()=>ses.closeAllConnections());}if(!controllers.size&&!quitting)app.quit();});}\n");
body=body.replace(/app.on\('before-quit',[\s\S]*?function openWindow\(kind\)\{[^\n]*\}/,`function openWindow(kind){createBrowserWindow({privateMode:kind==='private',profileId:privateMode?undefined:state.activeBrowserProfileId});}`);
body=body.replace("function showMain(){if(process.env.ACIRA_BROWSER_TEST_HIDDEN==='1'||!mainWindow", "function showMain(){if(process.env.ACIRA_BROWSER_TEST_HIDDEN==='1'||!mainWindow");
body=body.replace("title:'Acira',...windowChrome()","title:privateMode?'Acira · Incognito':'Acira',...windowChrome()");
body=body.replace("registryPath:path.join(app.getPath('userData'),'extensions.json')","registryPath:path.join(app.getPath('userData'),'extensions.json')");
body=body.replace("});await extensionManager.restore();","});if(!privateMode)await extensionManager.restore();");
const generated=top+`
const controllers=new Set(),handleRoutes=new Map(),eventRoutes=new Map();let quitting=false,sharedState=null;
const sharedFields=['browserProfiles','bookmarkNodes','browsingHistory','downloads','settings','workspaces','originZooms'];
function createBridge(owns){const registrations=[];return {
 handle(channel,handler){if(!handleRoutes.has(channel)){handleRoutes.set(channel,[]);ipcMain.handle(channel,(event,...args)=>{const route=handleRoutes.get(channel).find(r=>r.owns(event.sender));if(!route)throw new Error('Untrusted browser sender');return route.handler(event,...args);});}const route={owns,handler};handleRoutes.get(channel).push(route);registrations.push([handleRoutes,channel,route]);},
 on(channel,handler){if(!eventRoutes.has(channel)){eventRoutes.set(channel,[]);ipcMain.on(channel,(event,...args)=>{const route=eventRoutes.get(channel).find(r=>r.owns(event.sender));if(route)route.handler(event,...args);});}const route={owns,handler};eventRoutes.get(channel).push(route);registrations.push([eventRoutes,channel,route]);},
 dispose(){for(const [map,channel,route]of registrations){const list=map.get(channel);list.splice(list.indexOf(route),1);}}
};}
function createBrowserWindow({windowId='window-'+randomUUID(),privateMode=false,profileId,restore=false}={}){
 ${uiLine}${scaleFunction}
 ${body}
 function applyShared(shared){if(privateMode)return;for(const key of sharedFields)state[key]=structuredClone(shared[key]);state.bookmarks=state.bookmarkNodes.filter(b=>b.browserProfileId===state.activeBrowserProfileId&&b.url).map(b=>b.url);state.revision++;if(mainWindow){broadcast();queueSave();}}
 function publishShared(){sharedState=Object.fromEntries(sharedFields.map(key=>[key,structuredClone(state[key])]));for(const other of controllers)if(other!==controller&&!other.privateMode)other.applyShared(sharedState);}
 const bridge=createBridge(contents=>trustedContents.has(contents));
 const controller={windowId,privateMode,get profileId(){return state.activeBrowserProfileId;},get state(){return state;},get window(){return mainWindow;},pages,auxiliaries,applyShared,show:showMain,save};controllers.add(controller);void start().catch(error=>{console.error(error);controllers.delete(controller);bridge.dispose();if(!controllers.size)app.quit();});return controller;
}
app.whenReady().then(()=>{if(!primaryInstance)return;${protocolCode}
 database=new BrowserDatabase(path.join(app.getPath('userData'),'browser.sqlite'));
 permissionService=createPermissions({database,dialog,getWindow:()=>[...controllers].find(c=>c.window?.isFocused())?.window||[...controllers][0]?.window,ownsContents:wc=>[...controllers].some(c=>[...c.pages.values()].some(e=>e.view.webContents===wc)||[...c.auxiliaries.values()].some(w=>w.webContents===wc)),isPrivate:id=>id.startsWith('private-')});
 createBrowserWindow({windowId:'main',restore:true});
});
app.on('before-quit',()=>{quitting=true;for(const controller of controllers)controller.save();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(!controllers.size&&database)createBrowserWindow({windowId:'main',restore:true});});
if(primaryInstance)app.on('will-quit',createSessionShutdown({getSessions:()=>app.isReady()&&sharedState?sharedState.browserProfiles.map(p=>require('electron').session.fromPartition(p.partition)):[],quit:()=>app.quit(),onError:message=>console.warn(message)}));
`;
fs.writeFileSync('desktop/main.cjs',generated);
