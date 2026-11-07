#!/usr/bin/env node
// Serves the planned update documents and the built files from this computer, for the private tests on the Windows and Linux machines (the Mac rig serves its own).
// The documents are the ones scripts/release-publish.mjs planned (its review folder), with the GitHub file addresses pointed at this server, so what the app reads is
// what will be published except where the files are fetched from. It writes served.json: which documents were read and how many bytes of each file went out, which
// scripts/rehearsal-receipt.mjs turns into the automatic half of a receipt.
//   node scripts/serve-update-rehearsal.mjs --review release/update-review/<bridge>__<next> --hop 1 --bridge-dir <folder> [--next-dir <folder>] [--port 8080] [--mode ok|503|404|html|garbage|hang] [--log served.json]
// Hop 1 serves the rehearsal documents (the bridge release, for a beta.10 copy); hop 2 the testers documents (the next release, for a beta.11 copy).
// The old copy is started against it with:  ACIRA_UPDATE_TEST=1 ACIRA_UPDATE_FEED=http://127.0.0.1:<port>/   (a beta.11 copy on hop 2 can use the testers opt-in instead).
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DOWNLOAD=/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/([^/]+)\/([^/?#]+)$/;
const ALLOWED=['beta.yml','beta-mac.yml','latest.yml','latest-mac.yml','linux/beta-linux.yml','linux/latest-linux.yml'];
/** The review folder's document, with every GitHub file address pointed at this server. */
export function rewrite(text,origin){
 const doc=JSON.parse(text),to=url=>{const match=DOWNLOAD.exec(String(url));return match?origin+'/files/'+match[1]+'/'+match[2]:url;};
 const next={...doc,files:(doc.files||[]).map(file=>({...file,url:to(file.url)})),...(doc.path?{path:to(doc.path)}:{}),...(doc.previousBlockMaps?{previousBlockMaps:doc.previousBlockMaps.map(item=>({...item,url:to(item.url)}))}:{})};
 delete next.stagingPercentage;delete next.halted;
 return JSON.stringify(next,null,2)+'\n';
}
export async function createRehearsalServer({review,hop,dirs,mode='ok'}){
 const folder=path.join(review,hop===1?'rehearsal':'testers');
 const plan=JSON.parse(await fs.readFile(path.join(review,'PLAN.json'),'utf8')),tags=new Map(plan.releases.map(release=>[release.tag,release]));
 const log={startedAt:new Date().toISOString(),hop,mode,requests:[]};let origin='';
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x'),name=decodeURIComponent(url.pathname).replace(/^\//,'');
  const entry={path:'/'+name,status:0,bytes:0,range:req.headers.range||null};log.requests.push(entry);
  const end=(status,body='')=>{entry.status=status;res.statusCode=status;res.end(body);};
  try{
   if(ALLOWED.includes(name)){
    if(mode==='hang')return;
    if(mode==='503'||mode==='404')return end(Number(mode),'no');
    if(mode==='html')return end(200,'<!doctype html><title>Site not found</title>');
    if(mode==='garbage')return end(200,':\n  - [unclosed');
    const text=await fs.readFile(path.join(folder,...name.split('/')),'utf8').catch(()=>null);
    if(text===null)return end(404,'no document');
    res.setHeader('content-type','text/plain');return end(200,rewrite(text,origin));
   }
   const file=/^files\/([^/]+)\/([^/]+)$/.exec(name);
   if(file){
    const release=tags.get(file[1]);
    // the built files are found by name in the folder of the version the tag belongs to (the bridge release's, or the next one's)
    const dir=release&&(file[1].startsWith('v'+plan.bridge+'-')?dirs.bridge:file[1].startsWith('v'+plan.next+'-')?dirs.next:null);
    const target=dir&&path.join(dir,path.basename(file[2]));
    const stat=target&&await fs.stat(target).catch(()=>null);
    if(!stat)return end(404,'this rehearsal does not have that file');
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||''),start=range?Number(range[1]):0,last=range&&range[2]?Math.min(Number(range[2]),stat.size-1):stat.size-1;
    res.writeHead(range?206:200,{'content-length':last-start+1,'accept-ranges':'bytes',etag:'"'+stat.size+'-'+stat.mtimeMs+'"',...(range?{'content-range':`bytes ${start}-${last}/${stat.size}`}:{})});
    entry.status=range?206:200;
    const stream=createReadStream(target,{start,end:last});stream.on('data',chunk=>{entry.bytes+=chunk.length;});stream.pipe(res);return;
   }
   return end(404,'not found');
  }catch(error){if(!res.headersSent)end(500,String(error.message));else res.destroy(error);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
 const summary=()=>({documentFetched:log.requests.some(item=>ALLOWED.includes(item.path.slice(1))&&item.status===200),fileBytesServed:log.requests.filter(item=>item.path.startsWith('/files/')).reduce((sum,item)=>sum+item.bytes,0)});
 return {origin,log,summary,close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(()=>resolve());})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
 const review=path.resolve(value('review')||''),hop=Number(value('hop')),bridgeDir=value('bridge-dir'),nextDir=value('next-dir');
 if(![1,2].includes(hop)||!value('review')||!bridgeDir){console.error('Usage: node scripts/serve-update-rehearsal.mjs --review <review folder> --hop 1|2 --bridge-dir <folder> [--next-dir <folder>] [--mode ok|503|404|html|garbage|hang] [--log served.json]');process.exit(2);}
 const server=await createRehearsalServer({review,hop,dirs:{bridge:path.resolve(bridgeDir),next:nextDir&&path.resolve(nextDir)},mode:value('mode')||'ok'});
 const logFile=path.resolve(value('log')||'served.json'),save=()=>fs.writeFile(logFile,JSON.stringify({...server.log,summary:server.summary()},null,2)+'\n');
 console.log('Serving hop '+hop+' at '+server.origin+'/\nStart the old copy with  ACIRA_UPDATE_TEST=1 ACIRA_UPDATE_FEED='+server.origin+'/   (the log goes to '+logFile+'; press Ctrl+C when the test is over)');
 const timer=setInterval(save,2000);
 process.on('SIGINT',async()=>{clearInterval(timer);await save();await server.close();process.exit(0);});
}
