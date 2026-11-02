import test from 'node:test';import assert from 'node:assert/strict';
import{releaseVersion}from'../src/ui/releaseVersion';
import{version}from'../package.json';
import{createRequire}from'node:module';
const semver=createRequire(import.meta.url)('semver');
test('0.1 Beta keeps its display name and upgrades the earlier beta installations',()=>{
 assert.equal(releaseVersion(version),'0.1 Beta');
 for(const installed of ['0.1.0-beta.1','0.1.0-beta.2','0.1.0-beta.5'])assert(semver.gt(version,installed));
 assert.equal(releaseVersion('0.1.1-beta.1'),'0.1.1 Beta');
 assert.equal(releaseVersion('1.0.0'),'1.0.0');
});
