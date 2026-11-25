'use strict';
// Beta 14 member cards: what the card's three buttons do with the pictures the interface made (Copy image, Save picture, Save video).
// One request on the feedback channel ('feedback.card-share', main.cjs): {action:'copy'|'picture'|'video', data:Uint8Array, name?:string}. Copy writes the clipboard (a test run's stub, as the screenshot's);
// Save goes through the download engine (download-engine.cjs saveFile) and ALWAYS opens the system Save dialog (reported 17 Nov): it starts in the downloads folder (or the one chosen in Settings) on a name no file has, the person
// picks the folder and the name, Cancel saves nothing and says so quietly ('cancelled'); the saved file is listed in Downloads.
// What is in the bytes is read from the bytes, never taken from the interface's word for it. Parts that need no Electron, so it can be tested alone.
const path=require('node:path');
const {writeImageToClipboard}=require('./clipboard-image.cjs');
const {CLIPBOARD_MAX_PIXELS}=require('./page-capture.cjs');

const LIMITS=Object.freeze({picture:24*1024*1024,video:128*1024*1024,pixels:4_000_000});   // pixels: the most a raw-pixel Copy may hold (the card is 1200 x 1800 = 2.16 million)   // bytes: the interface checks the same figures (src/features/memberCard/share.ts)
const ACTIONS=Object.freeze({copy:'picture',picture:'picture',video:'video','copy-pixels':'pixels'});
const KEYS=['type','action','data','name','width','height'];
const DEFAULT_NAME='Acira member card';

/** What the bytes are: a PNG (its size from the header), a WebM (an EBML file whose document type is webm) or an MP4. Anything else is null. */
function sniff(bytes){
 if(bytes.length>=24&&bytes.readUInt32BE(0)===0x89504e47&&bytes.readUInt32BE(4)===0x0d0a1a0a&&bytes.readUInt32BE(8)===13&&bytes.toString('latin1',12,16)==='IHDR'){
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  return width>0&&height>0&&width<=0x7fffffff&&height<=0x7fffffff?{kind:'picture',mime:'image/png',extension:'.png',width,height}:null;
 }
 if(bytes.length>=32&&bytes.readUInt32BE(0)===0x1a45dfa3&&bytes.subarray(4,48).includes('webm'))return {kind:'video',mime:'video/webm',extension:'.webm'};
 if(bytes.length>=16&&bytes.toString('latin1',4,8)==='ftyp')return {kind:'video',mime:'video/mp4',extension:'.mp4'};
 return null;
}

/** The file name the interface suggests, with the extension the bytes need: a trailing media extension is replaced, a folder part is dropped (the download engine cleans the rest and picks a free name). */
function fileNameFor(name,extension){
 const base=path.posix.basename(String(name??'').replace(/\\/g,'/')).replace(/[\u0000-\u001f]/g,'').replace(/\.(?:png|jpe?g|webp|gif|apng|webm|mp4|m4v|mov|mkv)$/i,'').replace(/[.\s]+$/,'').trim();
 return (/^[.\s]*$/.test(base)?DEFAULT_NAME:base)+extension;
}

/** Raw RGBA (what a canvas's getImageData gives: straight alpha) as the premultiplied BGRA a nativeImage bitmap is. Makes a new buffer; the input is not touched. */
function rgbaToBgra(rgba){
 const out=Buffer.allocUnsafe(rgba.length);
 for(let i=0;i<rgba.length;i+=4){
  const a=rgba[i+3];
  if(a===255){out[i]=rgba[i+2];out[i+1]=rgba[i+1];out[i+2]=rgba[i];out[i+3]=255;}
  else{out[i]=Math.round(rgba[i+2]*a/255);out[i+1]=Math.round(rgba[i+1]*a/255);out[i+2]=Math.round(rgba[i]*a/255);out[i+3]=a;}
 }
 return out;
}

