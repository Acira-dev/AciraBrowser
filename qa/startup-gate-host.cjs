'use strict';
const{app,BrowserWindow,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const{createStartupGate}=require('../desktop/startup-gate.cjs'),{createExternalLinkIntake}=require('../desktop/accounts/external-links.cjs'),{createSessionShutdown}=require('../desktop/session-durability.cjs');
const root=process.env.ACIRA_GATE_DATA,nonce=process.env.ACIRA_GATE_NONCE;app.setPath('userData',root);fs.mkdirSync(path.join(root,'native-session-data'),{recursive:true});app.setPath('sessionData',path.join(root,'native-session-data'));app.setName('Acira isolated startup gate');
const primary=app.requestSingleInstanceLock();let links,gate,quitBarrier=false;
const write=(name,value)=>fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify({nonce,pid:process.pid,...value}));
if(!primary)app.quit();else{
 links=createExternalLinkIntake({app});write('primary-lock',{primary:true});
 const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'quit.signal')))app.quit();else if(quitBarrier&&fs.existsSync(path.join(root,'quit-release.signal')))app.quit();},20);timer.unref();
 app.whenReady().then(async()=>{
  write('pre-gate',{windows:BrowserWindow.getAllWindows().length});
  gate=createStartupGate({app,safeStorage,links});const state=await gate.prepare();fs.appendFileSync(path.join(root,'phases.jsonl'),JSON.stringify({nonce,pid:process.pid,...state,windows:BrowserWindow.getAllWindows().length})+'\n');
  if(!state.ready){if(!state.restarting){write('failed',{error:state.error});app.quit();}return;}
  write('gate-ready',{beforeNetwork:true});const urls=[];
  await links.bind(async url=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL(url);urls.push(win.webContents.getURL());});
  write('ready',{urls,allWindowsHidden:BrowserWindow.getAllWindows().every(win=>!win.isVisible()),initialHTTPArgs:process.argv.filter(arg=>/^https?:\/\//i.test(arg)).length,handoffRemoved:!fs.existsSync(path.join(root,'startup-links.bin')),splitSessionData:app.getPath('sessionData')!==app.getPath('userData')});
 }).catch(error=>{write('failed',{error:error.message});app.quit();});
 app.on('before-quit',event=>{if(gate?.restarting&&!quitBarrier&&!fs.existsSync(path.join(root,'quit-release.signal'))){event.preventDefault();quitBarrier=true;write('quit-barrier',{windows:BrowserWindow.getAllWindows().length,handoffProtected:!fs.readFileSync(path.join(root,'startup-links.bin')).includes(Buffer.from('http://127.0.0.1'))});}else if(!gate?.restarting)links.dispose();});
 app.on('will-quit',createSessionShutdown({beforeFlush:()=>gate?.flush(),getSessions:()=>[...new Set(BrowserWindow.getAllWindows().map(win=>win.webContents.session))],quit:()=>{links.dispose();app.quit();}}));
}
