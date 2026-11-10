'use strict';
// "Leave this site?" without freezing the browser (13.5). Up to 13.4 a reload, Back, a form or a script's navigation on a page with a beforeunload
// handler raised dialog.showMessageBoxSync, which blocks the whole main process until it is answered. desktop/leave-gate.cjs keeps the page where it is,
// asks without blocking, and repeats what the person was doing when they say Leave. These tests drive the gate with a fake page and a question the
// test answers whenever it likes.
const test=require('node:test'),assert=require('node:assert/strict');
const {createLeaveGate,classify,guardUnload,APPROVE_MS,INTENT_MS}=require('../desktop/leave-gate.cjs');

function fixture({url='https://site.example/edit',entryExtra={},gateOptions={}}={}){
  let clock=1000000;const log=[];
  const entry={closing:null,discarding:false,leaveApproved:0,askingLeave:false,navigation:{phase:'idle',target:null},...entryExtra};
  // closePage's real cancelClose exists only while a close is registered, and ends it (clears entry.closing); the fixture behaves the same way
  Object.defineProperty(entry,'cancelClose',{configurable:true,enumerable:true,get(){return entry.closing?()=>{log.push('cancelClose');entry.closing=null;}:null;},set(){}});
  const contents={destroyed:false,getURL:()=>url,isDestroyed(){return this.destroyed;}};
  const questions=[];
  const gate=createLeaveGate({entry,contents,now:()=>clock,settleMs:0,retryMs:30,retries:0,...gateOptions,
    stay:opts=>log.push(opts&&opts.keepClosing?'stay(keepClosing)':'stay'),
    ask:intent=>new Promise(resolve=>questions.push({intent,answer:resolve})),
    perform:intent=>log.push('perform:'+intent.kind+(intent.url?':'+intent.url:''))});
  const fire=()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};gate.handle(event);return event;};
  return {entry,contents,gate,questions,log,fire,tick:ms=>{clock+=ms;},now:()=>clock};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,60));   // an answer is acted on a moment after it arrives (settleMs 0 here)

test('classify: a close in progress wins over everything else',()=>{
  const now=5000;
  assert.deepEqual(classify({closing:Promise.resolve(),leaveIntent:{kind:'reload',at:now,redo(){}},navigation:{phase:'loading',target:'https://a/'}},now,'https://b/'),{kind:'close'});
});

test('classify: an Acira reload or history step counts for two seconds, then it is forgotten',()=>{
  const redo=()=>{};
  assert.equal(classify({leaveIntent:{kind:'reload',at:1000,redo}},1000+INTENT_MS,'https://a/').kind,'reload');
  assert.equal(classify({leaveIntent:{kind:'history',at:1000,redo}},1000+INTENT_MS,'https://a/').kind,'history');
  assert.equal(classify({leaveIntent:{kind:'reload',at:1000,redo}},1000+INTENT_MS+1,'https://a/').kind,'unknown');
  assert.equal(classify({leaveIntent:{kind:'reload',at:1000}},1000,'https://a/').kind,'unknown','no way to repeat it, so it is not a known step');
});

test('classify: a loading address that is not this page is a navigation; the page\'s own address is not',()=>{
  assert.deepEqual(classify({navigation:{phase:'loading',target:'https://b/x'}},1,'https://a/'),{kind:'navigate',url:'https://b/x'});
  assert.equal(classify({navigation:{phase:'loading',target:'https://a/'}},1,'https://a/').kind,'unknown');
  assert.equal(classify({navigation:{phase:'idle',target:'https://b/x'}},1,'https://a/').kind,'unknown');
});

