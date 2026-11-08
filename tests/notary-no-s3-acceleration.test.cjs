const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {notarizationPolicy,notarySubmitArgs,notarize,notarizeBundle}=require('../packaging/macos/notarization.cjs');

// ACIRA_NOTARY_NO_S3_ACCELERATION=1 adds --no-s3-acceleration to `notarytool submit` (uploads from some networks keep getting cut off on Apple's S3 acceleration endpoint).
const base=['notarytool','submit','/tmp/Acira.zip','--keychain-profile','acira-release','--wait','--timeout','30m','--output-format','json'];

test('by default the submit call is exactly what it always was',()=>{
 assert.deepEqual(notarySubmitArgs({artifact:'/tmp/Acira.zip',profile:'acira-release',env:{}}),base);
 for(const value of ['0','','true','yes',' 1','1 '])assert.deepEqual(notarySubmitArgs({artifact:'/tmp/Acira.zip',profile:'acira-release',env:{ACIRA_NOTARY_NO_S3_ACCELERATION:value}}),base,`"${value}" does not turn it on: only 1 does`);
});

test('ACIRA_NOTARY_NO_S3_ACCELERATION=1 adds --no-s3-acceleration before --wait, once, and keeps everything else',()=>{
 const args=notarySubmitArgs({artifact:'/tmp/Acira.zip',profile:'acira-release',env:{ACIRA_NOTARY_NO_S3_ACCELERATION:'1'}});
 assert.deepEqual(args,['notarytool','submit','/tmp/Acira.zip','--keychain-profile','acira-release','--no-s3-acceleration','--wait','--timeout','30m','--output-format','json']);
 assert.equal(args.filter(item=>item==='--no-s3-acceleration').length,1);
});

test('notarize and notarizeBundle pass the choice to the real command',async()=>{
 const id='11111111-2222-3333-4444-555555555555',policy=notarizationPolicy(true,'acira-release');
 for(const [env,expected] of [[{},false],[{ACIRA_NOTARY_NO_S3_ACCELERATION:'1'},true]]){
  const calls=[];
  const run=async(file,args)=>{calls.push([file,args]);return {stdout:args[0]==='notarytool'?JSON.stringify({status:'Accepted',id}):''};};
  await notarize({artifact:'/tmp/Acira.zip',policy,run,env});
  const submit=calls.find(([,args])=>args[0]==='notarytool');
  assert.equal(submit[0],'/usr/bin/xcrun');
  assert.equal(submit[1].includes('--no-s3-acceleration'),expected);
  const bundleCalls=[];
  const bundleRun=async(file,args)=>{bundleCalls.push([file,args]);return {stdout:args[0]==='notarytool'?JSON.stringify({status:'Accepted',id}):''};};
  await notarizeBundle({bundle:'/tmp/Acira.app',work:'/tmp',policy,run:bundleRun,env});
  assert.equal(bundleCalls.find(([,args])=>args[0]==='notarytool')[1].includes('--no-s3-acceleration'),expected,'notarizeBundle hands the environment on');
 }
});

test('with no env given, the process environment decides',async()=>{
 const was=process.env.ACIRA_NOTARY_NO_S3_ACCELERATION;
 try{
  process.env.ACIRA_NOTARY_NO_S3_ACCELERATION='1';
  const seen=[];
  await notarize({artifact:'/tmp/Acira.zip',policy:notarizationPolicy(true,'acira-release'),run:async(file,args)=>{seen.push(args);return {stdout:JSON.stringify({status:'Accepted',id:'11111111-2222-3333-4444-555555555555'})};}});
  assert.ok(seen[0].includes('--no-s3-acceleration'));
 }finally{if(was===undefined)delete process.env.ACIRA_NOTARY_NO_S3_ACCELERATION;else process.env.ACIRA_NOTARY_NO_S3_ACCELERATION=was;}
});

test('the packaging README tells the option',()=>{
 assert.match(fs.readFileSync(require('node:path').join(__dirname,'../packaging/macos/README.md'),'utf8'),/ACIRA_NOTARY_NO_S3_ACCELERATION=1/);
});
