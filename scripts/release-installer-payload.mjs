import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {root,filesIn,sha} from './release-build.mjs';

const execute=promisify(execFile);
export function validateArchivePaths(listing,expectedFiles){
 const records=listing.split(/----------\r?\n/).slice(1).join('\n').split(/\r?\n\r?\n/),files=[];
 for(const record of records){
  const original=record.match(/^Path = (.+)$/m)?.[1]?.trim();if(!original)continue;
  const name=original.replaceAll('\\','/');
  if(name.startsWith('/')||name.includes(':')||name.split('/').some(part=>['','..','.'].includes(part))||/^(?:Symbolic Link|Hard Link) =/m.test(record))throw new Error('Unsafe installer archive member');
  if(/^Attributes = .*D/m.test(record))continue;
  if(!expectedFiles.has(name)||files.includes(name))throw new Error('Unexpected or duplicate installer payload member: '+name);
  files.push(name);
 }
 if(files.length!==expectedFiles.size)throw new Error('Installer archive omits required product members');
 return files;
}

const sevenZipMagic=Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c]);
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// electron-builder embeds its already-compressed app archive with SetCompress off.
// The restricted builder 7za handles that 7z archive, not the surrounding NSIS PE.
export function findEmbedded7zArchive(bytes){
 const found=[];
 for(let at=bytes.indexOf(sevenZipMagic);at>=0;at=bytes.indexOf(sevenZipMagic,at+1)){
  if(at+32>bytes.length||bytes[at+6]!==0||bytes[at+7]>4)continue;
  if(crc32(bytes.subarray(at+12,at+32))!==bytes.readUInt32LE(at+8))continue;
  const offset=bytes.readBigUInt64LE(at+12),size=bytes.readBigUInt64LE(at+20),end=BigInt(at)+32n+offset+size;
  if(size===0n||end>BigInt(bytes.length))continue;
  const next=at+32+Number(offset),last=Number(end);
  if(crc32(bytes.subarray(next,last))!==bytes.readUInt32LE(at+28))continue;
  found.push({offset:at,bytes:last-at,end:last});
 }
 if(found.length!==1)throw new Error('Expected exactly one complete CRC-validated embedded 7z product archive');
 return found[0];
}
export async function inspectInstallerPayload({installer,folder,manifest,manifestBytes}){
 const require=createRequire(import.meta.url),fromBuilder=createRequire(require.resolve('electron-builder/package.json'));
 const toolset=fromBuilder(path.join(path.dirname(fromBuilder.resolve('app-builder-lib')),'toolsets/7zip.js'));
 const cache=path.join(root,'.bootstrap/electron-builder'),previousCache=process.env.ELECTRON_BUILDER_CACHE,previousOverride=process.env.ELECTRON_BUILDER_7ZIP_PATH;
 let extractor;
 try{process.env.ELECTRON_BUILDER_CACHE=cache;delete process.env.ELECTRON_BUILDER_7ZIP_PATH;extractor=await toolset.getPath7za();}
 finally{if(previousCache===undefined)delete process.env.ELECTRON_BUILDER_CACHE;else process.env.ELECTRON_BUILDER_CACHE=previousCache;if(previousOverride!==undefined)process.env.ELECTRON_BUILDER_7ZIP_PATH=previousOverride;}
 if(!path.resolve(extractor).startsWith(cache+path.sep))throw new Error('Builder extractor escaped the owned tool cache');
 const toolSha256=sha(await fs.readFile(extractor)),expected=new Set([...manifest.files.map(entry=>entry.file),'FILES-SHA256.json']);
 const output=await fs.mkdtemp(path.join(root,'qa/artifacts/release-installer-payload-')),prefix=path.join(root,'qa/artifacts')+path.sep;
 if(!path.resolve(output).startsWith(prefix)||!path.basename(output).startsWith('release-installer-payload-'))throw new Error('Unexpected payload inspection directory');
 try{
  const container=await fs.readFile(installer),segment=findEmbedded7zArchive(container),archiveBytes=container.subarray(segment.offset,segment.end),archive=path.join(output,'embedded-product.7z'),payload=path.join(output,'payload');
  await fs.writeFile(archive,archiveBytes);
  const listing=(await execute(extractor,['l','-slt',archive],{windowsHide:true,maxBuffer:8*1024*1024})).stdout,members=validateArchivePaths(listing,expected);
  await execute(extractor,['x','-y','-bd','-bsp0','-o'+payload,archive],{windowsHide:true,maxBuffer:4*1024*1024});
  const extracted=await filesIn(payload);if(extracted.length!==expected.size)throw new Error('Extracted payload file count differs');
  if(sha(await fs.readFile(path.join(payload,'FILES-SHA256.json')))!==sha(manifestBytes))throw new Error('Embedded portable manifest differs');
  for(const entry of manifest.files){const target=path.resolve(payload,entry.file);if(!target.startsWith(payload+path.sep))throw new Error('Invalid payload manifest path');const bytes=await fs.readFile(target);if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw new Error('Embedded portable payload differs: '+entry.file);}
  return {status:'PASS',method:'Locate the intact CRC-validated 7z product embedded uncompressed by NSIS; extract without executing the installer and validate every file size and SHA-256 against the native-qualified portable manifest.',files:members.length,portableFiles:manifest.files.length,embeddedArchive:{offset:segment.offset,bytes:segment.bytes,sha256:sha(archiveBytes)},extractor:{package:'7zip@1.0.0',sha256:toolSha256},temporaryExtractionRemoved:true};
 }finally{
  if(!path.resolve(output).startsWith(prefix)||path.dirname(output)!==path.join(root,'qa/artifacts'))throw new Error('Refuse cleanup outside owned inspection directory');
  await fs.rm(output,{recursive:true,force:true});
 }
}
