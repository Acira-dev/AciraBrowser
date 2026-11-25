import type {CSSProperties} from 'react';
import {useLiveRestSrc} from './sealRest';
import type {Rank} from '../../runtime/feedback';
import {NUMBERED_SEALS} from './sealNumbers';
import './seal.css';

/** The rank seals (Beta 14 section AI): five holographic "authenticity seals", thin metal coins with a foil face that shifts colour with angle. Since 15 Nov 22:37 the Insider seal is the BLACK design and the
 * Founding Contributor seal the COMPASS design (sealNumbers.ts SEAL_DESIGN): their full pictures are the cards pack's re-lettered sprites (INSIDER / FOUNDING on the rim), the small forms his own, swapped by
 * rank. Every picture is a supplied one, BYTE FOR BYTE
 * (public/seals/H_<kind>.png, 1024 px, and small_<kind>_64.png, 64 px; public/seals/SOURCE.sha256 holds their hashes and tests/seals-exact.test.cjs checks them): never resized into other files, never recoloured,
 * redrawn, given a glow, a plate or a shadow; they keep their proportions. The only thing done to them is the browser's own scaling to the size a screen asks for. A profile with no rank and no mark shows no seal
 * (the callers decide that; this draws what it is given).
 * Sizes: the FULL render is used at 64 px and above. Below that (the profile menu's 24, the new tab's 20, the ranks list's 48) the seal is a still of the SAME 3D coin the close-up shows (reported 17 Nov: the
 * small forms read as a flat 2D drawing, not the same object): public/seals/s/<kind>_<n>.webp, rendered from public/welcome-coin/live.js at its rest pose and downsampled to every size of SMALL_LADDER
 * (a QA rig: render-masters.mjs, make-ladder.py), so a screen at any scale gets about 1:1 pixels (srcset) and the full render is never scaled down to a small size (it turns to mush). The
 * supplied small forms (small_<kind>_64.png) stay in public/seals, untouched, but are not drawn any more. */
export type SealKind=Rank|'early';
export const SEAL_KINDS:readonly SealKind[]=['contributor','early','trusted','insider','founding'];
export const FULL_FROM=64;
/** The device-pixel sizes the small stills are made at (a QA rig): the browser takes the first at or above what the screen needs. */
export const SMALL_LADDER=[20,24,28,32,36,40,44,48,56,64,72,80,96,112,128,144,160,192] as const;
export const smallFile=(kind:SealKind,px:number)=>`./seals/s/${kind}_${SMALL_LADDER.find(n=>n>=px)??SMALL_LADDER[SMALL_LADDER.length-1]}.webp`;
export const smallSrcSet=(kind:SealKind)=>SMALL_LADDER.map(n=>`./seals/s/${kind}_${n}.webp ${n}w`).join(', ');
/** The coin fills 850 of the full sprite's 1024 px (87 px of transparent margin on every side; the small forms are all coin). A seal's SIZE is the coin's diameter, as on the reference design's sizes sheet (his full tiles are
 * cropped to the coin), so the full sprite is drawn 1024/850 larger than that and the margin is taken back with a negative margin: the layout box is exactly `size`. */
export const COIN=850/1024;
const round=(value:number)=>Math.round(value*1000)/1000;
export const sealStyle=(size:number):CSSProperties=>{const outer=round(size/COIN);return {width:outer,height:outer,margin:round((size-outer)/2)};};
/** Which of the two supplied files draws a seal of this size (CSS px). */
export const sealForm=(size:number):'small'|'full'=>size<FULL_FROM?'small':'full';
/** The member's own number on the seal (AH rule 2: `no` is shown on the card AND the seal): only the full render carries the rim legend legibly, so the per-number file is used from 64 px up; the small
 * forms (the stills of the 3D coin below 64 px) carry no lettering, where four rim digits could not be read. Beta 14.2 (D127): a seal NEVER shows another member's number. Insider and Founding seals of a
 * member with a number come from the number's own rendered file (Insider 1 to 60, Founding 1 to 100: sealNumbers.ts), and ABOVE that range they are drawn by the live coin at its rest pose (sealRest.ts);
 * the plain supplied sprite (it reads No. 0001 / No. 0003) is only for a seal that is given no number at all. */
export type SealRest={how:'small';src:string}|{how:'file';src:string}|{how:'live';number:number}|{how:'plain';src:string};
const isNumber=(number?:number|null):number is number=>Number.isInteger(number)&&(number as number)>=1;
export const numberedSeal=(kind:SealKind,size:number,number?:number|null):string|null=>{
 if(sealForm(size)!=='full'||(kind!=='insider'&&kind!=='founding')||!isNumber(number))return null;
 return number<=NUMBERED_SEALS[kind]?`./seals/H_${kind}_${String(number).padStart(4,'0')}.webp`:null;
};
/** How a seal of this kind, size and number is drawn at rest. */
export const sealRest=(kind:SealKind,size:number,number?:number|null):SealRest=>{
 if(sealForm(size)==='small')return {how:'small',src:smallFile(kind,Math.ceil(size*2))};
 if(kind==='insider'||kind==='founding'){
  if(isNumber(number)){const own=numberedSeal(kind,size,number);return own?{how:'file',src:own}:{how:'live',number};}
 }
 return {how:'plain',src:`./seals/H_${kind}.png`};
};
/** The picture's URL when a file draws it; null when the live coin has to (a number above the rendered range: use `useSealSrc` or `<Seal>`). */
export const sealSource=(kind:SealKind,size:number,number?:number|null):string|null=>{
 const rest=sealRest(kind,size,number);
 return rest.how==='live'?null:rest.src;
};
/** The seal's picture URL at rest for any number: a file at once, the live coin's picture (null until it is ready) above the rendered range. Hooks: call it at the top of a component. */
export function useSealSrc(kind:SealKind,size:number,number?:number|null,opts:{delayMs?:number;skipLive?:boolean}={}):string|null{
 const rest=sealRest(kind,size,number);
 const live=useLiveRestSrc(rest.how==='live'&&!opts.skipLive&&(kind==='insider'||kind==='founding')?kind:null,rest.how==='live'?rest.number:null,opts.delayMs);
 return rest.how==='live'?live:rest.src;
}

/** `skipLive`: no picture is made for a number above the rendered range (the caller shows the live coin itself: the seal screen, which draws it at once and needs no second one under it). */
export function Seal({kind,size,number=null,className='',style,skipLive=false}:{kind:SealKind;size:number;number?:number|null;className?:string;style?:CSSProperties;skipLive?:boolean}){
 const form=sealForm(size),rest=sealRest(kind,size,number),src=useSealSrc(kind,size,number,{skipLive});
 return <img className={`seal ${className}`.trim()} data-kind={kind} data-form={form} data-rest={rest.how==='live'?'live':undefined} data-pending={rest.how==='live'&&src===null?'':undefined} data-number={rest.how==='file'||rest.how==='live'?number??undefined:undefined} src={src??undefined} srcSet={form==='small'?smallSrcSet(kind):undefined} sizes={form==='small'?`${size}px`:undefined} width={form==='full'?undefined:size} height={form==='full'?undefined:size} alt="" aria-hidden="true" draggable={false} decoding="async" style={form==='full'?{...sealStyle(size),...style}:style}/>;
}
