'use strict';
// Mirrors (beta.13.2). A feed may list more addresses for a file (files[].mirrors). The first address is asked first, every time; the next one is tried when this one gives no first byte
// in FIRST_BYTE (GitHub's release downloads did exactly that on 8 Nov 2026), goes quiet, drops, answers with an error or sends the wrong thing. The bytes already here stay and the next
// address is asked for the rest. It is still one file with one SHA-512, every address is fetched with the SAME fetch the caller hands in (the person's route: proxy, VPN, Tor), and
// no host is named in the app. Every server here is local (127.0.0.1).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const fetched=require('../desktop/browser-services/update-download.cjs');
const {download,mirrorsOf,networkFailure,DIR_NAME,FIRST_BYTE,MAX_MIRRORS}=fetched;
const {createAppUpdater,updateFile,kindOf}=require('../desktop/browser-services/app-updater.cjs');
const hosts=require('../desktop/browser-services/update-hosts.cjs');

const blob=(seed,length=400000)=>Buffer.from(Array.from({length},(_,i)=>(i*seed+(i>>8))&255));
const BODY=blob(5),NAME='AciraBrowserSetup-0.1.0-beta.15.exe';
const sha512=buf=>createHash('sha512').update(buf).digest('base64');
const quiet={info(){},warn(){},error(){},debug(){}};
const made=[];test.after(()=>{for(const root of made)fs.rmSync(root,{recursive:true,force:true});});
const tmp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-mirrors-'));made.push(root);return root;};
const folder=()=>{const root=tmp();return {root,dir:path.join(root,'cache',DIR_NAME)};};
const until=async(what,ms=10000)=>{const end=Date.now()+ms;while(!what()){if(Date.now()>end)throw new Error('timed out waiting');await new Promise(resolve=>setTimeout(resolve,10));}};

/** A file host. mode: 'good', 'silent' (takes the request, never answers), 'status:503' (an HTTP error), 'hang' (1000 bytes, then nothing), 'html' (a sign-in page with 200),
 *  'corrupt' (the right size, other bytes), 'other' (a different size), 'drop' (half the file, then the connection closes). asked: every request's Range / If-Range. */
async function host(mode='good',{file=BODY,name='/file.bin'}={}){
 const state={mode,asked:[]};
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://x').pathname;
  if(pathname.endsWith('.blockmap')){res.statusCode=404;return res.end();}
  state.asked.push({url:pathname,range:req.headers.range||null,ifRange:req.headers['if-range']||null});
  const m=state.mode;
  if(m==='silent')return;
  if(m.startsWith('status:')){res.statusCode=Number(m.slice(7));return res.end('no');}
  if(m==='html'){res.writeHead(200,{'content-type':'text/html'});return res.end('<html>Sign in</html>');}
  const match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  let bytes=file;
  if(m==='corrupt'){bytes=Buffer.from(file);bytes[5000]^=255;} // (one byte in the middle: a partial of the first 1000 bytes from another address still ends damaged)
  if(m==='other')bytes=file.subarray(0,file.length-10);
  const fresh=!req.headers['if-range']||req.headers['if-range']===`"${state.tag}"`;
  const ranged=match&&fresh;
  res.writeHead(ranged?206:200,{'content-length':bytes.length-(ranged?start:0),etag:`"${state.tag}"`,...(ranged?{'content-range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
  const rest=bytes.subarray(ranged?start:0);
  if(m==='hang'){res.write(rest.subarray(0,1000));return;}
  if(m==='drop'){res.write(rest.subarray(0,Math.floor(rest.length/2)));setTimeout(()=>res.destroy(),30);return;}
  res.end(rest);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 state.tag=String(server.address().port);
 return Object.assign(state,{url:`http://127.0.0.1:${server.address().port}${name}`,close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})});
}
const want=(file=BODY)=>({sha512:sha512(file),size:file.length});
/** The common options of a download of BODY from `first` with `mirrors`. */
const grab=(where,first,mirrors,extra={})=>download({url:first.url,mirrors:mirrors.map(item=>item.url),...want(),dir:where.dir,fetch,firstByte:300,stall:2000,...extra});

test('mirrorsOf keeps https and local http, resolves relative ones, drops repeats, the file itself and anything odd, and stops at MAX_MIRRORS',()=>{
 const file='https://dl.example.com/a/File.zip';
 assert.deepEqual(mirrorsOf(['https://m1.example.net/File.zip','File2.zip','/root/File.zip','http://m2.example.net/File.zip','ftp://x/File.zip','https://','','  ',null,7,{url:'https://x/'}],file),
  ['https://m1.example.net/File.zip','https://dl.example.com/a/File2.zip','https://dl.example.com/root/File.zip']);
 assert.deepEqual(mirrorsOf([file,'https://m.example.net/f','https://m.example.net/f'],file),['https://m.example.net/f'],'its own address and a repeat are not mirrors');
 assert.deepEqual(mirrorsOf(['http://127.0.0.1:8080/f','http://localhost/f','http://[::1]:9/f'],file).length,3,'a rig on this computer may use plain http');
 assert.deepEqual(mirrorsOf(['https://user:pass@m.example.net/f'],file),[],'no credentials in an address');
 assert.deepEqual(mirrorsOf(undefined,file),[]);assert.deepEqual(mirrorsOf('https://m.example.net/f',file),[],'a string is not a list');
 assert.equal(mirrorsOf(Array.from({length:12},(_,i)=>'https://m'+i+'.example.net/f'),file).length,MAX_MIRRORS);
 assert.equal(FIRST_BYTE,20*1000,'a first byte is waited for about 20 s');
});

test('a mirror is the second address only: while the first answers, the mirror is never asked',async t=>{
 const first=await host(),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const told=[],result=await grab(where,first,[second],{onSource:url=>told.push(url)});
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));
 assert.equal(second.asked.length,0);assert.equal(result.source,first.url);assert.deepEqual(told,[first.url]);
});

