// Native backend qualification: no windows, UI automation or user data.
const {app,session,protocol}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {BrowserDatabase}=require('../desktop/database.cjs'),{RequestPipeline}=require('../desktop/request-pipeline.cjs'),{createExitCleanup}=require('../desktop/browser-services/exit-cleanup.cjs');
const base=path.resolve(__dirname,'../.qa-profiles');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'mac-exit-barrier-'));app.setPath('userData',directory);app.setPath('sessionData',directory);
protocol.registerSchemesAsPrivileged([{scheme:'acira-browser-ui',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.whenReady().then(async()=>{
 let database,server,checks=0,hits=0;
 const wait=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Native activity did not settle');};
 try{
  server=http.createServer((_req,res)=>{hits++;res.end('owned local fixture');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,owner={id:'fixture',partition:'persist:mac-exit-fixture'},native=session.fromPartition(owner.partition),pipeline=new RequestPipeline(native);
  database=new BrowserDatabase(path.join(directory,'browser.sqlite'));
  const cleanup=createExitCleanup({database,getProfiles:()=>[owner],getSession:()=>native,getPipeline:()=>pipeline,hasLivePages:()=>false,cookieRestore:{flush:async()=>{},clear:()=>{},completeClear:async()=>{}},permissions:{list:()=>[]},commitRecords:()=>({counts:{}}),dialog:{showMessageBox:async()=>({response:1})},getWindow:()=>undefined,getProtectedOrigins:()=>({complete:true,profileId:owner.id,origins:[]})});
  assert.equal((await native.fetch(origin+'/before')).status,200);checks++;await wait(()=>pipeline.hasActiveRequests()===false);
  await native.cookies.set({url:origin,name:'fixture-before',value:'owned'});
  await cleanup.set(owner.id,{enabled:true,categories:['cookies'],keepOrigins:[]});
  const exited=await cleanup.runPending({phase:'exit'});assert.equal(exited.completed,true,JSON.stringify(exited));checks++;
  assert.equal((await native.cookies.get({})).length,0);checks++;
  assert.equal(cleanup.status(owner.id).networkBlocked,true);checks++;
  const previousHits=hits;await assert.rejects(native.fetch(origin+'/blocked'));await wait(()=>pipeline.hasActiveRequests()===false);assert.equal(hits,previousHits);checks++;
  await native.cookies.set({url:origin,name:'fixture-late',value:'owned'});await wait(()=>cleanup.status(owner.id).pending);
  assert.equal(cleanup.status(owner.id).pending,true);checks++;
  assert.equal((await cleanup.runPending({phase:'startup'})).completed,true);checks++;
  assert.equal(cleanup.status(owner.id).networkBlocked,false);checks++;
  assert.equal((await native.cookies.get({})).length,0);checks++;
  assert.equal((await native.fetch(origin+'/recovered')).status,200);checks++;await wait(()=>pipeline.hasActiveRequests()===false);
  console.log(JSON.stringify({passed:true,checks,hits,scope:'Actual Electron session/cookies/request pipeline. Exit barrier blocks native fetch after cleanup; a late native cookie re-arms the journal; startup clears it and releases network. Cookie recovery hook control flow is stubbed; native encryption is a separate qualification.'}));
 }catch(error){console.error(error);process.exitCode=1;app.once('will-quit',()=>app.exit(1));}
 finally{database?.close();if(server)await new Promise(resolve=>server.close(resolve));app.quit();}
});
app.on('will-quit',()=>fs.rmSync(directory,{recursive:true,force:true}));
