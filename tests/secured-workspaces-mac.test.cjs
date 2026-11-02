const test=require('node:test'),assert=require('node:assert/strict');
const {platformVerifier}=require('../desktop/passwords/gate.cjs');
const {createMacAuthentication}=require('../desktop/passwords/mac-authentication.cjs');
const {createSecuredWorkspaces}=require('../desktop/secured-workspaces.cjs');
test('Mac secured unlock never reads or reveals its vault when native authentication is missing, cancelled or fails',async()=>{
 for(const kind of ['missing','cancelled','failed']){
  let prompts=0,reads=0;const actions=[];
  const verify=platformVerifier({platform:'darwin',packaged:true,env:{ACIRA_PASSWORDS_TEST_GATE:'allow'},macAuthentication:createMacAuthentication({load:()=>({authenticationAvailable:()=>kind!=='missing',authenticate:async()=>{prompts++;return {ok:false,code:kind}}})})});
  const controller={state:{workspaces:[{id:'first',browserProfileId:'p'},{id:'secure',browserProfileId:'p',secured:true}],tabs:[]},commitAction:a=>actions.push(a)};
  const service=createSecuredWorkspaces({controllers:new Set([controller]),vault:{read(){reads++;return {tabs:[]}}},gate:{ensure:verify}});
  const result=await service.unlock('secure',controller);assert.equal(result.ok,false);assert.equal(reads,0);assert.equal(actions.length,0);assert.equal(prompts,kind==='missing'?0:1);service.dispose();
 }
});
test('Mac secured unlock supplies the workspace reason to the native verifier and reveals only after success',async()=>{
 const events=[];const controller={state:{workspaces:[{id:'secure',browserProfileId:'p',secured:true}],tabs:[]},commitAction:a=>events.push(a.type)};
 const verify=platformVerifier({platform:'darwin',packaged:true,env:{},macAuthentication:createMacAuthentication({load:()=>({authenticationAvailable:()=>true,authenticate:async reason=>{assert.equal(reason,'Unlock your secured workspace in Acira');events.push('verified');return {ok:true,code:'verified'}}})})});
 const service=createSecuredWorkspaces({controllers:new Set([controller]),vault:{read(){events.push('vault-read');return {tabs:[{id:'t',url:'https://example.org/'}],activeId:'t'}}},gate:{ensure:verify}});
 assert.deepEqual(await service.unlock('secure',controller),{ok:true});assert.deepEqual(events,['verified','vault-read','workspace.secured-unlock']);service.dispose();
});
