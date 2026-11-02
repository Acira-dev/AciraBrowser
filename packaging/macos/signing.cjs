'use strict';
// Keep one signing policy through nested signing AND the final Tor-manifest seal.
// An ad-hoc seal after Developer ID signing would silently lose the app's identity.
const distributionIdentity=require('../../desktop/browser-services/mac-distribution-identity.cjs');
function signingPolicy(identity='-',requireDistribution=false,expected=distributionIdentity){
 if(identity==='-'){
  if(requireDistribution)throw Error('Mac distribution packaging requires an explicit Developer ID Application identity. Local ad-hoc signing is not a distribution identity.');
  return {identity,distribution:false,description:'Local ad-hoc signature; not notarized or published.'};
 }
 if(typeof identity!=='string'||!/^Developer ID Application: [^\r\n]+ \([A-Z0-9]{10}\)$/.test(identity))throw Error('Use the full Developer ID Application certificate name for Mac distribution signing.');
 const match=identity.match(/^Developer ID Application: (.+) \(([A-Z0-9]{10})\)$/);
 if(!expected||typeof expected.name!=='string'||!expected.name.trim()||!/^[A-Z0-9]{10}$/.test(expected.team||''))throw Error('Mac distribution requires an explicit verified signer name and Team ID.');
 if(match[1]!==expected.name||match[2]!==expected.team)throw Error('Mac signing certificate must match the configured legal signer and Team ID: '+expected.name+' ('+expected.team+').');
 return {identity,distribution:true,team:identity.slice(-11,-1),description:'Developer ID Application signature; notarization and clean-device qualification still required. Not published.'};
}
function signOptions(application,policy,{entitlements}={}){
 return {app:application,identity:policy.identity,identityValidation:policy.distribution,platform:'darwin',type:policy.distribution?'distribution':'development',preAutoEntitlements:false,preEmbedProvisioningProfile:false,optionsForFile:file=>({hardenedRuntime:policy.distribution,...(!policy.distribution?{timestamp:'none'}:{}),...(entitlements&&require('node:path').resolve(file)===require('node:path').resolve(application)?{entitlements}:{})})};
}
function resealArguments(application,policy){
 return ['--force','--sign',policy.identity,...(policy.distribution?['--options','runtime','--timestamp','--preserve-metadata=entitlements']:['--timestamp=none']),application];
}
function verifySigningDetails(details,policy){
 if(!policy.distribution){if(!/^Signature=adhoc$/m.test(details))throw Error('Expected the declared local ad-hoc signature.');return;}
 if(!details.includes('Authority='+policy.identity+'\n')||!details.includes('TeamIdentifier='+policy.team+'\n')||!/^CodeDirectory .*flags=0x[\da-f]+\([^\n]*runtime[^\n]*\)/mi.test(details)||/^Signature=adhoc$/m.test(details))throw Error('Mac signing identity or hardened runtime did not survive final sealing.');
}
module.exports={signingPolicy,signOptions,resealArguments,verifySigningDetails};
