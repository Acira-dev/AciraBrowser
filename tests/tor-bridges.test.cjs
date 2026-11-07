'use strict';
// Bridges and pluggable transports (tor-bridges.cjs, tor-engine.cjs): Tor Browser 15's built-in bridges and transport plugin lines,
// line-by-line validation of bridges the person knows, the tor options a choice becomes, pinned transport clients, the packaging that
// ships them, and the engine's "looks blocked" signal, against a fake tor that speaks the control protocol.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const bridges=require('../desktop/browser-services/tor-bridges.cjs');
const {createTorEngine,TOR_MANIFEST}=require('../desktop/browser-services/tor-engine.cjs');
const {createTorWindows}=require('../desktop/browser-services/tor-window.cjs');
const {parseBridgeLine,parseBridgeLines,bridgeArguments,bridgeLines,createBridgeSettings,neededClients,publicBridges,TOR_PT_CONFIG}=bridges;
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-bridges-'));

test('the built-in bridges are Tor Browser 15’s own pt_config.json, and every line of it passes our validator',()=>{
 const text=read('desktop/browser-services/tor-engine/pt_config.json');
 assert.equal(sha(text),TOR_MANIFEST.pluggableTransports.ptConfigSha256,'pt_config.json is Tor Browser 15.0.25’s file (LF bytes)');
 assert.deepEqual(bridges.TOR_BUILTIN_BRIDGE_TYPES,['obfs4','snowflake','meek'],'what Tor Browser 15 lists, recommended (obfs4) first');
 assert.equal(TOR_PT_CONFIG.recommendedDefault,'obfs4');
 for(const [type,lines] of Object.entries(TOR_PT_CONFIG.bridges))for(const line of lines){const parsed=parseBridgeLine(line);assert.ok(parsed.line,`${type}: ${line.slice(0,40)}… → ${parsed.error}`);}
});

test('bridge lines the person pastes are checked line by line, as Tor Browser numbers them',()=>{
 const obfs4='obfs4 203.0.113.5:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=abc+def/ghi iat-mode=0';
 assert.equal(parseBridgeLine(obfs4).line,obfs4);
 assert.equal(parseBridgeLine('Bridge '+obfs4).line,obfs4,'a leading "Bridge" (torrc form) is accepted');
 assert.equal(parseBridgeLine('webtunnel [2001:db8::5]:443 0123456789ABCDEF0123456789ABCDEF01234567 url=https://example.com/abc ver=0.0.1').transport,'webtunnel');
 assert.equal(parseBridgeLine('203.0.113.9:9001 0123456789abcdef0123456789abcdef01234567').line,'203.0.113.9:9001 0123456789ABCDEF0123456789ABCDEF01234567','a plain relay bridge');
 assert.equal(parseBridgeLine('meek 192.0.2.20:80 url=https://cdn.example/ front=www.example.org').line.split(' ')[0],'meek_lite','"meek" means meek_lite');
 const cases={'obfs5 203.0.113.5:443':'transport','obfs4 bridge.example.com:443 cert=x iat-mode=0':'address','obfs4 203.0.113.5:99999 cert=x iat-mode=0':'address','obfs4 300.1.1.1:443 cert=x iat-mode=0':'address',
  'obfs4 203.0.113.5:443 ABCD cert=x iat-mode=0':'fingerprint','obfs4 203.0.113.5:443 0123456789ABCDEF0123456789ABCDEF01234567':'obfs4','obfs4 203.0.113.5:443 cert=x iat-mode=7':'obfs4',
  'webtunnel 203.0.113.5:443 url=http://plain.example/':'webtunnel','meek_lite 192.0.2.20:80 front=x':'meek','203.0.113.9:9001 extra=1':'argument','obfs4 203.0.113.5:443 "quoted"':'characters',['obfs4 1.2.3.4:5 '+'x'.repeat(2001)]:'long'};
 for(const [line,code] of Object.entries(cases))assert.equal(parseBridgeLine(line).error,code,line.slice(0,60));
 const block=parseBridgeLines(['# my bridges','',obfs4,'obfs5 1.2.3.4:5',obfs4,'  ','snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://x.example/'].join('\r\n'));
 assert.deepEqual(block.lines.length,2,'comments, blanks and a duplicate are dropped');assert.deepEqual(block.errors,[{line:4,code:'transport',transport:'obfs5'}]);assert.equal(block.empty,false);
 assert.deepEqual(parseBridgeLines(Array.from({length:33},(_,i)=>`203.0.113.${i+1}:443`).join('\n')).errors,[{line:0,code:'many'}]);
 assert.equal(parseBridgeLines(' \n# only a comment').empty,true);
});

