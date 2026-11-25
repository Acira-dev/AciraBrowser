// Round 4 holographic seal: machined coin (flat bezel, crisp chamfers, small edge radius,
// reeded edge), diffractive foil on every rank, enamel grooves + raised polished relief,
// contrasty studio reflections so metal reads as metal.
import * as THREE from './three.module.min.js';
import { drawInk4 } from './ink4.js';

const canvas = document.createElement('canvas');
/* b14 welcome r6 SAMPLE: the live seal places this canvas itself */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
window.glInfo = () => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; };

// ladder, least -> most: contributor < early < trusted < insider < founding
export const LOOK = {
  contributor: { foil: ['#e6e9ef', '#f4f0f3', '#dfe5ec', '#efede6'], diff: 0.28, hue: [1, 1, 1], bezel: '#c8ccd2', brush: 1.0, mholo: 0.06, gloss: 0.25, sun: 0.9, wedge: 0, gold: 0, dark: 0, ceramic: 0 },
  // r5: richer warm champagne (yellow-gold side, never rose), apricot-gold to mint dawn foil, more holo
  early: { foil: ['#ffe2ae', '#fff4d8', '#cdf1dc', '#d3e6ff'], diff: 0.62, hue: [1.04, 1.0, 0.9], bezel: '#efd6a6', brush: 0.0, mholo: 0.14, gloss: 0.5, sun: 1.0, wedge: 0, gold: 0, dark: 0, ceramic: 0 },
  trusted: { foil: ['#a9bcff', '#c3c0ff', '#9fe2ff', '#bac7ff'], diff: 0.72, hue: [0.6, 0.85, 1.15], bezel: '#dfe3ea', brush: 0.0, mholo: 0.16, gloss: 0.45, sun: 0.8, wedge: 0, gold: 0, dark: 0, ceramic: 0 },
  // r5: rebalanced kinegram, yellow -> green -> teal-blue -> violet; pink only as a thin passing band
  insider: { foil: ['#ffe38a', '#8de8d6', '#7ab6ff', '#a99cff'], diff: 1.0, hue: [0.94, 1.0, 1.06], bezel: '#f4f5f8', brush: 0.0, mholo: 0.28, gloss: 0.55, sun: 0.75, wedge: 1, gold: 0, dark: 0, ceramic: 0 },
  founding: { foil: ['#2a2a30', '#1e1e24', '#26262e', '#22222a'], diff: 0.35, hue: [1, 0.9, 1.05], bezel: '#ffc76b', brush: 0.0, mholo: 0.1, gloss: 0.5, sun: 0.5, wedge: 1, gold: 1, dark: 1, ceramic: 1 },
};
LOOK.insiderB = { ...LOOK.insider, foil: ['#ffe9a0', '#ffc2e4', '#cdbfff', '#a6f1ff'], diff: 0.62, bezel: '#c9c2d8', mholo: 0.6, sun: 1.0 };
// r4 Insider colouring, relit, pink kept (for the team's choice)
LOOK.insiderPink = { ...LOOK.insider, foil: ['#ffe26a', '#ff9fd2', '#b6a4ff', '#7cecff'], hue: [1, 1, 1], nopink: 0 };
LOOK.earlyA = LOOK.early; LOOK.earlyB = LOOK.early;
LOOK.earlyR4 = { foil: ['#ffd6bf', '#fff0cf', '#c6f1e3', '#d4e5ff'], diff: 0.5, hue: [1.08, 0.97, 0.9], bezel: '#e6d3b4', brush: 0.35, mholo: 0.12, gloss: 0.35, sun: 0.9, wedge: 0, gold: 0, dark: 0, ceramic: 0 };

// ---------- geometry ----------
function coinGeometry() {
  const P = []; const add = (r, z) => P.push(new THREE.Vector2(Math.max(r, 0.0001), z));
  add(0, -0.07); add(0.99, -0.07);
  add(0.997, -0.067); add(1.0, -0.061);           // back edge radius
  add(1.0, 0.013);                                 // reeded flank
  add(0.9997, 0.0158); add(0.9985, 0.0175);        // small radius
  add(0.9868, 0.0318);                             // outer chamfer (45 deg plane)
  add(0.9852, 0.0333); add(0.9832, 0.0339);        // small radius
  add(0.935, 0.0352);                              // flat top, a hair convex
  add(0.888, 0.0339);
  add(0.8862, 0.0333); add(0.8848, 0.0318);        // small radius
  add(0.8668, 0.0142);                             // inner chamfer
  add(0.8655, 0.0128); add(0.8638, 0.0118);        // small radius
  add(0.8595, 0.0035); add(0.857, 0.0004);         // short wall into the field
  add(0.854, 0.0); add(0, 0.0);
  const g = new THREE.LatheGeometry(P, 900);
  g.rotateX(Math.PI / 2);
  return g;
}

