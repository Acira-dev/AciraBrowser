import type { BrowserProfile } from './types';
import { cleanProfileSettings } from './profileSettings';
import { isGreyProfileColor,profileColorFor } from './profileColors';

const row=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** Cheap shape checks for stored values; the image header and size are checked once, at the native boundary. */
export const validProfilePicture=(value:unknown):value is string=>typeof value==='string'&&value.length<=87424&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export const validProfileEmail=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&/^[^\s@<>"'`\\]{1,64}@[^\s@<>"'`\\]{1,255}\.[^\s@<>"'`\\]{2,}$/.test(value.trim());
const persistent=(value:unknown):value is string=>typeof value==='string'&&value.startsWith('persist:')&&value.length>8&&!/[\0\r\n]/.test(value);

/** Keep existing disk stores stable; recover malformed/shared stores without copying website credentials. */
export function normalizeBrowserProfiles(value:unknown,fallback:BrowserProfile[]):BrowserProfile[]{
 const inputs=Array.isArray(value)?value.map(row):[];
 // Reserve later valid stores too, so a recovered earlier row cannot take their sign-ins.
 const reserved=new Set(inputs.map(input=>input.partition).filter(persistent));
 const ids=new Set<string>(),partitions=new Set<string>(),profiles:BrowserProfile[]=[];
 for(const [index,input] of inputs.entries()){
  if(typeof input.id!=='string'||!input.id.trim()||typeof input.name!=='string'||ids.has(input.id))continue;
  ids.add(input.id);
  let partition=persistent(input.partition)?input.partition:'';
  if(!partition||partitions.has(partition)){
   let suffix=index+1;
   do{partition=`persist:acira-recovered-${suffix++}`;}while(reserved.has(partition));
   reserved.add(partition);
  }
  partitions.add(partition);
  profiles.push({id:input.id,name:input.name.trim()?input.name:'Recovered profile',color:typeof input.color==='string'&&/^#[\da-f]{6}$/i.test(input.color)?input.color:'',...(typeof input.avatar==='string'&&input.avatar&&input.avatar.length<=16?{avatar:input.avatar}:{}),...(validProfilePicture(input.picture)?{picture:input.picture}:{}),...(validProfileEmail(input.email)?{email:input.email.trim()}:{}),...(cleanProfileSettings(input.settings)?{settings:cleanProfileSettings(input.settings)}:{}),partition});
 }
 // A grey or missing colour (the old default) becomes a palette colour, stable per profile id; chosen colours stay.
 for(const profile of profiles)if(isGreyProfileColor(profile.color))profile.color=profileColorFor(profile.id,profiles.map(item=>item.color));
 return profiles.length?profiles:structuredClone(fallback);
}
