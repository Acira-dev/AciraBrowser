'use strict';
// R3-59: Tor and private tabs are told apart at a glance. Tokens are in src/styles/toolbar-controls.css (shared by the strip, the compact
// strip, the sidebar and the Tor address field); the real-pixel contrast measurement is C:\ae\r3\tor\cap-tabs.mjs (title contrast on the
// composited tab pixels, rest / hover / selected, both themes). This test keeps the hues apart and the glyph rules in place.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
const strip=read('src/styles/toolbar-controls.css'),side=read('src/components/sidebar/sidebar.css');
const hue=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return 0;const h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360;};
const token=(css,block,name)=>{const m=new RegExp(block.replace(/[.[\]()=]/g,'\\$&')+'\\{[^}]*--'+name+':(#[0-9a-f]{6})').exec(css);assert.ok(m,block+' '+name);return m[1];};
const distance=(a,b)=>{const d=Math.abs(hue(a)-hue(b));return Math.min(d,360-d);};

test('private and Tor washes and marks are far apart on the colour wheel in light and dark',()=>{
 for(const block of ['.app.style-acira','.app.style-acira[data-chrome=dark]']){
  const tw=token(strip,block,'tor-wash'),pw=token(strip,block,'private-wash'),tm=token(strip,block,'tor-mark'),pm=token(strip,block,'private-mark');
  assert.ok(distance(tw,pw)>=70,`${block}: washes ${tw} and ${pw} are ${Math.round(distance(tw,pw))} degrees apart`);
  assert.ok(distance(tm,pm)>=70,`${block}: marks ${tm} and ${pm}`);
  assert.ok(distance(tw,tm)<=25&&distance(pw,pm)<=25,`${block}: each kind keeps one hue between its wash and its mark`);
 }
});

test('tabs wear the wash (not the mark colour) in the strip, the compact strip and the sidebar; the active tab keeps a gentle wash and a ring',()=>{
 assert.match(strip,/--tab-wash:var\(--private-wash\)/);assert.match(strip,/--tab-wash:var\(--tor-wash\)/);
 assert.match(strip,/color-mix\(in srgb,var\(--tab-wash\) var\(--mark-rest\),transparent\)/);
 assert.match(strip,/\.tab-strip-selection\[data-privacy\]\{background:linear-gradient\([^;]*var\(--tab-wash\) var\(--mark-current\)/,'the active strip tab carries the wash');
 assert.match(side,/--sb-wash:var\(--sb-private-wash\)/);assert.match(side,/--sb-wash:var\(--sb-tor-wash\)/);
 assert.match(side,/\[aria-current=true\]\{background:linear-gradient\([^;]*var\(--sb-wash\) var\(--sb-mark-current\)/);
 assert.match(strip,/--tor-field:/,'the Tor address field gradient has its own strength token');
});

test('the glyph sits at the end of the row in the close button’s slot and the x replaces it on hover, without overlap on the active tab',()=>{
 assert.match(strip,/@container \(min-width:105px\)\{[\s\S]*margin-right:-16px;transform:translateX/,'strip: the mark is laid out over the x slot (wide tabs; narrow tabs already overlay the x)');
 assert.match(strip,/\.browser-tab\[data-privacy\]:not\(\.selected\):is\(:hover,:focus-within\)>\.tab-privacy-mark:not\(\.tab-privacy-icon\)\{opacity:0\}/,'strip: hover swaps it for the x');
 assert.match(strip,/\.acira-compact-tab\.selected\[data-privacy\]:is\(:hover,:focus-within\)/,'compact strip');
 assert.match(side,/\.sb-tab:not\(\[aria-current=true\]\) \.sb-tab-mark:has\(\+\.sb-tab-close\)\{margin-right:-20px/,'sidebar: shared slot on resting rows');
 assert.match(side,/:is\(:hover,:has\(:focus-visible\)\) \.sb-tab-mark:has\(\+\.sb-tab-close\)\{opacity:0\}/,'sidebar: hover swaps it for the x');
});

test('Tor’s tab glyph is the onion everywhere; the dot matrix is never a tab icon',()=>{
 const mark=read('src/components/TabPrivacyMark.tsx'),chip=read('src/features/tor/TorChip.tsx');
 assert.doesNotMatch(mark,/DotMatrix/,'no matrix drawn in a tab');assert.match(mark,/<TorGlyph size=\{size\}\/>/);
 assert.match(chip,/export function TorGlyph[\s\S]*strokeWidth=\{1\.5\}[\s\S]*M8 4V1\.9/,'a 1.5px stroke onion with its sprout on the 16px grid');
});

test('P0 28 Oct: a Tor or private mark that slides over the × slot never takes the click (the current Tor tab closes from its ×)',()=>{
 // The marks that overlap the × (margin-right:-16px/-20px, a transform, fading to opacity 0 on hover) paint above it: without this the
 // click on the current compact Tor tab's × landed on the invisible onion and only re-selected the tab (qa/r9-tor-close.mjs).
 assert.ok(/acira-compact-tab\.selected\[data-privacy\][^{]*>\.tab-privacy-mark\{margin-right:-16px/.test(strip),'the overlap this guards still exists (update the test if it goes)');
 assert.match(strip,/\.app :is\(\.browser-tab,\.acira-compact-tab\) :is\(\.tab-privacy-mark,\.tab-privacy-badge\)\{pointer-events:none\}/);
 assert.match(side,/\.acira-sidebar \.sb-tab-mark\{[^}]*pointer-events:none/);
 for(const css of [strip,side])assert.doesNotMatch(css,/(?:tab-privacy-mark|tab-privacy-badge|sb-tab-mark)[^{}]*\{[^}]*pointer-events:auto/,'no later rule gives a mark the pointer back');
});

test('a private window wears the private teal finish, not a violet next to Tor’s purple',()=>{
 const theme=read('src/ui/theme.ts');assert.match(theme,/private:\[\.24,\.035,200\],tor:\[\.24,\.04,310\]/);
});
