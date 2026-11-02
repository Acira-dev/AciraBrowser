// Actual-main backend lifecycle fixture. Production handlers are retained unchanged.
const {app,ipcMain,webContents,session,BaseWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=process.env.ACIRA_BROWSER_TEST_DATA,base=process.env.ACIRA_QUIT_BASE,mode=process.env.ACIRA_QUIT_MODE;
const routes=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>{routes.set(name,fn);return handle(name,fn);};
require('../desktop/main.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),event=sender=>({sender,senderFrame:sender.mainFrame}),invoke=(sender,name,...args)=>routes.get(name)(event(sender),...args),send=(sender,name,...args)=>ipcMain.emit(name,event(sender),...args),all=()=>webContents.getAllWebContents().filter(w=>!w.isDestroyed());
async function poll(get,test,label){for(let i=0;i<300;i++){const value=await get();if(test(value))return value;await delay(25);}throw Error('Timed out: '+label);}
const chrome=()=>all().filter(w=>w.getURL()==='acira-browser-ui://ui/index.html'),snapshot=w=>invoke(w,'acira:snapshot');
app.whenReady().then(async()=>{
 const ordinary=await poll(()=>chrome().find(w=>{try{return !!snapshot(w);}catch{return false;}}),Boolean,'ordinary chrome');
 await invoke(ordinary,'acira:dispatch',{type:'tab.new',url:base+'/ordinary'});await poll(()=>all().some(w=>w.getURL()===base+'/ordinary'),Boolean,'ordinary website');
 send(ordinary,'acira:open','private');const privateUi=await poll(()=>chrome().find(w=>{try{return snapshot(w).browserProfiles.some(p=>p.private);}catch{return false;}}),Boolean,'private chrome');
 await invoke(privateUi,'acira:dispatch',{type:'tab.new',url:base+'/private?case='+mode});const state=snapshot(privateUi),partition=state.browserProfiles[0].partition;
 await poll(()=>fs.existsSync(path.join(directory,'held-worker')),Boolean,'positive held request');assert.equal(Object.keys(session.fromPartition(partition).serviceWorkers.getAllRunning()).length,1);assert.ok(BaseWindow.getAllWindows().every(w=>!w.isVisible()));
 if(mode==='last-private-window'){send(ordinary,'acira:window','close');await poll(()=>ordinary.isDestroyed(),Boolean,'ordinary closed');}
 privateUi.once('destroyed',()=>fs.writeFileSync(path.join(directory,'private-closed'),'closed'));
 fs.writeFileSync(path.join(directory,'positive.json'),JSON.stringify({mode,runningWorkers:1,allHidden:true}));
 if(mode==='app-quit')app.quit();else send(privateUi,'acira:window','close');
}).catch(error=>{fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({error:error.stack}));app.exit(1);});
