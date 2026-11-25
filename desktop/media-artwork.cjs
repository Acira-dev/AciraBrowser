'use strict';
// Artwork for the now-playing card (Beta 14). A page names its artwork in navigator.mediaSession.metadata.artwork (a list of
// {src, sizes}); this fetches the one that fits, in the browser process, through the PAGE'S OWN session (so a Tor or private tab's
// request leaves the way its page's do, with no cookies and no referrer), shrinks it and hands the card a small data: URL. The card
// never loads a remote address itself. Only http(s) and inline data: images are taken; one image is at most 6 MB on the wire, 4 are
// asked at a time, each answer is kept (24 of them) and a failure is remembered for a minute so a dead address is not hammered.
const MAX_BYTES=6*1024*1024,PASS_BYTES=900*1024,MAX_INLINE=2*1024*1024,KEEP=24,PARALLEL=3,TIMEOUT_MS=6000,FAILED_MS=60000,SHORT_SIDE=240;

/** A picture nativeImage could not read, passed on in its own format when it really is WebP or AVIF and small. */
function passThrough(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<32||buffer.length>PASS_BYTES)return null;
 const type=buffer.toString('latin1',0,4)==='RIFF'&&buffer.toString('latin1',8,12)==='WEBP'?'webp':buffer.toString('latin1',4,8)==='ftyp'&&/^(avif|avis)/.test(buffer.toString('latin1',8,12))?'avif':null;
 return type?`data:image/${type};base64,${buffer.toString('base64')}`:null;
}
/** The artwork entry to fetch: the smallest one that is at least `want` px on its shorter side (the card draws 44 px, up to 3x), else the biggest there is. */
function pickArtwork(list,want=176){
 const found=[];
 for(const item of Array.isArray(list)?list:[]){
  const src=typeof item?.src==='string'?item.src.trim():'';
  if(!/^(?:https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(src)||src.length>8000)continue;
  let side=0;
  for(const size of String(item.sizes||'').split(/\s+/)){const m=/^(\d{1,5})x(\d{1,5})$/i.exec(size);if(m)side=Math.max(side,Math.min(Number(m[1]),Number(m[2])));}
  found.push({src,side});
 }
 if(!found.length)return null;
 const big=found.filter(entry=>entry.side>=want).sort((a,b)=>a.side-b.side)[0];
 if(big)return big.src;
 return found.sort((a,b)=>b.side-a.side)[0].src;
}

/** The video id of a YouTube address (watch?v=, /shorts/, /live/, /embed/, /v/, youtu.be/), or null. */
function youtubeId(address){
 let url;try{url=new URL(address);}catch{return null;}
 const host=url.hostname.replace(/^www\.|^m\.|^music\./i,'').toLowerCase();
 let id=null;
 if(host==='youtube.com'||host==='youtube-nocookie.com'){
  if(url.pathname==='/watch')id=url.searchParams.get('v');
  else{const m=/^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);if(m)id=m[1];}
 }else if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];
 return id&&/^[A-Za-z0-9_-]{6,20}$/.test(id)?id:null;
}
/** Where to look for a card's picture, best first (a page that names none still has a real picture, as Chrome's media hub finds it):
 *  1. the media session's own artwork (the page said it);
 *  2. a YouTube video's own thumbnail, from the address of the video that is PLAYING (maxres, then hq, then sd): the page's og:image is only the
 *     first video's after a playlist moves on, so it is not trusted there;
 *  3. the page's og:image / twitter:image;
 *  4. the video's own poster.
 *  Never the site's logo: that is what the card shows when none of these is there. Web addresses only, each once. */
function artworkCandidates({art,page,og,poster}={}){
 const out=[],add=src=>{if(typeof src==='string'&&/^https?:\/\//i.test(src)&&src.length<=2048&&!out.includes(src))out.push(src);};
 const own=pickArtwork(art);if(own)out.push(own);
 const id=youtubeId(page);
 if(id)for(const name of ['maxresdefault','hqdefault','sddefault'])add(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
 else{add(og);add(poster);}   // on YouTube the other pictures can belong to the video the page opened with, not the one playing
 return out;
}

async function readBody(response,limit){
 const length=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(length)&&length>limit)throw new Error('too large');
 const reader=response.body?.getReader?.();
 if(!reader){const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>limit)throw new Error('too large');return buffer;}
 const parts=[];let total=0;
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){try{await reader.cancel();}catch{}throw new Error('too large');}parts.push(Buffer.from(value));}
 return Buffer.concat(parts);
}

