'use strict';
// A badge colour as Chrome takes it: [r, g, b, a] (0-255 integers) or a CSS colour string (#rgb[a], #rrggbb[aa], rgb(), rgba(), hsl(), hsla(), a name).
const NAMED=('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,'
 +'blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,'
 +'cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,'
 +'darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,'
 +'darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,'
 +'gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,'
 +'indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,'
 +'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,'
 +'lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,'
 +'mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,'
 +'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,'
 +'olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,'
 +'papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,'
 +'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,'
 +'slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,'
 +'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32').split(',').reduce((map,entry)=>{const [name,hex]=entry.split(':');map[name]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));return map;},{});

const byte=n=>Number.isInteger(n)&&n>=0&&n<=255;
const clamp=(n,low,high)=>Math.min(high,Math.max(low,n));
function hsl(h,s,l){
 h=((h%360)+360)%360/360;s=clamp(s,0,1);l=clamp(l,0,1);
 const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q,channel=t=>{t=(t+1)%1;const v=t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;return Math.round(v*255);};
 return [channel(h+1/3),channel(h),channel(h-1/3)];
}
const alpha=text=>text===undefined?255:Math.round(clamp(text.endsWith('%')?parseFloat(text)/100:parseFloat(text),0,1)*255);

/** The colour as [r, g, b, a], or null when it cannot be read. */
function parseColor(value){
 if(Array.isArray(value))return value.length===4&&value.every(byte)?[...value]:null;
 if(typeof value!=='string')return null;
 const s=value.trim().toLowerCase();
 if(s==='transparent')return [0,0,0,0];
 if(NAMED[s])return [...NAMED[s],255];
 let m=/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
 if(m){let h=m[1];if(h.length<=4)h=[...h].map(c=>c+c).join('');return [0,2,4,6].map(i=>i<h.length?parseInt(h.slice(i,i+2),16):255);}
 m=/^rgba?\(\s*(\d{1,3}(?:\.\d+)?%?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?%?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
 if(m){const rgb=m.slice(1,4).map(n=>(n.endsWith('%')?Math.round(clamp(parseFloat(n),0,100)*2.55):Math.round(parseFloat(n))));return rgb.every(byte)?[...rgb,alpha(m[4])]:null;}
 m=/^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
 if(m)return [...hsl(parseFloat(m[1]),parseFloat(m[2])/100,parseFloat(m[3])/100),alpha(m[4])];
 return null;
}
/** [r, g, b, a] as a CSS colour. */
const toCss=([r,g,b,a])=>`rgba(${r}, ${g}, ${b}, ${Math.round(a/255*1000)/1000})`;

module.exports={parseColor,toCss};
