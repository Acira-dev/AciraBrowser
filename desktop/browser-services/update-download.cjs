'use strict';
// Acira's own download of an update file, so it can be paused (founder, 3 Nov 2026: people on 0.2-3 MB/s links). electron-updater can only cancel a
// download, and a cancelled one starts again from zero; this one keeps every byte it has in a partial file and asks for the rest with an HTTP Range
// request, after a pause, a dropped connection or a quit. GitHub's release downloads redirect to a host that honours Range; a server that ignores it
// answers 200 and the file simply starts again.
// The file is always written from its first byte to its last, so what is on disk is a prefix of the new file however it got there. That makes the
// Windows differential download resumable too: its plan (diffPlan, from the two versions' blockmaps and electron-updater's own planner) copies the
// unchanged blocks from the old setup and fetches each changed run with its own single Range request (GitHub refuses multi-range requests with 501,
// which is why electron-updater's own differential never worked against Acira's feed). A pause keeps the prefix; a differential that cannot finish
// falls back to the whole file from the same byte.
// The partial belongs to exactly one file of the feed: its SHA-512 and size are written beside it, and any other partial is removed first. The whole file
// is checked against the feed's SHA-512 before anything else sees it; a mismatch deletes it (ERR_CHECKSUM_MISMATCH).
// handOver() then puts the verified file where electron-updater's DownloadedUpdateHelper looks for "an update already downloaded by an earlier launch"
// (<cache>/pending/<file> + update-info.json), so electron-updater's own downloadUpdate() finds it, checks the SHA-512 once more and goes on as it
// always did: Squirrel.Mac on a Mac, the NSIS installer on Windows. Nothing here installs anything, and nothing partial ever reaches that folder.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib'),{createHash}=require('node:crypto');

const PART='update.part',META='update.part.json',MAPS='blockmaps.json',DIR_NAME='acira-partial';
const STALL=60*1000,SPEED_WINDOW=5000,COPY_CHUNK=1024*1024,MAP_MAX=16*1024*1024;

/** SHA-512 of a file, base64 (the feed's form). */
function hashFile(file){
 return new Promise((resolve,reject)=>{
  const hash=createHash('sha512');
  fs.createReadStream(file,{highWaterMark:1024*1024}).on('error',reject).on('data',chunk=>hash.update(chunk)).on('end',()=>resolve(hash.digest('base64')));
 });
}
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const sizeOf=file=>{try{return fs.statSync(file).size;}catch{return 0;}};
/** Only ever a folder this module made: an absolute path whose last part is acira-partial. */
const ownDir=dir=>typeof dir==='string'&&path.isAbsolute(dir)&&path.basename(dir)===DIR_NAME;

// A plan: the new file in order, as segments {start, end, old}: old is where to copy the segment from in the old file, or null to download it.
const wholePlan=size=>[{start:0,end:size,old:null}];
const downloaded=plan=>plan.reduce((sum,seg)=>sum+(seg.old===null?seg.end-seg.start:0),0);
const downloadedBefore=(plan,have)=>plan.reduce((sum,seg)=>sum+(seg.old===null?Math.max(0,Math.min(seg.end,have)-seg.start):0),0);
/** A plan that covers the file exactly, in order, every copy inside the old file; else null. */
function validPlan(plan,size,oldSize=Infinity){
 if(!Array.isArray(plan)||!plan.length)return null;
 let at=0;
 for(const seg of plan){
  if(!seg||seg.start!==at||!Number.isSafeInteger(seg.end)||seg.end<=seg.start)return null;
  if(seg.old!==null&&(!Number.isSafeInteger(seg.old)||seg.old<0||seg.old+seg.end-seg.start>oldSize))return null;
  at=seg.end;
 }
 return at===size?plan:null;
}

/** Bytes already here for this file (0 when the partial describes another file, which is removed). */
function received(dir,{sha512,size}){
 if(!ownDir(dir))return 0;
 const meta=readJson(path.join(dir,META));
 if(!meta||meta.sha512!==sha512||meta.size!==size)return 0;
 return Math.min(sizeOf(path.join(dir,PART)),size);
}
/** What the interface shows of a partial: the bytes fetched over the network so far and in all (a differential plan fetches only what changed). */
function progressOf(dir,{sha512,size}){
 const have=received(dir,{sha512,size}),plan=validPlan(readJson(path.join(dir,META))?.plan,size)||wholePlan(size);
 return {have,transferred:downloadedBefore(plan,have),total:downloaded(plan)};
}
/** null when there is room for the rest of this file (and `margin` beyond it), else {free, need} in bytes. A file system that cannot say, or a missing statfs, is "room". */
async function shortOfSpace(dir,{sha512,size,margin=0,statfs=fsp.statfs}={}){
 const ask=statfs||fsp.statfs;
 if(typeof ask!=='function')return null;
 try{
  let at=dir;while(!fs.existsSync(at)&&path.dirname(at)!==at)at=path.dirname(at);
  const stats=await ask(at),free=Number(stats.bavail)*Number(stats.bsize),need=Math.max(0,size-received(dir,{sha512,size}))+margin;
  return Number.isFinite(free)&&free<need?{free,need}:null;
 }catch{return null;}
}
/** Removes the partial file, its description and the blockmaps kept for it (and the folder, when that leaves it empty). */
function discard(dir){
 if(!ownDir(dir))return;
 for(const name of [PART,META,MAPS,'new.blockmap','old.blockmap'])try{fs.rmSync(path.join(dir,name),{force:true});}catch{}
 try{fs.rmdirSync(dir);}catch{}
}

