/** Which favorite the Edit favorite popover is for. The sidebar and the popover live in different renderers of the same
 * origin, so the sidebar leaves the target here just before it opens the popup; a popup may only carry a tab id. */
const KEY='acira-favorite-edit';
export type FavoriteEditTarget={profileId:string;appId:string};
export function setFavoriteEditTarget(target:FavoriteEditTarget){try{localStorage.setItem(KEY,JSON.stringify({...target,at:Date.now()}));}catch{/* the inline editor stays */}}
export function favoriteEditTarget():FavoriteEditTarget|null{
 try{const value:unknown=JSON.parse(localStorage.getItem(KEY)||'null');
  if(value&&typeof value==='object'){const {profileId,appId,at}=value as Record<string,unknown>;if(typeof profileId==='string'&&typeof appId==='string'&&typeof at==='number'&&Date.now()-at<10*60_000)return {profileId,appId};}
 }catch{/* no target */}
 return null;
}