test('a bridge choice becomes explicit tor options: UseBridges, the plugin lines it needs (relative to tor’s folder), one Bridge each',()=>{
 const obfs4=bridgeLines({mode:'builtin',builtin:'obfs4'}),args=bridgeArguments(obfs4,'win32'),values=name=>args.flatMap((a,i)=>a===name?[args[i+1]]:[]);
 assert.equal(obfs4.length,TOR_PT_CONFIG.bridges.obfs4.length);assert.deepEqual([...obfs4].sort(),[...TOR_PT_CONFIG.bridges.obfs4].sort(),'every built-in line, in a fresh order');
 assert.deepEqual(values('--UseBridges'),['1']);assert.deepEqual(values('--Bridge').sort(),[...TOR_PT_CONFIG.bridges.obfs4].sort());
 assert.deepEqual(values('--ClientTransportPlugin'),['meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec pluggable_transports\\lyrebird.exe'],'no space in the path: tor splits plugin lines on spaces');
 assert.deepEqual(bridgeArguments(bridgeLines({mode:'builtin',builtin:'snowflake'}),'win32').filter((a,i,all)=>all[i-1]==='--ClientTransportPlugin'),['snowflake exec pluggable_transports\\lyrebird.exe']);
 assert.deepEqual([...neededClients(bridgeLines({mode:'builtin',builtin:'meek'}),'win32')],['lyrebird.exe']);
 assert.deepEqual(bridgeArguments(['203.0.113.9:9001']),['--UseBridges','1','--Bridge','203.0.113.9:9001'],'a plain bridge needs no transport client');
 assert.deepEqual(bridgeArguments(bridgeLines({mode:'off'})),[],'off: no bridge options at all');
});