test('an address that gives no first byte is left after FIRST_BYTE (not after the stall): the mirror sends the file, and the answer says which one did',async t=>{
 const first=await host('silent'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const began=Date.now(),told=[],result=await grab(where,first,[second],{firstByte:300,stall:20000,onSource:url=>told.push(url)});
 const took=Date.now()-began;
 assert.ok(took>=250&&took<4000,'it waited the first-byte time, not the 20 s stall: '+took+' ms');
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));
 assert.equal(result.source,second.url);assert.deepEqual(result.from,[second.url]);assert.deepEqual(told,[second.url]);
 assert.equal(first.asked.length,1,'the silent address was asked once');
});

test('a 5xx or a 404 from the first address goes on to the mirror',async t=>{
 for(const status of ['status:503','status:404','status:500']){
  const first=await host(status),second=await host(),where=folder();
  try{const result=await grab(where,first,[second]);assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY),status);assert.equal(result.source,second.url);}
  finally{await first.close();await second.close();}
 }
});

test('a sign-in page where the file should be, and a refused connection, go on to the mirror',async t=>{
 const portal=await host('html'),second=await host(),where=folder();t.after(portal.close);t.after(second.close);
 assert.equal((await grab(where,portal,[second])).source,second.url);
 const closed=await host();const gone={url:closed.url};await closed.close();const third=await host(),where2=folder();t.after(third.close);
 assert.equal((await grab(where2,gone,[third])).source,third.url,'nothing listens at the first address');
});

test('an address that goes quiet half way: the bytes already here stay, the mirror is asked only for the rest (a Range request, no If-Range from the other address) and the file ends whole',async t=>{
 const first=await host('hang'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const result=await grab(where,first,[second],{stall:400,firstByte:2000});
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));
 assert.deepEqual(second.asked.at(-1),{url:'/file.bin',range:'bytes=1000-',ifRange:null});
 assert.deepEqual(result.from,[first.url,second.url],'both addresses supplied bytes, and the partial says so');
});

test('a dropped connection half way continues from the mirror',async t=>{
 const first=await host('drop'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const result=await grab(where,first,[second]);
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));
 assert.ok(/^bytes=\d+-$/.test(second.asked.at(-1).range)&&Number(second.asked.at(-1).range.slice(6,-1))>0,'the mirror was asked for the rest: '+second.asked.at(-1).range);
});

