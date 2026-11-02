// Convert the founder-selected BW01 raster into native icon containers.
// The transparent master is authoritative; this does not redraw the logo.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const source='public/brand/acira-app-icon.png',original='public/brand/acira-bw01-original.png',macSource='public/brand/acira-app-icon-mac.png';
const hash=b=>createHash('sha256').update(b).digest('hex'),master=await fs.readFile(source);
const executable=process.env.ACIRA_CHROME_EXECUTABLE||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
const sizes=[16,20,24,32,40,48,64,96,128,256,512,1024],pngs=new Map(),macPngs=new Map(),macMaster=await fs.readFile(macSource);
try{
 const page=await browser.newPage();
 await page.evaluate(async data=>{window.iconImage=new Image();window.iconImage.src='data:image/png;base64,'+data;await window.iconImage.decode();},master.toString('base64'));
 // The master has Mac-style empty space around the tile. Windows draws whatever is in the file at the slot's size, so a margin makes the taskbar icon look small: crop to the visible tile.
 await page.evaluate(()=>{const image=window.iconImage,c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const {data,width,height}=ctx.getImageData(0,0,c.width,c.height);let x0=width,y0=height,x1=-1,y1=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>=128){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}const side=Math.max(x1-x0,y1-y0)+1;window.iconCrop=[x0+(x1-x0+1-side)/2,y0+(y1-y0+1-side)/2,side,side];});
 for(const size of sizes){
  const png=await page.evaluate(size=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.beginPath();ctx.roundRect(0,0,size,size,size*.14);ctx.clip();ctx.drawImage(window.iconImage,...window.iconCrop,0,0,size,size);return c.toDataURL('image/png').split(',')[1];},size);
  const bytes=Buffer.from(png,'base64');pngs.set(size,bytes);await fs.mkdir('packaging/icons',{recursive:true});await fs.writeFile('packaging/icons/acira-icon-'+size+'.png',bytes);
 }
 await page.evaluate(async data=>{window.iconImage=new Image();window.iconImage.src='data:image/png;base64,'+data;await window.iconImage.decode();},macMaster.toString('base64'));
 for(const size of [16,32,64,128,256,512,1024]){const png=await page.evaluate(size=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(window.iconImage,0,0,size,size);return c.toDataURL('image/png').split(',')[1];},size);macPngs.set(size,Buffer.from(png,'base64'));}
}finally{await browser.close();}
const icoSizes=sizes.filter(s=>s<=256),header=Buffer.alloc(6+icoSizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(icoSizes.length,4);let offset=header.length;
for(const [index,size]of icoSizes.entries()){const png=pngs.get(size),at=6+index*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;}
const ico=Buffer.concat([header,...icoSizes.map(s=>pngs.get(s))]);
const entries=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]].map(([key,size])=>{const png=macPngs.get(size),h=Buffer.alloc(8);h.write(key);h.writeUInt32BE(png.length+8,4);return Buffer.concat([h,png]);});
const h=Buffer.alloc(8);h.write('icns');h.writeUInt32BE(8+entries.reduce((n,b)=>n+b.length,0),4);const icns=Buffer.concat([h,...entries]);
await fs.mkdir('packaging/mac',{recursive:true});
await Promise.all([fs.writeFile('packaging/acira-icon.ico',ico),fs.writeFile('packaging/mac/acira-icon.icns',icns),fs.writeFile('packaging/acira-icon-512.png',pngs.get(512)),fs.writeFile('public/app-icon.png',pngs.get(512)),fs.writeFile('public/favicon.ico',ico)]);
const report={schema:2,variant:'BW01 — Void Halo',source,sourceSha256:hash(master),macSource,macSourceSha256:hash(macMaster),windowsFraming:'The tile fills the whole slot with small corners, so it reads as large as Windows allows; the mark keeps the artwork proportions',macFraming:'Opaque black fills the canvas; macOS supplies the rounded-square mask, without a second gray backplate',original,canonicalSha256:hash(await fs.readFile(original)),icoSha256:hash(ico),icns:'packaging/mac/acira-icon.icns',icnsSha256:hash(icns),png512Sha256:hash(pngs.get(512)),sizes:icoSizes,macSizes:[16,32,64,128,256,512,1024],renderer:'Chromium PNG resampling from high-resolution masters',backgroundRemoval:'Built-in imagegen; Windows transparent tile and Mac full-bleed icon. Prompts: public/brand/acira-app-icon-prompt.txt and public/brand/acira-app-icon-mac-prompt.txt',rights:'Founder-selected BW01 from Acira-Monochrome-Aura-12-Variants.zip'};
await fs.writeFile('packaging/icon-provenance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({variant:report.variant,windowsIco:report.icoSha256,macIcns:report.icnsSha256}));
