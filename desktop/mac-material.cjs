let bridge,warningShown=false;
if(process.platform==='darwin'){
 try{bridge=require(require('node:path').join(__dirname,'native','build','mac-material.node'));}
 catch(error){console.warn('Native Mac material unavailable; run npm run build:mac-material.',error.message);}
}
function inspectMaterial(window){
 if(!bridge||!window||window.isDestroyed())return [];
 return JSON.parse(bridge.inspect(window.getNativeWindowHandle()));
}
function setMaterialAppearance(window,tone){
 if(!bridge||!window||window.isDestroyed())return [];
 try{return JSON.parse(bridge.setAppearance(window.getNativeWindowHandle(),tone));}
 catch(error){if(!warningShown){console.warn('Mac glass appearance:',error.message);warningShown=true;}return [];}
}
function setOverlayMaterial(window,chrome,regions,duration=0,reveal=true,enabled=true){
 if(!bridge?.overlayMaterial||!window||window.isDestroyed()||!chrome)return false;
 const views=[];const visit=view=>{if(view.webContents)views.push(view);for(const child of view.children||[])visit(child);};visit(window.contentView);
 const index=views.indexOf(chrome);if(index<0)return false;
 try{return bridge.overlayMaterial(window.getNativeWindowHandle(),index,views.length,regions,duration,reveal,enabled);}
 catch(error){if(!warningShown){console.warn('Mac overlay material:',error.message);warningShown=true;}return false;}
}
// Native fullscreen: AppKit's title strip would slide over the tab row and toolbar when the pointer touches the top edge (mac-material.mm).
// Returns how many strip windows are held; 0 until the window is fullscreen and its strip exists.
function hideFullscreenStrip(window){
 if(!bridge?.hideFullscreenStrip||!window||window.isDestroyed())return 0;
 try{return bridge.hideFullscreenStrip(window.getNativeWindowHandle());}
 catch(error){if(!warningShown){console.warn('Mac fullscreen titlebar:',error.message);warningShown=true;}return 0;}
}
// Is the window on the Space on screen (a fullscreen window is its own Space)? False when unknown. Key status says nothing about it: another app
// can hold the keyboard while this window is the only thing its display shows.
function windowOnActiveSpace(window){
 if(!bridge?.windowOnActiveSpace||!window||window.isDestroyed())return false;
 try{return !!bridge.windowOnActiveSpace(window.getNativeWindowHandle());}
 catch(error){if(!warningShown){console.warn('Mac window space:',error.message);warningShown=true;}return false;}
}
// Two-finger swipe between pages (swipe-nav.cjs): every precise scroll of the window arrives as callback(phase, momentumPhase, dx, dy, x, y, natural),
// the phases as NSEventPhase bits and the point in window pixels from the top left. Read only; the scroll itself is never touched. False when unavailable.
function watchScroll(window,callback){
 if(!bridge?.watchScroll||!window||window.isDestroyed()||typeof callback!=='function')return false;
 try{return !!bridge.watchScroll(window.getNativeWindowHandle(),callback);}
 catch(error){if(!warningShown){console.warn('Mac swipe:',error.message);warningShown=true;}return false;}
}
function unwatchScroll(window){
 if(!bridge?.unwatchScroll||!window||window.isDestroyed())return false;
 try{return !!bridge.unwatchScroll(window.getNativeWindowHandle());}catch{return false;}
}
// Every NSWindow of the process as [{class, level, behavior, visible, onActiveSpace, ...}] (read only; the rigs and the picture-in-picture Space fix use it). [] when unavailable.
function nativeWindows(){
 if(!bridge?.nativeWindows)return [];
 try{return JSON.parse(bridge.nativeWindows());}catch{return [];}
}
// Chromium's own small video window (picture in picture) may join the Space of a fullscreen window and every other Space (mac-material.mm pipSpaces). Returns how many windows were changed.
function pipOverFullscreen(){
 if(!bridge?.pipSpaces)return 0;
 try{return JSON.parse(bridge.pipSpaces()).length;}
 catch(error){if(!warningShown){console.warn('Mac picture in picture Spaces:',error.message);warningShown=true;}return 0;}
}
/** Beta 14.0: where the video's small pop-out window is now ({number, x, y, width, height} in AppKit points, origin at the bottom left of the primary display), or null (none on screen, or not macOS). */
function pipFrame(any=false){
 if(!bridge?.pipFrame)return null;
 try{return JSON.parse(bridge.pipFrame(any===true));}
 catch(error){if(!warningShown){console.warn('Mac picture in picture frame:',error.message);warningShown=true;}return null;}
}
/** Puts the pop-out window at this frame (AppKit points). 1 when it was moved. */
function pipPlace(x,y,width,height){
 if(!bridge?.pipPlace)return 0;
 try{return bridge.pipPlace(x,y,width,height)|0;}
 catch(error){if(!warningShown){console.warn('Mac picture in picture place:',error.message);warningShown=true;}return 0;}
}
/** Beta 14.0: the pop-out window is made transparent until it is placed (never longer than 250 ms: the native side puts it back by itself). 1 when a window was held. */
function pipHold(){
 if(!bridge?.pipHold)return 0;
 try{return bridge.pipHold()|0;}
 catch(error){if(!warningShown){console.warn('Mac picture in picture hold:',error.message);warningShown=true;}return 0;}
}
function pipRelease(){
 if(!bridge?.pipRelease)return 0;
 try{return bridge.pipRelease()|0;}
 catch(error){if(!warningShown){console.warn('Mac picture in picture release:',error.message);warningShown=true;}return 0;}
}
module.exports={pipFrame,pipPlace,pipHold,pipRelease,pipOverFullscreen,nativeWindows,setMaterialAppearance,inspectMaterial,setOverlayMaterial,hideFullscreenStrip,windowOnActiveSpace,watchScroll,unwatchScroll};
