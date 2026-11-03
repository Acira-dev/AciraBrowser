'use strict';
// Acira's own update download (founder, 3 Nov 2026: pause the update; people download at 0.2-3 MB/s). A pause, a dropped connection or a quit keeps
// the bytes; the rest comes with an HTTP Range request. A server that ignores Range starts the file again, a wrong file is deleted, and only a whole
// file whose SHA-512 matches the feed is handed to electron-updater, in the form its own DownloadedUpdateHelper accepts.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
const {download,handOver,handedOver,received,discard,DIR_NAME,PART}=require('../desktop/browser-services/update-download.cjs');

const body=Buffer.from(Array.from({length:600000},(_,i)=>(i*7+i%13)&255));
const sha512=buf=>createHash('sha512').update(buf).digest('base64');
const made=[];test.after(()=>{for(const root of made)fs.rmSync(root,{recursive:true,force:true});}); // every throwaway folder goes when the file's tests end
const folder=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-update-download-'));made.push(root);return {root,dir:path.join(root,'cache',DIR_NAME),pending:path.join(root,'cache','pending')};};
const quiet={info(){},warn(){},error(){},debug(){}};

/** A file server. range: honour Range (206); etag: the file's ETag; slow: send in 50 KB pieces with a pause between; asked: every request's Range/If-Range. */
async function serve({file=body,range=true,etag='"v1"',slow=false,redirect=false,hang=false}={}){
 const asked=[];let served=0;
 const server=http.createServer((req,res)=>{
  if(redirect&&req.url==='/download/Acira.zip'){res.writeHead(302,{location:'/cdn/Acira.zip?sig=1'});return res.end();}
  asked.push({url:req.url,range:req.headers.range||null,ifRange:req.headers['if-range']||null});
  let start=0;const match=/^bytes=(\d+)-$/.exec(req.headers.range||'');
  const fresh=!req.headers['if-range']||req.headers['if-range']===etag;
  if(range&&match&&fresh){start=Number(match[1]);if(start>=file.length){res.writeHead(416,{'content-range':`bytes */${file.length}`});return res.end();}res.writeHead(206,{'content-range':`bytes ${start}-${file.length-1}/${file.length}`,'content-length':file.length-start,etag,'accept-ranges':'bytes'});}
  else res.writeHead(200,{'content-length':file.length,etag,...(range?{'accept-ranges':'bytes'}:{})});
  const rest=file.subarray(start);
  if(hang){res.write(rest.subarray(0,1000));served+=1000;return;}
  if(!slow){served+=rest.length;return res.end(rest);}
  let at=0;const step=()=>{if(res.destroyed)return;const piece=rest.subarray(at,at+50000);at+=piece.length;served+=piece.length;if(at>=rest.length)return res.end(piece);res.write(piece);setTimeout(step,15);};step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 return {url:base+(redirect?'/download/Acira.zip':'/Acira.zip'),asked,served:()=>served,close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})};
}
/** Starts a download and pauses it once `bytes` have arrived. */
async function pausedAt(server,where,bytes){
 const controller=new AbortController();
 const result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch,signal:controller.signal,onProgress:p=>{if(p.transferred>=bytes)controller.abort();}});
 assert.equal(result.paused,true);
 return received(where.dir,{sha512:sha512(body),size:body.length});
}

test('a pause keeps the bytes; resuming asks only for the rest (Range, If-Range) and the file is whole and verified',async t=>{
 const server=await serve({slow:true}),where=folder();t.after(server.close);
 const have=await pausedAt(server,where,200000);
 assert.ok(have>=200000&&have<body.length,'part of the file is kept: '+have);
 const seen=[];
 const result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch,onProgress:p=>seen.push(p.transferred)});
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(body));
 assert.deepEqual(server.asked.at(-1),{url:'/Acira.zip',range:`bytes=${have}-`,ifRange:'"v1"'});
 assert.equal(seen[0],have,'the progress starts where it stopped, not at zero');
 assert.ok(server.served()<body.length+120000,`about one file's worth was sent in all (${server.served()} for ${body.length})`);
});

test('a server that ignores Range sends the whole file again: it starts from its first byte and still ends whole',async t=>{
 const server=await serve({range:false,slow:true}),where=folder();t.after(server.close);
 const have=await pausedAt(server,where,150000);assert.ok(have>0);
 const result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch});
 assert.equal(server.asked.at(-1).range,`bytes=${have}-`,'it asked for the rest');
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(body),'the 200 replaced the partial instead of being appended to it');
});

