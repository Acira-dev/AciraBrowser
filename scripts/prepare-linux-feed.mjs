#!/usr/bin/env node
import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),yaml=require('js-yaml'),args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const image=path.resolve(args[0]||''),output=path.resolve(value('--output')||path.join(path.dirname(image),'public-feed'));
if(!args.includes('--asset-url'))throw Error('Usage: node scripts/prepare-linux-feed.mjs <AppImage> --asset-url <public HTTPS download URL> [--output <folder>]');
const url=new URL(value('--asset-url'));if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a permanent public HTTPS asset URL without credentials or temporary tokens.');
const source=yaml.load(await fs.readFile(path.join(path.dirname(image),'beta-linux.yml'),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version||''))throw Error('Build metadata has no valid version.');
const hash=createHash('sha512');for await(const bytes of createReadStream(image))hash.update(bytes);const sha512=hash.digest('base64'),size=(await fs.stat(image)).size;
if(!source.files?.some(f=>f.sha512===sha512&&Number(f.size)===size))throw Error('AppImage does not match its generated build metadata.');
const response=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('The download must be anonymously accessible before preparing the live feed: HTTP '+response.status);
const remoteSize=Number(response.headers.get('content-length'));if(remoteSize&&remoteSize!==size)throw Error('The public download size does not match the built AppImage.');
const doc={version:source.version,files:[{url:url.href,sha512,size}],path:url.href,sha512,releaseDate:source.releaseDate||new Date().toISOString(),releaseName:'Acira Browser '+source.version+' for Linux',releaseNotes:value('--notes')||'Acira Browser for Linux.'};
await fs.mkdir(output,{recursive:true});for(const name of ['beta-linux.yml','latest-linux.yml'])await fs.writeFile(path.join(output,name),yaml.dump(doc,{lineWidth:-1}));
console.log('Prepared Linux feed files in '+output+'. Publish these only after the public AppImage is available. Nothing was uploaded.');