/** `report(step, error)` is told what really went wrong with a Copy ('decode' = making the picture, 'clipboard' = putting it on the clipboard): the person only sees "did not work", main.log and the console say why (reported 17 Nov: Copy image always failed). */
function createCardShare({downloads,clipboard,nativeImage,ClipboardItem,report=(step,error)=>{try{console.warn('Member card copy failed at '+step+':',error&&error.message||error);}catch{/* no console */}}}){
 const refuse=reason=>({feedback:{ok:false,reason}});
 /** `ctx.owner`: who the file is listed under (main.cjs interfaceOwner: the window's profile, private and Tor marks, the record and toast roads) or null when no window is there. */
 async function handle(request,ctx){
  if(!request||typeof request!=='object'||Array.isArray(request)||request.type!=='feedback.card-share')throw new Error('Invalid card request.');
  for(const key of Object.keys(request))if(!KEYS.includes(key))throw new Error('Unexpected card request field.');
  if(!Object.hasOwn(ACTIONS,request.action))throw new Error('Unknown card action.');
  if(request.name!==undefined&&typeof request.name!=='string')throw new Error('A name must be text.');
  if(request.action!=='copy-pixels'&&(request.width!==undefined||request.height!==undefined))throw new Error('Unexpected card request field.');
  const data=request.data;
  if(!(data instanceof ArrayBuffer||ArrayBuffer.isView(data)))throw new Error('A card file must be bytes.');
  const bytes=data instanceof ArrayBuffer?Buffer.from(data):Buffer.from(data.buffer,data.byteOffset,data.byteLength),want=ACTIONS[request.action];
  if(!bytes.length)return refuse('failed');
  /* Copy from raw pixels (RGBA, width x height x 4 bytes): no picture file is decoded in main, so nothing there can fail to decode it. */
  if(want==='pixels'){
   const {width,height}=request;
   if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||bytes.length!==width*height*4)return refuse('failed');
   if(width*height>LIMITS.pixels||width*height>CLIPBOARD_MAX_PIXELS)return refuse('too-large');
   if(!clipboard||!nativeImage)return refuse('unavailable');
   let image;
   try{image=nativeImage.createFromBitmap(rgbaToBgra(bytes),{width,height});if(!image||image.isEmpty())throw new Error('the picture came out empty');}
   catch(error){report('decode',error);return refuse('failed');}
   try{await writeImageToClipboard(clipboard,image,ClipboardItem);}catch(error){report('clipboard',error);return refuse('failed');}
   return {feedback:{ok:true}};
  }
  if(bytes.length>LIMITS[want])return refuse('too-large');
  const found=sniff(bytes);
  if(!found||found.kind!==want)return refuse('failed');
  try{
   if(request.action==='copy'){
    if(!clipboard||!nativeImage)return refuse('unavailable');
    if(found.width*found.height>CLIPBOARD_MAX_PIXELS)return refuse('too-large');   // decoding it for the clipboard would hold hundreds of MB
    let image;
    try{image=nativeImage.createFromBuffer(Buffer.from(bytes));if(!image||image.isEmpty())throw new Error('the picture could not be decoded (empty image)');}   // a fresh copy of the bytes, not a view over the IPC buffer
    catch(error){report('decode',error);return refuse('failed');}
    try{await writeImageToClipboard(clipboard,image,ClipboardItem);}catch(error){report('clipboard',error);return refuse('failed');}
    return {feedback:{ok:true}};
   }
   if(!ctx||!ctx.owner||!downloads)return refuse('unavailable');
   const saved=await downloads.saveFile(ctx.owner,fileNameFor(request.name,found.extension),bytes,{mime:found.mime,askWhere:'always',titleId:request.action==='video'?'memberCard.saveVideo':'memberCard.savePicture'});
   return saved?{feedback:{ok:true,path:saved.path,id:saved.id}}:refuse('cancelled');
  }catch{return refuse('failed');}
 }
 return {handle};
}
module.exports={createCardShare,sniff,fileNameFor,rgbaToBgra,LIMITS};
