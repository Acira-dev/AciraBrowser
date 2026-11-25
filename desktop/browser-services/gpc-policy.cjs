'use strict';
// QUALIFIED is the runtime the engine feature was proven on. An unqualified runtime throws, and native-network-preferences early() then fails closed (no browsing until it is fixed):
// every engine move must re-run qa/engine-verify.mjs (GPC on: navigator.globalPrivacyControl true, Sec-GPC: 1 on documents and subresources). 20 Nov 2026: Electron 45.2.1 / Chromium 156.0.8078.75,
// identical to 44.9.3 / 152.0.7977.167 in every probe (out/ev in the an earlier build, engine report).
const FEATURE='GlobalPrivacyControlForce',QUALIFIED={electron:'45.2.1',chrome:'156.0.8078.75'};
function configureGlobalPrivacyControl({app,enabled,versions=process.versions}){
 if(typeof enabled!=='boolean')throw new Error('Choose a boolean Global Privacy Control setting.');
 if(app.isReady())throw new Error('Global Privacy Control is an application startup choice. Restart Acira to change it.');
 const qualified=versions.electron===QUALIFIED.electron&&versions.chrome===QUALIFIED.chrome;
 if(enabled&&!qualified)throw new Error('This native runtime has not passed Global Privacy Control conformance. Requalification is required.');
 const names=['enable-features','disable-features'],lists=Object.fromEntries(names.map(name=>[name,app.commandLine.getSwitchValue(name).split(',').map(value=>value.trim()).filter(value=>value&&value.split(/[<:]/)[0]!==FEATURE)]));
 lists[enabled?'enable-features':'disable-features'].push(FEATURE);
 for(const name of names){const value=[...new Set(lists[name])].join(',');if(value)app.commandLine.appendSwitch(name,value);else app.commandLine.removeSwitch(name);}
 return {configured:true,enabled,qualified,scope:'application',changeRequiresRestart:true,engineFeature:FEATURE,qualifiedRuntime:{...QUALIFIED}};
}
module.exports={configureGlobalPrivacyControl,FEATURE,QUALIFIED};
