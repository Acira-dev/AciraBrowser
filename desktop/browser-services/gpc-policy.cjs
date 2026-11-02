'use strict';
const FEATURE='GlobalPrivacyControlForce',QUALIFIED={electron:'44.9.3',chrome:'152.0.7977.167'};
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