const vert = `
varying vec3 vObj; varying vec3 vObjN; varying vec3 vW;
void main(){ vObj = position; vObjN = normal; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const frag = `
uniform sampler2D uE; uniform sampler2D uM; uniform float uTexel; uniform mat3 uRot;
uniform vec3 f0; uniform vec3 f1; uniform vec3 f2; uniform vec3 f3;
uniform float uDiff; uniform vec3 uHue; uniform vec3 uBezel; uniform float uBrush; uniform float uMHolo; uniform float uGloss;
uniform float uGold; uniform float uDark; uniform float uCeramic; uniform float uSun; uniform float uLight; uniform float uWedge;
uniform float uFill; uniform float uNoPink;
varying vec3 vObj; varying vec3 vObjN; varying vec3 vW;
#define TAU 6.2831853
vec3 rotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c*v.x + s*v.z, v.y, -s*v.x + c*v.z); }
float rectL(vec3 R, vec3 d, float hw, float hh, float s){
  vec3 rt = normalize(cross(vec3(0.,1.,0.), d)); vec3 up = cross(d, rt);
  float z = dot(R, d); if (z <= 0.05) return 0.;
  float u = dot(R, rt)/z, v = dot(R, up)/z; float e = 0.012*s;
  return smoothstep(hw + e, hw - e, abs(u))*smoothstep(hh + e, hh - e, abs(v));
}
// studio: crisp rectangular soft boxes and strips on black (dark reflections for contrast)
vec3 env(vec3 R, float rough){
  R = rotY(R, uLight);
  float s = 1.0 + rough*16.0;
  vec3 c = vec3(0.003) + vec3(0.018)*smoothstep(-0.1, 1.0, R.y);
  c += vec3(1.0, 0.99, 0.97)*4.0*rectL(R, normalize(vec3(-0.6, 0.62, 0.48)), 0.42, 0.2, s);
  c += vec3(0.95, 0.97, 1.0)*3.4*rectL(R, normalize(vec3(0.92, 0.12, 0.38)), 0.05, 0.9, s);
  c += vec3(1.0)*2.2*rectL(R, normalize(vec3(-0.95, -0.25, 0.2)), 0.04, 0.6, s);
  c += vec3(1.0)*1.6*rectL(R, normalize(vec3(0.0, 0.95, -0.3)), 0.9, 0.05, s);
  c += vec3(1.0)*1.9*rectL(R, normalize(vec3(0.05, 0.36, 1.0)), 0.5, 0.13, s);
  c += vec3(0.9, 0.93, 1.0)*1.9*rectL(R, normalize(vec3(-0.05, -0.3, 1.0)), 1.1, 0.2, s);
  c += vec3(1.0, 0.98, 0.95)*1.1*rectL(R, normalize(vec3(0.0, -0.9, 0.45)), 1.2, 0.25, s);
  return c;
}
// r5 fill: a wide, soft studio (big diffused front box, floor bounce, soft sky) so no part of
// the metal falls to black; the crisp boxes above stay for the highlight bands.
vec3 fill(vec3 R){
  R = rotY(R, uLight);
  float fz = smoothstep(-0.35, 0.95, R.z);
  float floorB = smoothstep(0.05, -0.85, R.y);
  float sky = smoothstep(-0.1, 0.9, R.y);
  vec3 c = vec3(0.075, 0.077, 0.082);
  c += vec3(0.26, 0.26, 0.27)*fz*fz;
  c += vec3(0.30, 0.29, 0.27)*floorB*(0.45 + 0.55*fz);
  c += vec3(0.12, 0.125, 0.135)*sky;
  return c*uFill;
}
vec3 envF(vec3 R, float rough){ return env(R, rough) + fill(R); }
vec3 envBrushed(vec3 R, vec3 Tw, float amt, float rough){
  if (amt < 0.01) return envF(R, rough);
  vec3 a = vec3(0.);
  for (int i = -3; i <= 3; i++) a += envF(normalize(R + Tw*float(i)*0.09*amt), rough);
  return a/7.0;
}
// no pink: rose / magenta (r > b > g) is pulled toward lavender-blue
vec3 depink(vec3 c){
  float mx = max(max(c.r, c.g), c.b) + 1e-4;
  float p = clamp((c.b - c.g)/mx*5.0, 0., 1.)*clamp((c.r - c.b)/mx*5.0, 0., 1.);
  float q = clamp((c.b - c.g)/mx*4.0, 0., 1.)*step(c.b, c.r);
  c.r = mix(c.r, mix(c.b, c.g, 0.2), max(p, 0.6*q)*uNoPink*0.9);
  return c;
}
vec3 pal(float t){ t = fract(t)*4.; float f = fract(t); f = f*f*(3.-2.*f);
  if(t<1.) return mix(f0,f1,f); if(t<2.) return mix(f1,f2,f); if(t<3.) return mix(f2,f3,f); return mix(f3,f0,f); }
