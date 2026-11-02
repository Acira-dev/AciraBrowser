'use strict';
// Who a Chromium profile is, as the source browser shows it: account picture, colour, initial, name and email.
// Read-only and local: Local State's profile.info_cache entry plus the profile folder's own Google Profile Picture.
const fs=require('node:fs'),path=require('node:path');
const MAX_PICTURE_BYTES=1.5*1024*1024,SIZE=64;
const text=(value,max=120)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):undefined;
/** Chromium stores colours as signed 32-bit ARGB integers; 0 means unset. */
function hexColor(value){
 if(typeof value!=='number'||!Number.isInteger(value)||value===0)return undefined;
 return '#'+((value>>>0)&0xffffff).toString(16).padStart(6,'0');
}
function initialOf(...names){
 for(const name of names){const match=typeof name==='string'?/[\p{L}\p{N}]/u.exec(name):null;if(match)return match[0].toUpperCase();}
 return '?';
}
function picture(location,fileName,nativeImage){
 if(!nativeImage||typeof fileName!=='string'||!fileName)return undefined;
 try{
  const file=path.join(location,path.basename(fileName));
  if(path.dirname(file)!==location||!fs.statSync(file).isFile()||fs.statSync(file).size>MAX_PICTURE_BYTES)return undefined;
  const image=nativeImage.createFromPath(file);if(image.isEmpty())return undefined;
  const {width,height}=image.getSize(),scale=Math.min(1,SIZE/Math.max(width,height));
  const small=scale<1?image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'best'}):image;
  const url=small.toDataURL();return url.startsWith('data:image/png;base64,')&&url.length<40000?url:undefined;
 }catch{return undefined;}
}
/** `entry` is Local State profile.info_cache[<dir>]. Fields are only present when the browser recorded them. */
function readProfileIdentity({entry={},location,fallbackName,nativeImage}){
 const info=entry&&typeof entry==='object'?entry:{};
 const email=text(info.user_name,200),accountName=text(info.gaia_name)||text(info.gaia_given_name),profileName=text(info.name)||fallbackName;
 const color=hexColor(info.profile_highlight_color)??hexColor(info.default_avatar_fill_color)??hexColor(info.profile_color_seed);
 const strokeColor=hexColor(info.default_avatar_stroke_color),fillColor=hexColor(info.default_avatar_fill_color);
 const index=/IDR_PROFILE_AVATAR_(\d{1,3})$/.exec(String(info.avatar_icon||''));
 const result={initial:initialOf(accountName,profileName,email)};
 if(email)result.email=email;if(accountName)result.accountName=accountName;if(color)result.color=color;if(strokeColor)result.strokeColor=strokeColor;if(fillColor)result.fillColor=fillColor;if(index)result.avatarIndex=Number(index[1]);
 const image=picture(location,info.gaia_picture_file_name,nativeImage);if(image)result.picture=image;
 return result;
}
module.exports={readProfileIdentity,hexColor,initialOf};
