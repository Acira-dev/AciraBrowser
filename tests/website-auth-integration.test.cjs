const test=require('node:test'),assert=require('node:assert/strict');
const {resolveWebsiteOwner,validAuthEnvelope}=require('../desktop/website-auth-integration.cjs');
test('only exact canonical native website membership yields authentication authority',()=>{
 const wc={session:{},isDestroyed:()=>false},state={activeTabId:'tab',tabs:[{id:'tab',contentKind:'web',browserProfileId:'profile',url:'https://example.test/'}]},controller={windowId:'window',privateMode:false,profileId:'profile',closing:false,window:{isDestroyed:()=>false},state,pages:new Map([['tab',{view:{webContents:wc}}]])};
 assert.equal(resolveWebsiteOwner([controller],wc).active,true);
 assert.equal(resolveWebsiteOwner([controller],{...wc}),null);
 state.activeTabId='other';assert.equal(resolveWebsiteOwner([controller],wc).active,false);
 state.tabs[0].contentKind='internal';assert.equal(resolveWebsiteOwner([controller],wc),null);
 controller.closing=true;assert.equal(resolveWebsiteOwner([controller],wc),null);
});
test('dedicated management envelope is exact and bounded',()=>{
 assert.equal(validAuthEnvelope({type:'snapshot'}),true);assert.equal(validAuthEnvelope({type:'snapshot',profileId:'forged'}),false);
 assert.equal(validAuthEnvelope({type:'respond',response:{id:'ticket',action:'cancel'}}),true);
 assert.equal(validAuthEnvelope({type:'respond',response:[]}),false);
 assert.equal(validAuthEnvelope({type:'respond',response:{password:'x'.repeat(20001)}}),false);
});
