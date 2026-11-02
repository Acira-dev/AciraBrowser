'use strict';
const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
function notarizationPolicy(distribution,profile){
 if(!distribution)return {enabled:false,profile:null};
 if(typeof profile!=='string'||!profile.trim()||profile.length>120||/[\r\n\0]/.test(profile))throw Error('Public Mac packaging requires ACIRA_MAC_NOTARY_PROFILE naming existing notarytool credentials. No credentials are created or requested by the packager.');
 return {enabled:true,profile:profile.trim()};
}
async function notarize({artifact,policy,run=execute}){
 if(!policy.enabled)throw Error('Notarization requires distribution signing.');
 const {stdout}=await run('/usr/bin/xcrun',['notarytool','submit',artifact,'--keychain-profile',policy.profile,'--wait','--timeout','30m','--output-format','json'],{maxBuffer:1024*1024});
 let result;try{result=JSON.parse(stdout);}catch{throw Error('Apple notarization did not return a valid receipt.');}
 if(result.status!=='Accepted'||!/^[a-f\d-]{36}$/i.test(result.id||''))throw Error('Apple notarization was not accepted; no distributable artifact was approved.');
 return {id:result.id,status:result.status};
}
async function stapleAndAssess({artifact,run=execute}){
 await run('/usr/bin/xcrun',['stapler','staple',artifact]);
 await run('/usr/bin/xcrun',['stapler','validate',artifact]);
 await run('/usr/sbin/spctl',['--assess','--verbose=2',...(artifact.endsWith('.dmg')?['--type','open','--context','context:primary-signature']:['--type','execute']),artifact]);
 return {stapled:true,gatekeeperAccepted:true};
}
async function notarizeBundle({bundle,work,policy,run=execute}){
 const archive=path.join(work,path.basename(bundle)+'.notary.zip');
 await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',bundle,archive]);
 const receipt=await notarize({artifact:archive,policy,run});
 return {...receipt,...await stapleAndAssess({artifact:bundle,run})};
}
// The build files inside a bundle (ACIRA-BUILD.json, ACIRA-INSTALLER-BUILD.json) are sealed by the signature before Apple sees the bundle, and
// rewriting one afterwards would break the signature and the stapled ticket. So the sealed file says only what is known when it is sealed:
// whether the packager sends the bundle to Apple. What Apple and the tools then reported is recorded beside the bundle, in the build receipt.
const sealedNotarization=policy=>policy?.enabled?'requested':'none';
/** The outcome for the receipt, from notarizeBundle's real result (Apple's verdict, stapler validate, Gatekeeper), never from what was intended. */
function notarizationOutcome(submission){
 const accepted=submission?.status==='Accepted';
 return {notarized:accepted,stapled:accepted&&submission.stapled===true,gatekeeperAccepted:accepted&&submission.gatekeeperAccepted===true};
}
module.exports={notarizationPolicy,notarize,stapleAndAssess,notarizeBundle,sealedNotarization,notarizationOutcome};
