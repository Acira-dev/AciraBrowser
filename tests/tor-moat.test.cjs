'use strict';
// Moat (tor-moat.cjs): Tor Browser's domain-fronted "Request a bridge". The meek credentials, the managed-transport handshake, the HTTP
// parsing, the client's pin check, and the engine saving Moat's bridges as the person's own. The real network round trip is
// qa/r9-tor-moat.mjs; nothing here leaves 127.0.0.1.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createTorMoat,meekCredentials,parseCmethods,parseHttpResponse,TOR_MOAT_SERVICE,TOR_MOAT_TARGETS}=require('../desktop/browser-services/tor-moat.cjs');
const {createTorEngine}=require('../desktop/browser-services/tor-engine.cjs');
const {createTorWindows}=require('../desktop/browser-services/tor-window.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-moat-'));

test('Moat is reached exactly as Tor Browser 15 reaches it: its service URL and CDN targets, meek arguments escaped per the PT spec',()=>{
 assert.equal(TOR_MOAT_SERVICE,'https://bridges.torproject.org/moat');
 assert.equal(TOR_MOAT_TARGETS,'https://1723079976.rsc.cdn77.org|cdn.zk.mk+www.cdn77.com');
 assert.deepEqual(meekCredentials(),['targets=https://1723079976.rsc.cdn77.org|cdn.zk.mk+www.cdn77.com','\x00']);
 assert.deepEqual(meekCredentials('a=b;c\\d'),['targets=a\\=b\\;c\\\\d','\x00']);
 const long='x'.repeat(300),[user,pass]=meekCredentials(long);assert.equal(user.length,255);assert.equal(user+pass,'targets='+long,'over 255 bytes, the rest goes in the password (SOCKS5 field limit)');
});

test('the managed lyrebird handshake and Moat’s HTTP answers are read strictly',()=>{
 assert.deepEqual(parseCmethods('VERSION 1\nCMETHOD meek_lite socks5 127.0.0.1:61234\nCMETHODS DONE\n'),{version:'1',port:61234,error:null,done:true});
 assert.equal(parseCmethods('VERSION 1\nCMETHOD meek_lite socks5 10.0.0.5:61234\nCMETHODS DONE').port,0,'a client listening anywhere but loopback is not used');
 assert.match(parseCmethods('VERSION-ERROR no-version').error,/VERSION-ERROR/);
 const body=JSON.stringify({data:[{bridges:['x']}]});
 assert.deepEqual(parseHttpResponse(Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}junk`)).body,body);
 const chunked=`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${(5).toString(16)}\r\n${body.slice(0,5)}\r\n${(body.length-5).toString(16)}\r\n${body.slice(5)}\r\n0\r\n\r\n`;
 assert.equal(parseHttpResponse(Buffer.from(chunked)).body,body);
 assert.equal(parseHttpResponse(Buffer.from('HTTP/1.1 502 Bad Gateway\r\n\r\n')).status,502);
});

test('Moat runs only the pinned lyrebird: a missing or altered client never starts',async()=>{
 const userData=tmp(),dir=path.join(userData,'pt');fs.mkdirSync(dir);let spawned=0;
 try{
  const missing=createTorMoat({userData,platform:'win32',transports:()=>null,pins:()=>({'lyrebird.exe':'0'.repeat(64)}),verify:async()=>true,spawnClient:()=>{spawned++;}});
  await assert.rejects(missing.fetch(),error=>error.code==='transports');
  fs.writeFileSync(path.join(dir,'lyrebird.exe'),'tampered');
  const altered=createTorMoat({userData,platform:'win32',transports:()=>dir,pins:()=>({'lyrebird.exe':'0'.repeat(64)}),verify:async(file,sha)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===sha,spawnClient:()=>{spawned++;}});
  await assert.rejects(altered.fetch(),error=>error.code==='integrity');
  assert.equal(spawned,0);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('the managed client gets the PT environment, no arguments, and stops when its stdin closes',async()=>{
 const userData=tmp(),dir=path.join(userData,'pt');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'lyrebird.exe'),'lyre');
 let seen=null;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;child.kill=()=>{};
 let stdinClosed=false;child.stdin.on('finish',()=>{stdinClosed=true;});
 try{
  const moat=createTorMoat({userData,platform:'win32',transports:()=>dir,pins:()=>({'lyrebird.exe':'x'}),verify:async()=>true,spawnClient:(file,args,options)=>{seen={file,args,env:options.env,cwd:options.cwd};setTimeout(()=>child.stdout.write('VERSION 1\nCMETHOD meek_lite socks5 127.0.0.1:9\nCMETHODS DONE\n'),10);return child;},timeouts:{request:500}});
  await assert.rejects(moat.fetch()); // port 9 refuses: the request fails, but the client was started correctly
  assert.equal(seen.file,path.join(dir,'lyrebird.exe'));assert.deepEqual(seen.args,[]);assert.equal(seen.cwd,dir);
  assert.equal(seen.env.TOR_PT_MANAGED_TRANSPORT_VER,'1');assert.equal(seen.env.TOR_PT_CLIENT_TRANSPORTS,'meek_lite');assert.equal(seen.env.TOR_PT_EXIT_ON_STDIN_CLOSE,'1');
  assert.equal(seen.env.TOR_PT_STATE_LOCATION,path.join(userData,'tor','moat-pt-state'));
  moat.stop();await new Promise(r=>setTimeout(r,20));assert.equal(stdinClosed,true);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('the bridges Moat gives are saved as the person’s own; a wrong answer saves nothing; Settings reaches it through tor-window',async()=>{
 const userData=tmp();let answers=0;
 const lines=['obfs4 203.0.113.7:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=abc iat-mode=0','obfs4 203.0.113.8:443 1123456789ABCDEF0123456789ABCDEF01234567 cert=def iat-mode=0'];
 const fake=()=>({fetch:async()=>({transport:'obfs4',image:'/9j/AAAA',challenge:'c1'}),check:async({solution})=>{answers++;return solution==='right'?lines:null;},stop(){}});
 try{
  const engine=createTorEngine({userData,executable:()=>null,repair:async()=>false,moatFactory:fake});
  const windows=createTorWindows({engine,contentBlocking:null,log:()=>{},contentsOf:()=>[]});
  assert.deepEqual((await windows.handle({type:'tor.moat-fetch'},{windowId:'settings'})).torMoat,{transport:'obfs4',image:'/9j/AAAA',challenge:'c1'});
  const wrong=await windows.handle({type:'tor.moat-check',transport:'obfs4',challenge:'c1',solution:'nope'},{windowId:'settings'});
  assert.equal(wrong.torMoat.wrong,true);assert.equal(engine.bridges().mode,'off','nothing saved');
  const right=await windows.handle({type:'tor.moat-check',transport:'obfs4',challenge:'c1',solution:' right '},{windowId:'settings'});
  assert.deepEqual(right.torMoat,{ok:true,wrong:false,count:2});assert.equal(right.torBridges.mode,'custom');assert.deepEqual(right.torBridges.custom,lines);
  assert.throws(()=>windows.handle({type:'tor.moat-check',challenge:'c1',solution:''},{}),/characters/);
  assert.equal(answers,2);engine.stop();
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});