vec3 spectral(float l){
  float r = exp(-pow((l-605.)/52., 2.)) + 0.32*exp(-pow((l-445.)/26., 2.));
  float g = exp(-pow((l-545.)/48., 2.)); float b = exp(-pow((l-455.)/38., 2.));
  return vec3(r, g, b);
}
vec3 thinfilm(float t){ return 0.62 + 0.38*cos(TAU*(t + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float tE(vec2 p){ return texture2D(uE, p*0.5 + 0.5).a; }
float tM(vec2 p){ return texture2D(uM, p*0.5 + 0.5).a; }
void main(){
  vec3 nO = normalize(vObjN);
  vec2 p = vObj.xy; float r = length(p); float th = atan(p.y, p.x);
  vec3 V = normalize(cameraPosition - vW);
  vec3 T = vec3(-sin(th), cos(th), 0.), B = vec3(cos(th), sin(th), 0.);
  bool front = nO.z > 0.3; bool field = front && r < 0.8545;
  bool edge = abs(nO.z) < 0.3;
  bool top = front && r > 0.884 && r < 0.9855 && nO.z > 0.97;   // flat bezel top
  float k = tE(p), m = tM(p);
  float e = uTexel*1.5;
  vec2 gE = vec2(tE(p + vec2(e,0.)) - tE(p - vec2(e,0.)), tE(p + vec2(0.,e)) - tE(p - vec2(0.,e)));
  vec2 gM = vec2(tM(p + vec2(e,0.)) - tM(p - vec2(e,0.)), tM(p + vec2(0.,e)) - tM(p - vec2(0.,e)));
  vec3 n = nO;
  if (front) n = normalize(nO + vec3(gE*0.55 - gM*0.9, 0.));
  if (edge) n = normalize(nO + T*sin(th*540.)*0.45);
  vec3 N = normalize(uRot*n);
  vec3 Tw = normalize(uRot*T), Bw = normalize(uRot*B);
  vec3 R = reflect(-V, N);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 L1 = rotY(normalize(vec3(-0.6, 0.62, 0.48)), -uLight);
  vec3 L2 = rotY(normalize(vec3(0.92, 0.12, 0.38)), -uLight);
  vec3 L3 = rotY(normalize(vec3(0.05, 0.36, 1.0)), -uLight);
  vec3 L4 = rotY(normalize(vec3(-0.95, -0.25, 0.2)), -uLight);
  // diffraction shared by foil and (subtly) metal
  float g1 = sin(th*60. + 6.5*sin(r*21.)); float g2 = sin(th*60. - 6.5*sin(r*21. + 1.1));
  float gl = smoothstep(0.86, 1.0, abs(g1*g2));
  float wedge = smoothstep(-0.12, 0.12, sin(th*36.0)); float zone = smoothstep(0.47, 0.49, r)*(1.0 - smoothstep(0.68, 0.70, r));
  float gang = th + 1.5708 + mix(1.5708*gl, 0.55*wedge - 0.25, zone*uWedge);
  vec3 gdir = normalize(uRot*vec3(cos(gang), sin(gang), 0.));
  vec3 dif = vec3(0.);
  for (int i = 0; i < 4; i++) {
    vec3 L = i==0 ? L1 : i==1 ? L2 : i==2 ? L3 : L4; float I = i==0 ? 1.0 : i==1 ? 0.85 : i==2 ? 0.5 : 0.5;
    vec3 sv = L + V; sv -= N*dot(sv, N); float u = abs(dot(sv, gdir));
    dif += I*(spectral(820.*u) + 0.45*spectral(410.*u));
  }
  dif *= uHue;
  vec3 col;
  if (field) {
    float brush = 0.5 + 0.5*sin(th*1400.0 + 40.0*hash(vec2(floor(th*700.0), 2.0)));
    float t = 0.30*(p.x*0.72 - p.y*0.68) + 0.09*sin(2.1*p.x + 1.2)*cos(1.7*p.y - 0.3) + 0.55*dot(N.xy, vec2(0.6, 0.45)) + 0.7*(1.0 - ndv) + 0.03*gl;
    vec3 body = pal(t);
    float amb = 0.66 + 0.24*max(dot(N, L3), 0.) + 0.14*max(dot(N, L1), 0.);
    vec3 H1 = normalize(L1 + V), H2 = normalize(L2 + V);
    float an1 = exp(-(pow(dot(H1,Tw)/0.05, 2.) + pow(dot(H1,Bw)/0.6, 2.))/max(pow(dot(H1,N),2.), 1e-3));
    float an2 = exp(-(pow(dot(H2,Tw)/0.05, 2.) + pow(dot(H2,Bw)/0.6, 2.))/max(pow(dot(H2,N),2.), 1e-3));
    vec3 foil = body*amb*(0.96 + 0.04*brush) + vec3(0.55*an1 + 0.4*an2)*uSun*(0.85 + 0.3*brush);
    float dm = mix(0.6, 1.0, gl);
    foil = mix(foil, foil*0.6 + dif*0.6, clamp(uDiff*dm*0.85, 0., 1.)) + dif*0.12*uDiff*dm;
    // the foil is a mirror too: crisp studio reflections tinted by the foil
    foil += uGloss*env(R, 0.02)*mix(vec3(1.0), body, 0.6)*0.28;
    if (uDark > 0.5) {
      // onyx: deep black polish, crisp reflections, a deep holo sheen that lives in the black
      foil = vec3(0.003) + 0.022*env(R, 0.01) + dif*vec3(0.75, 0.62, 1.0)*0.045*(0.5 + 0.8*gl) + dif*0.01*zone*wedge;
    }
    foil *= 1.0 - 0.5*smoothstep(0.80, 0.8545, r);
    col = foil;
  } else {
    bool goldPart = uGold > 0.5 && (edge || !top);
    vec3 base = goldPart ? vec3(1.0, 0.70, 0.30) : uBezel;
    if (uCeramic > 0.5 && top) {
      col = vec3(0.004) + 0.03*env(R, 0.01) + 0.006*env(R, 0.4) + 0.05*fill(R);
    } else {
      vec3 F = base + (1.0 - base)*pow(1.0 - ndv, 5.0);
      float brushAmt = top ? uBrush : 0.0;
      float grain = 1.0 + brushAmt*(0.12*hash(vec2(floor(r*4000.), 1.)) - 0.06);
      vec3 E = envBrushed(R, Tw, brushAmt, edge ? 0.06 : 0.015 + 0.05*brushAmt)*grain;
      vec3 holo = thinfilm(1.6*(1.0 - ndv) + 0.4*R.y + 0.15*R.x);
      // the colour shift rides the studio reflections; the soft fill stays near-neutral metal
      vec3 Fl = fill(R);
      col = F*max(E - Fl, vec3(0.))*mix(vec3(1.0), holo, uMHolo) + F*Fl*mix(vec3(1.0), holo, uMHolo*0.15) + F*0.012;
      if (goldPart) col *= 0.6;
    }
  }
  // raised polished relief (emblem edge, studs)
  if (front && m > 0.003) {
    vec3 base = uGold > 0.5 ? vec3(1.0, 0.70, 0.30) : mix(uBezel, vec3(1.0), 0.3);
    vec3 mc = (base + (1.0 - base)*pow(1.0 - ndv, 5.0))*envF(R, 0.02)*(uGold > 0.5 ? 0.55 : 1.0)*mix(vec3(1.0), thinfilm(1.4*(1.0-ndv) + 0.5*R.y), uMHolo) + base*0.03;
    col = mix(col, mc, clamp(m*1.2, 0., 1.));
  }
  // enamel / gold inlay in the grooves
  if (front && k > 0.002) {
    vec3 inkc;
    if (uGold > 0.5) { vec3 G = vec3(1.0, 0.68, 0.28); inkc = G*(0.05 + 0.5*envF(R, 0.07)) + G*G*0.06*(0.6 + 0.4*dot(N.xy, vec2(-0.5, 0.8))); }
    else inkc = vec3(0.004, 0.004, 0.006) + 0.022*env(R, 0.02);
    col = mix(col, inkc, k);
  }
  col = depink(col);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const texCache = {};
function inkTex(rank) {
  if (texCache[rank]) return texCache[rank];
  const S = 4096; const ce = document.createElement('canvas'); const cm = document.createElement('canvas'); ce.width = ce.height = cm.width = cm.height = S;
  drawInk4(ce.getContext('2d'), cm.getContext('2d'), S, rank);
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  texCache[rank] = [mk(ce), mk(cm)]; return texCache[rank];
}
function material(look, rank) {
  const L = LOOK[look]; const [tE, tM] = inkTex(rank);
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, toneMapped: true,
    uniforms: {
      uE: { value: tE }, uM: { value: tM }, uTexel: { value: 2 / 4096 }, uRot: { value: new THREE.Matrix3() },
      f0: { value: new THREE.Color(L.foil[0]) }, f1: { value: new THREE.Color(L.foil[1]) }, f2: { value: new THREE.Color(L.foil[2]) }, f3: { value: new THREE.Color(L.foil[3]) },
      uDiff: { value: L.diff }, uHue: { value: new THREE.Vector3(...L.hue) }, uBezel: { value: new THREE.Color(L.bezel) }, uBrush: { value: L.brush }, uMHolo: { value: L.mholo }, uGloss: { value: L.gloss },
      uGold: { value: L.gold }, uDark: { value: L.dark }, uCeramic: { value: L.ceramic }, uSun: { value: L.sun }, uLight: { value: 0 }, uWedge: { value: L.wedge },
      uFill: { value: L.fill ?? 1 }, uNoPink: { value: L.nopink ?? 1 },
    },
  });
}

const geo = coinGeometry();
const camera = new THREE.PerspectiveCamera(16, 1, 0.1, 60);
window.renderCoin = function (o) {
  const { rank = 'insider', look = rank, px = 800, ss = 2, rotX = -0.1, rotY = 0.14, light = 0, dist = 8.6 } = o;
  const W = Math.round(px * ss);
  renderer.setSize(W, W, false); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const mat = material(look, rank);
  const mesh = new THREE.Mesh(geo, mat); mesh.rotation.set(rotX, rotY, 0); mesh.updateMatrixWorld(true);
  mat.uniforms.uRot.value.setFromMatrix4(mesh.matrixWorld); mat.uniforms.uLight.value = light;
  scene.add(mesh);
  camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  let src = canvas, s = W;
  while (s / 2 >= px) { const c = document.createElement('canvas'); c.width = c.height = s / 2; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, s / 2, s / 2); src = c; s /= 2; }
  const out = document.createElement('canvas'); out.width = out.height = px; const ox = out.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(src, 0, 0, px, px);
  mat.dispose();
  return out;
};
window.stage = function (coin, W, H, cx, cy, size, o = {}) {
  const c = o.canvas || Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d');
  if (!o.canvas) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); }
  const r = size * 0.43; const floorY = cy + r;
  const g = x.createRadialGradient(cx, floorY, 0, cx, floorY, r * 1.3);
  g.addColorStop(0, 'rgba(120,130,150,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.save(); x.translate(cx, floorY); x.scale(1, 0.16); x.translate(-cx, -floorY); x.fillStyle = g; x.fillRect(cx - r * 1.4, floorY - r * 1.4, r * 2.8, r * 2.8); x.restore();
  const ref = document.createElement('canvas'); ref.width = size; ref.height = size; const rx = ref.getContext('2d');
  rx.translate(0, size); rx.scale(1, -1); rx.drawImage(coin, 0, 0, size, size);
  rx.setTransform(1, 0, 0, 1, 0, 0); rx.globalCompositeOperation = 'destination-in';
  const topY = size / 2 - r; const fg = rx.createLinearGradient(0, topY, 0, topY + r * 0.6); fg.addColorStop(0, 'rgba(0,0,0,0.09)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
  rx.fillStyle = fg; rx.fillRect(0, 0, size, size);
  x.drawImage(ref, cx - size / 2, floorY + (floorY - cy) - size / 2 + 2);
  const cs = x.createRadialGradient(cx, floorY, 0, cx, floorY, r * 0.6); cs.addColorStop(0, 'rgba(0,0,0,0.9)'); cs.addColorStop(1, 'rgba(0,0,0,0)');
  x.save(); x.translate(cx, floorY); x.scale(1, 0.05); x.translate(-cx, -floorY); x.fillStyle = cs; x.fillRect(cx - r, floorY - r, r * 2, r * 2); x.restore();
  x.drawImage(coin, cx - size / 2, cy - size / 2, size, size);
  return c;
};
window.renderBadge = async (o) => {
  const px = o.px || 800; const coin = window.renderCoin({ ...o });
  return window.stage(coin, px, Math.round(px * 1.15), px / 2, px / 2, px).toDataURL('image/png');
};
window.sceneReady = true;

// b14 welcome r6 SAMPLE: exported for the live, pointer-driven seal (live.js)
export { THREE, renderer, canvas, material, coinGeometry, LOOK as SEAL_LOOK };