test('a file that changed on the server (If-Range no longer matches) starts again; a redirect to the download host keeps the Range',async t=>{
 const first=await serve({slow:true,redirect:true}),where=folder();t.after(first.close);
 const have=await pausedAt(first,where,120000);
 await download({url:first.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch});
 assert.deepEqual(first.asked.at(-1),{url:'/cdn/Acira.zip?sig=1',range:`bytes=${have}-`,ifRange:'"v1"'},'GitHub-style redirect: the Range reaches the host that serves the file');
 const where2=folder(),changing=await serve({slow:true,etag:'"v1"'});t.after(changing.close);
 await pausedAt(changing,where2,120000);
 const moved=await serve({etag:'"v2"'});t.after(moved.close);
 const result=await download({url:moved.url,sha512:sha512(body),size:body.length,dir:where2.dir,fetch});
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(body));
});

test('a SHA-512 mismatch deletes the file and says so; nothing is left to hand over',async t=>{
 const wrong=Buffer.from(body);wrong[1234]^=1;
 const server=await serve({file:wrong}),where=folder();t.after(server.close);
 await assert.rejects(download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch}),error=>error.code==='ERR_CHECKSUM_MISMATCH');
 assert.equal(fs.existsSync(path.join(where.dir,PART)),false);
 assert.equal(received(where.dir,{sha512:sha512(body),size:body.length}),0);
});

test('a file of another size than the feed says is refused before a byte is kept',async t=>{
 const server=await serve({file:body.subarray(0,500000)}),where=folder();t.after(server.close);
 await assert.rejects(download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch}),error=>error.code==='ERR_UPDATE_SIZE');
 assert.equal(fs.existsSync(path.join(where.dir,PART)),false);
});

test('a stalled connection gives up with the bytes kept, for the next try',async t=>{
 const server=await serve({hang:true}),where=folder();t.after(server.close);
 await assert.rejects(download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch,stall:300}),error=>error.code==='ERR_UPDATE_STALLED');
 assert.equal(received(where.dir,{sha512:sha512(body),size:body.length}),1000);
});

test('a response Acira refuses is hung up at once (its body cancelled, its request aborted), never left streaming',async t=>{
 const length=body.length+5; // another file than the feed describes, sent slowly: about 1.2 s in all
 for(const [status,headers,code] of [[500,{},'ERR_UPDATE_HTTP'],[200,{'content-length':length},'ERR_UPDATE_SIZE'],[206,{'content-length':length,'content-range':`bytes 0-${length-1}/${length}`},'ERR_UPDATE_SIZE']]){
  let ended=null;
  const server=http.createServer((req,res)=>{
   res.writeHead(status,headers);res.on('close',()=>{ended=res.writableFinished;});
   let at=0;const step=()=>{if(res.destroyed)return;const piece=Buffer.alloc(Math.min(10000,length-at));at+=piece.length;if(at>=length)return res.end(piece);res.write(piece);setTimeout(step,20);};step();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
  await assert.rejects(download({url:`http://127.0.0.1:${server.address().port}/Acira.zip`,sha512:sha512(body),size:body.length,dir:folder().dir,fetch}),error=>error.code===code);
  for(const end=Date.now()+600;ended===null&&Date.now()<end;)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ended,false,`HTTP ${status}: the connection was closed before the body ended`);
 }
});

test('a partial belongs to one file: another SHA-512 or size starts from zero, and only acira-partial folders are ever touched',async t=>{
 const server=await serve({slow:true}),where=folder();t.after(server.close);
 await pausedAt(server,where,100000);
 assert.equal(received(where.dir,{sha512:'other',size:body.length}),0);
 assert.equal(received(where.dir,{sha512:sha512(body),size:body.length+1}),0);
 await assert.rejects(download({url:server.url,sha512:sha512(body),size:body.length,dir:path.join(where.root,'elsewhere'),fetch}),/not valid/);
 discard(path.join(where.root,'cache'));assert.ok(fs.existsSync(path.join(where.dir,PART)),'discard() leaves a folder of any other name alone');
 discard(where.dir);assert.equal(fs.existsSync(where.dir),false);
});

test('the verified file is handed over in the form electron-updater\'s own DownloadedUpdateHelper accepts as already downloaded',async t=>{
 const server=await serve(),where=folder();t.after(server.close);
 fs.mkdirSync(where.pending,{recursive:true});fs.writeFileSync(path.join(where.pending,'stale.zip'),'old');
 const result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch});
 const placed=await handOver({file:result.file,pendingDir:where.pending,name:'Acira-0.1.0-beta.9-arm64-mac.zip',sha512:sha512(body)});
 assert.deepEqual(fs.readdirSync(where.pending).sort(),['Acira-0.1.0-beta.9-arm64-mac.zip','update-info.json'],'the stale download went, as electron-updater would empty it');
 assert.equal(fs.existsSync(where.dir),false,'the partial folder is gone');
 assert.equal(handedOver({pendingDir:where.pending,sha512:sha512(body),size:body.length}),true);
 assert.equal(handedOver({pendingDir:where.pending,sha512:'other',size:body.length}),false);
 const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');
 const helper=new DownloadedUpdateHelper(path.join(where.root,'cache'));
 assert.equal(await helper.getValidCachedUpdateFile({info:{sha512:sha512(body)}},quiet),placed);
 assert.deepEqual(helper.downloadedFileInfo,{fileName:'Acira-0.1.0-beta.9-arm64-mac.zip',sha512:sha512(body),isAdminRightsRequired:false});
 await assert.rejects(handOver({file:placed,pendingDir:where.pending,name:'../escape.zip',sha512:sha512(body)}),/not valid/);
});

