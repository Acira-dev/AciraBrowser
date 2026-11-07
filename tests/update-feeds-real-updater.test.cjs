'use strict';
// The provider of update-feeds.cjs inside electron-updater's REAL AppUpdater (the one an installed copy runs), with local HTTP servers standing in for update.acirabrowser.com and
// the GitHub feed: what a check offers, what the servers are sent, and what a failed check looks like to the app. Only the HTTP client is Node's (as in qa/publish-update-proof.mjs).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {AppUpdater}=require('electron-updater/out/AppUpdater'),{NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
const {createFeedProviderClass}=require('../desktop/browser-services/update-feeds.cjs');

const sha='A'.repeat(86)+'==';
const doc=(version,extra={})=>JSON.stringify({version,files:[{url:'Acira-'+version+'.zip',sha512:sha,size:10}],...extra});
function server(handler){
  const s=http.createServer((req,res)=>{s.seen.push({url:req.url,headers:req.headers});handler(req,res);});s.seen=[];
  return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve({s,url:`http://127.0.0.1:${s.address().port}/`})));
}
async function check({primary,fallback,installed='0.1.0-beta.11',share=0,platform='darwin',floor=()=>null,primaryWithin=800}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-real-updater-'));
  try{
    await fs.writeFile(path.join(dir,'.updaterId'),'3b6f1c2e-0000-4000-8000-0000'+Math.floor(share*0xffffffff).toString(16).padStart(8,'0'));
    await fs.writeFile(path.join(dir,'app-update.yml'),JSON.stringify({provider:'generic',url:'http://127.0.0.1:1/'}));
    const updater=new AppUpdater(null,{isPackaged:true,version:installed,name:'Acira fixture',userDataPath:dir,baseCachePath:dir,appUpdateConfigPath:path.join(dir,'app-update.yml'),whenReady:async()=>{}});
    updater.httpExecutor=new NodeHttpExecutor();updater._testOnlyOptions={platform};updater.channel='beta';updater.allowPrerelease=true;updater.allowDowngrade=false;updater.logger=null;updater.autoDownload=false;
    const events=[];for(const name of ['update-available','update-not-available','error'])updater.on(name,info=>events.push(name));
    updater.setFeedURL({provider:'custom',updateProvider:createFeedProviderClass(),feeds:[{name:'primary',url:primary},...(fallback?[{name:'fallback',url:fallback}]:[])],current:installed,floor,primaryWithin,fallbackWithin:2000});
    let result=null,error=null;try{result=await updater.checkForUpdates();}catch(e){error=e;}
    return {result,error,events,provider:(await updater.clientPromise)};
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}

test('real AppUpdater: the first address answers, the second is never asked, and no staging id is sent to either', async t => {
  const a=await server((q,r)=>r.end(doc('0.1.0-beta.12'))),b=await server((q,r)=>r.end(doc('0.1.0-beta.99')));t.after(()=>{a.s.close();b.s.close();});
  const {result,error,provider}=await check({primary:a.url,fallback:b.url});
  assert.equal(error,null);assert.equal(result.isUpdateAvailable,true);assert.equal(result.updateInfo.version,'0.1.0-beta.12');
  assert.equal(a.s.seen[0].url,'/beta-mac.yml');assert.equal(b.s.seen.length,0);assert.equal(provider.answeredBy,'primary');
  for(const seen of a.s.seen)assert.equal(Object.keys(seen.headers).some(key=>key.toLowerCase()==='x-user-staging-id'),false,'the host learns no stable id for this install');
  assert.equal(provider.resolveFiles(result.updateInfo)[0].url.href,a.url+'Acira-0.1.0-beta.12.zip');
});

test('real AppUpdater: a primary that is down, silent, or serving a page gives way to a newer fallback; the app sees the check succeed', async t => {
  const newer=await server((q,r)=>r.end(doc('0.1.0-beta.13')));t.after(()=>newer.s.close());
  const modes={'503':(q,r)=>{r.statusCode=503;r.end('busy');},html:(q,r)=>r.end('<html>parked</html>'),garbage:(q,r)=>r.end(':\n  - [unclosed'),silent:()=>{}};
  for(const [mode,handler] of Object.entries(modes)){
    const bad=await server(handler);
    try{
      const {result,error,events,provider}=await check({primary:bad.url,fallback:newer.url,primaryWithin:250});
      assert.equal(error,null,mode);assert.equal(result.updateInfo.version,'0.1.0-beta.13',mode);assert.deepEqual(events,['update-available'],mode+': no error event while the second address answers');assert.equal(provider.answeredBy,'fallback',mode);
      assert.equal(provider.resolveFiles(result.updateInfo)[0].url.href,newer.url+'Acira-0.1.0-beta.13.zip','the file comes from the address that answered');
    }finally{bad.s.closeAllConnections?.();bad.s.close();}
  }
  // and a refused connection
  const {result}=await check({primary:'http://127.0.0.1:1/',fallback:newer.url});assert.equal(result.updateInfo.version,'0.1.0-beta.13');
});

test('real AppUpdater: frozen GitHub says beta.11, so for beta.11 and beta.12 it changes nothing and the check fails like an offline one', async t => {
  const frozen=await server((q,r)=>r.end(doc('0.1.0-beta.11'))),down=await server((q,r)=>{r.statusCode=503;r.end('no');});t.after(()=>{frozen.s.close();down.s.close();});
  for(const installed of ['0.1.0-beta.11','0.1.0-beta.12']){
    const {result,error,events}=await check({primary:down.url,fallback:frozen.url,installed});
    assert.equal(result,null,installed);assert.equal(error.code,'ERR_UPDATE_FEEDS_UNAVAILABLE',installed);assert.deepEqual(events,['error'],installed+': an error event, never "update-not-available" (the app would call that "up to date" or a halt)');
  }
  // an update this computer already holds is not "found again" from the old feed either
  const newer=await server((q,r)=>r.end(doc('0.1.0-beta.13')));t.after(()=>newer.s.close());
  const held=await check({primary:down.url,fallback:newer.url,installed:'0.1.0-beta.12',floor:()=>'0.1.0-beta.13'});assert.equal(held.error.code,'ERR_UPDATE_FEEDS_UNAVAILABLE');
});

test('real AppUpdater: a usable answer from the first address is final, including a halt and an older version; the staged share is decided on this computer', async t => {
  const fallback=await server((q,r)=>r.end(doc('0.1.0-beta.99')));t.after(()=>fallback.s.close());
  for(const [label,text,share,offered] of [['a halt',doc('0.1.0-beta.12',{stagingPercentage:0}),0,false],['10% and inside it',doc('0.1.0-beta.12',{stagingPercentage:10}),0.05,true],['10% and outside it',doc('0.1.0-beta.12',{stagingPercentage:10}),0.5,false],['everyone',doc('0.1.0-beta.12'),0.99,true],['an older build',doc('0.1.0-beta.9'),0,false],['nothing new',doc('0.1.0-beta.11'),0,false]]){
    const first=await server((q,r)=>r.end(text));
    try{
      const {result,error,events}=await check({primary:first.url,fallback:fallback.url,share});
      assert.equal(error,null,label);assert.equal(result.isUpdateAvailable,offered,label);assert.deepEqual(events,[offered?'update-available':'update-not-available'],label);
    }finally{first.s.close();}
  }
  assert.equal(fallback.s.seen.length,0,'GitHub was not asked once');
});

test('real AppUpdater: the channel file follows the platform under the same address', async t => {
  const a=await server((q,r)=>r.end(doc('0.1.0-beta.12')));t.after(()=>a.s.close());
  await check({primary:a.url,platform:'darwin'});await check({primary:a.url,platform:'win32'});
  const arch=process.env.TEST_UPDATER_ARCH;process.env.TEST_UPDATER_ARCH='x64';try{await check({primary:a.url+'linux/',platform:'linux'});}finally{if(arch===undefined)delete process.env.TEST_UPDATER_ARCH;else process.env.TEST_UPDATER_ARCH=arch;}
  assert.deepEqual(a.s.seen.map(item=>item.url),['/beta-mac.yml','/beta.yml','/linux/beta-linux.yml']);
});
