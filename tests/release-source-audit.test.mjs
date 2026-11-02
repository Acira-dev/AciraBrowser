import test from 'node:test';
import assert from 'node:assert/strict';
import {prohibitedPath,scanSecrets} from '../scripts/release-source-audit.mjs';

test('release gate excludes profiles, secrets, captures and generated dependencies',()=>{
  for(const file of ['.env','.env.production','.qa-profiles/x/Cookies','node_modules/a/index.js','dist/index.html','qa/artifacts/capture.png','data/browser.sqlite','session-cookies/encrypted.bin','output/demo.webm'])assert.equal(prohibitedPath(file),true,file);
  for(const file of ['.env.example','desktop/session-store.cjs','docs/release/DEFECTS.md','public/app-icon.png','resources/filters/NOTICE.md'])assert.equal(prohibitedPath(file),false,file);
});
test('secret findings expose locations only, never matched values',()=>{
  const token=['ghp','a'.repeat(36)].join('_');const result=scanSecrets(Buffer.from('example\n'+token));
  assert.deepEqual(result,[{kind:'github-token',line:2}]);assert.equal(JSON.stringify(result).includes(token),false);
});
