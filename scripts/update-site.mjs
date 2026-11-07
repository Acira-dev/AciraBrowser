#!/usr/bin/env node
// The static site behind update.acirabrowser.com (packaging/update-site.cjs). Nothing here touches GitHub or the network.
//   node scripts/update-site.mjs build <folder>   writes the static files (CNAME, .nojekyll, index, 404, robots.txt, the Stable placeholders) into <folder>
//   node scripts/update-site.mjs check <folder>   checks a folder (a checkout's docs/, or what build wrote) against the rules; exit 1 on a problem
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),site=require('../packaging/update-site.cjs'),{parseUpdateInfo}=require('electron-updater/out/providers/Provider');
const [command,folder]=process.argv.slice(2);
if(!['build','check'].includes(command)||!folder){console.error('Usage: node scripts/update-site.mjs build|check <folder>');process.exit(2);}
const dir=path.resolve(folder);
if(command==='build'){
 const written=site.writeStatic(dir);
 console.log('Wrote '+written.length+' static files into '+dir+': '+written.join(', ')+'.\nNothing was published.');
}else{
 const problems=site.checkSite(site.listSite(dir),{parse:(text,name)=>parseUpdateInfo(text,name,name)});
 if(problems.length){console.error(problems.map(problem=>'  x '+problem).join('\n'));process.exit(1);}
 console.log(dir+' is a right update site.');
}
