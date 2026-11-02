import type {Settings} from './types';
// The glass slider runs 40–100% (round 2); older profiles' 60–100% values restore unchanged.
const amount=(value:unknown,fallback:number,max=100)=>typeof value==='number'&&Number.isFinite(value)?Math.max(40,Math.min(max,value)):fallback;
export function restoredMaterial(raw:Partial<Settings>){
 const opacity=amount(raw.glassOpacity,64),last=amount(raw.translucentOpacity,opacity<100?opacity:64,99),reduced=raw.reducedTransparency===true||opacity===100;
 return {glassOpacity:reduced?100:opacity,translucentOpacity:reduced?last:opacity,reducedTransparency:reduced};
}
export function materialSettingsPatch(current:Settings,patch:Partial<Settings>):Partial<Settings>{
 if(patch.glassOpacity!==undefined){const opacity=amount(patch.glassOpacity,current.glassOpacity);return {...patch,glassOpacity:opacity,reducedTransparency:opacity===100,translucentOpacity:opacity<100?opacity:current.glassOpacity<100?current.glassOpacity:current.translucentOpacity||64};}
 if(patch.reducedTransparency!==undefined){const last=current.glassOpacity<100?current.glassOpacity:current.translucentOpacity||64;return {...patch,glassOpacity:patch.reducedTransparency?100:last,translucentOpacity:last};}
 return patch;
}
