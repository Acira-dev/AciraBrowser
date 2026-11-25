'use strict';
const { tm } = require('./tm.cjs');
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {artworkImageInfo,MAX_INPUT_BYTES}=require('./artwork-image.cjs');
const {createArtworkRenditions}=require('./artwork-renditions.cjs');const {createProfileVideo,EXTENSIONS:VIDEO_EXTENSIONS}=require('./workspace-video.cjs');const {createArtworkThumbs}=require('./artwork-thumbs.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/* 14.1 (a Discord ask): up to 12 of the person's own pictures per profile (was 5), several chosen at once, the New Tab cycling through them.
 * The profile's 20 MB stays (it is what one profile transfer carries: desktop/transfer/inventory.cjs CAPS.picturesBytes). */
const MAX_ASSETS=12,MAX_OUTPUT_BYTES=6*1024*1024,MAX_PROFILE_BYTES=20*1024*1024,FULL="Remove a personal image before adding another. You can keep up to 12.";
/** Settings shows the pictures as cards about 200 px wide: a 480 px JPEG of each, made on first sight and held in memory for the window (artwork-thumbs.cjs does the same for the paintings), so the library never decodes twelve 1920 px pictures for twelve small cards. */
const THUMB_WIDTH=480,THUMB_QUALITY=78;
function createWorkspaceArtwork({root,nativeImage,dialog}){
 const scopes=new Map(),profiles=new Map(),base=path.resolve(root,'personal-artwork');
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 function folder(profileId){const directory=path.join(base,digest(profileId));fs.mkdirSync(directory,{recursive:true});const realBase=fs.realpathSync(base),real=fs.realpathSync(directory);if(!real.startsWith(realBase+path.sep)||fs.lstatSync(directory).isSymbolicLink())throw Error('Personal artwork storage is unavailable.');return directory;}
 function load(profileId){
  if(profiles.has(profileId))return profiles.get(profileId);
  const assets=new Map();let directory;
  try{directory=folder(profileId);const file=path.join(directory,'index.json');if(fs.existsSync(file)&&fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink()&&fs.statSync(file).size<=16384){const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(parsed.version===1&&Array.isArray(parsed.assets))for(const item of parsed.assets.slice(0,MAX_ASSETS)){if(!item||!UUID.test(item.id)||!['image/png','image/jpeg'].includes(item.mime)||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>MAX_OUTPUT_BYTES||!/^[a-f0-9]{64}$/.test(item.sha256))continue;const entry={id:item.id,name:typeof item.name==='string'?item.name.slice(0,100):'Personal image',mime:item.mime,bytes:item.bytes,width:item.width,height:item.height,sha256:item.sha256};const target=path.join(directory,entry.id+(entry.mime==='image/png'?'.png':'.jpg'));if(fs.existsSync(target)&&!fs.lstatSync(target).isSymbolicLink()&&fs.lstatSync(target).isFile()&&fs.statSync(target).size===entry.bytes)assets.set(entry.id,entry);}}}catch{throw Error('Personal artwork could not be read.');}
  if([...assets.values()].reduce((sum,item)=>sum+item.bytes,0)>MAX_PROFILE_BYTES)throw Error('Personal artwork exceeds this profile’s storage limit.');const state={directory,assets};profiles.set(profileId,state);return state;
 }
 function save(state){const target=path.join(state.directory,'index.json'),temporary=path.join(state.directory,'index-'+randomUUID()+'.tmp');try{fs.writeFileSync(temporary,JSON.stringify({version:1,assets:[...state.assets.values()]}),{flag:'wx'});fs.renameSync(temporary,target);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
 function createScope({profileId,privateMode=false,getWindow=()=>null,onChange=()=>{}}){
  if(typeof profileId!=='string'||!profileId||profileId.length>160)throw Error('Personal artwork requires a local profile.');
  const token=randomUUID(),state=privateMode?{assets:new Map(),memory:new Map()}:load(profileId);let alive=true,busy=false;
  const check=()=>{if(!alive)throw Error('This artwork window has closed.');};
  const thumbs=new Map();
  /* 14.4 live wallpaper: the profile's one video lives in the same folder (desktop/workspace-video.cjs). A private window has none. */
  if(!privateMode&&!state.video)state.video=createProfileVideo({directory:state.directory,nativeImage,onChange:()=>{for(const item of scopes.values())if(item.profileId===profileId&&!item.privateMode)item.changed();}});
  const videoView=entry=>entry&&{id:entry.id,name:entry.name,codec:entry.codec,mime:entry.mime,width:entry.width,height:entry.height,duration:entry.duration,powerEfficient:entry.powerEfficient,url:`acira-browser-ui://ui/personal-video/${token}/${entry.id}/file`,still:`acira-browser-ui://ui/personal-video/${token}/${entry.id}/still`};
  const list=()=>{check();return{profileId,private:privateMode,assets:[...state.assets.values()].map(item=>({id:item.id,name:item.name,width:item.width,height:item.height,bytes:item.bytes,url:`acira-browser-ui://ui/personal-artwork/${token}/${item.id}`,thumb:`acira-browser-ui://ui/personal-artwork/${token}/${item.id}/thumb`}))};};
  const notify=()=>{for(const item of scopes.values())if(item.profileId===profileId&&item.privateMode===privateMode&&(!privateMode||item.token===token))item.changed();};
  /** One chosen file's bytes: a plain file (no link, no folder), read once and never more than 8 MB. */
  const readFile=source=>{const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_INPUT_BYTES)throw Error('Choose a PNG or JPEG file up to 8 MB.');const handle=fs.openSync(source,'r');try{const buffer=Buffer.alloc(MAX_INPUT_BYTES+1),length=fs.readSync(handle,buffer,0,buffer.length,0);return buffer.subarray(0,length);}finally{fs.closeSync(handle);}};
  /** Checks, re-encodes (at most 1920 x 1440) and stores one picture; returns its new id. The stored name is a file name only; the file on disk is named by the id. */
  const addBytes=(bytes,name)=>{
   check();if(state.assets.size>=MAX_ASSETS)throw Error(FULL);
   const info=artworkImageInfo(bytes),image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('This image could not be decoded.');const actual=image.getSize();if(actual.width!==info.width||actual.height!==info.height)throw Error('This image has inconsistent dimensions.');const ratio=Math.min(1,1920/actual.width,1440/actual.height),resized=ratio<1?image.resize({width:Math.max(1,Math.round(actual.width*ratio)),height:Math.max(1,Math.round(actual.height*ratio)),quality:'best'}):image;const output=info.mime==='image/png'?resized.toPNG():resized.toJPEG(88);if(!output.length||output.length>MAX_OUTPUT_BYTES||[...state.assets.values()].reduce((sum,item)=>sum+item.bytes,output.length)>MAX_PROFILE_BYTES)throw Error('This image exceeds the personal artwork storage limit.');
   check();const id=randomUUID(),size=resized.getSize(),entry={id,name:path.basename(name.replaceAll('\\','/')).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,100)||'Personal image',mime:info.mime,bytes:output.length,width:size.width,height:size.height,sha256:digest(output)};let target;
   if(privateMode)state.memory.set(id,output);else{target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));fs.writeFileSync(target,output,{flag:'wx'});}state.assets.set(id,entry);try{if(!privateMode)save(state);}catch{state.assets.delete(id);if(target&&fs.existsSync(target))fs.unlinkSync(target);throw Error('The personal image could not be saved.');}
   return id;
  };
  const scope={token,profileId,privateMode,list,changed:onChange,
   /** 14.4: the profile's video (null when none), with this window's addresses for the file and its still. */
   videoInfo(){check();return{profileId,private:privateMode,video:privateMode?null:videoView(state.video.info())};},
   /** 14.4: the chooser for ONE video; the file is copied in as pending until the interface has played its first frame (commitVideo). */
   async importVideo(){check();if(privateMode)throw Error('Private windows cannot add a video.');if(busy)throw Error('An artwork chooser is already open.');busy=true;
    try{const selected=await dialog.showOpenDialog(getWindow(),{title:tm("workspaceArtwork.chooseANewTabVideo"),properties:['openFile'],filters:[{name:'MP4, MOV or WebM videos',extensions:VIDEO_EXTENSIONS}]});check();if(selected.canceled||!selected.filePaths?.length)return{cancelled:true};
     const entry=state.video.add(selected.filePaths[0]);return{pending:{id:entry.id,name:entry.name,codec:entry.codec,mime:entry.mime,bytes:entry.bytes,url:`acira-browser-ui://ui/personal-video/${token}/${entry.id}/file`}};
    }catch(error){throw typeof error?.code==='string'?Error('The video could not be read or copied. Choose the file again.'):error;}finally{busy=false;}},
   commitVideo(details){check();if(privateMode)throw Error('Private windows cannot add a video.');return{video:videoView(state.video.commit(details))};},
   discardVideo(id){check();if(!privateMode)state.video.discard(id);return{video:privateMode?null:videoView(state.video.info())};},
   removeVideo(){check();if(!privateMode)state.video.remove();return{video:null};},
   videoResponse(id,part,range){return privateMode?null:state.video.response(id,part,range);},
   /** The chooser takes several files at once (14.1). Each is checked and re-encoded alone (readFile below); the ones that fit are added in the order chosen, until the
    * profile holds 12 or its 20 MB. One file that is refused gives its own reason, as before; with several, the rest still arrive and `skipped` says how many did not. */
   async importImage(){check();if(busy)throw Error('An artwork chooser is already open.');if(state.assets.size>=MAX_ASSETS)throw Error(FULL);busy=true;
    try{const selected=await dialog.showOpenDialog(getWindow(),{title:tm("workspaceArtwork.chooseANewTabImage"),properties:['openFile','multiSelections'],filters:[{name:'PNG or JPEG images',extensions:['png','jpg','jpeg']}]});check();if(selected.canceled||!selected.filePaths?.length)return{...list(),cancelled:true};
     const files=selected.filePaths.slice(0,64),added=[];let first=null,skipped=0;
     for(const source of files){
      if(state.assets.size>=MAX_ASSETS){skipped+=files.length-files.indexOf(source);first||=Error(FULL);break;}
      try{added.push(addBytes(readFile(source),path.basename(String(source))));}catch(error){skipped++;first||=typeof error?.code==='string'?Error('The image could not be read or saved. Choose the file again.'):error;}
     }
     if(!added.length)throw first||Error('The image could not be read or saved. Choose the file again.');
     notify();return{...list(),addedId:added[0],addedIds:added,...(skipped?{skipped}:{})};
    }finally{busy=false;}
   },
   /** A profile transfer's pictures, as bytes: the same re-encoding and limits as importImage, without the chooser. Resolves to the new id. */
   async importBytes(input,name){check();if(busy)throw Error('An artwork chooser is already open.');const id=addBytes(Buffer.from(input),String(name||'Personal image'));notify();return id;},
   /** Every personal image with its bytes ({name, id, type, data: base64}), for a profile transfer. */
   async exportAll(){check();const out=[];for(const item of state.assets.values()){const read=scope.read(item.id);if(read)out.push({name:item.name,id:item.id,type:read.mime,data:read.bytes.toString('base64')});}return out;},
   remove(id){check();if(!UUID.test(id)||!state.assets.has(id))throw Error('This personal image is unavailable.');thumbs.delete(id);const entry=state.assets.get(id);if(privateMode)state.memory.delete(id);else{const target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink())throw Error('This personal image is unavailable.');fs.unlinkSync(target);}}state.assets.delete(id);if(!privateMode)save(state);notify();return list();},
   read(id){check();const entry=state.assets.get(id);if(!UUID.test(id)||!entry)return null;let bytes;if(privateMode)bytes=state.memory.get(id);else{const target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));if(!fs.existsSync(target)||!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()||fs.statSync(target).size!==entry.bytes)return null;bytes=fs.readFileSync(target);}if(!bytes||digest(bytes)!==entry.sha256)return null;return{bytes,mime:entry.mime};},
   /** The 480 px card picture of one image (made on first sight, held for this window; at most one per image). Falls back to the picture itself when it is that small already. */
   thumb(id){const read=scope.read(id);if(!read)return null;const have=thumbs.get(id);if(have)return have;let out=read;try{const image=nativeImage.createFromBuffer(read.bytes),size=image.getSize();if(size.width>THUMB_WIDTH){const bytes=image.resize({width:THUMB_WIDTH,quality:'good'}).toJPEG(THUMB_QUALITY);if(bytes.length)out={bytes,mime:'image/jpeg'};}}catch{}thumbs.set(id,out);return out;},
   dispose(){alive=false;scopes.delete(token);thumbs.clear();if(privateMode){state.memory.clear();state.assets.clear();}}
  };scopes.set(token,scope);return scope;
 }
 function response(url){const parts=url.pathname.split('/');if(url.hostname!=='ui'||!(parts.length===4||parts.length===5&&parts[4]==='thumb')||parts[1]!=='personal-artwork'||url.search||url.hash)return null;const scope=scopes.get(parts[2]);if(!scope)return null;try{return parts.length===5?scope.thumb(parts[3]):scope.read(parts[3]);}catch{return null;}}
 /** 14.4: /personal-video/<window token>/<id>/(file|still), with byte ranges for the file. */
 function videoResponse(url,range){const parts=url.pathname.split('/');if(url.hostname!=='ui'||parts.length!==5||parts[1]!=='personal-video'||!['file','still'].includes(parts[4])||!UUID.test(parts[3])||url.search||url.hash)return null;const scope=scopes.get(parts[2]);if(!scope)return null;try{return scope.videoResponse(parts[3],parts[4],range);}catch{return null;}}
 const renditions=createArtworkRenditions({root,dist:path.resolve(__dirname,'../dist'),nativeImage});
 const thumbs=createArtworkThumbs({root,dist:path.resolve(__dirname,'../dist'),remoteDirectory:path.join(root,'artwork-remote'),nativeImage});
 /** A removed profile's personal images leave with it (up to 20 MB of the person's own pictures); open windows of it are already closed. */
 function forget(profileId){
  profiles.delete(profileId);
  const directory=path.join(base,digest(profileId));
  if(path.dirname(directory)!==base)return;
  try{fs.rmSync(directory,{recursive:true,force:true});}catch{}
 }
 return{createScope,forget,response,videoResponse,rendition:url=>renditions.response(url),thumb:url=>thumbs.response(url),thumbnail:key=>thumbs.make(key)};
}
module.exports={createWorkspaceArtwork,MAX_ASSETS,MAX_PROFILE_BYTES};
