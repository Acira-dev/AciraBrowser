'use strict';
const MAX_INPUT_BYTES=8*1024*1024,MAX_PIXELS=24*1024*1024,MAX_DIMENSION=8192;
/** Probe only PNG/JPEG headers before invoking a raster decoder. */
function artworkImageInfo(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_INPUT_BYTES||bytes.length<24)throw Error('Choose a PNG or JPEG image up to 8 MB.');
 let width,height,mime;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
  if(bytes.readUInt32BE(8)!==13)throw Error('This PNG header is invalid.');
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime='image/png';
 }else if(bytes[0]===255&&bytes[1]===216){
  let at=2;
  while(at+3<bytes.length){
   if(bytes[at++]!==255)throw Error('This JPEG header is invalid.');
   while(bytes[at]===255)at++;
   const marker=bytes[at++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   if(at+2>bytes.length)break;const length=bytes.readUInt16BE(at);if(length<2||at+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)break;if(mime)throw Error('This JPEG has multiple image frames.');height=bytes.readUInt16BE(at+3);width=bytes.readUInt16BE(at+5);mime='image/jpeg';}at+=length;
  }
 }
 if(!mime||!width||!height||width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS)throw Error('Choose a valid PNG or JPEG image no larger than 24 megapixels or 8192 pixels on either side.');
 return{width,height,mime};
}
module.exports={artworkImageInfo,MAX_INPUT_BYTES};
