'use strict';
const {t}=require('./tx.cjs');
const path=require('node:path'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const httpURL=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const dangerous=name=>/\.(?:exe|msi|msix|appx|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|scr|cpl|reg|lnk|url|sh|desktop|app|pkg|dmg|mpkg|command|tool|terminal|workflow|action|scpt|scptd|applescript|jar)$/i.test(name);
const read=(item,method,fallback)=>{try{return item[method]();}catch{return fallback;}};

/** Native-selected paths and engine validators stay in main; private recovery is memory-only. */
function createDownloads({dialog,shell,app,getOwner,askSite,preferences,torWarning=()=>false,journalPath=path.join(app.getPath('userData'),'download-recovery.json'),now=Date.now}){
 const active=new Map(),attached=new WeakSet(),recoveries=new Map(),pending=new WeakMap(),bursts=new Map(),observers=new Set(),expected=new WeakMap();let lastPersist=0;
 /* chrome.downloads (ext-api/downloads): observers hear every ordinary download's records before the Downloads page does; expected holds the downloads an extension asked for, matched to their will-download by address. */
 const emit=event=>{for(const observer of [...observers])try{observer(event);}catch{}};
 try{if(fs.statSync(journalPath).size<4*1024*1024){const saved=JSON.parse(fs.readFileSync(journalPath,'utf8'));for(const entry of saved.entries||[])if(entry&&typeof entry.id==='string'&&typeof entry.profileId==='string'&&!entry.profileId.startsWith('private-')&&path.isAbsolute(entry.path||'')&&Array.isArray(entry.urlChain)&&entry.urlChain.length>0&&entry.urlChain.every(httpURL))recoveries.set(entry.id,entry);}}catch{}
 function persist(force=false){if(!force&&now()-lastPersist<1000)return;lastPersist=now();fs.mkdirSync(path.dirname(journalPath),{recursive:true});const entries=[...recoveries.values()].filter(e=>!e.private).slice(-500);fs.writeFileSync(journalPath+'.tmp',JSON.stringify({version:1,entries}));fs.renameSync(journalPath+'.tmp',journalPath);}
 const canRecover=entry=>{try{return !!entry&&entry.offset>0&&entry.length>entry.offset&&fs.statSync(entry.path).isFile()&&fs.statSync(entry.path).size>=entry.offset;}catch{return false;}};
 function attach(session){if(attached.has(session))return;attached.add(session);session.on('will-download',async(event,item,wc)=>{
  const recovering=!wc&&(pending.get(session)||[]).find(e=>e.path===read(item,'getSavePath',''));
  if(recovering)pending.set(session,(pending.get(session)||[]).filter(e=>e!==recovering));
  const claimed=!recovering&&!wc?takeExpected(session,item):null,owner=recovering?.owner||claimed?.owner||getOwner(wc);if(!owner){event.preventDefault();return;}
  const id=recovering?.id||'download-'+randomUUID(),profileId=owner.profileId,startedAt=recovering?.startedAt||now();if(claimed)claimed.begin(id);let announced=!!recovering,ended,ext=claimed?.request.extension;let selectedPath=recovering?.path,last=0,lastStatus='',terminal=false,startedToast=false,endedToast=false;
  /* A download starting says so with Show (opens the panel), finishing with Open, failing with Retry. A private transfer never offers Retry: it would run in the ordinary session. */
  const clip=text=>text.length>56?text.slice(0,28)+'…'+text.slice(-24):text,announce=status=>{if(typeof owner.toast!=='function')return;const name=clip(path.basename(selectedPath||read(item,'getFilename','Download')));
   if(status==='Downloading'&&!recovering&&!startedToast){startedToast=true;owner.toast(t('dl.started',{name}),{tone:'info',action:{label:t('dl.show'),command:{type:'ui.open',panel:'downloads'}}});}
   else if(status==='Ready'&&!endedToast){endedToast=true;owner.toast(t('dl.done',{name}),{action:{label:t('dl.open'),command:{type:'download.act',id,command:'open'}}});}
   else if(status==='Interrupted'&&terminal&&!endedToast){endedToast=true;const again=!owner.private&&!profileId.startsWith('private-')&&httpURL(read(item,'getURL',''));owner.toast(t('dl.failed',{name}),{tone:'error',...(again?{action:{label:t('dl.retry'),command:{type:'download.act',id,command:'retry'}}}:{})});}};
  // Private tabs keep an ephemeral engine/session owner but expose controls in their containing browser profile.
  const entry={item,profileId,recordProfileId:owner.recordProfileId||profileId,owner,session,pending:!recovering,speedAt:now(),speedBytes:0,speed:0};active.set(id,entry);
  const update=(status,force=false)=>{
   if(!force&&status===lastStatus&&now()-last<150)return;last=now();lastStatus=status;const receivedBytes=read(item,'getReceivedBytes',0),totalBytes=read(item,'getTotalBytes',0),measured=now(),dt=measured-entry.speedAt;if(dt>=700){const rate=Math.max(0,(receivedBytes-entry.speedBytes)*1000/dt);entry.speed=entry.speed?entry.speed*.6+rate*.4:rate;entry.speedAt=measured;entry.speedBytes=receivedBytes;}const flowing=!terminal&&!read(item,'isPaused',false)&&entry.speed>0,speed=flowing?Math.round(entry.speed):0,eta=flowing&&totalBytes>receivedBytes?Math.ceil((totalBytes-receivedBytes)/entry.speed):undefined,url=read(item,'getURL',''),paused=read(item,'isPaused',false),resumable=read(item,'canResume',false);
   const recovery={id,profileId,private:!!owner.private||profileId.startsWith('private-'),path:selectedPath,urlChain:read(item,'getURLChain',[url]),mimeType:read(item,'getMimeType',''),offset:receivedBytes,length:totalBytes,lastModified:read(item,'getLastModifiedTime',''),eTag:read(item,'getETag',''),startedAt,status};
   if(selectedPath&&httpURL(url)&&!['Ready','Cancelled'].includes(status))recoveries.set(id,recovery);else if(['Ready','Cancelled'].includes(status))recoveries.delete(id);
   try{persist(force);}catch{owner.toast('Download recovery data wasn’t saved.');}
   if(terminal&&!ended)ended=now();const chain=read(item,'getURLChain',[url]),extra={mime:read(item,'getMimeType',''),originalUrl:chain.length>1?chain[0]:undefined,endedAt:terminal?ended:undefined,updatedAt:now(),...(ext?{byExtensionId:ext.id,byExtensionName:ext.name}:{}),...(owner.tor?{tor:true}:{})};
   const shown={type:'download',tabId:owner.tabId,id,browserProfileId:profileId,name:read(item,'getFilename','Download'),path:selectedPath||'',receivedBytes,totalBytes,startedAt,url,speed,eta,size:totalBytes>0?`${Math.round(receivedBytes/1024)} / ${Math.round(totalBytes/1024)} KB`:`${Math.round(receivedBytes/1024)} KB`,status,canPause:!terminal&&!entry.pending&&!paused,canResume:!terminal&&!entry.pending&&resumable,canCancel:!terminal,canRetry:terminal&&!!httpURL(url)&&!recovery.private,dangerous:dangerous(selectedPath||read(item,'getFilename','')),...extra};
   if(observers.size&&!owner.private&&!profileId.startsWith('private-')){const type=announced?'changed':'created';announced=true;emit({type,profileId,record:shown});}
   owner.record(shown);
   announce(status);
  };
  entry.update=update;
  item.on('updated',(_event,state)=>update(read(item,'isPaused',false)?'Paused':state==='interrupted'?'Interrupted':'Downloading'));
  item.once('done',(_event,state)=>{terminal=true;update(state==='completed'?'Ready':state==='cancelled'?'Cancelled':'Interrupted',true);active.delete(id);});
  try{
   if(!recovering){item.pause();const burstKey=profileId+'|'+owner.tabId,prior=claimed?0:bursts.get(burstKey);if(!claimed)bursts.set(burstKey,now());if(prior&&now()-prior<10000){const allowedMany=askSite?await askSite(profileId,wc,{message:t('dl.manyMessage'),detail:t('dl.manyDetail')}):false;if(!allowedMany){item.cancel();owner.toast(t('dl.blockedRepeat'));return;}}
    const testDir=process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR,testRoot=process.env.ACIRA_BROWSER_TEST_DATA,validTest=testDir&&testRoot&&path.resolve(testDir).startsWith(path.resolve(testRoot)+path.sep);if(validTest)fs.mkdirSync(testDir,{recursive:true});
    /* R3-38: a secured workspace's file never lands silently in the normal Downloads folder: always ask where. */const direct=!validTest&&preferences&&!preferences.get().askWhere&&!profileId.startsWith('private-secured-');
    const selected=claimed?await claimed.destination({item,owner,dialog,preferences,app,t,testDir:validTest?testDir:null}):validTest?{canceled:false,filePath:path.join(testDir,path.basename(item.getFilename()))}:direct?{canceled:false,filePath:preferences.destination(item.getFilename())}:await dialog.showSaveDialog(owner.window,{title:t('dl.saveTitle'),defaultPath:path.join(preferences?.get().folder||app.getPath('downloads'),path.basename(item.getFilename()))});
    if(terminal)return;if(selected.canceled||!selected.filePath){item.cancel();return;}selectedPath=selected.filePath;item.setSavePath(selectedPath);
   }
   // createInterruptedDownload initializes the item after will-download returns.
   // Resuming synchronously inside that event is ignored by Chromium44.
   if(recovering)await new Promise(setImmediate);
   if(terminal)return;entry.pending=false;update('Downloading',true);item.resume();
  }catch(error){try{item.cancel();}catch{}active.delete(id);owner.toast('The download could not be saved: '+error.message);}
 });}
 function takeExpected(session,item){const queue=expected.get(session)||[],chain=read(item,'getURLChain',[]),wanted=[chain[0],read(item,'getURL',''),chain[chain.length-1]].filter(Boolean),index=queue.findIndex(entry=>wanted.includes(entry.href));if(index<0)return null;const [entry]=queue.splice(index,1);clearTimeout(entry.timer);return entry;}
 /** chrome.downloads.download: starts the transfer in the profile's session (its cookies, proxy and filters apply) and answers the record id once the response has started. */
 function startExtension({session,url,headers,owner,request,timeout=60000}){return new Promise((resolve,reject)=>{let href;try{href=new URL(url).href;}catch{reject(new Error('Invalid URL'));return;}const queue=expected.get(session)||[];expected.set(session,queue);
  const forget=()=>{const at=queue.indexOf(entry);if(at>=0)queue.splice(at,1);},entry={href,owner,request,begin:resolve,destination:details=>require('./ext-api/downloads/destination.cjs').chooseDestination({...details,request}),timer:setTimeout(()=>{forget();reject(new Error('NETWORK_FAILED'));},timeout)};entry.timer.unref?.();queue.push(entry);
  try{session.downloadURL(url,headers&&Object.keys(headers).length?{headers}:undefined);}catch(error){clearTimeout(entry.timer);forget();reject(error);}});}
 async function command(id,action,profileId,records,context={}){
  const record=records.find(r=>r.id===id&&r.browserProfileId===profileId);if(!record)throw new Error('Download is outside this profile.');
  if(action==='show'||action==='open'){
   if(record.status!=='Ready'||!record.path||!fs.existsSync(record.path))throw new Error('The downloaded file is unavailable.');
   if(action==='show'){shell.showItemInFolder(record.path);return {};}
   // A file from a Tor tab opens in another program, outside Tor and outside this browser (Tor Browser's download warning, asked before the file opens until "Got it" is chosen).
   if(record.tor&&torWarning()){const response=await dialog.showMessageBox(context.owner?.window,{type:'warning',title:t('tor.download.openTitle'),message:t('tor.download.title'),detail:t('tor.download.body'),buttons:[t('dialog.cancel'),t('dl.openFile')],defaultId:0,cancelId:0});if(response.response!==1)return {cancelled:true};}
   if(dangerous(record.path)){const response=await dialog.showMessageBox(context.owner?.window,{type:'warning',title:t('dl.openTitle'),message:t('dl.openMessage'),detail:t('dl.openDetail'),buttons:[t('dialog.cancel'),t('dl.openFile')],defaultId:0,cancelId:0});if(response.response!==1)return {cancelled:true};}
   const error=await shell.openPath(record.path);if(error)throw new Error(error);return {};
  }
  // A finished download dragged out of the Downloads page (to Explorer, a mail, an upload box): the native drag starts here, from the window that sent the request.
  if(action==='drag'){
   if(record.status!=='Ready'||!record.path||!fs.existsSync(record.path))throw new Error('The downloaded file is unavailable.');
   const sender=context.sender;if(!sender||sender.isDestroyed?.())return {};
   let icon=null;try{icon=await app.getFileIcon(record.path,{size:'normal'});}catch{}
   if(!icon||icon.isEmpty?.())icon=require('electron').nativeImage.createFromBitmap(Buffer.alloc(32*32*4,0xc8),{width:32,height:32});
   sender.startDrag({file:record.path,icon});return {};
  }
  const entry=active.get(id);
  if(entry){if(entry.recordProfileId!==profileId)throw new Error('Download is outside this profile.');if(action==='cancel'){entry.item.cancel();return {};}if(entry.pending)throw new Error('Choose a download destination first.');if(action==='pause'){entry.item.pause();entry.update('Paused',true);return {};}if(action==='resume'){if(!entry.item.canResume())throw new Error('The server cannot resume this transfer. Retry the download.');entry.item.resume();entry.update('Downloading',true);return {};}throw new Error('This transfer is already active.');}
  const wc=context.webContents,owner=wc&&!wc.isDestroyed()?getOwner(wc):null;
  if(['resume','retry'].includes(action)&&(!owner||owner.profileId!==profileId))throw new Error('Open a website tab in this profile before resuming or retrying.');
  if(action==='retry'){const url=httpURL(record.url);if(!url)throw new Error('This download address cannot be retried. Return to its website.');wc.downloadURL(url);return {restarted:true};}
  if(action==='resume'){
   const saved=recoveries.get(id);if(!canRecover(saved)||saved.profileId!==profileId)throw new Error('No valid partial file is available. Retry the download.');
   const queue=pending.get(wc.session)||[];if(queue.some(e=>e.id===id))throw new Error('This download is already resuming.');const pendingEntry={...saved,owner};queue.push(pendingEntry);pending.set(wc.session,queue);
   try{wc.session.createInterruptedDownload({path:saved.path,urlChain:saved.urlChain,mimeType:saved.mimeType,offset:saved.offset,length:saved.length,lastModified:saved.lastModified,eTag:saved.eTag,startTime:saved.startedAt/1000});}catch(error){pending.set(wc.session,queue.filter(e=>e!==pendingEntry));throw error;}return {resuming:true};
  }
  if(action==='cancel'){recoveries.delete(id);persist(true);return {cancelled:true};}
  throw new Error('This download is no longer active. Retry it from its website.');
 }
 function reconcile(records,profileId){return records.filter(r=>r.browserProfileId===profileId).map(record=>{const entry=active.get(record.id),saved=recoveries.get(record.id),finished=record.status==='Ready',exists=finished&&!!record.path&&fs.existsSync(record.path);return {...record,...(!entry&&['Downloading','Paused'].includes(record.status)?{status:'Interrupted'}:{}),canPause:!!entry&&!entry.pending&&!read(entry.item,'isPaused',false),canResume:entry?!!read(entry.item,'canResume',false):canRecover(saved),canCancel:!!entry||!!saved,canRetry:!entry&&!record.private&&!profileId.startsWith('private-')&&!!httpURL(record.url),canOpen:exists,canShow:exists};});}
 return {attach,command,reconcile,observe(listener){observers.add(listener);return()=>observers.delete(listener);},startExtension,hasActive:controller=>[...active.values()].some(e=>e.owner.controller===controller),hasActiveTab:tabId=>[...active.values()].some(e=>e.owner.tabId===tabId&&!e.pending||e.owner.tabId===tabId),clearPrivate(profileId){for(const [id,entry]of active)if(entry.profileId===profileId){try{entry.item.cancel();}catch{}active.delete(id);}for(const [id,entry]of recoveries)if(entry.profileId===profileId)recoveries.delete(id);for(const key of bursts.keys())if(key.startsWith(profileId+'|'))bursts.delete(key);}};
}
module.exports={createDownloads,dangerous};
