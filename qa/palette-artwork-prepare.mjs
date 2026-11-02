import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Exact, deterministic museum-image rendition preparation. Never fetches sources.
// Explicit source-pixel rectangles exclude photographic margins; no invented pixels,
// retouching, exposure adjustment, generative processing or generic border-hiding zoom.
const output=path.resolve('public/artwork/catalog-v2');
const references=['docs/reference/artwork-hires-2026-10-24/manifest.json','docs/reference/artwork-met-catalog-2026-10-24/manifest.json'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifests=await Promise.all(references.map(async file=>({file,bytes:await fs.readFile(file)})));
const sources=manifests.flatMap(m=>JSON.parse(m.bytes).paintings.map(p=>({...p,referenceManifest:m.file,referenceManifestSha256:sha(m.bytes),checkedAt:JSON.parse(m.bytes).checkedAt})));
const framing={
 'met-436535':{rect:[136,144,3720,2904],position:[50,68],alt:'Blue swirling clouds above golden wheat and a tall green cypress.',note:'Inner painted rectangle; exclude black surround and irregular canvas edge. Lower focus balances wheat, hills and cypress; wide cover intentionally omits the tree tip.'},
 'met-435877':{rect:[104,104,3784,3016],position:[50,34],alt:'A pine tree and pale mountain above a green valley crossed by a viaduct.',note:'Inner painted rectangle removes photographed outer edge; upper-middle focus retains mountain and viaduct.'},
 'met-438849':{rect:[112,144,3624,3016],position:[50,100],alt:'A low distant horizon beneath a broad peach and grey sunset.',note:'Exclude black surround. Bottom focus retains the very low horizon; original sky paint loss is not retouched.'},
 'met-435973':{rect:[280,530,3360,1510],position:[50,55],alt:'Warm chalk cliffs and an ochre valley in an Italian landscape.',note:'Crop inside the painted paper, excluding grey photographic backing, cast shadow and paper edge. Preserve central chalk valley.'},
 'met-436594':{rect:[112,1000,3584,2048],position:[50,65],label:'coastal ruins',alt:'Small boats and figures beside coastal ruins under a blue sky.',note:'Use lower rectangular painted area beneath the arch. Exclude black upper corners, panel rim and bottom edge; retain boats and coastal ruins.'},
 'met-436595':{rect:[80,1000,3640,2024],position:[50,65],label:'ruins and boats',alt:'Classical ruins on the left and small boats on blue water to the right.',note:'Use lower rectangular painted area beneath the arch. Exclude black corners and panel rim; retain left architecture and right boats.'},
 'met-436593':{rect:[120,780,3760,1420],position:[50,55],label:'arch and harbour',alt:'A broad masonry arch, tiny figures and sailboats beside a harbour.',note:'Use lower painted rectangle beneath arched top, inside outer border. Narrow covers crop some outer shore while keeping the arch and central boat.'},
 'met-436229':{rect:[96,104,3720,2296],position:[50,46],alt:'A pale distant valley framed by dark trees, rocks and small figures.',note:'Exclude photographed outer canvas edge. Preserve naturally dark woodland and central valley light without exposure changes.'},
 'met-436441':{rect:[64,64,3736,2980],position:[50,65],alt:'Rolling wooded hills with cattle, a cart and figures on a winding path.',note:'Exclude narrow outer edge; lower focus keeps hillside, cattle and cart rather than an all-sky strip.'},
 'met-435684':{rect:[136,136,3720,2872],position:[50,55],alt:'A castle and distant Roman hills balanced by a large tree and small figures.',note:'Exclude black surround and brown panel edge. Retain castle and tree balance; historic joined-panel seams remain visible.'}
};
const order=['met-436535','met-435877','met-436594','met-438849','met-435973','met-436595','met-436441','met-436229','met-436593','met-435684'];
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const catalog={schemaVersion:1,collection:'Ten landscape paintings — bounded starter',preparedAt:new Date().toISOString(),budgetBytes:10*1024*1024,paintings:[]};
try{
 const page=await browser.newPage();await page.route(/^https?:/,route=>route.abort());
 await fs.mkdir(output,{recursive:true});
 // Refuse to overwrite a frozen handoff without an explicit withdrawal.
 const ready=await fs.readFile('docs/workstreams/palette-artwork-ready.json','utf8').then(JSON.parse,()=>null);assert.ok(!ready?.ready,'Catalog is frozen in palette-artwork-ready.json');
 for(const id of order){
  const original=sources.find(p=>p.id===id),frame=framing[id],bytes=await fs.readFile(original.file);
  assert.equal(sha(bytes),original.sha256);assert.equal(bytes.length,original.bytes);assert.equal(original.isPublicDomain,true);
  let metadata=null;if(original.metadataFile){const raw=await fs.readFile(original.metadataFile),object=JSON.parse(raw);assert.equal(sha(raw),original.metadataSha256);assert.equal(object.isPublicDomain,true);assert.equal(object.primaryImage,original.imageURL);metadata={path:original.metadataFile,sha256:sha(raw)};}
  const encoded=await page.evaluate(async({data,rect})=>{const image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=2560;canvas.height=Math.round(rect[3]*2560/rect[2]);const ctx=canvas.getContext('2d',{colorSpace:'srgb'});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,...rect,0,0,canvas.width,canvas.height);return{original:[image.naturalWidth,image.naturalHeight],width:canvas.width,height:canvas.height,data:canvas.toDataURL('image/jpeg',.86).split(',')[1]};},{data:bytes.toString('base64'),rect:frame.rect});
  assert.deepEqual(encoded.original,[original.width,original.height]);const[x,y,w,h]=frame.rect;assert.ok(x>=0&&y>=0&&x+w<=original.width&&y+h<=original.height&&w>=2560);
  const jpeg=Buffer.from(encoded.data,'base64'),filename=id+'.jpg';await fs.writeFile(path.join(output,filename),jpeg);
  catalog.paintings.push({id,name:original.name+(frame.label?' ('+frame.label+')':''),originalTitle:original.name,artist:original.artist,date:original.date,provider:'The Metropolitan Museum of Art',rights:'CC0 1.0',rightsURL:'https://creativecommons.org/publicdomain/zero/1.0/',policyURL:'https://www.metmuseum.org/hubs/open-access',source:original.source,metadataURL:original.metadataURL,imageURL:original.imageURL,isPublicDomain:true,checkedAt:original.checkedAt,src:'/artwork/catalog-v2/'+filename,alt:frame.alt,objectPosition:frame.position.map(n=>n+'%').join(' '),sha256:sha(jpeg),bytes:jpeg.length,width:encoded.width,height:encoded.height,mime:'image/jpeg',provenance:{originalFile:original.file,originalSha256:original.sha256,originalBytes:original.bytes,originalWidth:original.width,originalHeight:original.height,referenceManifest:original.referenceManifest,referenceManifestSha256:original.referenceManifestSha256,metadataCapture:metadata,metadataCaptureNote:metadata?undefined:'Exact object was checked by reference owner; raw object response is not archived in the two-original manifest.'},framing:{sourceRect:{x,y,width:w,height:h},units:'original image pixels',note:frame.note},rendition:{width:2560,height:encoded.height,encoder:'Chromium Canvas JPEG',quality:.86,colorSpace:'srgb',resize:'high imageSmoothingQuality, downsample only',browser:browser.version(),operations:['source rectangle crop','proportional resize','JPEG encode'],retouched:false}});
 }
 catalog.totalBytes=catalog.paintings.reduce((sum,p)=>sum+p.bytes,0);assert.ok(catalog.totalBytes<=catalog.budgetBytes);catalog.maximumDecodedBytes=Math.max(...catalog.paintings.map(p=>p.width*p.height*4));
 await fs.writeFile(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
 console.log(JSON.stringify({directory:output,count:catalog.paintings.length,totalBytes:catalog.totalBytes,budgetBytes:catalog.budgetBytes,maximumDecodedBytes:catalog.maximumDecodedBytes,paintings:catalog.paintings.map(({id,width,height,bytes,objectPosition})=>({id,width,height,bytes,objectPosition}))}));
}finally{await browser.close();}
