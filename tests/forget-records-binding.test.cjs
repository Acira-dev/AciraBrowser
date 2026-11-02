const test=require('node:test'),assert=require('node:assert/strict');
const {createForgetRecordsBinding}=require('../desktop/forget-records-binding.cjs');
test('private record preview and commit remain confined to their actual native owner without reading the ordinary database',()=>{
 const state={revision:1,browserProfiles:[{id:'private',private:true}],browsingHistory:[{id:'visit',browserProfileId:'private',url:'https://example.test/a'}],closedTabs:[]};
 const applied=[],owner={windowId:'private-window',privateMode:true,state,replaceRecords(next){this.state=next;applied.push(next);},publishRecords(){assert.equal(applied.length,1);}};
 const ordinary={windowId:'ordinary',privateMode:false,state:{browserProfiles:[{id:'ordinary'}]}};
 const binding=createForgetRecordsBinding({database:new Proxy({},{get(){throw Error('Private operation accessed ordinary database');}}),controllers:new Set([owner,ordinary]),getOwner:()=>owner}),scope={profileId:'private',origin:'https://example.test',privateMode:true};
 assert.equal(binding.preview(scope).history,1);assert.equal(owner.state.browsingHistory.length,1);assert.equal(binding.commit(scope).counts.history,1);assert.equal(owner.state.browsingHistory.length,0);assert.equal(ordinary.state.browserProfiles[0].id,'ordinary');
});
