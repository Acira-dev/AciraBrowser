import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Seed disposable SQLite fixtures from the selected product's exact Git source.
// The real database implementation is bundled into main.cjs in shipped products.
export async function captureFixtureDatabase({commit,source}){
 assert.match(commit,/^[a-f0-9]{40}$/);
 const bytes=execFileSync('git',['show',commit+':desktop/database.cjs']);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const expected=source?.find(item=>item.file==='desktop/database.cjs');
 if(expected)assert.equal(sha256,expected.sha256,'Fixture database must match captured product source');
 assert.doesNotMatch(bytes.toString('utf8'),/require\(['"]\.{1,2}\//,'Review new seed-module dependencies before adapting');
 const output=path.resolve('qa/artifacts/release-fixture-database-'+commit),file=path.join(output,'database.cjs');
 await fs.mkdir(output,{recursive:true});
 try{assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),sha256,'Existing fixture source changed');}
 catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(file,bytes,{flag:'wx'});}
 return {file,commit,sha256,scope:'Disposable fixture data seeding only; actual cleanup and storage execute in the selected compiled product'};
}