test('classify: a navigation the page started itself, then a link click, each for two seconds',()=>{
  assert.deepEqual(classify({navIntent:{url:'https://b/form',type:'push',at:100}},100+INTENT_MS,'https://a/'),{kind:'navigate',url:'https://b/form'});
  assert.deepEqual(classify({navIntent:{url:'https://a/',type:'reload',at:100}},100,'https://a/'),{kind:'reload',redo:null});
  assert.equal(classify({navIntent:{url:'https://b/form',type:'push',at:100}},100+INTENT_MS+1,'https://a/').kind,'unknown');
  assert.deepEqual(classify({navIntent:{url:'https://b/post',type:'push',form:true,at:100}},100,'https://a/'),{kind:'form',url:'https://b/post',once:true},'a posting form is submitted again, never run twice');
  assert.deepEqual(classify({linkIntent:{url:'https://b/link',at:50}},50,'https://a/'),{kind:'navigate',url:'https://b/link'});
  assert.deepEqual(classify({navIntent:{url:'https://b/own',type:'replace',at:50},linkIntent:{url:'https://b/link',at:50}},50,'https://a/'),{kind:'navigate',url:'https://b/own'},'the page\'s own event is exact');
  assert.equal(classify({},1,'https://a/').kind,'unknown');
});

test('a page that is being put to sleep stays without a question',()=>{
  const f=fixture();f.entry.discarding=true;const event=f.fire();
  assert.equal(event.prevented,false);assert.deepEqual(f.log,['stay']);assert.equal(f.questions.length,0);
});

test('an approved leave lets the page go without asking again, for five seconds',async()=>{
  const f=fixture({entryExtra:{linkIntent:{url:'https://b/x',at:1000000}}});
  const first=f.fire();assert.equal(first.prevented,false,'the page stays first');assert.equal(f.questions.length,1);
  f.questions[0].answer(true);await settle();
  assert.equal(f.entry.leaveApproved,f.now()+APPROVE_MS);assert.deepEqual(f.log,['stay','perform:navigate:https://b/x']);
  const again=f.fire();assert.equal(again.prevented,true,'the repeat is let through');assert.equal(f.questions.length,1);
  f.tick(APPROVE_MS+1);const later=f.fire();assert.equal(later.prevented,false);assert.equal(f.questions.length,2,'after five seconds it asks again');
});

test('the question never blocks: the handler returns while it is still open, and an unanswered question changes nothing',async()=>{
  const f=fixture({entryExtra:{leaveIntent:{kind:'reload',at:1000000,redo:()=>{}}}});
  const event=f.fire();
  assert.equal(event.prevented,false);assert.equal(f.questions.length,1);assert.equal(f.questions[0].intent.kind,'reload');
  assert.equal(f.entry.askingLeave,true);assert.deepEqual(f.log,['stay']);
});

test('Stay leaves everything as it was',async()=>{
  const f=fixture({entryExtra:{leaveIntent:{kind:'history',at:1000000,redo:()=>f.log.push('redo')}}});
  f.fire();f.questions[0].answer(false);await settle();
  assert.deepEqual(f.log,['stay']);assert.equal(f.entry.askingLeave,false);assert.equal(f.entry.leaveApproved,0);
});

test('Leave repeats a reload or a history step through the recorded repeat',async()=>{
  const f=fixture();
  f.entry.leaveIntent={kind:'reload',at:f.now(),redo:()=>f.log.push('reload again')};
  f.fire();f.questions[0].answer(true);await settle();
  assert.deepEqual(f.log,['stay','perform:reload']);
});

test('a second attempt while the question is up only keeps the page, with no second question',async()=>{
  const f=fixture({entryExtra:{linkIntent:{url:'https://b/x',at:1000000}}});
  f.fire();f.entry.linkIntent={url:'https://c/y',at:f.now()};const second=f.fire();
  assert.equal(second.prevented,false);assert.equal(f.questions.length,1);assert.deepEqual(f.log,['stay','stay']);
  f.questions[0].answer(true);await settle();
  assert.deepEqual(f.log.slice(-1),['perform:navigate:https://b/x'],'the first question decides');
});

test('a tab close keeps its close open while the question is up, then finishes or ends it',async()=>{
  const stay=fixture({entryExtra:{closing:Promise.resolve()}});
  stay.fire();assert.deepEqual(stay.log,['stay(keepClosing)'],'the close is not ended yet');
  stay.questions[0].answer(false);await settle();assert.deepEqual(stay.log,['stay(keepClosing)','cancelClose']);
  const leave=fixture({entryExtra:{closing:Promise.resolve()}});
  leave.fire();leave.questions[0].answer(true);await settle();
  assert.deepEqual(leave.log,['stay(keepClosing)','perform:close'],'Leave closes the page again with its prompt waived; the close promise settles when the page is gone');
});

