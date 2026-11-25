'use strict';
// The frost behind the one-time "Welcome to Beta 14" screen (brief section AL). The whole window (the interface and every visible page) turns into
// frosted glass and the welcome sits straight on it. Ported from the approved sample's frost layer (round 12) with exactly its look and motion; the
// sample's other rounds (equaliser, bloom, top light, veil, contrast flattening, the g1/g3 ladders, test switches) are gone, they were switched off in
// the approved look.
//
// What it is: a still of the window, captured once at full resolution (popupBackdropSources: the interface view and every visible page), laid out in
// ONE transparent native layer above the pages and under the popup host, then blurred and tinted. The first painted frame of the layer is the unblurred
// copy, identical to the live window, so the hand-over from the live window to the still is invisible; only then the blur and the tint ramp in together.
// Leaving is the exact reverse, and the layer hides once the copy is sharp and transparent again.
//
// Where every value comes from (the reference sample, 15 Nov 2026):
//   sigma 48          the glass is ONE true gaussian blur of the window, sigma 48 CSS px (72 device px at 150%): nothing readable shows through and no
//                     interface edge is traceable. Built as the sample builds it: downsample by 16 in two smooth steps, then three gaussian passes of
//                     sigma / sqrt(3) each, upsample in two smooth steps.
//   P = 160           the blur source is extended past every window edge (clamp-to-edge: the outer row and column are stretched outward). Without it
//                     the edges go dark or crop.
//   base colours      the interface's translucent (acrylic) areas are captured transparent and laid over the window's own base colour, #1b1b1e dark and
//                     #f2f2f4 light, as the screen shows them. Without it a light sidebar blurs into a grey slab.
//   pages + 14 px     in the blur source every page is drawn 14 px larger on each side and unclipped, so the thin dark gutter and the rounded corner
//                     around each page cannot survive any blur as a soft frame.
//   dark   saturation 1.65, brightness 0.65, tint rgb(10 12 20 / .37)
//   light  saturation 1.45, brightness 1.00, tint rgb(255 255 255 / .49)
//                     "the most transparent values that keep body text at 4.5:1 or better over white, busy and dark pages": the ladder's most
//                     transparent step (.30 / .72) failed (3.4-3.9:1), each step back of .01 down to .36 still failed over a busy page, .37 / .65 is the
//                     first that passes everywhere; light .46 failed over a dark page, .49 is the first that passes. ONE uniform tint, brightness and
//                     saturation on every pixel.
//   soften 28         while the ramp runs the sharp copy softens with blur(28px) and dissolves into the settled glass image (and back when leaving).
//   dither +-1        the settled image is dithered with interleaved-gradient noise of +-1 level so the long gradients cannot band.
//   620 ms            the ramp in: cubic-bezier(.2,0,0,1); the ramp out is the exact reverse in time with cubic-bezier(.4,0,.2,1). Reduced motion (the
//                     Acira setting, the OS, or animation speed "off") is no ramp at all; animation speed "fast" halves it. On the way out the sharp copy
//                     fades out over the last 45% (after a delay of 55%), so a page that changed underneath returns without a jump.
//   Off, and meant to stay off: no veil of the page's mean colour, no contrast flattening, no top-down light, no bloom, NO gradient, vignette, pool, glow
//   disc or any local shape in or over the frost, ever (the team rejected a dark ellipse behind the text outright: the glass may only show what is
//   behind it, softly). Readability comes from the uniform tint and the text's own soft shadow (the welcome's CSS), never from a shape.
//
// The fallback (reduced transparency, high contrast, or a window that cannot be captured): popupBackdropSources answers nothing in those cases (and
// nothing could be captured), and the welcome must still show. Then the layer is FLAT: the window's base colour with the same tint colour over it, no
// blur, no capture, fading in and out on the same clock and curves. Nothing else is invented: no other colour, no mean of the window. It is for those
// settings only; with them off, the glass above is the only look.
//
// Opening: the layer starts when the welcome's own page says it has opened (open(), through the 'opened' request of desktop/welcome-service.cjs),
// never from the layout alone, and only for the 'welcome' overlay of that announcement. One frost per overlay id; a closing welcome never frosts again.
const BASE = Object.freeze({ dark: '#1b1b1e', light: '#f2f2f4' });
/** The one source of the frost's values (see the header). sigma and soften are CSS px. */
const LOOKS = Object.freeze({
  dark: Object.freeze({ sigma: 48, soften: 28, saturate: 1.65, brightness: .65, tint: 'rgb(10 12 20 / .37)' }),
  light: Object.freeze({ sigma: 48, soften: 28, saturate: 1.45, brightness: 1, tint: 'rgb(255 255 255 / .49)' }),
});
const TIMING = Object.freeze({ rampMs: 620, curveIn: 'cubic-bezier(.2,0,0,1)', curveOut: 'cubic-bezier(.4,0,.2,1)', copyFadeDelay: .55, copyFadeLength: .45 });
const KIND = 'welcome';
const PARTITION = 'acira-welcome-frost';

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
#f{position:fixed;inset:0;opacity:0}
#f>.k,#f>.s{position:absolute;inset:0}
#t{position:fixed;inset:0;opacity:0;pointer-events:none}
</style><div id="f"><div class="s"></div><div class="k"></div></div><div id="t"></div>
<script>
const f=document.getElementById('f'),k=f.querySelector('.k'),s=f.querySelector('.s'),t=document.getElementById('t');
const IN='${TIMING.curveIn}',OUT='${TIMING.curveOut}',DELAY=${TIMING.copyFadeDelay},LENGTH=${TIMING.copyFadeLength};
const SHARP='blur(0px) saturate(1) brightness(1)';
let state=null,seq=0;
// ONE composite of the window at device pixels (chrome, then every page), over the window's base colour, extended past the window by repeating its
// own border pixels (clamp-to-edge), so the blur never meets a layer bound or a transparent border. No scale: nothing slides while the blur is small.
const P=160;
const compose=async(o)=>{const W=innerWidth,H=innerHeight,dpr=devicePixelRatio||1;
  const imgs=await Promise.all(o.layers.map(l=>new Promise(r=>{const i=new Image();i.onload=()=>r([l,i]);i.onerror=()=>r([l,null]);i.src=l.src;})));
  const c=document.createElement('canvas');c.width=Math.round((W+2*P)*dpr);c.height=Math.round((H+2*P)*dpr);
  const x=c.getContext('2d');x.imageSmoothingQuality='high';const p=Math.round(P*dpr),w=Math.round(W*dpr),h=Math.round(H*dpr);
  x.save();x.translate(p,p);x.scale(dpr,dpr);
  // the interface's translucent (acrylic) areas arrive transparent (PNG); the window's own base colour goes under everything, as the screen shows it
  x.fillStyle=o.base;x.fillRect(-P,-P,W+2*P,H+2*P);
  for(const [l,i] of imgs){if(!i)continue;x.save();if(l.r){x.beginPath();x.roundRect(l.x,l.y,l.w,l.h,l.r);x.clip();}x.drawImage(i,l.x,l.y,l.w,l.h);x.restore();}
  x.restore();
  // clamp-to-edge: the outer row/column of the window, stretched outwards; corners from the corner pixel
  x.drawImage(c,p,p,w,1,p,0,w,p);x.drawImage(c,p,p+h-1,w,1,p,p+h,w,p);
  x.drawImage(c,p,0,1,h+2*p,0,0,p,h+2*p);x.drawImage(c,p+w-1,0,1,h+2*p,p+w,0,p,h+2*p);
  Object.assign(c.style,{position:'absolute',left:-P+'px',top:-P+'px',width:(W+2*P)+'px',height:(H+2*P)+'px'});return c;};