/** A blockmap as electron-builder writes it (gzipped JSON) and electron-updater reads it; only the one-file form a setup has. */
function readBlockMap(raw){
 const map=JSON.parse(zlib.gunzipSync(raw).toString()),file=map?.files?.[0];
 if(!file||map.files.length!==1||!Array.isArray(file.checksums)||!Array.isArray(file.sizes)||file.checksums.length!==file.sizes.length||!Number.isSafeInteger(file.offset))throw new Error('Not a blockmap.');
 return map;
}
/** The size of the file a blockmap describes. */
const blockMapSize=map=>map.files[0].offset+map.files[0].sizes.reduce((sum,size)=>sum+size,0);
/** The Windows differential plan: electron-updater's own planner (computeOperations) over the old and the new blockmap, as segments of the new file. */
function diffPlan(oldMap,newMap,{size,oldSize}){
 const {computeOperations,OperationKind}=require('electron-updater/out/differentialDownloader/downloadPlanBuilder');
 if(newMap.files[0].offset!==0||blockMapSize(newMap)!==size)throw new Error('The new blockmap does not describe this file.');
 if(blockMapSize(oldMap)!==oldSize)throw new Error('The old blockmap does not describe the old file.');
 const plan=[];let at=0;
 for(const op of computeOperations(oldMap,newMap,{info(){},warn(){},debug:null})){
  const length=op.end-op.start,old=op.kind===OperationKind.COPY?op.start:null;
  plan.push({start:at,end:at+length,old});at+=length;
 }
 if(!validPlan(plan,size,oldSize))throw new Error('The differential plan does not cover the file.');
 return plan;
}
/** The blockmaps a differential download was planned from, kept beside the partial so a resume plans the same without fetching them again. */
function saveMaps(dir,{sha512,oldSize,newRaw,oldRaw}){
 if(!ownDir(dir))return;
 try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'new.blockmap'),newRaw);fs.writeFileSync(path.join(dir,'old.blockmap'),oldRaw);fs.writeFileSync(path.join(dir,MAPS),JSON.stringify({sha512,oldSize}));}catch{}
}
function loadMaps(dir,{sha512,oldSize}){
 const meta=ownDir(dir)?readJson(path.join(dir,MAPS)):null;
 if(!meta||meta.sha512!==sha512||meta.oldSize!==oldSize)return null;
 try{return {newRaw:fs.readFileSync(path.join(dir,'new.blockmap')),oldRaw:fs.readFileSync(path.join(dir,'old.blockmap'))};}catch{return null;}
}

class DownloadError extends Error{constructor(message,code){super(message);this.code=code;}}
const contentRange=value=>{const match=/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value||'').trim());return match?{start:Number(match[1]),end:Number(match[2]),total:match[3]==='*'?null:Number(match[3])}:null;};

/** Downloads `url` into <dir>/update.part, from where the partial stopped. Resolves {file} when the whole file is here and its SHA-512 matches,
 *  or {paused:true} when `signal` was aborted (the bytes stay). Rejects on a network error (the bytes stay, for the next try) and on a mismatch
 *  (the file is deleted). With a `plan` (diffPlan) and the `oldFile` it was made from, unchanged segments are copied from the old file and each
 *  changed one is fetched with its own Range request; a server that will not send a segment exactly rejects with ERR_UPDATE_RANGE (the bytes stay,
 *  and the caller goes on with the whole file). onProgress gets {transferred, total, bytesPerSecond} in bytes fetched over the network,
 *  bytesPerSecond averaged over the last five seconds. */
