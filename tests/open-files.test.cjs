const{test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const{createOpenFileIntake}=require('../desktop/accounts/open-files.cjs');
const event=()=>({prevented:false,preventDefault(){this.prevented=true;}});
test('a file macOS opens before the browser is ready waits, then arrives once, in order',async()=>{
 const app=new EventEmitter(),intake=createOpenFileIntake({app}),first=event(),second=event();
 app.emit('open-file',first,'/Users/x/a.html');app.emit('open-file',second,'/Users/x/b.pdf');
 assert.equal(first.prevented,true,'the event is claimed, so Electron does not drop the file');assert.equal(second.prevented,true);assert.equal(intake.pending,2);
 const seen=[];await intake.bind(async file=>{seen.push(file);});
 assert.deepEqual(seen,['/Users/x/a.html','/Users/x/b.pdf']);assert.equal(intake.pending,0);
});
test('a file opened after the browser is ready is handed over at once',async()=>{
 const app=new EventEmitter(),intake=createOpenFileIntake({app}),seen=[];await intake.bind(async file=>{seen.push(file);});
 const e=event();app.emit('open-file',e,'/Users/x/c.html');await new Promise(r=>setImmediate(r));
 assert.deepEqual(seen,['/Users/x/c.html']);assert.equal(e.prevented,true);
});
test('anything that is not an absolute path is left alone',async()=>{
 const app=new EventEmitter(),intake=createOpenFileIntake({app}),seen=[];await intake.bind(async file=>{seen.push(file);});
 for(const value of [undefined,null,42,'relative/a.html','','file:///Users/x/a.html','x'.repeat(5000)]){const e=event();app.emit('open-file',e,value);assert.equal(e.prevented,false,String(value).slice(0,20));}
 assert.deepEqual(seen,[]);
});
test('a handler that fails reports once and the next file still opens; the queue is bounded; dispose stops listening',async()=>{
 const app=new EventEmitter(),errors=[],intake=createOpenFileIntake({app,onError:message=>errors.push(message),maxQueued:2});
 for(const name of ['a','b','c'])app.emit('open-file',event(),'/Users/x/'+name+'.html');assert.equal(intake.pending,2);
 const seen=[];await intake.bind(async file=>{if(file.endsWith('a.html'))throw new Error('no window');seen.push(file);});
 assert.deepEqual(seen,['/Users/x/b.html']);assert.deepEqual(errors,['A file could not be opened.']);
 intake.dispose();assert.equal(app.listenerCount('open-file'),0);
});

// Windows and Linux name the file in the command line ("Open with", a drop on the program's icon) instead of raising 'open-file'. Run here on any computer: the platform is named.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const withFiles=async(names,run)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-open-files-'));try{const files=Object.fromEntries(names.map(name=>{const file=path.join(dir,name);fs.writeFileSync(file,'x');return [name,file];}));return await run(files,dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}};
test('Windows: a file named in the command line of the first start opens, and only a file a tab can show',()=>withFiles(['a.html','b.pdf','c.exe','d.txt'],async(files,dir)=>{
 const app=new EventEmitter(),exe=path.join(dir,'AciraBrowser.exe');fs.writeFileSync(exe,'x');
 const argv=[exe,'--acira-app=x','https://example.com/e.html','relative/a.html',files['a.html'],path.join(dir,'missing.html'),files['c.exe'],files['b.pdf'],files['a.html']];
 const intake=createOpenFileIntake({app,argv,platform:'win32'}),seen=[];await intake.bind(async file=>{seen.push(file);});
 assert.deepEqual(seen,[files['a.html'],files['b.pdf']],'the program, flags, addresses, relative or missing paths, an .exe and a repeat are not files to open');
 intake.dispose();assert.equal(app.listenerCount('second-instance'),0);
}));
test('Windows and Linux: a second start of a running Acira hands its file over; macOS uses open-file only',()=>withFiles(['a.html','b.svg'],async(files)=>{
 for(const platform of ['win32','linux']){
  const app=new EventEmitter(),intake=createOpenFileIntake({app,platform}),seen=[];await intake.bind(async file=>{seen.push(file);});
  app.emit('second-instance',{},['AciraBrowser.exe',files['b.svg']],'/work');await new Promise(r=>setImmediate(r));
  assert.deepEqual(seen,[files['b.svg']],platform);
  app.emit('second-instance',{},['AciraBrowser.exe'],'/work');app.emit('second-instance',{},undefined,'/work');await new Promise(r=>setImmediate(r));
  assert.deepEqual(seen,[files['b.svg']],'nothing to open, nothing opened');
 }
 const mac=new EventEmitter(),intake=createOpenFileIntake({app:mac,argv:['x',files['a.html']],platform:'darwin'}),seen=[];await intake.bind(async file=>{seen.push(file);});
 mac.emit('second-instance',{},['x',files['a.html']],'/');await new Promise(r=>setImmediate(r));
 assert.deepEqual(seen,[],'a Mac does not read file names from the command line');assert.equal(mac.listenerCount('second-instance'),0);
}));
test('the command line queue is bounded like the open-file one',()=>withFiles(['1.html','2.html','3.html'],async(files)=>{
 const app=new EventEmitter(),intake=createOpenFileIntake({app,argv:Object.values(files),platform:'win32',maxQueued:2});
 assert.equal(intake.pending,2);intake.dispose();
}));
