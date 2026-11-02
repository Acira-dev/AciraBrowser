/** Parse the sRGB forms emitted by our tokens and getComputedStyle. Alpha is
 * explicit so contrast checks cannot silently measure a translucent raw token. */
export function parseColor(value:string):{channels:number[];alpha:number}|undefined{
 const hex=/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim());
 if(hex){const h=hex[1].length<=4?hex[1].split('').map(c=>c+c).join(''):hex[1];return{channels:[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)),alpha:h.length===8?parseInt(h.slice(6),16)/255:1};}
 const css=/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(value.trim());
 if(css){const channels=css.slice(1,4).map(n=>n.endsWith('%')?parseFloat(n)*255/100:Number(n)),alpha=css[4]===undefined?1:css[4].endsWith('%')?parseFloat(css[4])/100:Number(css[4]);if(channels.every(n=>n>=0&&n<=255)&&alpha>=0&&alpha<=1)return{channels,alpha};}
 const srgb=/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(value.trim());
 if(srgb){const channels=srgb.slice(1,4).map(n=>Number(n)*255),alpha=srgb[4]===undefined?1:Number(srgb[4]);if(channels.every(n=>n>=0&&n<=255)&&alpha>=0&&alpha<=1)return{channels,alpha};}
 if(value.trim()==='transparent')return{channels:[0,0,0],alpha:0};
}
export function rgb(value:string):number[]{return parseColor(value)?.channels||[98,102,109];}
export function luminance(value:string){const color=parseColor(value);if(color&&color.alpha<1)throw new Error('Composite translucent colors before measuring contrast');const c=rgb(value).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
export function compositeColor(foreground:string,background:string){
 const front=parseColor(foreground),back=parseColor(background);
 if(!front||!back||back.alpha<1)throw new Error('Color composition requires a supported foreground and an opaque background');
 return '#'+front.channels.map((v,i)=>Math.round(v*front.alpha+back.channels[i]*(1-front.alpha)).toString(16).padStart(2,'0')).join('');
}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function mix(a:string,b:string,f:number){const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v*f+y[i]*(1-f)).toString(16).padStart(2,'0')).join('');}
const encode=(v:number)=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
export function toOklch(hex:string):[number,number,number]{
 const [r,g,b]=rgb(hex).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}),l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b),L=.2104542553*l+.793617785*m-.0040720468*s,a=1.9779984951*l-2.428592205*m+.4505937099*s,B=.0259040371*l+.7827717662*m-.808675766*s;
 return [L,Math.hypot(a,B),Math.atan2(B,a)];
}
/** Reduce chroma at constant hue/lightness until the result is in sRGB gamut. */
export function fromOklch(L:number,C:number,h:number){
 const raw=(c:number)=>{const a=c*Math.cos(h),b=c*Math.sin(h),l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];};
 let values=raw(C);if(values.some(v=>v<0||v>1)){let low=0,high=C;for(let i=0;i<20;i++){const mid=(low+high)/2;if(raw(mid).every(v=>v>=0&&v<=1))low=mid;else high=mid;}values=raw(low);}
 return '#'+values.map(encode).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
}