test('a second update in the same run under the same file name (every Windows setup is AciraBrowserSetup.exe): with electron-updater\'s helper, it takes the new file from its cache',async t=>{
 const server=await serve(),where=folder();t.after(server.close);
 const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper'),helper=new DownloadedUpdateHelper(path.join(where.root,'cache'));
 const name='AciraBrowserSetup.exe',earlier=Buffer.from('the setup taken earlier in this run'),newer={info:{sha512:sha512(body)}};
 fs.mkdirSync(where.pending,{recursive:true});fs.writeFileSync(path.join(where.pending,name),earlier);
 await helper.setDownloadedFile(path.join(where.pending,name),null,{version:'0.1.0-beta.10'},{info:{sha512:sha512(earlier)}},name,true); // as electron-updater records the update it took
 let result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch});
 let placed=await handOver({file:result.file,pendingDir:where.pending,name,sha512:sha512(body)});
 assert.equal(await helper.validateDownloadedPath(placed,{version:'0.1.0-beta.11'},newer,quiet),null,'without the helper, electron-updater still has the earlier one in mind and would download this one again');
 result=await download({url:server.url,sha512:sha512(body),size:body.length,dir:where.dir,fetch});
 placed=await handOver({file:result.file,pendingDir:where.pending,name,sha512:sha512(body),helper});
 assert.equal(await helper.validateDownloadedPath(placed,{version:'0.1.0-beta.11'},newer,quiet),placed,'with it, the new file is taken from the cache');
 assert.deepEqual(fs.readdirSync(where.pending).sort(),[name,'update-info.json']);
});