async function download({url,sha512,size,dir,plan:given=null,oldFile=null,headers={},fetch,signal,onProgress=()=>{},now=Date.now,stall=STALL}){
 if(!ownDir(dir))throw new Error('The update download folder is not valid.');
 if(typeof sha512!=='string'||!sha512||!Number.isSafeInteger(size)||size<=0)throw new Error('The update feed does not describe this file.');
 const whole=!given,plan=whole?wholePlan(size):validPlan(given,size,oldFile?sizeOf(oldFile):0);
 if(!plan)throw new Error('The differential plan does not fit these files.');
 await fsp.mkdir(dir,{recursive:true});
 const part=path.join(dir,PART),metaFile=path.join(dir,META),old=readJson(metaFile);
 if(!old||old.sha512!==sha512||old.size!==size){await fsp.rm(part,{force:true});}
 let have=received(dir,{sha512,size});
 if(have)await fsp.truncate(part,have);
 const meta={sha512,size,url,etag:old?.sha512===sha512?old.etag||null:null,plan:whole?null:plan};
 const writeMeta=()=>fsp.writeFile(metaFile,JSON.stringify(meta),{mode:0o600});
 await writeMeta();
 const total=downloaded(plan),fetched=()=>downloadedBefore(plan,have);
 const samples=[[now(),fetched()]],report=()=>{
  const at=now(),net=fetched();if(at-samples[samples.length-1][0]>=250)samples.push([at,net]);while(samples.length>2&&at-samples[1][0]>=SPEED_WINDOW)samples.shift();
  const [t0,b0]=samples[0],seconds=(at-t0)/1000;
  onProgress({transferred:net,total,bytesPerSecond:seconds>=.5?Math.max(0,(net-b0)/seconds):null});
 };
 const verify=async()=>{
  if(await hashFile(part)===sha512)return {file:part,size};
  await fsp.rm(part,{force:true});await fsp.rm(metaFile,{force:true});
  throw new DownloadError('The downloaded update does not match its SHA-512; it was deleted.','ERR_CHECKSUM_MISMATCH');
 };
 const paused=()=>({paused:true,transferred:fetched()});
 // An unchanged segment, read from the old file. Anything wrong with the old file is the plan's problem: ERR_UPDATE_RANGE.
 async function copy(seg){
  let from=null;
  try{
   from=await fsp.open(oldFile,'r');const out=await fsp.open(part,have?'a':'w'),buffer=Buffer.allocUnsafe(COPY_CHUNK);
   try{
    while(have<seg.end){
     if(signal?.aborted)return false;
     const want=Math.min(COPY_CHUNK,seg.end-have),{bytesRead}=await from.read(buffer,0,want,seg.old+have-seg.start);
     if(bytesRead!==want)throw new Error('The old file is shorter than its blockmap.');
     await out.write(buffer.subarray(0,bytesRead));have+=bytesRead;
    }
   }finally{await out.close().catch(()=>{});}
   report();return true;
  }catch(error){throw error instanceof DownloadError?error:new DownloadError('The old setup could not be read: '+(error?.message||error),'ERR_UPDATE_RANGE');}
  finally{await from?.close().catch(()=>{});}
 }
 // A segment from the network: the whole file (one request, open-ended, from wherever it stopped) or one changed run of a differential plan.
 async function fetchSegment(seg){
  for(let attempt=0;;attempt++){
   if(signal?.aborted)return false;
   const controller=new AbortController(),abort=()=>controller.abort();
   signal?.addEventListener('abort',abort,{once:true});
   let timer=null,stalled=false,response=null;
   const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{stalled=true;controller.abort();},stall);timer.unref?.();};
   try{
    const asked=!whole||have>0,ifRange=meta.etag&&!/^W\//.test(meta.etag)?{'if-range':meta.etag}:{};
    arm();
    response=await fetch(url,{headers:{...headers,...(asked?{range:`bytes=${have}-${whole?'':seg.end-1}`,...ifRange}:{})},signal:controller.signal,redirect:'follow'});
    const range=response.status===206?contentRange(response.headers.get('content-range')):null;
    // a web page where the file should be (a captive portal's sign-in, an error page served with 200): refused before a byte is kept
    if(response.ok&&/^\s*(?:text\/html|application\/xhtml)/i.test(String(response.headers.get('content-type')||'')))throw new DownloadError('A web page came back instead of the update (a sign-in page on this network?).','ERR_UPDATE_PORTAL');
    if(!whole&&!(range&&range.start===have&&range.end===seg.end-1&&(range.total===null||range.total===size))){
     throw new DownloadError(`The server did not send the changed part of the update (HTTP ${response.status}).`,'ERR_UPDATE_RANGE');
    }
    if(whole){
     if(response.status===416&&asked&&attempt===0){/* the server says what is here is not part of the file */await response.body?.cancel().catch(()=>{});await fsp.rm(part,{force:true});have=0;continue;}
     if(response.status===206){
      if(!range||range.total!==null&&range.total!==size)throw new DownloadError('The server sent a different file than the update feed describes.','ERR_UPDATE_SIZE');
      if(range.start!==have){await response.body?.cancel().catch(()=>{});await fsp.rm(part,{force:true});have=0;if(attempt>0)throw new DownloadError('The server sent the wrong part of the update.','ERR_UPDATE_RANGE');continue;}
     }else if(response.status===200){
      // a server that ignores Range (or a file that changed, If-Range): the whole file again, from its first byte
      const length=Number(response.headers.get('content-length'));
      if(Number.isFinite(length)&&length>0&&length!==size)throw new DownloadError('The server sent a different file than the update feed describes.','ERR_UPDATE_SIZE');
      have=0;
     }else throw new DownloadError(`The update download failed (HTTP ${response.status}).`,'ERR_UPDATE_HTTP');
    }
    if(!response.body)throw new DownloadError('The update download sent nothing.','ERR_UPDATE_HTTP');
    meta.etag=response.headers.get('etag')||meta.etag;await writeMeta();
    const out=await fsp.open(part,have?'a':'w'),reader=response.body.getReader();
    try{
     report();
     for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      arm();
      if(have+value.length>seg.end)throw new DownloadError('The server sent more than the update feed describes.',whole?'ERR_UPDATE_SIZE':'ERR_UPDATE_RANGE');
      await out.write(value);have+=value.length;report();
     }
    }finally{await reader.cancel().catch(()=>{});await out.sync().catch(()=>{});await out.close().catch(()=>{});}
    clearTimeout(timer);
    if(have===seg.end)return true;
    if(signal?.aborted)return false;
    throw new DownloadError('The update download ended early.','ERR_UPDATE_SHORT');
   }catch(error){
    clearTimeout(timer);
    // a refused or broken response is hung up at once, never left streaming into nothing
    controller.abort();await response?.body?.cancel().catch(()=>{});
    if(signal?.aborted)return false;
    if(stalled)throw new DownloadError('The update download stalled.','ERR_UPDATE_STALLED');
    throw error;
   }finally{signal?.removeEventListener('abort',abort);}
  }
 }
 report();
 try{
  for(const seg of plan){
   if(seg.end<=have)continue;
   if(!(seg.old===null?await fetchSegment(seg):await copy(seg)))return paused();
  }
 }catch(error){
  if(signal?.aborted)return paused();
  if(error?.code==='ERR_UPDATE_SIZE'){await fsp.rm(part,{force:true});await fsp.rm(metaFile,{force:true});}
  throw error;
 }
 return verify();
}