test('an address that sends a different file (another size) is out: the partial it may have touched is dropped and the mirror sends the file from its start',async t=>{
 const first=await host('other'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const result=await grab(where,first,[second]);
 assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));assert.equal(result.source,second.url);assert.equal(second.asked.at(-1).range,null);
});

test('the one that worked last is asked first (first), so a retry does not wait on a silent address again',async t=>{
 const first=await host('silent'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const began=Date.now(),result=await grab(where,first,[second],{first:1,firstByte:5000});
 assert.ok(Date.now()-began<3000);assert.equal(first.asked.length,0,'the silent one was not asked at all');assert.equal(result.source,second.url);
});

test('every address failing ends in one error that marks it as tried on all of them; a sign-in page is the one reported when there was one',async t=>{
 const first=await host('silent'),second=await host('status:503'),where=folder();t.after(first.close);t.after(second.close);
 const error=await grab(where,first,[second]).then(()=>null,e=>e);
 assert.ok(error&&error.exhausted===true,'exhausted');assert.equal(error.code,'ERR_UPDATE_HTTP');assert.equal(kindOf(error),'server');
 const portal=await host('html'),third=await host('silent'),where2=folder();t.after(portal.close);t.after(third.close);
 const second2=await grab(where2,third,[portal]).then(()=>null,e=>e);
 assert.equal(second2.code,'ERR_UPDATE_PORTAL','the sign-in page tells the person more than a timeout');assert.equal(kindOf(second2),'portal');
});

test('one address: nothing changes. The stall time applies from the start (no short first-byte time), a failure is the plain error, and it is not marked as tried on every address',async t=>{
 const only=await host('silent'),where=folder();t.after(only.close);
 const began=Date.now(),error=await download({url:only.url,...want(),dir:where.dir,fetch,firstByte:100,stall:500}).then(()=>null,e=>e);
 assert.ok(Date.now()-began>=450,'it waited the stall time: '+(Date.now()-began));
 assert.equal(error.code,'ERR_UPDATE_STALLED');assert.equal(error.exhausted,undefined);
});

test('a problem of this computer (a full disk) is not a reason to ask the next address: it ends the download at once',async t=>{
 const first=await host(),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const asked=[];
 const failing=(url,init)=>{asked.push(url);return Promise.reject(Object.assign(new Error('no space left on device'),{code:'ENOSPC'}));};
 const error=await grab(where,first,[second],{fetch:failing}).then(()=>null,e=>e);
 assert.equal(error.code,'ENOSPC');assert.equal(asked.length,1);assert.equal(networkFailure(error),false);
 assert.equal(networkFailure(new TypeError('fetch failed')),true);assert.equal(networkFailure(Object.assign(new Error('x'),{code:'ECONNRESET'})),true);
 assert.equal(networkFailure(new Error('net::ERR_CONNECTION_TIMED_OUT')),true);assert.equal(networkFailure(Object.assign(new Error('x'),{code:'EACCES'})),false);
});

test('a pause during a failover pauses: the bytes stay and nothing more is asked',async t=>{
 const first=await host('hang'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const controller=new AbortController(),result=await grab(where,first,[second],{stall:60000,firstByte:60000,signal:controller.signal,onProgress:progress=>{if(progress.transferred>=500)controller.abort();}});
 assert.equal(result.paused,true);assert.equal(second.asked.length,0);
});

test('D2: every address is fetched with the fetch it is handed, so a mirror never leaves by another route than the person\'s; the module opens no connection of its own',async t=>{
 const first=await host('status:503'),second=await host(),where=folder();t.after(first.close);t.after(second.close);
 const seen=[];
 const routed=(url,init)=>{seen.push(String(url));return fetch(url,init);};
 const result=await grab(where,first,[second],{fetch:routed});
 assert.deepEqual(seen,[first.url,second.url],'both addresses went through the route the caller gave');assert.equal(sha512(fs.readFileSync(result.file)),sha512(BODY));
 const source=fs.readFileSync(require.resolve('../desktop/browser-services/update-download.cjs'),'utf8');
 assert.ok(!/require\((['"])(?:node:)?(?:https?|http2|net|tls|dns|dgram|child_process)\1\)/.test(source),'no network module is loaded here');
 assert.ok(!/globalThis\.fetch|\bnew\s+(?:XMLHttpRequest|WebSocket)\b|require\((['"])electron\1\)/.test(source),'no other way out');
});

test('SHA-512: a mirror that sends other bytes of the right size is caught like any file: deleted, and the error names the addresses that supplied it',async t=>{
 const first=await host('hang'),second=await host('corrupt'),where=folder();t.after(first.close);t.after(second.close);
 const error=await grab(where,first,[second],{stall:300,firstByte:2000}).then(()=>null,e=>e);
 assert.equal(error.code,'ERR_CHECKSUM_MISMATCH');assert.deepEqual(error.sources,[first.url,second.url]);
 assert.equal(fs.existsSync(path.join(where.dir,fetched.PART)),false,'the damaged file is gone');
});

// ---- the feed side: files[].mirrors reach the download, the mirror feeds are an empty list

test('updateFile hands the mirrors of the chosen file on, resolved and cleaned; a feed without mirrors gives an empty list',()=>{
 const files=(info)=>({updateInfoAndProvider:{info:{version:'0.1.0-beta.15'},provider:{resolveFiles:()=>[{url:new URL('https://update.acirabrowser.com/'+NAME),info}]}}});
 const target=updateFile(files({url:NAME,sha512:'A'.repeat(86)+'==',size:5,mirrors:['https://dl.example.net/'+NAME,'http://insecure.example.net/'+NAME,'https://update.acirabrowser.com/'+NAME]}),{platform:'win32',arm64:()=>false});
 assert.deepEqual(target.mirrors,['https://dl.example.net/'+NAME]);
 assert.deepEqual(updateFile(files({url:NAME,sha512:'A'.repeat(86)+'==',size:5}),{platform:'win32',arm64:()=>false}).mirrors,[]);
});

test('MIRROR_FEED_URLS is empty today: the feeds a build asks are exactly what they were; given a mirror it is asked after the first address and before the frozen GitHub feed',()=>{
 assert.deepEqual(hosts.MIRROR_FEED_URLS,[],'no host is named in the app');
 const base=hosts.HOST_URL;
 assert.deepEqual(hosts.feedsFor({primary:base}),[{name:'primary',url:base},{name:'fallback',url:hosts.GITHUB_FEED_URL}]);
 assert.deepEqual(hosts.feedsFor({primary:base+'linux/',mirrors:['https://updates.example.net/feed']}),[{name:'primary',url:base+'linux/'},{name:'mirror',url:'https://updates.example.net/feed/linux/'},{name:'fallback',url:hosts.GITHUB_FEED_URL+'linux/'}]);
 assert.deepEqual(hosts.feedsFor({primary:base,mirrors:['http://insecure.example.net/','https://u:p@x.example.net/','https://a.example.net/?q=1','nonsense',hosts.HOST_URL,hosts.GITHUB_FEED_URL]}),hosts.feedsFor({primary:base}),'only https mirrors that are not already an address count');
 assert.deepEqual(hosts.feedsFor({primary:base,testers:true,mirrors:['https://updates.example.net/']}),[{name:'testers',url:base+'testers/'}],'the testers folder stays alone');
 assert.deepEqual(hosts.feedsFor({primary:'http://127.0.0.1:8080/',mirrors:['https://updates.example.net/']}),[{name:'primary',url:'http://127.0.0.1:8080/'}],'a build that names another address asks it alone');
});

// ---- the whole updater: a real download through createAppUpdater

/** A host for the feed document and the setup file. file: 'good', 'silent', 'status:503', 'corrupt'. mirrors: what the document lists for the file. */
async function feedHost({mode='good',mirrors=[],version='0.1.0-beta.15'}={}){
 const state={mode,mirrors,requests:[],base:'',failFirst:0};
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));state.requests.push({name,range:req.headers.range||null});
  if(name==='beta.yml'){res.setHeader('content-type','text/yaml');return res.end(JSON.stringify({version,releaseNotes:'- Mirrors',files:[{url:NAME,sha512:sha512(BODY),size:BODY.length,...(state.mirrors.length?{mirrors:state.mirrors}:{})}]}));}
  if(name!==NAME){res.statusCode=404;return res.end();}
  if(state.failFirst>0){state.failFirst--;res.statusCode=503;return res.end();} // (the first requests for the file are refused, then the host is well again)
  if(state.mode==='silent')return;
  if(state.mode.startsWith('status:')){res.statusCode=Number(state.mode.slice(7));return res.end();}
  const bytes=state.mode==='corrupt'?Buffer.concat([Buffer.from([BODY[0]^255]),BODY.subarray(1)]):BODY;
  const match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  res.writeHead(match?206:200,{'content-length':bytes.length-start,...(match?{'content-range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
  res.end(bytes.subarray(start));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 state.base=`http://127.0.0.1:${server.address().port}/`;
 return Object.assign(state,{file:()=>state.requests.filter(r=>r.name===NAME),close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})});
}
function liteUpdater(feed,{root}){
 const updater=new EventEmitter(),{DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper'),helper=new DownloadedUpdateHelper(path.join(root,'cache'));
 updater.ownDownloads=0;
 updater.checkForUpdates=async()=>{
  updater.emit('checking-for-update');
  const doc=JSON.parse(await(await fetch(feed.base+'beta.yml')).text());
  updater.updateInfoAndProvider={info:doc,provider:{resolveFiles:info=>info.files.map(file=>({url:new URL(file.url,feed.base),info:file}))}};
  updater.emit('update-available',doc);
 };
 updater.getOrCreateDownloadHelper=async()=>helper;
 updater.downloadUpdate=async()=>{
  for(const file of updater.updateInfoAndProvider.info.files){const cached=await helper.getValidCachedUpdateFile({info:file},quiet);if(cached){updater.emit('update-downloaded',updater.updateInfoAndProvider.info);return [cached];}}
  updater.ownDownloads++;throw new Error('would download by itself');
 };
 updater.quitAndInstall=()=>{};updater.setFeedURL=()=>{};
 return updater;
}
const make=(root,autoUpdater,extra={})=>createAppUpdater({app:{getVersion:()=>'0.1.0-beta.14',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,fetch,firstByte:300,...extra});

test('the updater: the feed lists a mirror, the first address is silent, the update downloads from the mirror and is handed over verified (electron-updater never downloads by itself)',async t=>{
 const mirror=await feedHost(),feed=await feedHost({mode:'silent'}),root=tmp();t.after(feed.close);t.after(mirror.close);
 feed.mirrors=[mirror.base+NAME];
 const updater=make(root,liteUpdater(feed,{root}));
 await updater.check();
 await until(()=>updater.status().status==='ready');
 assert.equal(feed.file().length,1,'the first address was asked once');assert.equal(mirror.file().length,1,'the mirror sent the file');
 const handed=path.join(root,'cache','pending',NAME);
 assert.equal(sha512(fs.readFileSync(handed)),sha512(BODY));
});

test('the updater: a mirror that sends a wrong file (right size) is caught by the hash, and the next try, at once, skips it and takes the first address',async t=>{
 const mirror=await feedHost({mode:'corrupt'}),feed=await feedHost(),root=tmp();t.after(feed.close);t.after(mirror.close);
 feed.mirrors=[mirror.base+NAME];feed.failFirst=1; // the first address refuses once; the mirror then sends a damaged file; the second try is the first address again, now well
 const updater=make(root,liteUpdater(feed,{root}));
 await updater.check();
 await until(()=>updater.status().status==='ready',12000);
 assert.equal(mirror.file().length,1,'the mirror was asked once and not again after its file failed the hash');
 assert.equal(feed.file().length,2,'the first address: the refused request and the good one');
 assert.equal(sha512(fs.readFileSync(path.join(root,'cache','pending',NAME))),sha512(BODY));
});

test('the updater: every address failing is an ordinary download failure (offline-like, retried later), not a new kind of trouble',async t=>{
 const mirror=await feedHost({mode:'status:503'}),feed=await feedHost({mode:'silent'}),root=tmp();t.after(feed.close);t.after(mirror.close);
 feed.mirrors=[mirror.base+NAME];
 const updater=make(root,liteUpdater(feed,{root}));
 await updater.check();
 await until(()=>updater.status().status==='error',12000);
 const status=updater.status();
 assert.equal(status.cause,'network');assert.equal(status.interrupted,true,'the download that stopped is kept visible, with its version');
});