test('the choice is saved beside tor’s data, never with a site’s; a choice that can’t be used is refused and nothing changes',()=>{
 const userData=tmp();
 try{
  const settings=createBridgeSettings({userData});assert.deepEqual(settings.get(),{mode:'off',builtin:'obfs4',custom:[]});
  settings.set({mode:'builtin',builtin:'snowflake'});assert.deepEqual(createBridgeSettings({userData}).get().mode,'builtin','kept across restarts');
  assert.equal(path.relative(userData,settings.file),path.join('tor','bridges.json'));
  assert.throws(()=>settings.set({mode:'custom',custom:'obfs4 nope'}),error=>error.code==='invalid'&&error.errors[0].code==='address');
  assert.throws(()=>settings.set({mode:'custom',custom:''}),error=>error.code==='empty');
  assert.throws(()=>settings.set({mode:'builtin',builtin:'webtunnel'}),error=>error.code==='builtin');
  assert.throws(()=>settings.set({mode:'on'}),error=>error.code==='mode');
  assert.equal(settings.get().builtin,'snowflake','refused choices left the saved one alone');
  settings.set({mode:'custom',custom:'203.0.113.9:9001\n203.0.113.9:9001'});assert.deepEqual(settings.get().custom,['203.0.113.9:9001']);
  const view=publicBridges(settings.get(),{installed:true});assert.deepEqual(view.types.map(t=>t.id),['obfs4','snowflake','meek']);assert.equal(view.recommended,'obfs4');assert.equal(view.installed,true);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('the transport clients and their licences are pinned and shipped exactly like tor.exe',()=>{
 const pt=TOR_MANIFEST.pluggableTransports.files;
 assert.deepEqual(Object.keys(pt).sort(),['pluggable_transports/LICENSE.conjure.txt','pluggable_transports/LICENSE.lyrebird.txt','pluggable_transports/conjure-client.exe','pluggable_transports/lyrebird.exe']);
 for(const entry of Object.values(pt)){assert.match(entry.sha256,/^[0-9a-f]{64}$/);assert.ok(entry.from&&entry.torBrowser);}
 assert.deepEqual(bridges.transportPins({platform:'win32'}),{'lyrebird.exe':pt['pluggable_transports/lyrebird.exe'].sha256,'conjure-client.exe':pt['pluggable_transports/conjure-client.exe'].sha256});
 const builder=JSON.parse(read('packaging/electron-builder.json')),tor=builder.extraResources.find(item=>item.to==='tor');
 for(const name of Object.keys(pt))assert.ok(tor.filter.includes(name),'installer ships '+name);
 assert.match(read('scripts/release-package.mjs'),/pluggableTransports\?\.files/,'the portable release copies (and re-checks) the clients too');
 assert.match(read('scripts/desktop-bundle.mjs'),/tor-engine\/win-x64\/pluggable_transports/);
 assert.match(read('scripts/fetch-tor.mjs'),/--from-tor-browser/);
 assert.match(read('THIRD_PARTY_NOTICES.md'),/lyrebird\.exe, conjure-client\.exe/);
 // A development checkout that has the clients has exactly the pinned bytes.
 const dir=path.join(root,'desktop/browser-services/tor-engine/win-x64');
 for(const [name,entry] of Object.entries(pt)){const file=path.join(dir,name);if(fs.existsSync(file))assert.equal(sha(fs.readFileSync(file)),entry.sha256,name);}
});

/** A tor that answers the engine's control commands, reports bootstrap from a script, and records how it was started. */
function fakeTor({script=[{progress:100}]}={}){
 const starts=[],servers=new Set(),all=new Set();
 function spawnTor(file,args,options){
  starts.push({file,args,cwd:options?.cwd});const argument=name=>args[args.indexOf(name)+1];
  // Each tor has its own control port and sockets: stopping one never touches the next.
  const sockets=new Set();let server=null;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
  child.kill=()=>{if(child.exitCode===null){child.exitCode=0;child.emit('exit',0);}server?.close();for(const s of sockets)s.destroy();};
  server=net.createServer(socket=>{sockets.add(socket);all.add(socket);socket.on('close',()=>{sockets.delete(socket);all.delete(socket);});let buffer='';
   socket.on('data',chunk=>{buffer+=chunk.toString('latin1');let index;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
    if(line==='GETINFO net/listeners/socks')socket.write('250-net/listeners/socks="127.0.0.1:9055"\r\n250 OK\r\n');
    else if(line==='GETINFO status/bootstrap-phase')socket.write(`250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=${script[0].progress} TAG=${script[0].tag||'conn'} SUMMARY="x"\r\n250 OK\r\n`);
    else if(line==='SIGNAL SHUTDOWN'){socket.write('250 OK\r\n');child.kill();}
    else socket.write('250 OK\r\n');}});
   // Scripted STATUS_CLIENT events, one every 30 ms.
   script.forEach((step,i)=>setTimeout(()=>{if(!socket.destroyed)socket.write(`650 STATUS_CLIENT ${step.warn?'WARN':'NOTICE'} BOOTSTRAP PROGRESS=${step.progress} TAG=${step.tag||'conn'} SUMMARY="step"${step.warn?' WARNING="Connection refused" REASON=CONNECTREFUSED COUNT=1 RECOMMENDATION=warn':''}\r\n`);},30*(i+1)));});
  servers.add(server);server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(argument('--ControlPortWriteToFile'),`PORT=127.0.0.1:${server.address().port}\n`);fs.writeFileSync(argument('--CookieAuthFile'),crypto.randomBytes(32));});
  return child;
 }
 return {spawnTor,starts,stop:()=>{for(const s of all)s.destroy();for(const s of servers)s.close();}};
}
function engineWith({userData,tor,transports=null,pins={},online=true,timeouts={},repair=async()=>false}){
 const exe=path.join(userData,'tor-fake.exe');fs.writeFileSync(exe,'fake');
 return createTorEngine({userData,platform:'win32',spawnTor:tor.spawnTor,executable:()=>exe,updated:()=>({file:exe,sha256:sha('fake')}),transports:()=>transports,transportHashes:()=>pins,isOnline:()=>online,extraArguments:()=>[],repair,timeouts});
}
const until=(engine,accept,label,ms=6000)=>new Promise((resolve,reject)=>{if(accept(engine.status()))return resolve(engine.status());const timer=setTimeout(()=>{off();reject(new Error(label+': '+JSON.stringify(engine.status())));},ms);const off=engine.onStatus(s=>{if(accept(s)){clearTimeout(timer);off();resolve(s);}});});

test('with obfs4 bridges tor starts from the bundled tor folder with every bridge and the lyrebird plugin; the client is hash-checked first',async()=>{
 const userData=tmp(),pt=path.join(userData,'tor','pluggable_transports');fs.mkdirSync(pt,{recursive:true});fs.writeFileSync(path.join(pt,'lyrebird.exe'),'lyre');
 createBridgeSettings({userData}).set({mode:'builtin',builtin:'obfs4'});
 const tor=fakeTor(),engine=engineWith({userData,tor,transports:pt,pins:{'lyrebird.exe':sha('lyre')}});
 try{
  engine.acquire('w1');const ready=await until(engine,s=>s.state==='ready'||s.state==='error','ready');
  assert.equal(ready.state,'ready');assert.deepEqual(ready.bridges,{mode:'builtin',type:'obfs4',count:TOR_PT_CONFIG.bridges.obfs4.length});
  const {args,cwd}=tor.starts[0];assert.equal(cwd,path.dirname(pt),'tor runs beside pluggable_transports\\ so the relative plugin path resolves');
  assert.equal(args.filter(a=>a==='--Bridge').length,TOR_PT_CONFIG.bridges.obfs4.length);assert.ok(args.includes('--UseBridges'));
  assert.ok(args.includes('meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec pluggable_transports\\lyrebird.exe'));
 }finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});