test('a page that is gone before the answer is left alone',async()=>{
  const f=fixture({entryExtra:{closing:Promise.resolve()}});
  f.fire();f.contents.destroyed=true;f.questions[0].answer(true);await settle();
  assert.deepEqual(f.log,['stay(keepClosing)']);assert.equal(f.entry.askingLeave,false);assert.equal(f.entry.leaveApproved,0);
});

test('a question that fails, or a repeat that throws, ends as Stay',async()=>{
  const broken=fixture({entryExtra:{closing:Promise.resolve()}});
  const gate=createLeaveGate({entry:broken.entry,contents:broken.contents,now:broken.now,settleMs:0,retries:0,stay:()=>{},ask:()=>Promise.reject(new Error('no sheet')),perform:()=>{}});
  gate.handle({preventDefault(){}});await settle();
  assert.equal(broken.entry.askingLeave,false);assert.deepEqual(broken.log,['cancelClose']);
  const sync=fixture({entryExtra:{closing:Promise.resolve()}});
  const syncGate=createLeaveGate({entry:sync.entry,contents:sync.contents,now:sync.now,settleMs:0,retries:0,stay:()=>{},ask:()=>{throw new Error('boom');},perform:()=>{}});
  syncGate.handle({preventDefault(){}});await settle();assert.deepEqual(sync.log,['cancelClose']);
  const failing=fixture({entryExtra:{closing:Promise.resolve()}});
  const failGate=createLeaveGate({entry:failing.entry,contents:failing.contents,now:failing.now,settleMs:0,retries:0,stay:()=>{},ask:()=>Promise.resolve(true),perform:()=>{throw new Error('close failed');}});
  failGate.handle({preventDefault(){}});await settle();
  assert.equal(failing.entry.leaveApproved,0,'a failed repeat does not leave the prompt waived');assert.deepEqual(failing.log,['cancelClose']);
});

test('the recorded hints are used once',()=>{
  const f=fixture({entryExtra:{linkIntent:{url:'https://b/x',at:1000000},navIntent:{url:'https://b/y',type:'push',at:1000000},leaveIntent:{kind:'reload',at:1000000,redo(){}}}});
  f.fire();assert.equal(f.entry.linkIntent,undefined);assert.equal(f.entry.navIntent,undefined);assert.equal(f.entry.leaveIntent,undefined);
});

test('two pages ask independently',async()=>{
  const a=fixture({url:'https://a.example/'}),b=fixture({url:'https://b.example/'});
  a.entry.linkIntent={url:'https://a.example/next',at:a.now()};b.entry.linkIntent={url:'https://b.example/next',at:b.now()};
  a.fire();b.fire();assert.equal(a.questions.length,1);assert.equal(b.questions.length,1);
  b.questions[0].answer(true);await settle();
  assert.deepEqual(b.log,['stay','perform:navigate:https://b.example/next']);assert.deepEqual(a.log,['stay'],'a is still waiting');assert.equal(a.entry.askingLeave,true);
});

test('guardUnload records reload, hard reload, Back, Forward and history steps, and the repeat does not record itself',()=>{
  const calls=[];
  const contents={reload(){calls.push('reload');},reloadIgnoringCache(){calls.push('hard');},navigationHistory:{goBack(){calls.push('back');},goForward(){calls.push('forward');},goToIndex(i){calls.push('index'+i);},goToOffset(o){calls.push('offset'+o);}}};
  const entry={};let clock=10;guardUnload(contents,entry,()=>clock);
  contents.reload();assert.equal(entry.leaveIntent.kind,'reload');assert.equal(entry.leaveIntent.at,10);
  clock=20;contents.reloadIgnoringCache();assert.equal(entry.leaveIntent.at,20);
  entry.leaveIntent.redo();assert.equal(entry.leaveIntent.at,20,'the repeat calls the original, not the wrapped method');
  contents.navigationHistory.goBack();assert.equal(entry.leaveIntent.kind,'history');
  contents.navigationHistory.goToIndex(3);entry.leaveIntent.redo();
  contents.navigationHistory.goForward();contents.navigationHistory.goToOffset(-2);
  assert.deepEqual(calls,['reload','hard','hard','back','index3','index3','forward','offset-2']);
});

