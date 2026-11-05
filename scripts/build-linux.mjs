#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='linux'||process.arch!=='x64')throw Error('Build Linux x64 inside a Linux x64 environment.');
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit'});if(r.error||r.status!==0)throw r.error||Error('Build step failed: '+args.join(' '));}
if(!process.env.npm_execpath)throw Error('Run through npm run build:linux after npm ci.');
run([process.env.npm_execpath,'run','build']);
run(['scripts/fetch-tor-linux.mjs',...(process.argv.includes('--require-signature')?['--require-signature']:[])]);
run(['node_modules/electron-builder/out/cli/cli.js','--linux','AppImage','--x64','--config','packaging/electron-builder-linux.cjs','--publish','never']);
run(['scripts/package-linux-handoff.mjs']);
