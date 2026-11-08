import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{releaseVersion,chromiumSuffix}from'../src/ui/releaseVersion';
import{version}from'../package.json';
import{createRequire}from'node:module';
const semver=createRequire(import.meta.url)('semver');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('a beta is named by its number: 0.1.0-beta.12 is "Beta 12", worked out from the package version',()=>{
 assert.equal(releaseVersion('0.1.0-beta.12'),'Beta 12');
 assert.equal(releaseVersion('0.1.0-beta.1'),'Beta 1');
 assert.equal(releaseVersion('0.1.0-beta.100'),'Beta 100');
 // the shipped package.json: right on every release without anyone editing the display name
 const number=/-beta\.(\d+)$/.exec(version)?.[1];
 assert.equal(releaseVersion(version),number?`Beta ${number}`:releaseVersion(version));
 assert.ok(!/0\.1 Beta/.test(releaseVersion(version)),'no more "0.1 Beta" for every release');
});

test('a fix release of a beta carries its fix number: 0.1.0-beta.13.1 is "Beta 13.1" (beta.14 is the next big release, beta.13.M the next fix)',()=>{
 assert.equal(releaseVersion('0.1.0-beta.13'),'Beta 13');
 assert.equal(releaseVersion('0.1.0-beta.13.1'),'Beta 13.1');
 assert.equal(releaseVersion('0.1.0-beta.13.12'),'Beta 13.12');
 assert.equal(releaseVersion('0.1.1-beta.2.3'),'0.1.1 Beta 2.3');
 assert.equal(releaseVersion('0.2.0-beta.1.1'),'0.2 Beta 1.1');
 // each fix upgrades the one before and the beta before it; the next beta upgrades the last fix
 const order=['0.1.0-beta.12','0.1.0-beta.13','0.1.0-beta.13.1','0.1.0-beta.13.2','0.1.0-beta.13.10','0.1.0-beta.14'];
 for(let i=1;i<order.length;i++)assert(semver.gt(order[i],order[i-1]),order[i-1]+' < '+order[i]);
 assert.notEqual(releaseVersion('0.1.0-beta.13'),releaseVersion('0.1.0-beta.13.1'),'a fix reads differently from its beta');
});

test('a beta on another line keeps its line; a plain version drops a patch of 0',()=>{
 assert.equal(releaseVersion('0.1.1-beta.1'),'0.1.1 Beta 1');
 assert.equal(releaseVersion('0.2.0-beta.3'),'0.2 Beta 3');
 assert.equal(releaseVersion('1.0.0-beta.2'),'1.0 Beta 2');
 assert.equal(releaseVersion('0.1.0'),'0.1');
 assert.equal(releaseVersion('1.0.0'),'1.0');
 assert.equal(releaseVersion('1.2.3'),'1.2.3');
 assert.equal(releaseVersion('0.1.4'),'0.1.4');
});

test('a local build or anything unusual is shown exactly as it is',()=>{
 for(const odd of ['0.1.0-beta.12.local.1','0.1.0-beta.6.local.4','0.1.0-beta.13.1.local.1','0.1.0-beta.13.1.2','0.1.0-rc.1','dev',''])assert.equal(releaseVersion(odd),odd);
});

test('the display name never changes how updates compare: each beta still upgrades the one before',()=>{
 for(const installed of ['0.1.0-beta.1','0.1.0-beta.2','0.1.0-beta.5','0.1.0-beta.11'])assert(semver.gt('0.1.0-beta.12',installed));
 assert(semver.gt('0.1.0-beta.12','0.1.0-beta.6.local.4'),'a local build of an earlier beta is upgraded too');
 assert.notEqual(releaseVersion('0.1.0-beta.11'),releaseVersion('0.1.0-beta.12'),'two betas read differently');
});

test('the Chromium part stays: " (Chromium 152)", or nothing when the engine is not known',()=>{
 assert.equal(chromiumSuffix('152'),' (Chromium 152)');
 assert.equal(chromiumSuffix(undefined),'');
 assert.equal(chromiumSuffix(''),'');
});

test('every language file builds "Acira Beta 12 (Chromium 152)" from the same catalog line',()=>{
 const folder=path.join(root,'src/i18n'),files=fs.readdirSync(folder).filter(name=>/^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(name));
 assert.ok(files.length>=13,'every language file is checked ('+files.join(', ')+')');
 for(const file of files){
  const line=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'))['updates.aciraAciraversionChromium'];
  assert.equal(typeof line,'string',file+' has the version line');
  assert.ok(line.includes('{aciraVersion}')&&line.includes('{chromium}'),file+' keeps both placeholders: '+line);
  const shown=line.replace('{aciraVersion}',releaseVersion('0.1.0-beta.12')).replace('{chromium}',chromiumSuffix('152'));
  assert.equal(shown,'Acira Beta 12 (Chromium 152)',file);
  assert.equal(line.replace('{aciraVersion}',releaseVersion('0.1.0')).replace('{chromium}',chromiumSuffix('152')),'Acira 0.1 (Chromium 152)',file+' stable');
  assert.equal(line.replace('{aciraVersion}',releaseVersion('0.1.0')).replace('{chromium}',chromiumSuffix(undefined)),'Acira 0.1',file+' without Chromium');
 }
});
