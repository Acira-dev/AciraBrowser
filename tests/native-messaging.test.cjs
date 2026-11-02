'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {encodeFrame,FrameReader,findHost,NOT_FOUND,FORBIDDEN,ERROR,TOO_LARGE}=require('../desktop/browser-services/native-messaging.cjs');
const {patchPreload}=require('../desktop/browser-services/extension-runtime-patch.cjs');

test('frames count bytes, not characters',()=>{
 const message={text:'héllo €日本語'};const frame=encodeFrame(message),body=JSON.stringify(message);
 assert.equal(frame.readUInt32LE(0),Buffer.byteLength(body,'utf8'));assert.ok(frame.readUInt32LE(0)>body.length);
 assert.deepEqual(JSON.parse(frame.subarray(4).toString('utf8')),message);
});

test('the reader joins split chunks and separates batched messages',()=>{
 const got=[],errors=[],reader=new FrameReader(m=>got.push(m),e=>errors.push(e));
 const a=encodeFrame({a:'é'.repeat(5000)}),b=encodeFrame({b:2}),c=encodeFrame({c:3}),all=Buffer.concat([a,b,c]);
 for(let i=0;i<all.length;i+=997)reader.push(all.subarray(i,i+997));
 assert.equal(got.length,3);assert.equal(got[0].a.length,5000);assert.deepEqual(got.slice(1),[{b:2},{c:3}]);assert.deepEqual(errors,[]);
 const header=Buffer.alloc(4);header.writeUInt32LE(a.length-4,0);const r2=[],reader2=new FrameReader(m=>r2.push(m),()=>undefined);
 reader2.push(header);assert.equal(r2.length,0);reader2.push(a.subarray(4));assert.equal(r2.length,1);
});

test('oversized and malformed frames are errors, not hangs',()=>{
 const errors=[];let reader=new FrameReader(()=>undefined,e=>errors.push(e),100);
 const big=Buffer.alloc(4);big.writeUInt32LE(101,0);reader.push(big);assert.deepEqual(errors,[TOO_LARGE]);
 errors.length=0;reader=new FrameReader(()=>undefined,e=>errors.push(e));
 const bad=Buffer.from('not json'),head=Buffer.alloc(4);head.writeUInt32LE(bad.length,0);reader.push(Buffer.concat([head,bad]));assert.deepEqual(errors,[ERROR]);
});

test('a missing, mismatched or forbidden host reports Chrome\'s messages',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-nm-')),hosts=path.join(dir,'NativeMessagingHosts');fs.mkdirSync(hosts);
 const exe=path.join(dir,'host.exe');fs.writeFileSync(exe,'',{mode:0o755});
 const write=(name,config)=>fs.writeFileSync(path.join(hosts,name+'.json'),JSON.stringify(config));
 write('com.acira.test.ok',{name:'com.acira.test.ok',description:'t',path:exe,type:'stdio',allowed_origins:['chrome-extension://abc/']});
 write('com.acira.test.mismatch',{name:'other.name',description:'t',path:exe,type:'stdio',allowed_origins:['chrome-extension://abc/']});
 assert.deepEqual(await findHost('com.acira.test.ok','chrome-extension://abc/',dir),{exe});
 assert.deepEqual(await findHost('com.acira.test.ok','chrome-extension://zzz/',dir),{error:FORBIDDEN});
 assert.deepEqual(await findHost('com.acira.test.mismatch','chrome-extension://abc/',dir),{error:NOT_FOUND});
 assert.deepEqual(await findHost('com.acira.test.nothing','chrome-extension://abc/',dir),{error:NOT_FOUND});
 assert.deepEqual(await findHost('../escape','chrome-extension://abc/',dir),{error:NOT_FOUND},'host names are validated like Chrome\'s');
});

test('the preload patch matches the pinned electron-chrome-extensions and is skipped (not half-applied) when it does not',()=>{
 const original=fs.readFileSync(require.resolve('electron-chrome-extensions/preload'),'utf8'),patched=patchPreload(original);
 assert.ok(patched,'all five edits must match the pinned library');assert.match(patched,/acira_withLastError/);assert.match(patched,/__acira_native_error/);
 assert.doesNotThrow(()=>new Function(patched));
 assert.equal(patchPreload(original.replace('class NativePort {','class OtherPort {')),null);
 assert.equal(patchPreload('unrelated'),null);
});