test('guardUnload leaves a page without navigationHistory or some methods alone',()=>{
  const contents={reload(){return 'r';}};const entry={};
  guardUnload(contents,entry);assert.equal(contents.reload(),'r');assert.equal(entry.leaveIntent.kind,'reload');
});

test('an answer that arrives at once is acted on after the unload check that raised the question has finished, not in the same turn',async()=>{
  const f=fixture({entryExtra:{linkIntent:{url:'https://b/x',at:1000000}},gateOptions:{settleMs:20}});
  const answers=[];const gate=createLeaveGate({entry:f.entry,contents:f.contents,now:f.now,settleMs:20,retries:0,stay:()=>{},ask:()=>Promise.resolve(true),perform:intent=>answers.push(intent.kind)});
  gate.handle({preventDefault(){}});
  await Promise.resolve();await Promise.resolve();assert.deepEqual(answers,[],'not yet: the page is still finishing the unload check');
  await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(answers,['navigate']);
});

test('while the answer is being acted on, the page\'s prompt is already waived',async()=>{
  const f=fixture({entryExtra:{linkIntent:{url:'https://b/x',at:1000000}},gateOptions:{settleMs:40}});
  f.fire();f.questions[0].answer(true);await Promise.resolve();await Promise.resolve();
  const early=f.fire();assert.equal(early.prevented,true,'a repeat that comes first is let through');
});

