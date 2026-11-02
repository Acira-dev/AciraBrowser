'use strict';
// Every test file under tests/ must be run by `npm test`; a test nobody runs only looks like coverage.
// The lists live in package.json "testSuites" (scripts/run-tests.mjs runs them); a path may be a glob ("tests/tor-*.test.cjs").
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('npm test runs every test file in tests/',()=>{
  const pkg=require('../package.json');
  assert.match(pkg.scripts.test,/node scripts\/run-tests\.mjs/,'npm test runs the suites');
  const paths=Object.values(pkg.testSuites).flat();
  const named=new Set(paths.filter(p=>!p.includes('*')).map(p=>p.replace(/^tests\//,'')));
  const globs=paths.filter(p=>p.includes('*')).map(p=>new RegExp('^'+p.replace(/^tests\//,'').replace(/\./g,'\\.').replace(/\*/g,'.*')+'$'));
  const unrun=fs.readdirSync(path.join(__dirname)).filter(file=>/\.test\.(cjs|mjs|ts|js)$/.test(file)&&!named.has(file)&&!globs.some(glob=>glob.test(file)));
  assert.deepEqual(unrun,[],`add these to "testSuites" in package.json (or delete them): ${unrun.join(', ')}`);
});
test('the test command stays short (cmd.exe refuses command lines over 8191 characters)',()=>{
  const script=require('../package.json').scripts.test;
  assert.ok(script.length<1000,`scripts.test is ${script.length} characters: keep file lists in "testSuites"`);
});
