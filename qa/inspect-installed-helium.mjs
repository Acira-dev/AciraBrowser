import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const install=String.raw`C:\Users\you\AppData\Local\imput\Helium\Application\0.20.1.1`;
const output=path.resolve('qa/artifacts/installed-helium-0.20.1.1');fs.mkdirSync(output,{recursive:true});
const files=['resources.pak','chrome_100_percent.pak','chrome_200_percent.pak','Locales/en-US.pak'];
const report={version:'0.20.1.1',chromium:'156.0.8078.47',scope:'Installed application resource packs only; no profiles, browser windows, binaries copied or executed.',packs:[],hits:[]};
const pattern=/\bvpn\b|mullvad|\bivpn\b|proton(?:vpn| vpn)|wireguard|\bsocks[45]?\b|\bproxy\b|proxy-extension-downloads|helium.onboarding|PasswordManager|HeliumServices/gi;
for(const file of files){const buffer=fs.readFileSync(path.join(install,file));const version=buffer.readUInt32LE(0);const count=version===5?buffer.readUInt16LE(8):buffer.readUInt32LE(4);const header=version===5?12:9;let decompressed=0,failed=0,texts=0;
for(let index=0;index<count;index++){const id=buffer.readUInt16LE(header+index*6),start=buffer.readUInt32LE(header+index*6+2),end=buffer.readUInt32LE(header+(index+1)*6+2);let payload=buffer.subarray(start,end);try{if(payload[0]===0x1f&&payload[1]===0x8b){payload=zlib.gunzipSync(payload);decompressed++;}else if(payload[0]===0x1e&&payload[1]===0x9b){payload=zlib.brotliDecompressSync(payload.subarray(8));decompressed++;}}catch{failed++;continue;}const text=payload.toString(buffer[version===5?4:8]===2?'utf16le':'utf8');if(text.includes('\ufffd')&&[...text.slice(0,500)].filter(x=>x==='\ufffd').length>10)continue;texts++;const matches=[...text.matchAll(pattern)];if(!matches.length)continue;const terms=[...new Set(matches.map(m=>m[0].toLowerCase()))];const hit={pack:file,id,bytes:payload.length,sha256:crypto.createHash('sha256').update(payload).digest('hex'),terms,snippets:matches.slice(0,8).map(m=>text.slice(Math.max(0,m.index-80),m.index+160).replace(/\s+/g,' '))};report.hits.push(hit);if(id===41760){const target=`resource-${id}.txt`;fs.writeFileSync(path.join(output,target),text);hit.extracted=target;}}
report.packs.push({file,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),version,count,texts,decompressed,failed});}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({packs:report.packs,hitCount:report.hits.length,onboarding:report.hits.find(hit=>hit.id===41760),output},null,2));
