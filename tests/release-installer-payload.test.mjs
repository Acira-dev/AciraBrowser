import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArchivePaths,findEmbedded7zArchive} from '../scripts/release-installer-payload.mjs';

const listing=members=>'Archive header\r\n----------\r\n'+members.map(({file,attributes='A',extra=''})=>'Path = '+file+'\r\nSize = 10\r\nAttributes = '+attributes+'\r\n'+extra).join('\r\n');
test('installer payload members match the complete allowlisted portable manifest',()=>{
 assert.deepEqual(validateArchivePaths(listing([{file:'resources',attributes:'D'},{file:'resources\\app.js'},{file:'FILES-SHA256.json'}]),new Set(['resources/app.js','FILES-SHA256.json'])),['resources/app.js','FILES-SHA256.json']);
});
test('payload extraction rejects traversal, links, duplicates, extras and missing files',()=>{
 for(const members of [[{file:'../escape'}],[{file:'C:\\escape'}],[{file:'/escape'}],[{file:'ok',extra:'Symbolic Link = target\r\n'}],[{file:'ok'},{file:'ok'}],[{file:'extra'}],[]])assert.throws(()=>validateArchivePaths(listing(members),new Set(['ok'])));
});

import {crc32} from 'node:zlib';
function archive(){const next=Buffer.from([1,0]),header=Buffer.alloc(32);Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c,0,4]).copy(header);header.writeBigUInt64LE(0n,12);header.writeBigUInt64LE(BigInt(next.length),20);header.writeUInt32LE(crc32(next),28);header.writeUInt32LE(crc32(header.subarray(12)),8);return Buffer.concat([header,next]);}
test('finds the intact product archive inside a surrounding installer PE',()=>{const item=archive(),prefix=Buffer.from('MZ installer prefix'),bytes=Buffer.concat([prefix,item,Buffer.from('trailer')]);assert.deepEqual(findEmbedded7zArchive(bytes),{offset:prefix.length,bytes:item.length,end:prefix.length+item.length});});
test('rejects corrupt headers, truncated payloads and forged huge offsets',()=>{const corrupt=archive();corrupt[8]^=1;const huge=archive();huge.writeBigUInt64LE(0xffffffffffffffffn,12);huge.writeUInt32LE(crc32(huge.subarray(12,32)),8);for(const bytes of [corrupt,archive().subarray(0,33),huge])assert.throws(()=>findEmbedded7zArchive(bytes),/exactly one complete/);});
test('rejects ambiguous multiple complete embedded archives',()=>assert.throws(()=>findEmbedded7zArchive(Buffer.concat([archive(),archive()])),/exactly one complete/));
