/** Capture only an isolated app's own offscreen, non-focusable window.
 * A separate ephemeral QA renderer avoids changing production permissions. */
const recorders=new WeakMap();
export async function startNativeCapture(app,ui,{everyFrame=false,maxFrames=70,allowOnscreen=false}={}){
 const result=await app.evaluate(async({BaseWindow,WebContentsView},{everyFrame,maxFrames,allowOnscreen})=>{
  const win=BaseWindow.getAllWindows()[0];if((win.getBounds().x>-2000&&!allowOnscreen)||BaseWindow.prototype.isFocused.call(win)||win.isFocusable())throw new Error('Capture window must remain offscreen and unfocused');
  const source=win.getMediaSourceId();
  const view=new WebContentsView({webPreferences:{partition:'qa-recorder-'+Date.now(),backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  view.setBackgroundColor('#00000000');view.setBounds({x:0,y:0,width:1,height:1});win.contentView.addChildView(view);
  globalThis.__qaRecorder=view;await view.webContents.loadFile(process.cwd()+'/qa/native-recorder.html');
  return view.webContents.executeJavaScript(`(${(async ({source,everyFrame,maxFrames})=>{
   const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:source,maxWidth:1800,maxHeight:1200,maxFrameRate:60}}});
   const video=document.createElement('video');video.srcObject=stream;video.muted=true;await video.play();const canvas=document.createElement('canvas'),context=canvas.getContext('2d');window.__nativeCapture={stream,video,frames:[],running:true};let last=0;
   const frame=(_now,metadata)=>{const cap=window.__nativeCapture;if(!cap?.running)return;if(everyFrame||metadata.mediaTime-last>=.035){last=metadata.mediaTime;canvas.width=video.videoWidth;canvas.height=video.videoHeight;context.drawImage(video,0,0);cap.frames.push({time:Date.now(),image:canvas.toDataURL('image/png').split(',')[1]});if(cap.frames.length>maxFrames)cap.frames.shift();}video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback(frame);return {width:video.videoWidth,height:video.videoHeight};
  }).toString()})(${JSON.stringify({source,everyFrame,maxFrames})})`,true);
 },{everyFrame,maxFrames,allowOnscreen});recorders.set(ui,app);return result;
}
export async function stopNativeCapture(ui){
 const app=recorders.get(ui);if(!app)return [];recorders.delete(ui);
 return app.evaluate(async({BaseWindow})=>{const view=globalThis.__qaRecorder;if(!view)return [];try{return await view.webContents.executeJavaScript(`(()=>{const cap=window.__nativeCapture;if(!cap)return [];cap.running=false;for(const track of cap.stream.getTracks())track.stop();cap.video.srcObject=null;return cap.frames;})()`);}finally{BaseWindow.getAllWindows()[0]?.contentView.removeChildView(view);view.webContents.close();delete globalThis.__qaRecorder;}});
}