test('an altered or missing transport client never runs: integrity / transports errors, after one repair attempt',async()=>{
 const userData=tmp(),pt=path.join(userData,'pt');fs.mkdirSync(pt);fs.writeFileSync(path.join(pt,'lyrebird.exe'),'tampered');
 const tor=fakeTor();let repairs=0,bad=null,none=null;
 try{
  createBridgeSettings({userData}).set({mode:'builtin',builtin:'snowflake'});
  bad=engineWith({userData,tor,transports:pt,pins:{'lyrebird.exe':sha('lyre')}});bad.acquire('w');
  const failed=await until(bad,s=>s.state==='error','integrity');assert.equal(failed.error.code,'integrity');assert.equal(tor.starts.length,0,'tor never started');
  none=engineWith({userData,tor,transports:null,repair:async()=>{repairs++;return false;}});none.acquire('w');
  const missing=await until(none,s=>s.state==='error','transports');assert.equal(missing.error.code,'transports');assert.match(missing.error.title,/\S/);assert.equal(repairs,1);assert.equal(tor.starts.length,0);
 }finally{bad?.stop();none?.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});

test('Tor that never gets past its first handshake looks blocked (not an error yet); progress past the handshake clears it',async()=>{
 const userData=tmp(),tor=fakeTor({script:[{progress:5,tag:'conn',warn:true},{progress:5,tag:'conn',warn:true}]});
 const engine=engineWith({userData,tor,online:true,timeouts:{blocked:{warned:300,quiet:600,bridgeWarned:900,bridgeQuiet:1200},blockedCheck:50}});
 try{
  engine.acquire('w');const blocked=await until(engine,s=>Boolean(s.blocked),'blocked');
  assert.equal(blocked.state,'connecting','tor keeps trying');assert.equal(blocked.blocked.phase,'conn');assert.equal(blocked.blocked.offline,false);assert.equal(blocked.blocked.bridges,null);assert.equal(blocked.blocked.reason,'CONNECTREFUSED');
  const windows=createTorWindows({engine,contentBlocking:null,log:()=>{},contentsOf:()=>[]});
  assert.deepEqual(windows.status().blocked,{phase:'conn',progress:5,offline:false,bridges:null},'the connect page gets it');
 }finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
 // Past the first handshake: not blocked after all.
 const userData2=tmp(),tor2=fakeTor({script:[{progress:5,tag:'conn',warn:true},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:5,tag:'conn'},{progress:20,tag:'onehop_create'},{progress:100,tag:'done'}]});
 const engine2=engineWith({userData:userData2,tor:tor2,timeouts:{blocked:{warned:60,quiet:600,bridgeWarned:900,bridgeQuiet:1200},blockedCheck:20}});
 try{
  engine2.acquire('w');await until(engine2,s=>Boolean(s.blocked),'blocked first');
  const after=await until(engine2,s=>s.progress>=20,'past handshake');assert.equal(after.blocked,null);
  await until(engine2,s=>s.state==='ready','ready');
 }finally{engine2.stop();tor2.stop();fs.rmSync(userData2,{recursive:true,force:true});}
});

test('offline is told apart from blocked',async()=>{
 const userData=tmp(),tor=fakeTor({script:[{progress:0,tag:'starting'}]});
 const engine=engineWith({userData,tor,online:false,timeouts:{blocked:{warned:100,quiet:150,bridgeWarned:900,bridgeQuiet:1200},blockedCheck:30}});
 try{engine.acquire('w');const s=await until(engine,x=>Boolean(x.blocked),'blocked');assert.equal(s.blocked.offline,true);}finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});

