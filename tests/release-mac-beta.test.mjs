import test from 'node:test';
import assert from 'node:assert/strict';
const macOnly={skip:process.platform!=='darwin'&&'Mac packaging only; no Windows build changes'};

test('a Mac beta can advance independently of the Windows package version',macOnly,async()=>{
 const {betaVersion}=await import('../scripts/package-mac-beta.mjs');
 assert.equal(betaVersion('0.1.0-beta.1','0.1.0-beta.2'),'0.1.0-beta.2');
 assert.equal(betaVersion('0.1.0-beta.1','0.2.0-beta.1'),'0.2.0-beta.1');
 assert.equal(betaVersion('0.1.0-beta.5','0.1.0-beta.5'),'0.1.0-beta.5');
 for(const version of ['0.1.0-beta.0','0.1.0','0.2.0','not-a-version'])assert.throws(()=>betaVersion('0.1.0-beta.1',version),/newer Mac prerelease/);
});

test('Mac beta packaging rejects unsupported architectures before preparing output',macOnly,async()=>{
 const {packageMacBeta}=await import('../scripts/package-mac-beta.mjs');
 await assert.rejects(packageMacBeta('/unused',{template:'/unused',arch:'ia32',version:'0.1.0-beta.2'}),/actual Mac runtime architecture/);
});

test('Mac native build numbers advance across betas and stable distributions without changing Windows versions',macOnly,async()=>{
 const {default:version}=await import('../packaging/macos/build-version.cjs');
 const earlier=version.macBuildVersion(new Date('2026-10-29T09:00:00Z'));
 const later=version.macBuildVersion(new Date('2026-10-29T09:00:01Z'));
 assert.match(earlier,/^\d{14}$/);assert.equal(earlier,'20261029090000');assert(BigInt(later)>BigInt(earlier));
 assert.throws(()=>version.macBuildVersion(new Date('invalid')),/valid Mac build date/);
});
