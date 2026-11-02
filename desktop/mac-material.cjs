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
module.exports={setMaterialAppearance,inspectMaterial,setOverlayMaterial};
