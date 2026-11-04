// A stand-in for the two things scripts/publish-update.mjs talks to: GitHub (the gh subset it uses: releases and their assets, the feed repository's
// contents, ref, trees and commits) and the anonymous web (release downloads and the raw feed). Nothing here touches the network.
// tests/publish-update.test.mjs uses the model in-process ({state, gh, fetch}); qa/publish-update-proof.mjs serves it over HTTP (serveStandIn) and runs
// the real script with --stand-in http://127.0.0.1:<port>. Failure switches on state: failUpload, corrupt (flips the first byte of that asset as it is
// stored; with corruptOnce only the next upload of it), moveMainDuringPublish (the feed branch moves before the commit lands), isPrivate, canPush.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import http from 'node:http';
import path from 'node:path';

export const REPO='Acira-dev/AciraBrowserUpdates';
const DOWNLOAD=/^https:\/\/github\.com\/Acira-dev\/AciraBrowserUpdates\/releases\/download\/([^/]+)\/([^/?#]+)$/;
const RAW=/^https:\/\/raw\.githubusercontent\.com\/Acira-dev\/AciraBrowserUpdates\/main\/feed\/([^/?#]+)$/;
/** A channel document's text: a version alone is a document that offers it with no files (0.0.0 is standby); an object is written as the publisher writes it. */
export const feedText=value=>typeof value==='string'?JSON.stringify({version:value,files:[]}):JSON.stringify(value,null,2)+'\n';

/** feed: {file: version | document}. dir: keep uploaded assets on disk there (large files); without it they stay in memory. */
export function createStandIn({feed={'beta-mac.yml':'0.1.0-beta.4','beta.yml':'0.0.0','latest-mac.yml':'0.0.0','latest.yml':'0.0.0'},dir=null}={}){
 const state={releases:new Map(),feed:Object.fromEntries(Object.entries(feed).map(([file,value])=>[file,feedText(value)])),head:'head0',history:[],log:[],pendingTree:null,commits:0,commitBody:null,
  failUpload:null,corrupt:null,corruptOnce:false,moveMainDuringPublish:false,isPrivate:false,canPush:true,downloadsWithCredentials:0};
 const notFound=message=>Object.assign(Error(message),{stderr:message});
 const find=tag=>{const release=state.releases.get(tag);if(!release)throw notFound('release not found');return release;};
 /** Stores an asset (a Buffer, or a stream of its bytes) the way GitHub would, applying the failure switches. */
 async function upload(tag,name,source){
  const release=find(tag);state.log.push('UPLOAD '+tag+' '+name);
  if(state.failUpload===name){if(!Buffer.isBuffer(source))source.resume();throw notFound('upload failed: '+name);}
  let asset;
  if(dir){
   const file=path.join(dir,tag,name);await fs.mkdir(path.dirname(file),{recursive:true});
   if(Buffer.isBuffer(source))await fs.writeFile(file,source);else await pipeline(source,createWriteStream(file));
   if(state.corrupt===name){const handle=await fs.open(file,'r+'),byte=Buffer.alloc(1);try{await handle.read(byte,0,1,0);byte[0]^=0xff;await handle.write(byte,0,1,0);}finally{await handle.close();}if(state.corruptOnce)state.corrupt=null;}
   asset={size:(await fs.stat(file)).size,file};
  }else{
   let bytes=Buffer.isBuffer(source)?source:Buffer.concat(await source.toArray());
   if(state.corrupt===name){bytes=Buffer.from(bytes);bytes[0]^=0xff;if(state.corruptOnce)state.corrupt=null;}
   asset={size:bytes.length,bytes};
  }
  release.assets.set(name,asset);
 }
 /** A published release that already exists (what an earlier run left), with its assets as Buffers. */
 function seedRelease(tag,{assets={},isDraft=false,prerelease=true}={}){
  state.releases.set(tag,{isDraft,prerelease,notes:'',assets:new Map(Object.entries(assets).map(([name,bytes])=>[name,{size:bytes.length,bytes}]))});
 }
 const gh=async(args,{input}={})=>{
  state.log.push(args.slice(0,5).join(' '));
  const [command,...rest]=args;
  if(command==='release'){
   const [sub,tag]=rest;
   if(sub==='view'){const release=find(tag);return JSON.stringify({tagName:tag,isDraft:release.isDraft,assets:[...release.assets].map(([name,asset])=>({name,size:asset.size}))});}
   if(sub==='create'){state.releases.set(tag,{isDraft:true,prerelease:rest.includes('--prerelease'),assets:new Map(),notes:await fs.readFile(rest[rest.indexOf('--notes-file')+1],'utf8')});return '';}
   if(sub==='upload'){const file=rest[2];await upload(tag,path.basename(file),await fs.readFile(file));return '';} // like the real gh: the asset is named after the file
   if(sub==='edit'){const release=find(tag);if(rest.includes('--draft=false'))release.isDraft=false;return '';}
   if(sub==='delete-asset'){const release=find(tag),asset=release.assets.get(rest[2]);if(!asset)throw notFound('asset not found');if(asset.file)await fs.rm(asset.file,{force:true});release.assets.delete(rest[2]);return '';}
  }
  if(command==='api'){
   const method=rest.includes('-X')?rest[rest.indexOf('-X')+1]:'GET',endpoint=rest.find(item=>item.startsWith('repos/'))||'';
   if(endpoint===`repos/${REPO}`)return JSON.stringify({private:state.isPrivate,default_branch:'main',permissions:{push:state.canPush}});
   if(endpoint.startsWith(`repos/${REPO}/contents/feed/`)){const file=endpoint.split('/feed/')[1].split('?')[0];if(!state.feed[file])throw notFound('HTTP 404');return JSON.stringify({content:Buffer.from(state.feed[file]).toString('base64')});}
   if(endpoint.endsWith('/git/ref/heads/main'))return JSON.stringify({object:{sha:state.head}});
   if(/\/git\/commits\/[^/]+$/.test(endpoint)&&method==='GET')return JSON.stringify({tree:{sha:'tree-of-'+state.head}});
   if(endpoint.endsWith('/git/trees')){state.pendingTree=JSON.parse(input);return JSON.stringify({sha:'newtree'});}
   if(endpoint.endsWith('/git/commits')){state.commits++;state.commitBody=JSON.parse(input);return JSON.stringify({sha:'commit'+state.commits});}
   if(endpoint.endsWith('/git/refs/heads/main')){
    if(state.moveMainDuringPublish)throw notFound('Update is not a fast forward (HTTP 422)');
    const body=JSON.parse(input);if(body.force!==false)throw notFound('the stand-in only accepts fast-forward updates (force:false)');
    if(state.commitBody?.parents?.[0]!==state.head)throw notFound('Update is not a fast forward (HTTP 422)');
    for(const entry of state.pendingTree.tree)state.feed[entry.path.replace(/^feed\//,'')]=entry.content;
    state.head='commit'+state.commits;state.history.push({sha:state.head,message:state.commitBody.message,feed:{...state.feed}});state.log.push('FEED COMMITTED');return '{}';
   }
  }
  throw Error('stand-in gh: unexpected '+args.join(' '));
 };
 // anonymous reads: published releases only (a draft is invisible), and the public feed
 const fetch=async(url,init={})=>{
  const download=DOWNLOAD.exec(String(url));
  if(download){
   if(init.headers&&new Headers(init.headers).has('authorization'))state.downloadsWithCredentials++;
   const release=state.releases.get(download[1]),asset=release&&!release.isDraft&&release.assets.get(download[2]);state.log.push('DOWNLOAD '+download[2]);
   if(!asset)return new Response('not found',{status:404});
   return new Response(asset.file?Readable.toWeb(createReadStream(asset.file)):asset.bytes,{headers:{'content-length':String(asset.size)}});
  }
  const raw=RAW.exec(String(url));
  if(raw)return state.feed[raw[1]]?new Response(state.feed[raw[1]]):new Response('',{status:404});
  throw Error('stand-in fetch: unexpected '+url);
 };
 return {state,gh,fetch,upload,seedRelease};
}

/** Serves a stand-in on a loopback port for the script's --stand-in transport (scripts/publish-update.mjs standInTransport). Resolves {url, close}. */
export function serveStandIn(model,{host='127.0.0.1',port=0}={}){
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://stand-in'),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const fail=(status,error)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({message:String(error?.message||error),stderr:String(error?.stderr||error?.message||error)}));};
  try{
   if(req.method==='POST'&&url.pathname==='/gh'){const {args,input}=JSON.parse(Buffer.concat(await req.toArray()).toString());const out=await model.gh(args,{input});res.writeHead(200);return res.end(out);}
   if(req.method==='PUT'&&parts[0]==='upload'&&parts.length===3){await model.upload(parts[1],parts[2],req);res.writeHead(200);return res.end('');}
   if(req.method==='GET'&&(parts[0]==='download'&&parts.length===3||parts[0]==='raw'&&parts[1]==='feed'&&parts.length===3)){
    const target=parts[0]==='download'?`https://github.com/${REPO}/releases/download/${parts[1]}/${parts[2]}`:`https://raw.githubusercontent.com/${REPO}/main/feed/${parts[2]}`;
    const response=await model.fetch(target,{headers:req.headers.authorization?{authorization:req.headers.authorization}:{}});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(!response.body)return res.end();
    return await pipeline(Readable.fromWeb(response.body),res);
   }
   fail(404,'stand-in: no route '+req.method+' '+url.pathname);
  }catch(error){if(!res.headersSent)fail(/404|not found/i.test(String(error?.message))?404:500,error);else res.destroy(error);}
 });
 return new Promise(resolve=>server.listen(port,host,()=>resolve({url:`http://${host}:${server.address().port}`,close:()=>new Promise(done=>{server.closeAllConnections?.();server.close(()=>done());})})));
}
