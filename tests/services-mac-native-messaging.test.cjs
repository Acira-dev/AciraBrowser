const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {findHost,installNativeMessaging,FORBIDDEN,NOT_FOUND}=require('../desktop/browser-services/native-messaging.cjs');
test('Mac native messaging discovers registered hosts, enforces origins and executable absolute paths, and exchanges a real framed message',async t=>{
 if(process.platform==='win32')return t.skip('Mac executable host fixture');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-native-host-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const options={platform:'darwin',home:path.join(root,'home'),libraryRoot:path.join(root,'Library')},name='com.acira.release_fixture',id='abcdefghijklmnopabcdefghijklmnop',origin=`chrome-extension://${id}/`,dir=path.join(options.home,'Library/Application Support/Google/Chrome/NativeMessagingHosts');fs.mkdirSync(dir,{recursive:true});
 const exe=path.join(root,'host.cjs');fs.writeFileSync(exe,'#!'+process.execPath+'\n'+`process.stdin.once('data',b=>{const n=b.readUInt32LE(0),message=JSON.parse(b.subarray(4,4+n));const body=Buffer.from(JSON.stringify({message,args:process.argv.slice(2),cwd:process.cwd()}));const h=Buffer.alloc(4);h.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([h,body]));});`,{mode:0o755});
 const file=path.join(dir,name+'.json'),config={name,type:'stdio',path:exe,allowed_origins:[origin]};const write=()=>fs.writeFileSync(file,JSON.stringify(config));write();
 assert.deepEqual(await findHost(name,origin,null,options),{exe});assert.deepEqual(await findHost(name,'chrome-extension://wrong/',null,options),{error:FORBIDDEN});
 config.path='host.cjs';write();assert.deepEqual(await findHost(name,origin,null,options),{error:NOT_FOUND});config.path=exe;write();fs.chmodSync(exe,0o644);assert.deepEqual(await findHost(name,origin,null,options),{error:NOT_FOUND});fs.chmodSync(exe,0o755);
 const handlers=new Map(['runtime.connectNative','runtime.disconnectNative','runtime.sendNativeMessage'].map(name=>[name,{callback(){}}]));assert(installNativeMessaging({ctx:{router:{handlers}}},{hostOptions:options,getWindowHandle:()=>123}));
 const reply=await Promise.race([handlers.get('runtime.sendNativeMessage').callback({extension:{id}},name,{text:'native Mac € 日本語'}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Native host response timeout')),5000);timer.unref()})]);
 assert.equal(reply.message.text,'native Mac € 日本語');assert.deepEqual(reply.args,[origin]);assert.equal(fs.realpathSync(reply.cwd),fs.realpathSync(root));
});
