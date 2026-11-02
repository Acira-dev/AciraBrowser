import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// Apply only the reviewed text patch to esbuild's in-memory CSS loader. This
// creates an isolated candidate renderer; it never changes production sources.
const dir=path.resolve('docs/design/color-research/production-qa'),patchPath='docs/design/color-research/popup-paint-proposed.patch',lines=fs.readFileSync(patchPath,'utf8').split('\n'),files=new Map();
for(let i=0;i<lines.length;){
 if(!lines[i].startsWith('--- a/')){i++;continue;}
 const name=lines[i++].slice(6);if(!['src/frost-preview.css','src/styles/popup-material.css'].includes(name))throw Error('Candidate patch outside palette ownership');
 if(!lines[i++].startsWith('+++ b/'))throw Error('Malformed patch');
 let source=fs.readFileSync(name,'utf8').replaceAll('\r\n','\n'),removed=[],added=[];
 const flush=()=>{if(!removed.length&&!added.length)return;const before=removed.join('\n')+'\n',after=added.length?added.join('\n')+'\n':'';if(!removed.length||source.split(before).length!==2)throw Error(`Candidate change is not unique: ${name}`);source=source.replace(before,after);removed=[];added=[];};
 while(i<lines.length&&!lines[i].startsWith('--- a/')){
  const hunk=/^@@ /.test(lines[i]);if(!hunk){i++;continue;}i++;
  while(i<lines.length&&!lines[i].startsWith('@@ ')&&!lines[i].startsWith('--- a/')){
   const line=lines[i++];if(!line||line.startsWith('\\'))continue;
   const type=line[0],body=line.slice(1);if(type==='-')removed.push(body);else if(type==='+')added.push(body);else flush();
  }
  flush();
 }
 files.set(path.resolve(name).toLowerCase(),source);fs.writeFileSync(path.join(dir,'popup-proposed-'+path.basename(name)),source);
}
if(files.size!==2)throw Error('Expected both palette CSS candidates');
const live=process.argv.includes('--live'),entry=live?'popup-live-candidate':'popup-candidate';
if(live){for(const [name,css]of files){let value=css.replaceAll('.acira-popup-surface.native-popup-surface .popup-material','.acira-popup-surface.native-popup-surface:not([data-material-provider="live"]):not([data-material-provider="opaque"]) .popup-material').replaceAll(':is(.acira-popup-surface .popup-material,',':is(.acira-popup-surface:not([data-material-provider="live"]):not([data-material-provider="opaque"]) .popup-material,');if(name.endsWith('popup-material.css'))value+='\n'+fs.readFileSync('docs/design/color-research/popup-live-provider-proposed.css','utf8');else{const start=value.indexOf('/* Agent tab core · Vapor formation'),end=value.indexOf('/* Agent tab core · In-page language',start);if(start<0||end<0)throw Error('Missing coordinated vapor retirement block');value=value.slice(0,start)+value.slice(end);}files.set(name,value);fs.writeFileSync(path.join(dir,'popup-live-proposed-'+path.basename(name)),value);}}
const built=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outdir:dir,entryNames:entry,minify:true,format:'iife',platform:'browser',define:{'import.meta.env.DEV':'true','process.env.NODE_ENV':'"production"'},plugins:[{name:'candidate-paint',setup(b){b.onLoad({filter:/\.css$/},args=>{const contents=files.get(args.path.toLowerCase());return contents===undefined?undefined:{contents,loader:'css'};});b.onResolve({filter:/^\//},args=>({path:args.path,external:true}));}}]});
const asset=p=>pathToFileURL(path.resolve('public',p.replace(/^\//,''))).href;
for(const output of built.outputFiles){let value=output.text;if(output.path.endsWith('.css'))value=value.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g,(_m,_q,p)=>`url("${asset(p)}")`);else value=value.replace(/(["'])((?:\/|\.\/)(?:workspace-coast\.png|acira-[a-z.-]+|fonts\/[a-zA-Z0-9.-]+|frost-grain\.svg))\1/g,(_m,q,p)=>q+asset(p)+q);fs.writeFileSync(output.path,value);}
fs.writeFileSync(path.join(dir,entry+'.html'),`<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="${entry}.css"><body><div id="root"></div><script src="${entry}.js"></script></body></html>`);
console.log('Candidate renderer built in owned QA directory; production popup CSS unchanged.');
