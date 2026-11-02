import type { CSSProperties } from 'react';

/** Acira brand built from the supplied canonical paths (resources/brand/build-brand-assets.mjs).
 * Variants: lockup (symbol + wordmark) · mark (framed symbol, hero/brand slots) · icon (favicon-sized symbol for
 * internal tabs, menus and other 12–20px slots).
 * Tone follows the brand rule automatically: on dark, burgundy and other deep surfaces the whole logo is white; on
 * light neutral surfaces the symbol keeps its gradient and the wordmark is dark. The surface tone comes from the
 * inherited `--brand-tone` (dark | light), which the theme sets for chrome, sidebar and Acira pages; a caller can
 * still force tone="white" | "color", or tone="mono" to take the surrounding ink. Each variant is a self-contained
 * SVG file, so gradient ids never collide and only one image ever displays. */
export type BrandVariant='lockup'|'mark'|'icon';
export type BrandTone='auto'|'color'|'white'|'mono';
const files:Record<BrandVariant,{color:string;white:string}>={
 lockup:{color:'./acira-logo.svg',white:'./acira-logo-light.svg'},
 mark:{color:'./acira-symbol.svg',white:'./acira-symbol-white.svg'},
 icon:{color:'./acira-icon.svg',white:'./acira-icon-white.svg'},
};

export function BrandLogo({mark=false,variant=mark?'mark':'lockup',size,tone='auto',className='',label='Acira'}:{mark?:boolean;variant?:BrandVariant;size?:number;tone?:BrandTone;className?:string;label?:string}){
 const style=size?{'--brand-size':`${size}px`} as CSSProperties:undefined,source=files[variant];
 const classes=`brand-logo ${variant==='lockup'?'':'brand-symbol'} ${className}`;
 if(tone==='mono')return <span className={`${classes} brand-mono`} data-acira-brand={variant} role="img" aria-label={label} style={{...style,'--brand-mask':`url('${source.color}')`} as CSSProperties}/>;
 return <span className={classes} data-acira-brand={variant} data-brand-tone={tone} role="img" aria-label={label} style={style}>
  {tone!=='white'&&<img className="brand-light" src={source.color} alt="" aria-hidden="true" draggable={false}/>}
  {tone!=='color'&&<img className="brand-dark" src={source.white} alt="" aria-hidden="true" draggable={false}/>}
 </span>;
}

/** Icon-only Acira mark for internal pages and small UI slots. */
export function BrandIcon({size=16,tone='auto',className=''}:{size?:number;tone?:BrandTone;className?:string}){
 return <BrandLogo variant="icon" size={size} tone={tone} className={className}/>;
}
