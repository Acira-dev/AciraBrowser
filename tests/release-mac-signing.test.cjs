const test=require('node:test'),assert=require('node:assert/strict');
const {signingPolicy,signOptions,resealArguments,verifySigningDetails}=require('../packaging/macos/signing.cjs');
const identity='Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)',bundle='/owned/Acira Browser.app';
test('Mac distribution packaging cannot silently fall back to local or development signing',()=>{
 assert.equal(signingPolicy().distribution,false);
 assert.throws(()=>signingPolicy('-',true),/requires an explicit Developer ID/);
 for(const value of ['',null,'Apple Development: Person (2MGLP3QV9X)',identity+'\n--deep'])assert.throws(()=>signingPolicy(value),/full Developer ID/);
});
test('nested signing and final Tor-manifest sealing preserve the same Developer ID and hardened runtime',()=>{
 const policy=signingPolicy(identity,true),options=signOptions(bundle,policy),args=resealArguments(bundle,policy);
 assert.equal(options.identity,identity);assert.equal(options.identityValidation,true);assert.equal(options.type,'distribution');
 assert.equal(options.optionsForFile('/owned/Helper.app').hardenedRuntime,true);
 assert.equal(args[args.indexOf('--sign')+1],identity);assert.ok(args.includes('runtime'));assert.ok(args.includes('--timestamp'));assert.ok(args.includes('--preserve-metadata=entitlements'));assert.equal(args.at(-1),bundle);assert.ok(!args.includes('-'));
});
test('post-seal verification rejects lost identity, changed team and missing hardened runtime',()=>{
 const policy=signingPolicy(identity,true),details=`CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+7 location=embedded\nAuthority=${identity}\nTeamIdentifier=2MGLP3QV9X\n`;
 assert.doesNotThrow(()=>verifySigningDetails(details,policy));
 for(const changed of [details.replace('Authority=','Wrong='),details.replace('TeamIdentifier=2MGLP3QV9X','TeamIdentifier=Z1Z2Z3Z4Z5'),details.replace('0x10000(runtime)','0x0(none)'),details+'Signature=adhoc\n'])assert.throws(()=>verifySigningDetails(changed,policy),/did not survive/);
});
test('local packages stay explicitly ad-hoc and do not request timestamp or certificate access',()=>{
 const policy=signingPolicy(),options=signOptions(bundle,policy),args=resealArguments(bundle,policy);
 assert.equal(options.identityValidation,false);assert.equal(options.optionsForFile(bundle).hardenedRuntime,false);assert.equal(options.optionsForFile(bundle).timestamp,'none');assert.ok(args.includes('--timestamp=none'));
 assert.doesNotThrow(()=>verifySigningDetails('Signature=adhoc\nTeamIdentifier=not set\n',policy));
 assert.throws(()=>verifySigningDetails('Authority='+identity+'\n',policy),/Expected the declared local/);
});

test('Mac distribution binds the verified legal signer and Team ID independently of product branding',()=>{
 assert.throws(()=>signingPolicy('Developer ID Application: Other Company (2MGLP3QV9X)',true),/configured legal signer and Team ID/);
 assert.throws(()=>signingPolicy('Developer ID Application: Khaled Kaed Beyh (Z1Z2Z3Z4Z5)',true),/configured legal signer and Team ID/);
 assert.doesNotThrow(()=>signingPolicy('Developer ID Application: Other Company (A1B2C3D4E5)',true,{name:'Other Company',team:'A1B2C3D4E5'}));
 assert.throws(()=>signingPolicy(identity,true,{name:'Khaled Kaed Beyh'}),/explicit verified signer/);
});