/** `nativeImage` is Electron's; `fetch(session, url, init)` is the page session's fetch (injected so tests need no network). */
function createMediaArtwork({nativeImage,fetch,now=()=>Date.now()}={}){
 const kept=new Map(),waiting=[];let running=0;
 const remember=(key,entry)=>{kept.delete(key);kept.set(key,entry);while(kept.size>KEEP)kept.delete(kept.keys().next().value);};
 /** The picture as a small data: URL, or null when it cannot be had. */
 function shrink(buffer,type){
  const image=nativeImage.createFromBuffer(buffer);
  // Electron's nativeImage reads PNG and JPEG only. A WebP or AVIF picture (YouTube and Google's image servers send them) is not refused: the interface's own
  // image decoder reads them, so a small one goes on as it is (the magic bytes are checked: it is an image, not whatever a server said).
  if(!image||image.isEmpty())return passThrough(buffer);
  const size=image.getSize();
  if(!(size.width>0&&size.height>0))return null;
  const small=Math.min(size.width,size.height)>SHORT_SIDE*1.25?image.resize(size.width<=size.height?{width:SHORT_SIDE,quality:'best'}:{height:SHORT_SIDE,quality:'best'}):image;
  const png=/png|gif|webp/i.test(type||'');
  const bytes=png?small.toPNG():small.toJPEG(86);
  return bytes&&bytes.length&&bytes.length<=1.5*1024*1024?`data:image/${png?'png':'jpeg'};base64,${bytes.toString('base64')}`:null;
 }
 async function download(session,src){
  const inline=/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(src);
  if(inline){if(src.length>MAX_INLINE*1.4)return null;return shrink(Buffer.from(inline[2],'base64'),inline[1]);}
  if(!/^https?:\/\//i.test(src)||typeof fetch!=='function')return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
   const response=await fetch(session,src,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'follow',signal:controller.signal,headers:{accept:'image/*'}});
   if(!response||!response.ok)return null;
   const type=String(response.headers?.get?.('content-type')||'');
   if(type&&!/^image\//i.test(type))return null;
   return shrink(await readBody(response,MAX_BYTES),type);
  }finally{clearTimeout(timer);}
 }
 function pump(){
  while(running<PARALLEL&&waiting.length){
   const job=waiting.shift();running++;
   // A fetch that ignores its abort signal must not hold a slot (and its "pending" mark) for ever.
   Promise.race([download(job.session,job.src),new Promise(resolve=>{const t=setTimeout(resolve,TIMEOUT_MS+2000,null);t.unref?.();})]).then(data=>data||null,()=>null).then(data=>{
    running--;
    remember(job.key,data?{data}:{failedAt:now()});
    job.done(data);pump();
   });
  }
 }
 const keyOf=(partition,src)=>`${partition||''}\n${src}`,pending=new Map();
 /** One download per address at a time: whoever asks while it runs gets the same answer. */
 function start(session,key,src){
  const running=pending.get(key);if(running)return running;
  const job=new Promise(resolve=>{waiting.push({key,session,src,done:resolve});pump();});
  pending.set(key,job);job.then(()=>pending.delete(key));
  return job;
 }
 return {
  pick:pickArtwork,candidates:artworkCandidates,
  /** The picture if it is already here (null while it loads or after a failure); asks for it the first time. */
  peek(session,partition,src){
   if(typeof src!=='string'||!src)return null;
   const key=keyOf(partition,src),hit=kept.get(key);
   if(hit?.data){remember(key,hit);return hit.data;}
   if(hit&&now()-hit.failedAt<FAILED_MS)return null;
   void start(session,key,src);
   return null;
  },
  /** One picture, waited for at most `ms`: its data URL, null when it cannot be had (a recent failure counts), or 'pending' when it is still coming
   * (the card knows its address and waits). Lets a chain of candidates move on at once from a dead address. */
  async settle(session,partition,src,ms=1500){
   if(typeof src!=='string'||!src)return null;
   const key=keyOf(partition,src),hit=kept.get(key);
   if(hit?.data){remember(key,hit);return hit.data;}
   if(hit&&now()-hit.failedAt<FAILED_MS)return null;
   const race=await Promise.race([start(session,key,src),new Promise(resolve=>{const t=setTimeout(resolve,ms,'pending');t.unref?.();})]);
   return race;
  },
  /** Awaitable form (tests, and a caller that wants to wait for the picture). */
  load(session,partition,src){
   if(typeof src!=='string'||!src)return Promise.resolve(null);
   const key=keyOf(partition,src),hit=kept.get(key);
   if(hit?.data)return Promise.resolve(hit.data);
   return start(session,key,src);
  },
  size:()=>kept.size,
  clear(){kept.clear();waiting.length=0;pending.clear();},
 };
}
module.exports={createMediaArtwork,pickArtwork,artworkCandidates,youtubeId,passThrough,MAX_BYTES,KEEP};