/** Puts a verified file where electron-updater looks for an update that an earlier launch downloaded: <pending>/<name> and update-info.json.
 *  With the new version's blockmap (Windows), it goes beside it as current.blockmap: electron-updater moves that into its cache when it takes the
 *  file, so the next update can be differential (its old blockmap is then on this computer). `helper` is electron-updater's DownloadedUpdateHelper:
 *  its clear() also forgets the update it took earlier in this run, which would otherwise hide this one when the file name is the same (every
 *  Windows setup is AciraBrowserSetup.exe), and electron-updater would download it all again by itself. */
async function handOver({file,pendingDir,name,sha512,isAdminRightsRequired=false,blockMap=null,helper=null}){
 if(path.basename(name)!==name||!name)throw new Error('The update file name is not valid.');
 if(helper)await helper.clear();
 await fsp.mkdir(pendingDir,{recursive:true});
 // whatever else is in the folder is a stale download (electron-updater empties it the same way when it starts a new one)
 for(const entry of await fsp.readdir(pendingDir))await fsp.rm(path.join(pendingDir,entry),{recursive:true,force:true});
 const target=path.join(pendingDir,name);
 try{await fsp.rename(file,target);}catch(error){if(error.code!=='EXDEV')throw error;await fsp.copyFile(file,target);await fsp.rm(file,{force:true});}
 await fsp.writeFile(path.join(pendingDir,'update-info.json'),JSON.stringify({fileName:name,sha512,isAdminRightsRequired:isAdminRightsRequired===true}));
 if(blockMap)await fsp.writeFile(path.join(pendingDir,'current.blockmap'),blockMap);
 discard(path.dirname(file));
 return target;
}
/** True when the pending folder already holds this exact file (a launch that downloaded it whole and quit before installing). electron-updater checks its SHA-512 itself. */
function handedOver({pendingDir,sha512,size}){
 const info=readJson(path.join(pendingDir,'update-info.json'));
 return Boolean(info&&info.sha512===sha512&&typeof info.fileName==='string'&&path.basename(info.fileName)===info.fileName&&sizeOf(path.join(pendingDir,info.fileName))===size);
}

module.exports={download,shortOfSpace,handOver,handedOver,received,progressOf,discard,hashFile,ownDir,readBlockMap,blockMapSize,diffPlan,downloaded,saveMaps,loadMaps,DIR_NAME,PART,META,MAP_MAX,STALL};
