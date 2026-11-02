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
module.exports={setMaterialAppearance,inspectMaterial,setOverlayMaterial,hideFullscreenStrip,windowOnActiveSpace};
