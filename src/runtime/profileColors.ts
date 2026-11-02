/** The profile colour palette. Every colour keeps white text above 4.5:1, so the initial is always readable.
 *  Names are the i18n colour keys (`profiles.color.<name>`). */
export const PROFILE_PALETTE=[
 {name:'Burgundy',value:'#7a2235'},
 {name:'Rose',value:'#b4475e'},
 {name:'Amber',value:'#9f5f18'},
 {name:'Olive',value:'#6b7a3a'},
 {name:'Emerald',value:'#1f7a5c'},
 {name:'Ocean',value:'#266a98'},
 {name:'Indigo',value:'#4b55a8'},
 {name:'Violet',value:'#7d4f8a'},
] as const;

const HEX=/^#[\da-f]{6}$/i;

/** True for a missing, malformed or grey-looking colour (the old default #62666d, #6b7280 and the like). */
export function isGreyProfileColor(color:unknown):boolean{
 if(typeof color!=='string'||!HEX.test(color))return true;
 const n=parseInt(color.slice(1),16),r=n>>16&255,g=n>>8&255,b=n&255;
 return Math.max(r,g,b)-Math.min(r,g,b)<28;
}

/** A palette colour for this profile id: the same id always starts at the same place, and a colour another profile already uses is skipped while any is free. */
export function profileColorFor(id:string,taken:Iterable<string>=[]):string{
 let hash=2166136261;
 for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619)>>>0;
 const used=new Set([...taken].map(value=>String(value).toLowerCase())),start=hash%PROFILE_PALETTE.length;
 for(let i=0;i<PROFILE_PALETTE.length;i++){
  const value=PROFILE_PALETTE[(start+i)%PROFILE_PALETTE.length].value;
  if(!used.has(value))return value;
 }
 return PROFILE_PALETTE[start].value;
}
