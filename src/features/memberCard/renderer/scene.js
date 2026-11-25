// @ts-nocheck
// Beta 14 member cards: the scene. Ported from the sample pack's card12.js (the reference sample, round r19).
// The vertex and fragment shaders below are his, character for character. What changed: no module-level renderer (a card makes its own, so the
// page owns the WebGL context and can dispose it), the backdrop is optional (the app draws the card on its own surface; the saved picture clips
// the corners), the soft shadow is made once and only moved while the card tilts, and the card's plates can be repainted (the Founding number's foil).
import * as THREE from 'three';
// His scene is display-referred: the shaders write sRGB themselves, every texture is raw (NoColorSpace) and every colour below is set with NoColorSpace too, so the scene does not depend on
// three's global ColorManagement switch (his coin renderer, coin.js, wants it on, as it is by default).

export const CW = 1.0, CH = 1.5, RAD = 0.059, THICK = 0.014;

const VS = `
varying vec2 vUv; varying vec3 vW; varying vec3 vT; varying vec3 vB; varying vec3 vN;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
  mat3 m = mat3(modelMatrix); vT = normalize(m*vec3(1,0,0)); vB = normalize(m*vec3(0,1,0)); vN = normalize(m*vec3(0,0,1));
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
precision highp float;
varying vec2 vUv; varying vec3 vW; varying vec3 vT; varying vec3 vB; varying vec3 vN;
uniform sampler2D uCol, uMap, uAux; uniform vec2 uTexel; uniform vec3 uCam, uL; uniform float uKind, uGloss, uBump, uSeed, uSat, uEnvRot, uPaper, uFoilGain;
uniform vec3 uTint; uniform float uFlat; uniform float uHoloMix;
uniform vec3 uMetC, uHiC, uGuil; uniform float uCustom; uniform vec4 uRing; uniform float uClear; uniform float uSmooth;
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = fract(sin(dot(i, vec2(12.9898,78.233)))*43758.5453), b = fract(sin(dot(i+vec2(1.,0.), vec2(12.9898,78.233)))*43758.5453);
  float c = fract(sin(dot(i+vec2(0.,1.), vec2(12.9898,78.233)))*43758.5453), d = fract(sin(dot(i+vec2(1.,1.), vec2(12.9898,78.233)))*43758.5453);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.0)-3.0)-1.0, 0.0, 1.0); return v*mix(vec3(1.0), k, s); }
vec3 spectral(float x){ // Acira holo: gold -> green -> cyan -> blue -> violet and back; never pink/red
  float t = abs(fract(x)*2.0 - 1.0); float h = (52.0 + 218.0*t)/360.0;
  return hsv(h, 0.62, 1.0); }
float env(vec3 R){
  float r = uEnvRot; vec3 q = vec3(cos(r)*R.x - sin(r)*R.z, R.y, sin(r)*R.x + cos(r)*R.z);
  float base = 0.32 + 0.22*q.y;
  float s1 = 1.6*exp(-pow((q.x-0.42)/0.085,2.0))*smoothstep(-0.7,0.1,q.y);
  float s2 = 0.9*exp(-pow((q.x+0.50)/0.14,2.0))*smoothstep(-0.5,0.4,q.y);
  float s3 = 1.1*exp(-pow((q.y-0.62)/0.10,2.0));
  float s4 = 0.5*exp(-pow((q.x-0.05)/0.05,2.0))*smoothstep(0.0,0.6,q.y);
  return base + s1 + s2 + s3 + s4; }
float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 c = texture2D(uCol, vUv); if (c.a < 0.004) discard;
  vec4 m = texture2D(uMap, vUv);
  float hx = texture2D(uMap, vUv+vec2(uTexel.x,0.)).b - texture2D(uMap, vUv-vec2(uTexel.x,0.)).b;
  float hy = texture2D(uMap, vUv+vec2(0.,uTexel.y)).b - texture2D(uMap, vUv-vec2(0.,uTexel.y)).b;
  vec3 N = normalize(vN - uBump*(hx*vT + hy*vB));
  vec3 V = normalize(uCam - vW); vec3 R = reflect(-V, N); vec3 L = normalize(uL);
  float e = env(R);
  vec3 base = toLin(c.rgb / max(c.a, 1e-3));
  float dif = 0.80 + 0.28*max(dot(N, L), 0.0);
  float grain = (hsh(floor(vUv*vec2(1600.,2400.))) - 0.5) * uPaper;
  vec3 paper = base * (dif + grain) + uGloss * 0.18 * pow(e, 2.2) * vec3(1.0) + 0.025 * e;
  // r17b: white stock lands on true white after the soft shoulder (only near-white paper is lifted; ink is untouched)
  paper *= mix(1.0, 1.12, smoothstep(0.55, 0.95, dot(base, vec3(0.2126, 0.7152, 0.0722))));
  // r11 foil: solid stamped metal. Colour comes from the metal itself; the only "gradient" is real reflection:
  // a broad strip highlight that travels with tilt, plus micro-facet flakes that glint (the shimmer).
  // kinds: 0 silver, 1 gold, 2 blue-steel, 3 holo (silver + fine diffraction flecks), 4 pearl overprint (ink at 0deg, sheen at angle)
  float f = m.r;
  vec3 col = paper;
  float off = sqrt(max(0.0, 1.0 - dot(V, vN)*dot(V, vN)));
  if (f > 0.002) {
    vec2 cell = floor(vUv*vec2(1600.,2400.)/4.0);
    vec3 rnd = vec3(hsh(cell), hsh(cell+17.3), hsh(cell+41.9));
    vec3 Nf = normalize(N + (1.0-uSmooth)*(0.16*(rnd.x-0.5)*vT + 0.16*(rnd.y-0.5)*vB)); // r20 d5d: uSmooth = polished metal, no per-facet flakes
    vec3 Rf = reflect(-V, Nf);
    float ef = env(Rf);
    // flat renders: a fixed soft studio sheen across the foil so it reads as metal head-on (not paint)
    float sheen = uFlat * (0.32*exp(-pow((vUv.x*0.75 + (1.0-vUv.y)*0.66 - 0.86)/0.20, 2.0)) - 0.10*exp(-pow((vUv.x*0.75 + (1.0-vUv.y)*0.66 - 0.42)/0.16, 2.0)));
    float I0x = 0.0; float I = (uKind > 0.5 && uKind < 1.5 ? 0.46 : 0.22) + 0.62*e + 0.34*ef + 1.5*sheen*(uKind > 0.5 && uKind < 1.5 ? 0.7 : 1.0);
    float spark = (pow(max(ef - 1.05, 0.0), 1.3) * step(0.80, rnd.z) * 1.4 + uFlat*0.35*step(0.985, rnd.z)*rnd.x) * (1.0 - uSmooth);
    // r20 d5d: polished silver with a fine turned (circular) grain about uRing.xy: concentric 1 px + 5 px tool marks
    if (uSmooth > 0.5 && uRing.z > 0.5 && uKind < 0.5) { vec2 pc0 = vec2(vUv.x*1600., (1.0-vUv.y)*2400.) - uRing.xy; float r0 = length(pc0);
      float st0 = 0.55*hsh(vec2(floor(r0*1.3), 5.0)) + 0.45*hsh(vec2(floor(r0/5.0), 9.0)); I *= 1.0 + uRing.w*0.10*(st0 - 0.5); }
    vec3 metal, hi;
    if (uKind < 0.5)      { metal = vec3(0.78, 0.79, 0.81); hi = vec3(1.0); }
    else if (uKind < 1.5) { metal = vec3(0.74, 0.52, 0.20); hi = vec3(1.0, 0.88, 0.58); }
    else if (uKind < 2.5) { metal = vec3(0.09, 0.17, 0.42); hi = vec3(0.52, 0.68, 1.0); }
    else                  { metal = vec3(0.80, 0.81, 0.84); hi = vec3(1.0); }
    if (uCustom > 0.5) { metal = uMetC; hi = uHiC; }
    // r13 gold + blue-steel: a studio reflection read even head-on (bright and dark bands = metal, not beige paint),
    // and a brushed finish wherever the map carries a grating angle (fine streaks along that direction)
    if (uKind > 0.5 && uKind < 2.5) {
      float d = vUv.x*0.75 + (1.0-vUv.y)*0.66;
      float bands = uFlat * (0.55*exp(-pow((d-0.92)/0.07, 2.0)) + 0.30*exp(-pow((d-0.40)/0.05, 2.0)) - 0.32*exp(-pow((d-0.66)/0.12, 2.0)) - 0.20*exp(-pow((d-0.18)/0.10, 2.0)));
      I = 0.30 + 0.70*e + 0.30*ef + bands;
      if (m.g > 0.004) { float ba = m.g*3.14159; vec2 bp = vec2(-sin(ba), cos(ba)); float st = hsh(vec2(floor(dot(vUv*vec2(1600.,2400.), bp)*0.9), 3.0)); I *= 0.86 + 0.24*st; spark *= 0.4; }
      { float g1 = texture2D(uAux, vUv).r; if (g1 > 0.02) I *= mix(1.0, 0.62 + 0.76*g1, uGuil.x); } // r15 engine-turned metal
      // r14 turned (lathe) finish about a centre (uRing.xy, card px): concentric 1 px + 5 px tool marks and the
      // anisotropic radial highlight of turned metal, which swings round the ring as the card tilts.
      if (uRing.z > 0.5) {
        vec2 pc = vec2(vUv.x*1600., (1.0-vUv.y)*2400.) - uRing.xy; float rr = length(pc); vec2 rad = pc / max(rr, 1.0);
        float st = 0.55*hsh(vec2(floor(rr*1.3), 5.0)) + 0.45*hsh(vec2(floor(rr/5.0), 9.0));
        vec2 Rp = vec2(dot(R, vT), -dot(R, vB));
        vec2 hd = normalize(Rp*2.2 + vec2(0.62, -0.78));
        float al = abs(dot(rad, hd));
        float aniso = pow(al, 40.0)*1.25 + pow(al, 6.0)*0.32;
        float dark = 0.20*pow(abs(dot(rad, vec2(-hd.y, hd.x))), 8.0);
        I = 0.26 + 0.40*e + 0.20*ef + uRing.w*aniso*(0.75 + 0.5*st) - uRing.w*dark + 0.10*(st - 0.5);
        spark *= 0.35 * (1.0 - 0.8*uFlat); // fine glints on tilt; no "dust" specks head-on
      }
    }
    vec3 fc = metal * I + hi * (0.22*pow(max(e - 0.7, 0.0), 2.0) + spark);
    if (uKind > 2.5 && uKind < 3.5) {
      // holographic glitter foil: a bright silver mirror; ~40% of the 4 px facets carry a diffraction colour that
      // depends on the view (so the colour sparkles and travels on tilt); a faint whole-sheet tint only off-axis.
      vec2 Rp = vec2(dot(R, vT), dot(R, vB));
      // (a) glitter flecks on 4 px facets (as r11)
      vec2 cell4 = floor(vUv*vec2(1600.,2400.)/4.0); vec3 q = vec3(hsh(cell4+3.1), hsh(cell4+7.7), hsh(cell4+11.3));
      float ga = q.z*3.14159; vec2 gd = vec2(cos(ga), sin(ga));
      float ph = dot(gd, Rp)*3.2 + q.x*2.0 + uSeed;
      vec3 silver = vec3(0.87, 0.88, 0.91) * (0.56 + 0.50*e + 0.22*ef + 1.5*sheen);
      float flash = smoothstep(0.55, 0.85, q.y) * (0.55 + 0.45*smoothstep(0.4, 1.2, ef)) * (0.75 + 0.8*off);
      // (b) stamped diffraction mosaic: 7 px cells whose grating follows a coherent field (G channel or a radial field),
      // so a filled area reads as a solid foil of colour that shifts cell by cell as the card turns (blue/violet/teal/green/yellow)
      // dot-matrix diffraction: a regular 10 px lattice of rounded dots; every dot is a tiny grating whose hue follows a
      // coherent field (so neighbours agree and the colour steps cleanly across the foil) and moves with the view
      vec2 gp = vUv*vec2(1600.,2400.)/10.0; vec2 c7 = floor(gp); vec2 fr = fract(gp) - 0.5;
      vec2 cu = (c7 + 0.5)*10.0/vec2(1600.,2400.);
      float fa = m.g > 0.004 ? m.g*3.14159 : atan(cu.y*1.5-0.55, cu.x-0.62);
      vec2 gm = vec2(cos(fa), sin(fa));
      float pm = dot(gm, Rp)*3.0 + dot(gm, cu)*2.4 + uSeed;
      float dotm = 1.0 - smoothstep(0.30, 0.40, max(abs(fr.x), abs(fr.y)) - 0.02);
      vec3 mos = spectral(pm) * (0.66 + 0.40*e + 0.22*ef + 1.2*sheen);
      flash *= 0.35 * step(0.85, q.y);
      fc = silver + hi*spark*0.6;
      fc = mix(fc, mos, clamp(uHoloMix*(0.75 + 0.5*off), 0.0, 0.92) * dotm);
      fc = mix(fc, spectral(ph) * (0.75 + 0.45*ef), clamp(flash, 0.0, 0.85) * uSat * 0.8);
    }
    // r14 Founding material studies. 5 = lacquer / enamel / ceramic (a dielectric colour under a clear glaze: the
    // colour stays solid, the glaze carries sharp, hard-edged reflections); 6 = nacre (mother-of-pearl: cloudy
    // platelets + fine growth lines, a soft thin-film colour that shifts with the view; low saturation, pink included).
    vec2 pcx = vec2(vUv.x*1600., (1.0-vUv.y)*2400.);
    float dg = (pcx.x*0.75 + pcx.y*0.66) / 1600.0;
    // flat only: a studio softbox seen in the glaze = two hard-edged parallel strips across the inlay (not a gradient)
    // the glaze reflects the SAME studio as the metals, but sharply: hard-edged softboxes in reflection space (they
    // travel across the face as the card tilts, like a real glazed surface), plus one window that faces the camera.
    float win = 0.0;
    float rq = uEnvRot; vec3 q3 = vec3(cos(rq)*R.x - sin(rq)*R.z, R.y, sin(rq)*R.x + cos(rq)*R.z);
    float aw = 0.0016; float uq = dot(q3.xy, vec2(0.749, 0.663));
    float box1 = (smoothstep(0.30, 0.30+aw, q3.x) - smoothstep(0.50, 0.50+aw, q3.x)) * smoothstep(-0.6, -0.2, q3.y);
    float box2 = (smoothstep(-0.62, -0.62+aw, q3.x) - smoothstep(-0.40, -0.40+aw, q3.x)) * 0.55;
    float box3 = (smoothstep(0.56, 0.56+aw, q3.y) - smoothstep(0.70, 0.70+aw, q3.y)) * 0.7;
    // a light-bar array off to both sides (out of the head-on view): any real tilt sweeps a few crisp bars across
    // bars are set by AZIMUTH of the reflected ray (linear in tilt), so each stays a narrow crisp bar at any angle
    float ax = abs(atan(q3.x, q3.z)), box0 = 0.0, ab = 0.0009;
    for (int i = 0; i < 8; i++) { float c0 = 0.36 + 0.145*float(i); float wd = mod(float(i), 2.0) < 0.5 ? 0.030 : 0.010;
      box0 += (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.65) * (smoothstep(c0, c0+ab, ax) - smoothstep(c0+wd, c0+wd+ab, ax)); }
    box0 *= smoothstep(-0.9, -0.5, q3.y) * (1.0 - smoothstep(0.75, 0.95, q3.y));
    float glaze = 0.85*min(box0, 1.0) + 0.015*e; // box1..3 (broad boxes) read as washes on a mirror; not used
    // a hard key light grazing from the upper left: on a glazed surface it shows only where the surface turns
    // (polished bevels, the walls of engraved lines) as crisp bright lines, never as a wash across the face
    vec3 Lg = normalize(vec3(-0.27, 0.31, 0.91)); float key = smoothstep(0.9915, 0.9975, dot(reflect(-Lg, N), V)) * 1.5;
    // r15 bevel light, read straight from the relief: faces turned to the upper left (rim bevel, one wall of every
    // engraved line, the crests of the engine-turning) catch a crisp line of light; faces turned away fall into shade.
    float slope = dot(vec2(hx, hy), vec2(0.7071, -0.7071));
    float edL = smoothstep(0.010, 0.030, slope), edD = smoothstep(0.010, 0.030, -slope);
    key += edL * 0.75;
    if (uKind > 4.5 && uKind < 5.5) {
      float fr = 0.04 + 0.96*pow(1.0 - max(dot(N, V), 0.0), 5.0);
      // r15 guilloché enamel: translucent colour over an engine-turned ground (aux R, 0.5 = neutral). Thicker enamel
      // in the grooves reads darker and richer, the ridges lighter: the pattern shows through with real depth.
      float gl = texture2D(uAux, vUv).r; float gm = step(0.02, gl);
      vec3 body = uMetC * (0.80 + 0.30*max(dot(N, L), 0.0)) * mix(1.0, 0.55 + 0.9*gl, gm*uGuil.x) + vec3(uGuil.y*gm*(gl - 0.5));
      // flat only: one softbox reflection in the glaze (hard edges, broken by the engine-turning), strength uGuil.z
      float sb = (smoothstep(0.700, 0.7015, dg) - smoothstep(0.735, 0.7365, dg)) + 0.6*(smoothstep(0.752, 0.7535, dg) - smoothstep(0.760, 0.7615, dg));
      win = uFlat * uGuil.z * sb * (0.75 + 0.5*gl*gm);
      fc = body * (1.0 - 0.45*edD) + vec3(1.0) * ((glaze + win) * uClear + fr*0.25*e + key);
    }
    if (uKind > 0.5 && uKind < 1.5 && uCustom > 0.5) fc = fc * (1.0 - 0.35*edD) + hi * edL * 0.55;
    if (uKind > 5.5 && uKind < 6.5) {
      vec2 q = pcx / 1600.0;
      float w1 = fbm(q*vec2(5.0, 3.2) + vec2(uSeed, 0.0));
      float cloud = fbm(q*vec2(3.0, 2.0) + 2.0*vec2(w1, fbm(q*4.0 + 7.0)));
      float growth = 0.5 + 0.5*sin((cloud*38.0 + q.x*6.0) );
      vec2 Rp = vec2(dot(R, vT), dot(R, vB));
      float hue = fract(cloud*1.35 + 0.55*dot(Rp, vec2(0.8, 0.6)) + 0.12*growth + uSeed*0.1);
      vec3 film = hsv(hue, (0.22 + 0.16*smoothstep(0.05, 0.4, off) + 0.06*growth) * uSat / 0.9, 1.0);
      vec3 body = uMetC * (0.84 + 0.22*max(dot(N, L), 0.0)) * (0.90 + 0.10*growth);
      fc = body * mix(vec3(1.0), film, 0.72) * (0.84 + 0.30*e) + vec3(1.0) * ((glaze + win*0.7) * uClear + key*0.8);
    }
    float lat = texture2D(uAux, vUv).r;
    if (uKind > 3.5 && uKind < 4.5) { // pearl: a clear overprint on ink; invisible head-on, a cool sheen at an angle
      float ph = dot(vec2(0.8,0.6), vec2(dot(R, vT), dot(R, vB))) * 1.4 + uSeed;
      fc = paper + spectral(ph) * 0.55 * smoothstep(0.08, 0.35, off) * (0.4 + 0.6*e) * f;
      col = fc;
    } else {
      fc *= uTint * uFoilGain;
      col = mix(paper, fc, f);
    }
  }
  col = col / (1.0 + 0.10*col); // soft shoulder
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0/2.2)), c.a);
}`;