// The settled glass: the composite (pages drawn 14 px larger, see set) reduced to 1/16 in two smooth steps, clamp-padded and blurred in THREE gaussian
// passes (sigma_total = look.sigma CSS px), the look's saturation and brightness baked into the last pass; upsampled in two smooth steps and dithered
// with interleaved noise of +-1 level so the long ramps of tone cannot band. No per-region step of any kind.
const frostImage=(kc,L)=>{const dpr=devicePixelRatio||1,S=16,W2=kc.width,H2=kc.height,w=Math.ceil(W2/S),h=Math.ceil(H2/S);
  const q4=document.createElement('canvas');q4.width=Math.ceil(W2/4);q4.height=Math.ceil(H2/4);const q4x=q4.getContext('2d');q4x.imageSmoothingQuality='high';q4x.drawImage(kc,0,0,q4.width,q4.height);
  const sigT=L.sigma*dpr/S,sig=sigT/Math.sqrt(3),pad=Math.ceil(sigT*3)+2;
  const pc=document.createElement('canvas');pc.width=w+2*pad;pc.height=h+2*pad;const px=pc.getContext('2d',{willReadFrequently:true});px.imageSmoothingQuality='high';
  const clamp=()=>{px.drawImage(pc,pad,pad,w,1,pad,0,w,pad);px.drawImage(pc,pad,pad+h-1,w,1,pad,pad+h,w,pad);px.drawImage(pc,pad,0,1,h+2*pad,0,0,pad,h+2*pad);px.drawImage(pc,pad+w-1,0,1,h+2*pad,pad+w,0,pad,h+2*pad);};
  px.drawImage(q4,pad,pad,w,h);clamp();
  const tmp=document.createElement('canvas');tmp.width=pc.width;tmp.height=pc.height;const tx=tmp.getContext('2d');
  for(let n=0;n<3;n++){tx.clearRect(0,0,tmp.width,tmp.height);tx.filter='blur('+sig.toFixed(2)+'px)'+(n===2?' saturate('+L.saturate+') brightness('+L.brightness+')':'');tx.drawImage(pc,0,0);tx.filter='none';
    px.clearRect(0,0,pc.width,pc.height);px.drawImage(tmp,pad,pad,w,h,pad,pad,w,h);clamp();}
  const d=px.getImageData(pad,pad,w,h),a=d.data;for(let i=3;i<a.length;i+=4)a[i]=255;
  const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').putImageData(d,0,0);
  const u=document.createElement('canvas');u.width=Math.ceil(W2/4);u.height=Math.ceil(H2/4);const ux=u.getContext('2d');ux.imageSmoothingQuality='high';ux.drawImage(c,0,0,u.width,u.height);
  const o=document.createElement('canvas');o.width=W2;o.height=H2;const ox=o.getContext('2d',{willReadFrequently:true});ox.imageSmoothingQuality='high';ox.drawImage(u,0,0,W2,H2);
  const D=ox.getImageData(0,0,W2,H2),q=D.data;
  for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){const i=(y*W2+x)*4,g=(52.9829189*((0.06711056*x+0.00583715*y)%1))%1,nn=g<1/3?-1:g<2/3?0:1;q[i]+=nn;q[i+1]+=nn;q[i+2]+=nn;q[i+3]=255;}
  ox.putImageData(D,0,0);o.style.cssText=kc.style.cssText;return o;};
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
window.frost={
  // o: {dark, base, look, flat, layers}. Lays the still out under the live window's own look; nothing is visible until go().
  async set(o){
    const mine=++seq,alive=()=>mine===seq;state=o;
    for(const el of [f,t,k])el.style.transition='none';
    f.style.opacity='0';t.style.opacity='0';k.style.filter=SHARP;k.style.opacity='1';t.style.background=o.look.tint;k.innerHTML='';s.innerHTML='';s.style.background='';
    if(o.flat){s.style.background=o.base;k.style.opacity='0';await frame();return alive()?1:0;}
    // the sharp copy (bridges the open and the close) and, from one composite with every page drawn 14 px larger and unclipped (so the card's corner gaps and
    // gutter are filled), the settled glass image
    const kc=await compose(o);if(!alive())return 0;k.appendChild(kc);
    const fc=await compose({...o,layers:o.layers.map(l=>l.key==='page'?{...l,x:l.x-14,y:l.y-14,w:l.w+28,h:l.h+28,r:0}:l)});if(!alive())return 0;
    s.appendChild(frostImage(fc,o.look));
    await frame();if(!alive())return 0;
    f.style.opacity='1';                                   // the copy, sharp: identical to the live window
    await frame();
    return alive()?1:0;
  },
  // on: the ramp in; off: the exact reverse. ms 0 = no ramp (reduced motion).
  go(on,ms){
    if(!state)return 0;const L=state.look,curve=on?IN:OUT,tr=ms+'ms '+curve;
    t.style.transition='opacity '+tr;t.style.opacity=on?'1':'0';
    if(state.flat){f.style.transition='opacity '+tr;f.style.opacity=on?'1':'0';return 1;}
    k.style.transition='filter '+tr+', opacity '+tr;
    // the sharp copy softens and dissolves into the glass image underneath (reverse on close)
    k.style.filter=on?'blur('+L.soften+'px) saturate('+L.saturate+') brightness('+L.brightness+')':SHARP;k.style.opacity=on?'0':'1';
    // leaving: the sharp copy fades out over the last part, so a page that changed underneath returns without a jump
    f.style.transition=on?'none':'opacity '+Math.round(ms*LENGTH)+'ms linear '+Math.round(ms*DELAY)+'ms';if(!on)f.style.opacity='0';
    return 1;
  },
};
</script>`;

/** The ramp's length in ms: none under reduced motion, halved by animation speed "fast". */
const rampMs = (reduced, pace) => reduced ? 0 : Math.round(TIMING.rampMs * (pace || 1));
/** The overlay's identity for "one frost per overlay": its generation id (0 when it has none). */
const keyOf = (overlay) => Number.isSafeInteger(overlay?.id) && overlay.id > 0 ? overlay.id : 0;

/**
 * @param {object} deps
 * @param {Function} deps.WebContentsView  Electron's class (injected so tests can fake it)
 * @param {() => object|null} deps.getWindow  the window whose content the frost covers
 * @param {() => Array<{key:string,contents:object,bounds:object,radius?:number}>} deps.sources  popupBackdropSources: bounds in the interface's CSS px
 * @param {(what:'in'|'away') => void} [deps.notify]  'in': the ramp has begun; 'away': a click on the frost, outside the welcome's frame
 * @param {() => boolean} [deps.reducedMotion]
 * @param {() => number} [deps.motionPace]  1, or .5 for animation speed "fast"
 * @param {() => number} [deps.scale]  the interface scale: sources' bounds are in the interface's CSS px, the layer is in window DIP
 * @param {() => void} [deps.refocus]  puts the keyboard back on the welcome after a click on the frost (a click on a view moves focus into it)
 * @param {() => void} [deps.raise]  raises the popup host again: a view added to the window lands on top, and the frost must stay directly under the popup
 */
function createWelcomeFrost({ WebContentsView, getWindow, sources, notify = () => {}, reducedMotion = () => false, motionPace = () => 1, scale = () => 1, refocus = () => {}, raise = () => {} }) {
  let view = null, loaded = null, forId = null, announced = null, hideTimer = null, phase = 'off', gen = 0;
  const live = () => view && !view.webContents.isDestroyed();
  function ensure() {
    const win = getWindow(); if (!win || win.isDestroyed()) return null;
    if (!live()) {
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: true, partition: PARTITION, backgroundThrottling: false } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      loaded = new Promise(res => contents.once('did-finish-load', res));
      contents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
      contents.on('will-navigate', (event) => event.preventDefault());
      contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE)).catch(() => {});
      // a click on the frost (outside the welcome's frame) is a click away; the keyboard goes back to the welcome
      contents.on('input-event', (_event, input) => { if (input.type === 'mouseDown' && phase === 'on') { try { notify('away'); } catch {} try { refocus(); } catch {} } });
    }
    if (!win.contentView.children.includes(view)) { win.contentView.addChildView(view); try { raise(); } catch {} }
    return view;
  }
  const ms = () => rampMs(reducedMotion(), motionPace());
  /** The welcome's own page has opened: this overlay may frost (once). */
  function announce(overlay) { announced = overlay?.kind === KIND ? keyOf(overlay) : null; }
  /** The welcome's page says it opened: announce its overlay and frost it. */
  function open(overlay, appearance) { announce(overlay); return update(overlay, appearance); }
  /** On every applied layout. A 'welcome' overlay that has announced itself: frost in (once per overlay id). Anything else ends a frost that is on. */
  async function update(overlay, appearance) {
    const want = overlay?.kind === KIND && announced !== null && keyOf(overlay) === announced;
    if (!want) { if (phase === 'on' || phase === 'capturing') leave(); return; }
    if (forId === keyOf(overlay)) { keepUnder(); return; }   // one frost per welcome; a closing welcome never frosts again
    forId = keyOf(overlay); phase = 'capturing'; const mine = ++gen; clearTimeout(hideTimer);
    const layer = ensure(); if (!layer) { phase = 'off'; return; }
    const win = getWindow(), c = win.getContentBounds(), dark = appearance === 'dark', k = Number(scale()) || 1;
    layer.setBounds({ x: 0, y: 0, width: c.width, height: c.height });
    const list = sources();
    const layers = (await Promise.all(list.map(async (s) => {
      try {
        const img = await s.contents.capturePage(); if (img.isEmpty()) return null;
        const page = s.key.startsWith('page');
        return { key: page ? 'page' : s.key, src: page ? 'data:image/jpeg;base64,' + img.toJPEG(93).toString('base64') : 'data:image/png;base64,' + img.toPNG().toString('base64'), x: s.bounds.x * k, y: s.bounds.y * k, w: s.bounds.width * k, h: s.bounds.height * k, r: (s.radius || 0) * k };
      } catch { return null; }
    }))).filter(Boolean);
    if (mine !== gen || !live()) return;
    await loaded;
    if (mine !== gen || !live()) return;
    layer.setVisible(true); try { raise(); } catch {}
    const payload = { dark, base: BASE[dark ? 'dark' : 'light'], look: LOOKS[dark ? 'dark' : 'light'], flat: layers.length === 0, layers };
    await layer.webContents.executeJavaScript('frost.set(' + JSON.stringify(payload) + ')').catch(() => 0);
    if (mine !== gen || !live()) return;
    await layer.webContents.executeJavaScript('frost.go(true, ' + ms() + ')').catch(() => 0);
    if (mine !== gen || !live()) return;
    phase = 'on';
    notify('in');
  }
  /** The popup host is raised after every layout (raiseLayers) and again whenever this layer is added, so the frost stays directly under it; nothing to do. */
  function keepUnder() {}
  /** The layer's page holds a few full-window canvases: it is let go as soon as nothing is on screen (the welcome shows once; a later one makes it again). */
  function dropView() {
    if (view) { try { getWindow()?.contentView.removeChildView(view); } catch {} try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch {} }
    view = null; loaded = null;
  }
  /** The welcome starts leaving (its own page says so), or its overlay is gone: the exact reverse. */
  function leave() {
    if (!live() || phase === 'off' || phase === 'leaving') return;
    const capturing = phase === 'capturing'; ++gen; clearTimeout(hideTimer);
    if (capturing) { view.setVisible(false); phase = 'off'; dropView(); return; }   // nothing is on screen yet: drop the pending frost
    const m = ms(); phase = 'leaving';
    void view.webContents.executeJavaScript('frost.go(false, ' + m + ')').catch(() => 0);
    hideTimer = setTimeout(() => { if (phase === 'leaving') { if (live()) view.setVisible(false); phase = 'off'; dropView(); } }, m + 60);
  }
  /** The window changed size while the welcome is up: the layer follows the window (the glass is a blurred picture, so stretching it by a few pixels shows nothing). */
  function refit() {
    if (!live() || phase === 'off') return;
    const win = getWindow(); if (!win || win.isDestroyed()) return;
    const c = win.getContentBounds(); try { view.setBounds({ x: 0, y: 0, width: c.width, height: c.height }); } catch {}
  }
  function destroy() {
    clearTimeout(hideTimer); ++gen; dropView();
    phase = 'off'; forId = null; announced = null;
  }
  return { update, open, leave, refit, destroy, get phase() { return phase; } };
}

module.exports = { createWelcomeFrost, LOOKS, BASE, TIMING, KIND, PARTITION, FROST_PAGE: PAGE, rampMs };
