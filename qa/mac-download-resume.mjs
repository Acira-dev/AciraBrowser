// Actual native HTTP range recovery through the public UI service after an owned main-process crash.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';

const candidate=process.argv[2]?path.resolve(process.argv[2]):process.cwd();
const root=path.resolve('.qa-profiles/mac-download-resume-'+Date.now());
const out=path.resolve(process.env.MAC_DEEP_OUT||'qa/artifacts/mac-download-resume-'+Date.now());
await fs.mkdir(out,{recursive:true});
const payload=Buffer.alloc(8*1024*1024);for(let i=0;i<payload.length;i++)payload[i]=i%251;
const requests=[];
const server=await httpFixture((req,res)=>{
 if(req.url!=='/file'){res.setHeader('Set-Cookie','resume_owner='+(req.url==='/private'?'private-profile':'owned-profile')+'; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax');res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned download</title><a href="/file" download>Download report</a>');return;}
 if(req.headers.cookie!=='resume_owner=owned-profile'){requests.push({ownedProfileCookie:false});res.writeHead(403);res.end('Wrong owned fixture profile');return;}
 const offset=Number(/bytes=(\d+)-/.exec(req.headers.range||'')?.[1]||0);requests.push({offset,range:req.headers.range||null,ifRange:req.headers['if-range']||null,ownedProfileCookie:true});
 res.writeHead(offset?206:200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="owned-range.bin"','Content-Length':payload.length-offset,'Accept-Ranges':'bytes','ETag':'"acira-owned-range-v1"',...(offset?{'Content-Range':`bytes ${offset}-${payload.length-1}/${payload.length}`}:{})});
 let sent=offset;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}const end=Math.min(sent+65536,payload.length);res.write(payload.subarray(sent,end));sent=end;if(sent===payload.length){clearInterval(timer);res.end();}},25);res.on('close',()=>clearInterval(timer));
});
const origin='http://127.0.0.1:'+server.port,report={passed:false,candidate,root,checks:[],requests};let app;
const launch=()=>startApp({root,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.join(candidate,'desktop/main.cjs'),ACIRA_BROWSER_TEST_DOWNLOAD_DIR:path.join(root,'saved')}});
try{
 app=await launch();await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:true}});
 await app.act({type:'tab.navigate',url:origin+'/'});let web=await app.waitWeb(origin+'/');await web.getByRole('link',{name:'Download report'}).click();
 const list=async()=> (await app.svc({type:'downloads.list'})).downloads;
 let row=await poll(async()=>(await list())[0],v=>v?.receivedBytes>=262144&&v.status==='Downloading','Native bytes arriving');
 await app.svc({type:'downloads.command',id:row.id,command:'pause'});row=await poll(async()=>(await list())[0],v=>v.status==='Paused','Native download paused');
 const size=row.receivedBytes;await sleep(1400);assert.equal((await list())[0].receivedBytes,size);report.checks.push('Actual range-capable transfer pauses and bytes stop');
 await app.main(async({webContents},url)=>{await webContents.getAllWebContents().find(w=>w.getURL()===url).session.cookies.flushStore();},origin+'/');
 report.before={id:row.id,receivedBytes:row.receivedBytes,totalBytes:row.totalBytes,path:row.path};
 const child=app.app.process(),exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exit;app=null;await sleep(600);
 app=await launch();row=await poll(async()=>(await list()).find(r=>r.id===report.before.id),v=>v?.status==='Interrupted','Interrupted transfer restored');
 assert(row.canResume&&row.canCancel&&!row.canPause);assert.equal(row.receivedBytes,size);report.checks.push('Owned main crash restores partial-file record with Resume available');
 if(process.env.MAC_RESUME_WITH_PRIVATE==='1'){await app.act({type:'tab.new',privacy:'private',url:origin+'/private',background:true});await app.waitWeb(origin+'/private');}
 await app.act({type:'tab.navigate',url:'acira://downloads'});await app.ui.locator('.ed-library').waitFor();
 await app.ui.getByRole('button',{name:'Resume',exact:true}).click();
 row=await poll(async()=>(await list()).find(r=>r.id===report.before.id),v=>v?.status==='Ready','Mounted Downloads Resume completes',30000);
 assert(requests.some(q=>q.offset>0),'Server received a real HTTP Range request');const bytes=await fs.readFile(row.path);assert.equal(bytes.length,payload.length);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),crypto.createHash('sha256').update(payload).digest('hex'));assert.equal(row.id,report.before.id);report.checks.push('Public service resumes the same ID from real HTTP byte range and preserves its profile cookie and produces the exact original file hash');
 report.checks.push(process.env.MAC_RESUME_WITH_PRIVATE==='1'?'Mounted ordinary Resume refuses to borrow a background private website session':'Mounted Resume works with Downloads as the only open tab and no website renderer');
 report.after={id:row.id,receivedBytes:row.receivedBytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{if(app)try{report.uiErrors=await app.ui.locator('[role=alert]').allTextContents();}catch{}await app?.close();await server.close();await fs.writeFile(path.join(out,'download-resume.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
