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
