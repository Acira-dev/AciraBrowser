import type {PopupBackdropFrame} from '../runtime/types';

/** Decode only the broker's local PNG. The crop is rectangular: the radius
 * belongs to the original view, whose corner may be outside this crop. */
export async function decodePopupSnapshot(source:PopupBackdropFrame,signal:AbortSignal):Promise<HTMLCanvasElement>{
 if(signal.aborted)throw new DOMException('Popup snapshot cancelled','AbortError');
 if(!source.image.startsWith('data:image/png;base64,')||source.image.length>24000000||source.bounds.width<=0||source.bounds.height<=0)throw new Error('Invalid popup snapshot');
 const image=new Image();
 const aborted=()=>{image.src='';};signal.addEventListener('abort',aborted,{once:true});
 try{
  image.src=source.image;await image.decode();
  if(signal.aborted)throw new DOMException('Popup snapshot cancelled','AbortError');
  if(image.naturalWidth<1||image.naturalHeight<1||image.naturalWidth*image.naturalHeight>16000000)throw new Error('Popup snapshot dimensions unavailable');
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.setAttribute('aria-hidden','true');
  const context=canvas.getContext('2d');if(!context)throw new Error('Popup snapshot canvas unavailable');
  const b=source.bounds,original=source.sourceBounds;
  context.scale(canvas.width/b.width,canvas.height/b.height);
  context.beginPath();context.roundRect(original.x-b.x,original.y-b.y,original.width,original.height,source.radius);context.clip();
  context.drawImage(image,0,0,b.width,b.height);return canvas;
 }finally{signal.removeEventListener('abort',aborted);image.src='';}
}
