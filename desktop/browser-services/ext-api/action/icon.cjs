'use strict';
// chrome.action.setIcon: the two ways to give an icon, as the toolbar can draw it.
//   imageData  ImageData, or {size: ImageData}. The extension page sends raw RGBA ({width, height, data}); here it becomes a PNG data URL.
//   path       a file of the extension, or {size: file}; checked to exist and to stay inside the extension.
const fs=require('node:fs'),path=require('node:path');

const MAX_SIDE=512;
const NEEDS='Either the path or imageData property must be specified.';
let encoder=null;
/** Tests replace the PNG encoder (Electron's nativeImage is not available outside the app). */
const setImageEncoder=fn=>{encoder=typeof fn==='function'?fn:null;};

/** Straight RGBA -> the premultiplied BGRA bitmap that nativeImage.createFromBitmap takes. */
function toBitmap({width,height,data}){
 const out=Buffer.alloc(width*height*4);
 for(let i=0;i<out.length;i+=4){
  const a=data[i+3];
  out[i]=Math.round(data[i+2]*a/255);out[i+1]=Math.round(data[i+1]*a/255);out[i+2]=Math.round(data[i]*a/255);out[i+3]=a;
 }
 return out;
}
function encodeWithElectron(image){
 const {nativeImage}=require('electron');
 const native=nativeImage.createFromBitmap(toBitmap(image),{width:image.width,height:image.height});
 if(native.isEmpty())throw new Error('The icon image is invalid.');
 return native.toDataURL();
}
const bytesOf=data=>{
 if(data instanceof ArrayBuffer)return new Uint8Array(data);
 if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
 if(Array.isArray(data))return Uint8Array.from(data);
 return null;
};
/** A wire image ({width, height, data}) checked and turned into a PNG data URL. */
function imageToDataURL(image,encode=encoder||encodeWithElectron){
 // Manifest V2 pages convert the image themselves (a canvas) and send a PNG data URL.
 if(typeof image==='string'){if(image.length>512*1024||!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image))throw new Error('The icon image data is invalid.');return image;}
 if(!image||typeof image!=='object')throw new Error('The icon image data is invalid.');
 const {width,height}=image,data=bytesOf(image.data);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_SIDE||height>MAX_SIDE||!data||data.length!==width*height*4)throw new Error('The icon image data is invalid.');
 return encode({width,height,data});
}
const isWireImage=value=>!!value&&typeof value==='object'&&typeof value.width==='number'&&typeof value.height==='number'&&'data' in value;
const sizeKey=key=>/^\d{1,4}$/.test(key)&&Number(key)>0;

function resolveFile(extension,relative){
 if(typeof relative!=='string'||!relative||!extension?.path)return null;
 const root=path.resolve(extension.path),full=path.resolve(root,relative.replace(/^[\\/]+/,''));
 return full.startsWith(root+path.sep)?full:null;
}
function checkPath(extension,relative,exists){
 const full=resolveFile(extension,relative);
 if(!full||!exists(full))throw new Error(`Could not load action icon '${relative}'.`);
}

/**
 * details = {imageData?, path?}: {imageData: {size: dataURL}} or {path: string | {size: string}}, ready for the toolbar's icon route.
 * Throws Chromium's errors.
 */
function normalizeIcon(details,{extension,encode,exists=file=>fs.existsSync(file)}={}){
 const image=details?.imageData,file=details?.path;
 if((image===undefined||image===null)&&(file===undefined||file===null))throw new Error(NEEDS);
 if(image!==undefined&&image!==null){
  const out={};
  if(typeof image==='string')return {imageData:imageToDataURL(image,encode)};
  if(isWireImage(image))out[String(image.width)]=imageToDataURL(image,encode);
  else if(typeof image==='object')for(const [key,value] of Object.entries(image)){
   if(!sizeKey(key))throw new Error('The icon image data is invalid.');
   out[key]=imageToDataURL(value,encode);
  }
  else throw new Error('The icon image data is invalid.');
  if(!Object.keys(out).length)throw new Error(NEEDS);
  return {imageData:out};
 }
 if(typeof file==='string'){checkPath(extension,file,exists);return {path:file};}
 if(file&&typeof file==='object'&&!Array.isArray(file)){
  const out={};
  for(const [key,value] of Object.entries(file)){
   if(!sizeKey(key)||typeof value!=='string')throw new Error(`Could not load action icon '${String(value)}'.`);
   checkPath(extension,value,exists);out[key]=value;
  }
  if(!Object.keys(out).length)throw new Error(NEEDS);
  return {path:out};
 }
 throw new Error(NEEDS);
}

module.exports={normalizeIcon,imageToDataURL,toBitmap,setImageEncoder,NEEDS,MAX_SIDE};