function tex(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.premultiplyAlpha = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function plateGeo() { // rounded-rect plate with UVs spanning the card
  const g = new THREE.ShapeGeometry(rrShape(CW, CH, RAD), 12); const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5); return g;
}
const rawColor = (hex) => new THREE.Color().setStyle(hex, THREE.NoColorSpace);
function blackMap() { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 4, 4); return c; }
function flatMap() { const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d'); x.fillStyle = 'rgb(0,0,128)'; x.fillRect(0, 0, 16, 16); return c; }

/** One card scene on its own canvas. `alpha` leaves the background transparent (the app draws the card on its own surface); `backdrop` is a colour (the sample's stage). */
export function createCardScene(canvas, { alpha = true, backdrop = null, preserveDrawingBuffer = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer, alpha });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders write display-referred sRGB themselves
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0xffffff, alpha ? 0 : 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 100);
  const PG = plateGeo();
  let card = null, objs = [], textures = [], shadowMesh = null, shadowTex = null, disposed = false;
  const own = (t) => { textures.push(t); return t; };

  function clearObjs() {
    for (const o of objs) { scene.remove(o); o.traverse((n) => { if (n.geometry && n.geometry !== PG) n.geometry.dispose(); if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach((m) => m.dispose()); } }); }
    objs = []; for (const t of textures) t.dispose(); textures = []; card = null;
  }
  async function build(spec) {
    clearObjs();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(rrShape(CW, CH, RAD), { depth: THICK, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 16 }), new THREE.MeshBasicMaterial({ color: rawColor(spec.edge || '#e7e6e2') }));
    body.position.z = -THICK - 0.0035; g.add(body);
    const meshes = [];
    for (const p of spec.plates) {
      const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: !p.shadow, uniforms: {
        uCol: { value: own(tex(p.col)) }, uMap: { value: own(tex(p.map || flatMap())) }, uAux: { value: own(tex(p.aux || blackMap())) }, uTexel: { value: new THREE.Vector2(1.5 / p.col.width, 1.5 / p.col.height) },
        uCam: { value: new THREE.Vector3() }, uL: { value: new THREE.Vector3(-0.4, 0.7, 0.8) }, uKind: { value: p.kind ?? spec.kind ?? 0 }, uGloss: { value: p.gloss ?? 0.15 },
        uBump: { value: p.bump ?? 6.0 }, uSeed: { value: spec.seed || 0.3 }, uSat: { value: p.sat ?? 0.9 }, uEnvRot: { value: 0 }, uPaper: { value: p.paper ?? 0.025 },
        uTint: { value: rawColor(p.tint || '#ffffff') }, uFoilGain: { value: p.gain ?? 1 }, uFlat: { value: 0 }, uHoloMix: { value: p.holo ?? 0.0 },
        uMetC: { value: new THREE.Vector3(...(p.metal || [0, 0, 0])) }, uHiC: { value: new THREE.Vector3(...(p.hi || [1, 1, 1])) }, uCustom: { value: p.metal ? 1 : 0 },
        uRing: { value: new THREE.Vector4(...(p.ring ? [p.ring[0], p.ring[1], 1, p.ringK ?? 1] : [0, 0, 0, 0])) }, uClear: { value: p.clear ?? 1 }, uSmooth: { value: p.smooth ?? 0 }, uGuil: { value: new THREE.Vector3(...(p.guil || [0, 0, 0])) } } });
      const m = new THREE.Mesh(PG, mat); m.position.z = p.z || 0; m.renderOrder = Math.round((p.z || 0) * 1e4) + (p.shadow ? -1 : 0); g.add(m); meshes.push(m);
    }
    if (spec.seal) {
      const img = spec.seal.img; const t = own(new THREE.Texture(img)); t.needsUpdate = true; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
      const sz = spec.seal.size * CW; const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
      m.position.set((spec.seal.cx - 0.5) * CW, (0.5 - spec.seal.cy) * CH, spec.seal.z ?? 0.0012); m.renderOrder = 9999; g.add(m);
    }
    scene.add(g); objs.push(g); card = g;
    if (backdrop) { const bd = makeBackdrop(backdrop); scene.add(bd); objs.push(bd); }
    return { group: g, plates: meshes.map((mesh, i) => ({ mesh, texture: mesh.material.uniforms.uCol.value, canvas: spec.plates[i].col })) };
  }
  function makeBackdrop(colour) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = colour; x.fillRect(0, 0, 4, 4);
    const t = own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); m.position.z = -3; return m;
  }
  function softShadow(on, rotY, rotX) { // his shadow (a blurred rounded rectangle behind the card), made once and then only moved
    if (!on) { if (shadowMesh) shadowMesh.visible = false; return; }
    if (!shadowMesh) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d'); x.filter = 'blur(38px)'; x.fillStyle = 'rgba(20,24,30,0.42)'; x.beginPath(); x.roundRect(146, 96, 220, 330, 30); x.fill();
      shadowTex = new THREE.CanvasTexture(c); shadowTex.colorSpace = THREE.NoColorSpace;
      shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, toneMapped: false, depthWrite: false })); scene.add(shadowMesh);
    }
    shadowMesh.visible = true; shadowMesh.position.set(0.10 + rotY * 0.25, -0.16 - rotX * 0.2, -0.75); shadowMesh.rotation.set(rotX * 0.4, rotY * 0.4, 0);
  }
  /** Draws the card. w, h are pixels of the canvas; the rest are his pose() arguments. */
  function pose({ ry = 0, rx = 0, rz = 0, dist = 5.6, w = 1200, h = 1800, env = 0, shadow = true, fov = 18, ty = 0, flat = 0, pixelRatio = 1 }) {
    if (disposed || !card) return canvas;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.set(0, ty, dist); camera.lookAt(0, ty, 0);
    card.rotation.set(rx, ry, rz);
    card.updateMatrixWorld(true);
    card.traverse((o) => { if (o.material && o.material.uniforms) { o.material.uniforms.uCam.value.copy(camera.position); o.material.uniforms.uEnvRot.value = env; o.material.uniforms.uFlat.value = flat; } });
    softShadow(shadow, ry, rx);
    renderer.render(scene, camera);
    return canvas;
  }
  function dispose() { disposed = true; clearObjs(); if (shadowMesh) { shadowMesh.geometry.dispose(); shadowMesh.material.dispose(); shadowTex.dispose(); } PG.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); }
  return { build, pose, dispose, renderer };
}
export function fitDist(fov, h, margin = 1.08) { return (CH * margin / 2) / Math.tan((fov * Math.PI / 180) / 2); }
