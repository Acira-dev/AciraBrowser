import {feedbackCall} from '../../runtime/feedback';

/* Beta 14 member cards: the card's three buttons (Copy image, Save picture, Save video). The interface only hands the bytes over: main (desktop/member-card-share.cjs) writes the real clipboard and
   saves through the download engine, so a saved card is in the person's download folder (or the one they chose, or asked for) and in the Downloads list like any download. No words here: the caller says what happened. */

/** How a share ended. `path` and `id` (the Downloads row, for the "Open" / "Show in folder" commands) are given for a saved file. The reasons:
 *  unavailable: nothing to do it with (no desktop bridge, no window, no clipboard)
 *  too-large:   over the size limit (a picture 24 MB, a video 128 MB), or a picture too big to put on the clipboard
 *  cancelled:   the person closed the Save dialog ("Ask where to save" is on)
 *  failed:      anything else: not the kind of file asked for, no bytes, the disk or the clipboard refused */
export type ShareFailure='unavailable'|'too-large'|'cancelled'|'failed';
export type ShareResult={ok:true;path?:string;id?:string}|{ok:false;reason:ShareFailure};

/** Bytes. Main checks the same figures against what the bytes really are. */
export const CARD_LIMITS={picture:24*1024*1024,video:128*1024*1024} as const;
const PICTURE_TYPES:readonly string[]=['image/png'];
const VIDEO_TYPES:readonly string[]=['video/webm','video/mp4'];
const REASONS:readonly string[]=['unavailable','too-large','cancelled','failed'];
const fail=(reason:ShareFailure):ShareResult=>({ok:false,reason});

/** A Blob's type without its parameters ("video/webm;codecs=vp9" -> "video/webm"). */
const essence=(blob:Blob)=>blob.type.split(';')[0].trim().toLowerCase();

async function send(action:'copy'|'picture'|'video',blob:Blob,name?:string):Promise<ShareResult>{
 try{
  if(!(blob instanceof Blob)||!blob.size)return fail('failed');
  const video=action==='video';
  if(!(video?VIDEO_TYPES:PICTURE_TYPES).includes(essence(blob)))return fail('failed');
  if(blob.size>CARD_LIMITS[video?'video':'picture'])return fail('too-large');
  const data=new Uint8Array(await blob.arrayBuffer()),result=await feedbackCall({type:'feedback.card-share',action,data,...(name===undefined?{}:{name})});
  if(result.ok===true)return {ok:true,...(typeof result.path==='string'?{path:result.path}:{}),...(typeof result.id==='string'?{id:result.id}:{})};
  if(result.failure==='unavailable')return fail('unavailable');
  return fail(REASONS.includes(result.reason??'')?result.reason as ShareFailure:'failed');
 }catch{return fail('failed');}
}

/** The picture's pixels as RGBA (what a canvas gives), or null when the browser cannot make them. */
async function pixelsOf(png:Blob):Promise<{data:Uint8Array;width:number;height:number}|null>{
 try{
  const bitmap=await createImageBitmap(png),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d');if(!context){bitmap.close();return null;}
  context.drawImage(bitmap,0,0);bitmap.close();
  const {data}=context.getImageData(0,0,canvas.width,canvas.height);
  return {data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength),width:canvas.width,height:canvas.height};
 }catch{return null;}
}

/** Puts the card's picture on the clipboard. The pixels go to main as they are (RGBA, 1200 x 1800) and main builds the clipboard image from them, so no picture file has to be decoded there (reported 17 Nov: Copy image
 *  always failed with the PNG route). Where the pixels cannot be made, or main refuses them, the PNG goes the old way as a second try. */
export async function copyCardImage(png:Blob):Promise<ShareResult>{
 try{
  if(!(png instanceof Blob)||!png.size)return fail('failed');
  if(!PICTURE_TYPES.includes(essence(png)))return fail('failed');
  if(png.size>CARD_LIMITS.picture)return fail('too-large');
  const pixels=await pixelsOf(png);
  if(pixels){
   const result=await feedbackCall({type:'feedback.card-share',action:'copy-pixels',data:pixels.data,width:pixels.width,height:pixels.height});
   if(result.ok===true)return {ok:true};
   if(result.failure==='unavailable')return fail('unavailable');
  }
 }catch{/* the PNG route is tried */}
 return send('copy',png);
}
/** Saves a PNG picture of the card as `fileName` in the download folder (a name no file has is used: "Card (1).png"); the extension is made to fit the file. */
export const saveCardPicture=(png:Blob,fileName:string):Promise<ShareResult>=>send('picture',png,fileName);
/** Saves the card's video (WebM or MP4) as `fileName`, the same way. */
export const saveCardVideo=(video:Blob,fileName:string):Promise<ShareResult>=>send('video',video,fileName);
