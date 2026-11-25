// @ts-nocheck
// What a card needs before it can be drawn: its four typefaces (the card's own artwork, all SIL Open Font Licence, bundled), the two SVG
// filters the Early card's hand-drawn pass uses (they live in the document because canvas filters name them by id), and the logo outlines.
import oxanium from '../fonts/oxanium-latin-wght-normal.woff2?url';
import geist from '../fonts/geist-latin-wght-normal.woff2?url';
import geistMono from '../fonts/geist-mono-latin-wght-normal.woff2?url';
import architects from '../fonts/architects-daughter-latin-400-normal.woff2?url';
import legendFont from '../fonts/legend-stand-in-500.woff2?url';
import { loadLogo } from './sys12.js';
import { preloadR18 } from './cards16.js';

const FACES = [['Oxanium', oxanium, '200 800'], ['Card Sans', geist, '100 900'], ['Card Mono', geistMono, '100 900'], ['Architects Daughter', architects, '400']];
// the sample page's two filters, unchanged
const FILTERS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
 <filter id="acira-card-hand" filterUnits="userSpaceOnUse" x="0" y="0" width="1600" height="2400" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.0045" numOctaves="2" seed="7" result="w"/>
  <feDisplacementMap in="SourceGraphic" in2="w" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.018 0.018" numOctaves="2" seed="21" result="p"/>
  <feColorMatrix in="p" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.5 0 0 0 0.05" result="pa"/>
  <feComposite in="d" in2="pa" operator="in" result="d2"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="3" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.1 0 0 0 0.35" result="ga"/>
  <feComposite in="d2" in2="ga" operator="in"/>
 </filter>
 <filter id="acira-card-tooth" filterUnits="userSpaceOnUse" x="0" y="0" width="1600" height="2400">
  <feTurbulence type="fractalNoise" baseFrequency="0.7 0.5" numOctaves="2" seed="11"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.36  0 0 0 0 0.36  0.18 0 0 0 -0.06"/>
 </filter>
</svg>`;
let ready = null;
export function loadCardResources() {
  if (ready) return ready;
  ready = (async () => {
    if (!document.getElementById('acira-card-filters')) { const host = document.createElement('div'); host.id = 'acira-card-filters'; host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'; host.innerHTML = FILTERS; document.body.appendChild(host); }
    const faces = FACES.map(([family, url, weight]) => new FontFace(family, `url(${url})`, { weight, display: 'block' }));
    await Promise.all(faces.map((f) => f.load())); faces.forEach((f) => document.fonts.add(f));
    // the rim legend of the Insider and Founding tokens: his Windows-only Bahnschrift is replaced, as in the approved seal renders, by Barlow Condensed Medium at size-adjust 108 %
    if (!document.getElementById('acira-card-legend-font')) { const st = document.createElement('style'); st.id = 'acira-card-legend-font'; st.textContent = `@font-face{font-family:"Card Legend";src:url(${legendFont});font-weight:100 900;font-stretch:50% 200%;size-adjust:108%}`; document.head.appendChild(st); }
    await document.fonts.load('600 40px "Card Legend"'); await document.fonts.load('500 40px "Card Legend"');
    await document.fonts.ready;
    await loadLogo(); await preloadR18();
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