test('a repeat the browser took for the unload check still under way is run again, twice at most, and not once the page raised its check',async()=>{
  let runs=0;
  const f=fixture({entryExtra:{leaveIntent:{kind:'reload',at:1000000,redo:()=>{}}},gateOptions:{retries:2}});
  const gate=createLeaveGate({entry:f.entry,contents:f.contents,now:f.now,settleMs:0,retryMs:30,retries:2,stay:()=>{},ask:()=>Promise.resolve(true),perform:()=>{runs++;}});
  gate.handle({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(runs,3,'the first run and two more');
  // when the page does raise its check after the first run, nothing more is run
  let runs2=0;const g=fixture({entryExtra:{leaveIntent:{kind:'reload',at:1000000,redo:()=>{}}}});
  const gate2=createLeaveGate({entry:g.entry,contents:g.contents,now:g.now,settleMs:0,retryMs:30,retries:2,stay:()=>{},ask:()=>Promise.resolve(true),perform:()=>{runs2++;setTimeout(()=>gate2.handle({preventDefault(){}}),5);}});
  gate2.handle({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(runs2,1);
  // and nothing is run for a page that is gone
  let runs3=0;const h=fixture({entryExtra:{leaveIntent:{kind:'reload',at:1000000,redo:()=>{}}}});
  const gate3=createLeaveGate({entry:h.entry,contents:h.contents,now:h.now,settleMs:0,retryMs:30,retries:2,stay:()=>{},ask:()=>Promise.resolve(true),perform:()=>{runs3++;h.contents.destroyed=true;}});
  gate3.handle({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,200));assert.equal(runs3,1);
});

test('a posting form is repeated once and never again, even when the page raises no check afterwards',async()=>{
  let runs=0;const f=fixture({entryExtra:{navIntent:{url:'https://b/post',type:'push',form:true,at:1000000}}});
  const gate=createLeaveGate({entry:f.entry,contents:f.contents,now:f.now,settleMs:0,retryMs:30,retries:2,stay:()=>{},ask:()=>Promise.resolve(true),perform:intent=>{assert.equal(intent.kind,'form');runs++;}});
  gate.handle({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,200));assert.equal(runs,1);
});

test('a close that comes while a reload question is up is ended, not held (nobody would answer it); a reload that comes while a close question is up just stays',async()=>{
  const f=fixture({entryExtra:{leaveIntent:{kind:'reload',at:1000000,redo:()=>{}}}});
  f.fire();assert.equal(f.questions.length,1);
  f.entry.closing=Promise.resolve();f.fire();
  assert.deepEqual(f.log,['stay','stay(keepClosing)','cancelClose'],'the close is ended at once');
  assert.equal(f.questions.length,1,'no second question');
  f.entry.closing=null;f.questions[0].answer(false);await settle();
  const g=fixture({entryExtra:{closing:Promise.resolve()}});
  g.fire();g.entry.leaveIntent={kind:'reload',at:g.now(),redo:()=>{}};g.fire();
  assert.deepEqual(g.log,['stay(keepClosing)','stay(keepClosing)'],'the close question stays the one that is asked');assert.equal(g.questions.length,1);
});

// A close that is registered while another question is up can have its wc.close() swallowed by Chromium (an earlier unload check is still being finished): no
// 'will-prevent-unload' ever comes for it, so nothing would end it, entry.closing stayed set, and every later × on that tab returned the old promise without closing
// anything: no card, ever (final run 10 Nov: 5 of 24 bursts of 6 reloads + 3 closes + Back, then Stay, then ×). Whatever the answer to a question that is not about
// a close, a close still registered is over.
const strayCloseFixture=entryExtra=>fixture({entryExtra});   // the fixture's cancelClose ends a registered close and clears entry.closing, like closePage's

test('Stay on a reload question also ends a close that was registered meanwhile and never raised an event (the tab can be closed afterwards)',async()=>{
  const f=strayCloseFixture({leaveIntent:{kind:'reload',at:1000000,redo(){}}});
  f.fire();assert.equal(f.questions.length,1);assert.equal(f.questions[0].intent.kind,'reload');
  f.entry.closing=Promise.resolve();   // closePage registered a close while the question was up; Chromium swallowed its wc.close()
  f.questions[0].answer(false);await settle();
  assert.equal(f.entry.closing,null,'no stale close is left: the next × asks again');
  assert.ok(f.log.includes('cancelClose'));
});

test('Leave on a reload question also ends a close that was registered meanwhile, and the reload still runs',async()=>{
  const f=strayCloseFixture({leaveIntent:{kind:'reload',at:1000000,redo(){}}});
  f.fire();f.entry.closing=Promise.resolve();
  f.questions[0].answer(true);await settle();
  assert.equal(f.entry.closing,null);
  assert.ok(f.log.includes('perform:reload'),'the reload the person agreed to still runs');
});

test('Stay on a navigation question ends a stray close the same way',async()=>{
  const f=strayCloseFixture({navigation:{phase:'loading',target:'https://b.example/next'}});
  f.fire();f.entry.closing=Promise.resolve();
  f.questions[0].answer(false);await settle();
  assert.equal(f.entry.closing,null);
});

test('Leave on a close question keeps the close going (it is the close the person agreed to)',async()=>{
  const f=strayCloseFixture({closing:Promise.resolve()});
  f.fire();assert.equal(f.questions[0].intent.kind,'close');
  f.questions[0].answer(true);await settle();
  assert.ok(!f.log.includes('cancelClose'),'the close is not cancelled');
  assert.ok(f.log.includes('perform:close'));
});

test('a repeat that throws still leaves no stale close',async()=>{
  const f=strayCloseFixture({leaveIntent:{kind:'reload',at:1000000,redo(){}}});
  let answer;const failing=createLeaveGate({entry:f.entry,contents:f.contents,now:f.now,settleMs:0,retryMs:30,retries:0,stay:()=>{},ask:()=>new Promise(resolve=>{answer=resolve;}),perform:()=>{throw new Error('repeat failed');}});
  failing.handle({preventDefault(){}});
  f.entry.closing=Promise.resolve();   // registered while the question was up
  answer(true);await settle();
  assert.equal(f.entry.closing,null,'a repeat that throws leaves no stale close');
});
