'use strict';
const { tm } = require('./tm.cjs');
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {artworkImageInfo,MAX_INPUT_BYTES}=require('./artwork-image.cjs');
const {createArtworkRenditions}=require('./artwork-renditions.cjs');const {createArtworkThumbs}=require('./artwork-thumbs.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_ASSETS=5,MAX_OUTPUT_BYTES=6*1024*1024,MAX_PROFILE_BYTES=20*1024*1024;
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
  const list=()=>{check();return{profileId,private:privateMode,assets:[...state.assets.values()].map(item=>({id:item.id,name:item.name,width:item.width,height:item.height,bytes:item.bytes,url:`acira-browser-ui://ui/personal-artwork/${token}/${item.id}`}))};};
  const notify=()=>{for(const item of scopes.values())if(item.profileId===profileId&&item.privateMode===privateMode&&(!privateMode||item.token===token))item.changed();};
  const scope={token,profileId,privateMode,list,changed:onChange,
   async importImage(){check();if(busy)throw Error('An artwork chooser is already open.');if(state.assets.size>=MAX_ASSETS)throw Error('Remove a personal image before adding another. You can keep up to 5.');busy=true;let id,target;
    try{const selected=await dialog.showOpenDialog(getWindow(),{title:tm("workspaceArtwork.chooseANewTabImage"),properties:['openFile'],filters:[{name:'PNG or JPEG images',extensions:['png','jpg','jpeg']}]});check();if(selected.canceled||!selected.filePaths?.length)return{...list(),cancelled:true};if(state.assets.size>=MAX_ASSETS)throw Error('Remove a personal image before adding another. You can keep up to 5.');const source=selected.filePaths[0],stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_INPUT_BYTES)throw Error('Choose a PNG or JPEG file up to 8 MB.');const handle=fs.openSync(source,'r');let bytes;try{const buffer=Buffer.alloc(MAX_INPUT_BYTES+1),length=fs.readSync(handle,buffer,0,buffer.length,0);bytes=buffer.subarray(0,length);}finally{fs.closeSync(handle);}const info=artworkImageInfo(bytes),image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('This image could not be decoded.');const actual=image.getSize();if(actual.width!==info.width||actual.height!==info.height)throw Error('This image has inconsistent dimensions.');const ratio=Math.min(1,1920/actual.width,1440/actual.height),resized=ratio<1?image.resize({width:Math.max(1,Math.round(actual.width*ratio)),height:Math.max(1,Math.round(actual.height*ratio)),quality:'best'}):image;const output=info.mime==='image/png'?resized.toPNG():resized.toJPEG(88);if(!output.length||output.length>MAX_OUTPUT_BYTES||[...state.assets.values()].reduce((sum,item)=>sum+item.bytes,output.length)>MAX_PROFILE_BYTES)throw Error('This image exceeds the personal artwork storage limit.');check();id=randomUUID();const size=resized.getSize(),entry={id,name:path.basename(source).slice(0,100),mime:info.mime,bytes:output.length,width:size.width,height:size.height,sha256:digest(output)};
     if(privateMode)state.memory.set(id,output);else{target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));fs.writeFileSync(target,output,{flag:'wx'});}state.assets.set(id,entry);try{if(!privateMode)save(state);}catch{state.assets.delete(id);if(target&&fs.existsSync(target))fs.unlinkSync(target);throw Error('The personal image could not be saved.');}notify();return{...list(),addedId:id};
    }catch(error){if(typeof error?.code==='string')throw Error('The image could not be read or saved. Choose the file again.');throw error;}finally{busy=false;}
   },
   remove(id){check();if(!UUID.test(id)||!state.assets.has(id))throw Error('This personal image is unavailable.');const entry=state.assets.get(id);if(privateMode)state.memory.delete(id);else{const target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink())throw Error('This personal image is unavailable.');fs.unlinkSync(target);}}state.assets.delete(id);if(!privateMode)save(state);notify();return list();},
   read(id){check();const entry=state.assets.get(id);if(!UUID.test(id)||!entry)return null;let bytes;if(privateMode)bytes=state.memory.get(id);else{const target=path.join(state.directory,id+(entry.mime==='image/png'?'.png':'.jpg'));if(!fs.existsSync(target)||!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()||fs.statSync(target).size!==entry.bytes)return null;bytes=fs.readFileSync(target);}if(!bytes||digest(bytes)!==entry.sha256)return null;return{bytes,mime:entry.mime};},
   dispose(){alive=false;scopes.delete(token);if(privateMode){state.memory.clear();state.assets.clear();}}
  };scopes.set(token,scope);return scope;
 }
 function response(url){const parts=url.pathname.split('/');if(url.hostname!=='ui'||parts.length!==4||parts[1]!=='personal-artwork'||url.search||url.hash)return null;const scope=scopes.get(parts[2]);if(!scope)return null;try{return scope.read(parts[3]);}catch{return null;}}
 const renditions=createArtworkRenditions({root,dist:path.resolve(__dirname,'../dist'),nativeImage});
 const thumbs=createArtworkThumbs({root,dist:path.resolve(__dirname,'../dist'),remoteDirectory:path.join(root,'artwork-remote'),nativeImage});
 /** A removed profile's personal images leave with it (up to 20 MB of the person's own pictures); open windows of it are already closed. */
 function forget(profileId){
  profiles.delete(profileId);
  const directory=path.join(base,digest(profileId));
  if(path.dirname(directory)!==base)return;
  try{fs.rmSync(directory,{recursive:true,force:true});}catch{}
 }
 return{createScope,forget,response,rendition:url=>renditions.response(url),thumb:url=>thumbs.response(url),thumbnail:key=>thumbs.make(key)};
}
module.exports={createWorkspaceArtwork};