test('saving a bridge choice reconnects a Tor in use with it; with no Tor tab open it only applies next time',async()=>{
 const userData=tmp(),pt=path.join(userData,'pt');fs.mkdirSync(pt);fs.writeFileSync(path.join(pt,'lyrebird.exe'),'lyre');
 const tor=fakeTor(),engine=engineWith({userData,tor,transports:pt,pins:{'lyrebird.exe':sha('lyre')}});
 try{
  const idle=engine.setBridges({mode:'builtin',builtin:'meek'});assert.equal(idle.ok,true);assert.equal(engine.status().state,'idle','nothing started');assert.equal(tor.starts.length,0);
  const refused=engine.setBridges({mode:'custom',custom:'obfs4 x'});assert.equal(refused.ok,false);assert.equal(refused.code,'invalid');assert.equal(refused.mode,'builtin','the saved choice is unchanged');
  engine.acquire('w');await until(engine,s=>s.state==='ready','ready');assert.ok(tor.starts[0].args.includes('--UseBridges'));
  engine.setBridges({mode:'off'});await until(engine,s=>s.state==='ready'&&tor.starts.length===2,'reconnected');
  assert.ok(!tor.starts[1].args.includes('--UseBridges'),'reconnected without bridges');assert.equal(engine.status().bridges,null);
  assert.deepEqual(engine.checkBridges('obfs4 1.2.3.4:5\n203.0.113.9:9001'),{count:1,errors:[{line:1,code:'obfs4'}],empty:false});
 }finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});

test('Settings and the connect page reach bridges through tor-window, from any window',async()=>{
 const userData=tmp(),pt=path.join(userData,'pt');fs.mkdirSync(pt);fs.writeFileSync(path.join(pt,'lyrebird.exe'),'lyre');
 const tor=fakeTor(),engine=engineWith({userData,tor,transports:pt,pins:{'lyrebird.exe':sha('lyre')}});
 try{
  const windows=createTorWindows({engine,contentBlocking:null,log:()=>{},contentsOf:()=>[]});
  assert.equal(windows.handle({type:'tor.bridges'},{windowId:'ordinary'}).torBridges.installed,true);
  const set=windows.handle({type:'tor.bridges-set',bridges:{mode:'builtin',builtin:'snowflake'}},{windowId:'ordinary'});assert.equal(set.torBridges.ok,true);assert.equal(set.torBridges.builtin,'snowflake');
  assert.deepEqual(windows.handle({type:'tor.bridges-check',text:'obfs5 1.2.3.4:5'},{}).torBridgeCheck.errors,[{line:1,code:'transport',transport:'obfs5'}]);
  assert.throws(()=>windows.handle({type:'tor.bridges-check',text:42},{}));
 }finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});

test('Acira’s own Tor traffic (the engine updater) never goes direct: it needs the engine’s Tor fetch',()=>{
 const update=read('desktop/browser-services/tor-update.cjs');assert.match(update,/fetcher=NO_FETCH/);
 assert.match(read('desktop/browser-services/tor-window.cjs'),/createTorUpdater\(\{userData,log,fetcher:\(url,init\)=>tor\.fetch\(url,init\),ready:\(\)=>tor\.whenReady\(\)\}\)/);
});

test('a connection that goes silent after the first handshake starts again on another route by itself, with no error and no Tor page open; unwarm() ends the retrying',async()=>{
 const userData=tmp(),tor=fakeTor({script:[{progress:20,tag:'onehop_create'},{progress:30,tag:'loading_status'}]});
 const engine=engineWith({userData,tor,timeouts:{stall:250,earlyStall:250,blockedCheck:30,retryDelays:[60,60,60]}});
 const states=[];engine.onStatus(s=>states.push(s.state));
 try{
  void engine.warm(); // a Tor tab with no page yet: no lease
  assert.equal(engine.leases(),0);
  await until(engine,s=>s.progress>=30,'at 30%');
  await new Promise(resolve=>{const timer=setInterval(()=>{if(tor.starts.length>=3){clearInterval(timer);resolve();}},20);setTimeout(()=>{clearInterval(timer);resolve();},4000);});
  assert.ok(tor.starts.length>=3,'tor was started again after each silence ('+tor.starts.length+' starts)');
  assert.ok(!states.includes('error'),'a slow start is not shown as an error while it still has re-routes left');
  assert.equal(engine.status().slowRestarts>0,true,'the connect page can say the network is slow');
  // Past the re-routes it fails like before, and still tries again by itself because the Tor tab is still open.
  await until(engine,s=>s.state==='error'&&s.error.code==='unreachable'&&s.retryInMs>0,'error with a retry pending');
  const before=tor.starts.length;for(let i=0;i<100&&tor.starts.length<=before;i++)await new Promise(r=>setTimeout(r,20));assert.ok(tor.starts.length>before,'retried by itself');
  engine.unwarm();await until(engine,s=>s.state==='error','fails again');
  assert.equal(engine.status().retryInMs,0,'no retry once the Tor tab is gone');
 }finally{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}
});
