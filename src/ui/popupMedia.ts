/** Playback readiness is separate from native capture admission. No permission
 * remains armed while a video waits for its first presented frame. */
export function waitForPopupVideo(video:HTMLVideoElement,signal:AbortSignal,timeout=2500):Promise<void>{
 return new Promise((resolve,reject)=>{
  const hasVideoFrames=typeof video.requestVideoFrameCallback==='function';
  let complete=false,playing=false,presented=false,painting=false,frame=0,videoFrame:number|undefined;
  const cleanup=()=>{clearTimeout(timer);cancelAnimationFrame(frame);if(videoFrame!==undefined)video.cancelVideoFrameCallback(videoFrame);video.removeEventListener('loadeddata',check);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);};
  const finish=(error?:Error)=>{if(complete)return;complete=true;cleanup();if(error)reject(error);else resolve();};
  const check=()=>{
   if(complete||painting||!playing||video.readyState<2||!video.videoWidth||!video.videoHeight||hasVideoFrames&&!presented)return;
   // loadeddata/play can resolve before the compositor receives the texture.
   // Give the mounted, already-blurred layer a paint before fading its tint.
   painting=true;frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>finish());});
  };
  const failed=()=>finish(new Error('Popup material video could not decode'));
  const aborted=()=>finish(new DOMException('Popup material cancelled','AbortError'));
  const timer=setTimeout(()=>finish(new Error('Popup material first frame timed out')),timeout);
  video.addEventListener('loadeddata',check);video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted){aborted();return;}
  if(hasVideoFrames)videoFrame=video.requestVideoFrameCallback(()=>{videoFrame=undefined;presented=true;check();});
  // React commits BackdropSources before this frame starts the media element.
  frame=requestAnimationFrame(()=>{if(complete)return;try{void video.play().then(()=>{playing=true;check();},error=>finish(error instanceof Error?error:new Error('Popup material playback failed')));}catch(error){finish(error instanceof Error?error:new Error('Popup material playback failed'));}});
 });
}

/** Keep only decoded pixels, never a live capture, while the sheet is visible.
 * The canvas stays local to this mounted popup and is discarded with its context. */
export function freezePopupVideo(video:HTMLVideoElement):HTMLCanvasElement{
 if(video.readyState<2||video.videoWidth<1||video.videoHeight<1)throw new Error('Popup material frame is not decoded');
 const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.setAttribute('aria-hidden','true');
 const context=frame.getContext('2d');if(!context)throw new Error('Popup material frame unavailable');
 context.drawImage(video,0,0);return frame;
}
