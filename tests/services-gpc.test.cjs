'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{configureGlobalPrivacyControl}=require('../desktop/browser-services/gpc-policy.cjs');
function fixture(values={},ready=false){const switches=new Map(Object.entries(values)),calls=[],app={isReady:()=>ready,commandLine:{getSwitchValue:name=>switches.get(name)||'',appendSwitch:(name,value)=>{calls.push([name,value]);switches.set(name,value);},removeSwitch:name=>{calls.push(['remove',name]);switches.delete(name);}}};return {app,switches,calls};}
const versions={electron:'44.9.3',chrome:'152.0.7977.167'};
test('GPC startup choice merges only its native feature, retains other flags/trials and explicit off overrides a stale force-on argument',()=>{
 const f=fixture({'enable-features':'OtherFeature<Trial:param/value,GlobalPrivacyControlForce','disable-features':'AnotherFeature,GlobalPrivacyControlForce'});const enabled=configureGlobalPrivacyControl({app:f.app,enabled:true,versions});assert.equal(enabled.scope,'application');assert.equal(f.switches.get('enable-features'),'OtherFeature<Trial:param/value,GlobalPrivacyControlForce');assert.equal(f.switches.get('disable-features'),'AnotherFeature');configureGlobalPrivacyControl({app:f.app,enabled:false,versions});assert.equal(f.switches.get('enable-features'),'OtherFeature<Trial:param/value');assert.equal(f.switches.get('disable-features'),'AnotherFeature,GlobalPrivacyControlForce');
});
test('late, ambiguous or unqualified GPC enablement rejects before changing native features',()=>{
 for(const [ready,enabled,runtime]of [[true,true,versions],[false,'true',versions],[false,true,{electron:'44.9.4',chrome:'unqualified'}]]){const f=fixture({},ready);assert.throws(()=>configureGlobalPrivacyControl({app:f.app,enabled,versions:runtime}));assert.equal(f.calls.length,0);}
});
