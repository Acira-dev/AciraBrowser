import {useEffect,useState} from 'react';
import {formatCardNumber} from '../memberCard/cardData';

/** Beta 14.2 (D127): a seal at rest for a number that has no rendered still. `public/seals/H_<rank>_NNNN.webp` exist for Insider 1 to 60 and Founding 1 to 100 (sealNumbers.ts); a member numbered above that
 * must never see another member's number on the seal (the plain sprite reads No. 0001 / No. 0003), so the seal is drawn once by the live coin (public/welcome-coin/rest.js, the coin "Look closer" shows, the rim lettered
 * with the member's own number) and shown as a picture framed exactly like the stills (a PNG data URL: the interface's policy allows pictures from its own files and data: URLs, not blob: ones). It is made in a throw-away invisible iframe of this page: the iframe has its own copy of the coin's modules (one lettering per
 * member number, whatever else this page showed) and removing it frees the WebGL context, the ink canvases and three.js at once, so nothing stays in memory when the seal is not on screen. The picture is a string held by the seal
 * that shows it, gone with it. Nothing is made for a seal that is not shown. */
export type RestKind='insider'|'founding';
/** The iframe's sandbox: scripts only. Without `allow-same-origin` its page has an opaque origin and cannot reach this interface at all; the picture comes back as a message. */
export const REST_SANDBOX='allow-scripts';
const TIMEOUT_MS=20000;
/** The legend font's URL for the iframe (the card's own stand-in for his Windows-only Bahnschrift), made absolute: the iframe lives at another path. Null when it cannot be had (tests, no bundler). */
async function legendFontUrl():Promise<string|null>{
 try{
  // @ts-ignore a bundler asset import (a URL string); Node has none, and then the coin is lettered with the fallback face
  const url=((await import('../memberCard/fonts/legend-stand-in-500.woff2?url')) as {default:string}).default;
  return new URL(url,document.baseURI).href;
 }catch{return null;}
}
/** Starts the iframe and gives its picture (a PNG data URL) or null. `cancel` removes the iframe at once. */
export function restStill(kind:RestKind,number:number):{promise:Promise<string|null>;cancel:()=>void}{
 let frame:HTMLIFrameElement|null=null,done:(picture:string|null)=>void=()=>{},timer:ReturnType<typeof setTimeout>|0=0,ended=false,listener:((event:MessageEvent)=>void)|null=null;
 const finish=(picture:string|null)=>{
  if(ended)return;ended=true;
  if(timer)clearTimeout(timer);
  if(listener){window.removeEventListener('message',listener);listener=null;}
  if(frame){frame.remove();frame=null;}
  done(picture);
 };
 const promise=new Promise<string|null>(resolve=>{done=resolve;});
 const no=formatCardNumber(number);
 if(!no||typeof document==='undefined'){finish(null);return {promise,cancel:()=>{}};}
 timer=setTimeout(()=>finish(null),TIMEOUT_MS);
 void legendFontUrl().then(font=>{
  if(ended)return;   // cancelled (or timed out) while the font URL was being had
  const iframe=document.createElement('iframe');
  iframe.setAttribute('sandbox',REST_SANDBOX);iframe.setAttribute('aria-hidden','true');iframe.tabIndex=-1;iframe.title='';
  iframe.style.cssText='position:fixed;left:-10000px;top:0;width:8px;height:8px;border:0;visibility:hidden;pointer-events:none';
  listener=(event:MessageEvent)=>{
   const data=event.data as {type?:string;ok?:boolean;dataUrl?:string}|null;
   if(event.source!==iframe.contentWindow||!data||data.type!=='acira-seal-rest')return;
   finish(data.ok&&typeof data.dataUrl==='string'&&data.dataUrl.startsWith('data:image/png;base64,')?data.dataUrl:null);
  };
  window.addEventListener('message',listener);
  frame=iframe;
  iframe.src=new URL(`./welcome-coin/rest.html?rank=${kind}&no=${no}${font?`&font=${encodeURIComponent(font)}`:''}`,document.baseURI).href;
  document.body.appendChild(iframe);
 });
 return {promise,cancel:()=>finish(null)};
}

/** The seal drawn for `number` as a PNG data URL (null until it is ready, and null for no kind: nothing is made), started `delayMs` after the seal appears. The iframe is removed when the seal goes. */
export const REST_DELAY_MS=650;
export function useLiveRestSrc(kind:RestKind|null,number:number|null,delayMs=REST_DELAY_MS):string|null{
 const [src,setSrc]=useState<string|null>(null);
 useEffect(()=>{
  if(!kind||number===null){setSrc(null);return;}
  let alive=true,job:{promise:Promise<string|null>;cancel:()=>void}|null=null;
  // not at once: the coin's modules, ink canvases and shaders take a hundred milliseconds or so of this page's thread, so the work waits until the view that shows the seal has finished opening
  const timer=setTimeout(()=>{job=restStill(kind,number);void job.promise.then(picture=>{if(alive&&picture)setSrc(picture);});},delayMs);
  return ()=>{alive=false;clearTimeout(timer);job?.cancel();setSrc(null);};
 },[kind,number,delayMs]);
 return src;
}
