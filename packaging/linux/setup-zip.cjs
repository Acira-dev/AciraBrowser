'use strict';
// AciraBrowser-Linux-SetupFiles.zip: the setup files people download beside the AppImage. Made by scripts/package-linux-handoff.mjs, never by hand: the installer needs
// SHA256SUMS.txt, so the zip must hold it. A small zip writer (no dependency): deflate from node:zlib, fixed timestamps, so the same input gives the same bytes.
const zlib=require('node:zlib'),fs=require('node:fs'),path=require('node:path');
const DOS_DATE=(0<<9)|(1<<5)|1,DOS_TIME=0; // 1980-01-01 00:00:00
function zipBuffer(entries){
 const locals=[],centrals=[];let offset=0;
 for(const {name,data,mode} of entries){
  const raw=Buffer.from(name,'utf8'),crc=zlib.crc32(data),packed=zlib.deflateRawSync(data,{level:9});
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(DOS_TIME,10);local.writeUInt16LE(DOS_DATE,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(raw.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE((3<<8)|20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(DOS_TIME,12);central.writeUInt16LE(DOS_DATE,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(raw.length,28);central.writeUInt32LE(((0o100000|mode)<<16)>>>0,38);central.writeUInt32LE(offset,42);
  locals.push(local,raw,packed);centrals.push(central,raw);offset+=30+raw.length+packed.length;
 }
 const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
// folder: where the files are; names: the files, flat at the zip's root, in this order; executable: the names that keep an executable mode
function writeSetupZip({folder,names,executable=[],zipName='AciraBrowser-Linux-SetupFiles.zip'}){
 const entries=names.map(name=>({name,data:fs.readFileSync(path.join(folder,name)),mode:executable.includes(name)?0o755:0o644}));
 fs.writeFileSync(path.join(folder,zipName),zipBuffer(entries));return zipName;
}
module.exports={zipBuffer,writeSetupZip};