// --- Windows: the differential download, resumable -------------------------------------------------------------------------------------------
// A blockmap as electron-builder writes one (gzipped JSON, one file, blocks with checksums and sizes). Fixed blocks here; the planner only compares them.
const zlib=require('node:zlib'),{readBlockMap,diffPlan,downloaded,progressOf}=require('../desktop/browser-services/update-download.cjs');
const blockMap=(buf,block=16384)=>{const checksums=[],sizes=[];for(let at=0;at<buf.length;at+=block){const piece=buf.subarray(at,at+block);checksums.push(createHash('sha256').update(piece).digest('base64'));sizes.push(piece.length);}return zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums,sizes}]}));};
const oldSetup=(()=>{const b=Buffer.alloc(640000);let x=12345;for(let i=0;i<b.length;i++){x=(x*1103515245+12345)>>>0;b[i]=x>>>24;}return b;})(); // no two blocks alike, as in a real setup
const newSetup=(()=>{const b=Buffer.from(oldSetup);for(const [from,length] of [[40000,30000],[300000,90000],[600000,40000]])for(let i=from;i<from+length;i++)b[i]=(b[i]*7+3)&255;return b;})();
/** The new setup over HTTP like GitHub's download host: one range at a time (206), a multi-range request refused with 501, sent slowly. */
async function setupServer({file=newSetup,single=true}={}){
 const asked=[];let sent=0;
 const server=http.createServer((req,res)=>{
  const range=req.headers.range||null;asked.push(range);
  if(range&&range.includes(',')){res.writeHead(501);return res.end('Unsupported client range');}
  const match=/^bytes=(\d+)-(\d*)$/.exec(range||''),start=match?Number(match[1]):0,end=match&&match[2]?Number(match[2]):file.length-1;
  if(match&&!single){res.writeHead(200,{'content-length':file.length,etag:'"s1"'});sent+=file.length;return res.end(file);}
  res.writeHead(match?206:200,{'content-length':end-start+1,etag:'"s1"',...(match?{'content-range':`bytes ${start}-${end}/${file.length}`}:{})});
  let at=start;const step=()=>{if(res.destroyed)return;const piece=file.subarray(at,Math.min(end+1,at+20000));at+=piece.length;sent+=piece.length;if(at>end)return res.end(piece);res.write(piece);setTimeout(step,15);};step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/AciraBrowserSetup-0.1.0-beta.9.exe`,asked,sent:()=>sent,close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})};
}
const planFor=()=>diffPlan(readBlockMap(blockMap(oldSetup)),readBlockMap(blockMap(newSetup)),{size:newSetup.length,oldSize:oldSetup.length});

test('Windows differential: unchanged blocks come from the old setup, each changed run with one single-range request; a pause keeps the prefix and the resume fetches only what is left',async t=>{
 const server=await setupServer(),where=folder();t.after(server.close);
 const oldFile=path.join(where.root,'installer.exe');fs.writeFileSync(oldFile,oldSetup);
 const plan=planFor(),changed=downloaded(plan);
 assert.ok(changed>=160000&&changed<=230000,'only the changed blocks are fetched: '+changed+' of '+newSetup.length);
 assert.equal(plan.filter(seg=>seg.old===null).length,3,'three changed runs');
 const controller=new AbortController(),seen=[];
 const first=await download({url:server.url,sha512:sha512(newSetup),size:newSetup.length,dir:where.dir,plan,oldFile,fetch,signal:controller.signal,onProgress:p=>{seen.push(p);if(p.transferred>=80000)controller.abort();}});
 assert.equal(first.paused,true);
 assert.equal(seen[0].total,changed,'the progress counts the bytes to fetch, not the setup');
 const here=progressOf(where.dir,{sha512:sha512(newSetup),size:newSetup.length});
 assert.ok(here.transferred>=80000&&here.transferred<changed&&here.total===changed,'after a pause (and a relaunch) the progress is known from disk: '+JSON.stringify(here));
 const before=server.sent(),result=await download({url:server.url,sha512:sha512(newSetup),size:newSetup.length,dir:where.dir,plan,oldFile,fetch});
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(newSetup),'the assembled setup is exactly the new one');
 assert.ok(server.sent()<=changed+40000,`about the changed bytes in all were sent (${server.sent()} for ${changed}); the resume fetched ${server.sent()-before}`);
 assert.ok(server.asked.every(range=>/^bytes=\d+-\d+$/.test(range)),'every request is one closed range: '+server.asked.join(' '));
 assert.equal(server.asked.length,4,'three changed runs, one of them asked for again from where the pause left it');
});

test('a server that will not send a changed run as asked: ERR_UPDATE_RANGE with the prefix kept, and the whole file goes on from that byte',async t=>{
 const server=await setupServer({single:false}),where=folder();t.after(server.close);
 const oldFile=path.join(where.root,'installer.exe');fs.writeFileSync(oldFile,oldSetup);
 const plan=planFor();
 await assert.rejects(download({url:server.url,sha512:sha512(newSetup),size:newSetup.length,dir:where.dir,plan,oldFile,fetch}),error=>error.code==='ERR_UPDATE_RANGE');
 const kept=received(where.dir,{sha512:sha512(newSetup),size:newSetup.length});
 assert.equal(kept,plan.find(seg=>seg.old===null).start,'the unchanged blocks before the first changed run were copied and kept');
 const whole=await serve({file:newSetup}),result=await download({url:whole.url,sha512:sha512(newSetup),size:newSetup.length,dir:where.dir,fetch});t.after(whole.close);
 assert.equal(whole.asked[0].range,`bytes=${kept}-`,'the whole file resumes from the same byte');
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(newSetup));
});

test('an old setup that does not match its blockmap gives a file that fails its SHA-512: deleted, never handed over',async t=>{
 const server=await setupServer(),where=folder();t.after(server.close);
 const oldFile=path.join(where.root,'installer.exe'),damaged=Buffer.from(oldSetup);damaged[200000]^=1;fs.writeFileSync(oldFile,damaged);
 await assert.rejects(download({url:server.url,sha512:sha512(newSetup),size:newSetup.length,dir:where.dir,plan:planFor(),oldFile,fetch}),error=>error.code==='ERR_CHECKSUM_MISMATCH');
 assert.equal(fs.existsSync(path.join(where.dir,PART)),false);
 assert.throws(()=>diffPlan(readBlockMap(blockMap(oldSetup)),readBlockMap(blockMap(newSetup)),{size:newSetup.length,oldSize:oldSetup.length+1}),/old blockmap/,'a blockmap of another file is never planned from');
 assert.throws(()=>readBlockMap(zlib.gzipSync('{"files":[]}')),/Not a blockmap/);
});
