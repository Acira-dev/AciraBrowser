const test=require('node:test'),assert=require('node:assert/strict');const {validServiceEnvelope,GENERAL_LIMIT,CLEANUP_LIMIT}=require('../desktop/cleanup-envelope.cjs'),{cleanupChoice}=require('../desktop/browser-services/exit-cleanup.cjs');
const origins=Array.from({length:100},(_,index)=>'https://'+['a'.repeat(50),'b'.repeat(50),'c'.repeat(50),'d'.repeat(50),'h'+index,'example','com'].join('.')),choice={enabled:true,categories:['cookies','storage','history','permissions'],keepOrigins:origins};
test('all100native-accepted long-host keep rules cross their specific transport bound',()=>{assert.equal(cleanupChoice(choice).keepOrigins.length,100);const request={type:'cleanup.set',choice};assert.ok(JSON.stringify(request).length>GENERAL_LIMIT);assert.equal(validServiceEnvelope(request),true);assert.equal(validServiceEnvelope({...request,type:'some.other.service'}),false);});
test('JSON-escaped native-accepted origins remain bounded without silently dropping rules',()=>{const escaped=origins.map(origin=>'\u0001'.repeat(2048-origin.length)+origin),request={type:'cleanup.set',choice:{...choice,keepOrigins:escaped}};assert.equal(cleanupChoice(request.choice).keepOrigins.length,100);assert.ok(JSON.stringify(request).length<CLEANUP_LIMIT);assert.equal(validServiceEnvelope(request),true);});
test('extra routing/profile fields and native-over-limit choices reject',()=>{assert.equal(validServiceEnvelope({type:'cleanup.set',choice,profileId:'forged'}),false);assert.equal(validServiceEnvelope({type:'cleanup.set',choice:{...choice,keepOrigins:[...origins,'https://another.example']}}),false);assert.equal(validServiceEnvelope({type:'cleanup.set',choice:{...choice,keepOrigins:['https://'+ 'a'.repeat(2048)]}}),false);assert.equal(validServiceEnvelope({type:'cleanup.set',choice:{...choice,categories:['cookies','unsupported']}}),false);});

// Profile transfer: transfer.send and transfer.saveFile carry the collected interface preferences, so they get their own bounded limit; nothing else does.
test('transfer.send and transfer.saveFile pass up to 2 MiB with exactly their keys and shapes; everything else keeps 20000',()=>{
 const {TRANSFER_LIMIT}=require('../desktop/cleanup-envelope.cjs');
 const filler=n=>'x'.repeat(n),include={look:true,bookmarks:true,passwords:false};
 const big=(extra={})=>({type:'transfer.send',include,historyDays:90,ui:{profile:{newTab:{note:filler(300000)},sidebarApps:{apps:[],hidden:false,seeded:true}},global:{ctrlTabMode:'recent'},readingList:[]},...extra});
 assert.equal(TRANSFER_LIMIT,2*1024*1024);
 assert.equal(validServiceEnvelope(big()),true,'300 KB of preferences is fine');
 assert.equal(validServiceEnvelope({...big(),type:'transfer.saveFile',password:'a long enough password'}),true);
 assert.equal(validServiceEnvelope({...big(),type:'transfer.saveFile'}),true,'the password is optional');
 assert.equal(validServiceEnvelope(big({ui:{profile:{newTab:{note:filler(TRANSFER_LIMIT)}}}})),false,'over 2 MiB');
 assert.equal(validServiceEnvelope(big({extra:1})),false,'an extra key');
 assert.equal(validServiceEnvelope(big({password:'x'})),false,'send takes no password');
 assert.equal(validServiceEnvelope({...big(),type:'transfer.receive'}),false,'any other transfer request keeps the general limit and shape: 300 KB is over 20000');
 assert.equal(validServiceEnvelope({type:'transfer.receive',code:'amber falcon river copper lantern'}),true);
 assert.equal(validServiceEnvelope({type:'transfer.status'}),true);
 const summary=(extra={})=>({type:'transfer.summary',ui:big().ui,...extra});
 assert.equal(validServiceEnvelope(summary()),true,'the checklist\'s counts come from the same collected preferences, so 300 KB is fine here too');
 assert.equal(validServiceEnvelope(summary({include})),false,'summary takes no rows');
 assert.equal(validServiceEnvelope(summary({ui:{profile:{evil:1}}})),false,'unknown ui key');
 assert.equal(validServiceEnvelope(summary({ui:{profile:{newTab:{note:filler(TRANSFER_LIMIT)}}}})),false,'over 2 MiB');
 assert.equal(validServiceEnvelope({type:'transfer.summary'}),false,'summary needs its ui');
 assert.equal(validServiceEnvelope(big({ui:{profile:{evil:1}}})),false,'unknown ui key');
 assert.equal(validServiceEnvelope(big({ui:{global:{evil:1}}})),false);
 assert.equal(validServiceEnvelope(big({ui:{profile:{}},evil:1})),false);
 assert.equal(validServiceEnvelope(big({include:{nope:true}})),false,'unknown row');
 assert.equal(validServiceEnvelope(big({include:{look:'yes'}})),false);
 assert.equal(validServiceEnvelope(big({historyDays:7})),false);
 assert.equal(validServiceEnvelope(big({ui:{readingList:Array.from({length:201},()=>({}))}})),false,'reading list over 200');
 assert.equal(validServiceEnvelope(big({ui:{profile:{sidebarApps:{apps:Array.from({length:25},()=>({})),hidden:false,seeded:true}}}})),false,'more than 24 Favorites');
 assert.equal(validServiceEnvelope({type:'tab.new',url:'https://'+filler(30000)}),false,'every other request still stops at 20000');
 assert.equal(validServiceEnvelope({type:'imports.html'}),true);
});
