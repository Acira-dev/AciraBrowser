import { motion,useIsPresent } from 'motion/react';
import type { ReactNode } from 'react';
import { browserTransition } from '../ui/motion';

/** Reclaim real layout space while fading its contents; never scale text.
 * Exiting controls become inert immediately, before their decorative exit. */
export function MorphSlot({children,axis='height',gap=0,reduced=false,name,className=''}:{children:ReactNode;axis?:'width'|'height';gap?:number;reduced?:boolean;name:string;className?:string}){
 const present=useIsPresent(),margin=axis==='width'?'marginRight':'marginBottom';
 return <motion.div data-morph-slot={name} className={`morph-slot ${className}`} aria-hidden={!present||undefined} inert={!present||undefined}
  style={{overflow:'hidden',minWidth:0,minHeight:0,flexShrink:0,display:axis==='width'?'flex':'flow-root',pointerEvents:present?undefined:'none'}}
  initial={{[axis]:0,opacity:0,[margin]:-gap}}
  animate={{[axis]:'auto',opacity:1,[margin]:0}}
  exit={{[axis]:0,opacity:0,[margin]:-gap}}
  transition={{...browserTransition(reduced),opacity:{duration:reduced?0:present?.16:.1,delay:reduced||!present?0:.055}}}>
  {children}
 </motion.div>;
}
