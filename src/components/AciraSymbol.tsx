import type { CSSProperties } from 'react';
import { BrandIcon } from './BrandLogo';
/** The Acira icon-only mark for internal pages and the rail, inside the existing icon and hit geometry. */
export function AciraSymbol({size=18,className='',style}:{size?:number;className?:string;style?:CSSProperties}){
 return <span className={`acira-symbol ${className}`} style={{display:'inline-grid',placeItems:'center',width:size,height:size,flexShrink:0,...style}} aria-hidden="true"><BrandIcon size={size}/></span>;
}
