/** The first run's luminous layer as a plain WebGL2 renderer (no React), so the scene can also be studied on its own.
 *
 * Three passes.
 * 1. Atmosphere, at a fifth of the window's resolution (it has no fine detail): one very wide, gently domain-warped fBm
 *    (Inigo Quilez, "fbm" and "warp" articles) drifting very slowly. The light pass uses it only as a low-contrast
 *    variation on a soft gradient — densest near the source, fading toward the bottom-left — so it reads as haze the
 *    beams glow through, never as smoke.
 * 2. Light, at about half resolution: soft beams from a source beyond the top-right corner and a quieter set from the
 *    bottom-right. A beam is brighter and wider where the haze is denser, with a hot filament, a soft body, a long glow
 *    and a scattering shaft, widening with distance and dissolving at its end. A full spectrum travels outward along
 *    each beam on its own eased cycle, fading in at the source and out at the end, so it never pops. The source drifts,
 *    the beams sway and breathe, slowly. The haze is faintly lit by scatter from the source. Light theme: light through
 *    frosted glass on true white — pale aqua pools drifting slowly, each carrying soft caustic filaments with a faint
 *    dispersed fringe.
 * 3. Composite, at device resolution: stationary film grain from an integer PCG hash per device pixel (Jarzynski &
 *    Olano, "Hash Functions for GPU Rendering", JCGT 2020), so it never tiles or repeats. The grain is scaled by
 *    SCENE_GRAIN (sceneLook.ts; 0 today: clean), and a half-level dither of the same hash stays at every setting so the
 *    dark gradients never band.
 * Glass: when a frosted card sits over the scene, the scene draws the frosting itself — inside the card's rounded rect
 * it shows a blurred, saturated copy of the light (downsampled to an eighth of a CSS pixel, then a separable Gaussian
 * of about 28 CSS px), so the card needs no CSS backdrop-filter re-blurring a full-window canvas every frame. */

import { SCENE_BLACKS, SCENE_GRAIN } from "./sceneLook";

export type PrismInputs = {
  /** 0..1, overall light. */
  power: number;
  /** 0..1, a calm pocket in the middle for hero text. */
  clear: number;
  /** Radians the fan leans by. */
  swing: number;
  /** Per-step pose in scene-height units, animated through GPU uniforms. */
  shiftX: number;
  shiftY: number;
  /** 0 dark, 1 light. */
  tone: number;
  /** 0..1, the second set of beams from the bottom-right. */
  cross: number;
  /** 0..1, the entrance: the fog rises from black, the source ignites, the beams reach out into the fog. */
  intro: number;
  /** 0..1, the frosted card region; its rect in canvas device pixels (origin bottom-left) and corner radius. */
  glass: number;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  gr: number;
};

const vertex = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;

const noise = `
// Integer PCG hash (O'Neill; GPU form from Jarzynski & Olano 2020): no sin(), so no patterns at large coordinates.
uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
float hash(vec2 i){uvec2 u=uvec2(ivec2(i)+32768);return float(pcg(u.x+pcg(u.y)))*(1./4294967295.);}
// Value noise with a quintic fade, and fBm with a rotation between octaves (iq).
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
const mat2 M=mat2(.8,.6,-.6,.8);
float fbm4(vec2 p){float f=.5*noise(p);p=M*p*2.02;f+=.25*noise(p);p=M*p*2.03;f+=.125*noise(p);p=M*p*2.01;f+=.0625*noise(p);return f/.9375;}
float fbm3(vec2 p){float f=.5*noise(p);p=M*p*2.02;f+=.25*noise(p);p=M*p*2.03;f+=.125*noise(p);return f/.875;}
`;

const fogShader = `#version 300 es
precision highp float;precision highp int;
uniform vec2 res;uniform float t;
out vec4 o;
${noise}
// f(p + q(p)): one gentle warp whose offsets drift, so the haze slowly thickens and thins; never curls.
float haze(vec2 p,float k){
  vec2 q=vec2(fbm3(p+vec2(0.,.3*k)),fbm3(p+vec2(5.2,1.3)-vec2(.25*k,0.)));
  return fbm3(p+1.1*q);
}
void main(){
  vec2 P=gl_FragCoord.xy/res.y;
  o=vec4(haze(P*.4+vec2(t*.008,t*.003),t*.03),0.,0.,1.);
}`;

const scene = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D fog;uniform vec2 res;uniform float t;uniform float tone;uniform float power;uniform float clear;uniform float swing;uniform float second;uniform float intro;uniform vec3 bg;uniform vec2 pose;
// Deeper blacks (SCENE_BLACKS): the dark haze between the beams falls toward black; BLACKS 0 leaves the original haze.
const float BLACKS=${SCENE_BLACKS.toFixed(3)};
out vec4 o;
${noise}
// Smooth HSV (iq): no kinks between hues.
vec3 hsv(float h,float s,float v){vec3 k=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);k=k*k*(3.-2.*k);return v*mix(vec3(1),k,s);}
// A prism's spectrum across a band, x in -1..1: red outside, violet inside; hue steps sharpened so neighbours separate
// cleanly, and the blue-violet end softened so it never outweighs the warm end.
vec3 spectral(float x){float h=clamp(.5-.47*x,0.,1.);h=clamp(h+.035*sin(h*18.85),0.,1.);return hsv(.8*h,mix(.88,.7,smoothstep(.55,1.,h)),1.);}
// Light theme: a caustic network, the bright filaments light makes after passing through rippled glass or water (the
// tileable water caustic, after joltz0r and Dave Hoskins): five warped iterations, sharpened. It tiles every 1.0 in p,
// which the light branch keeps to over three screen widths, so no repeat is ever on screen.
float caustic(vec2 p,float time){
  vec2 q=mod(p*6.28318,6.28318)-250.,i=q;float c=1.;
  for(int n=0;n<5;n++){
    float tt=time*(1.-3.5/float(n+1));
    i=q+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));
    c+=1./length(vec2(q.x/(sin(i.x+tt)/.005),q.y/(cos(i.y+tt)/.005)));
  }
  c=1.17-pow(c/5.,1.4);
  return pow(abs(c),6.);
}
// Atmosphere: a soft gradient, densest near the source and fading toward the bottom-left, varied only a few percent
// by the very wide drifting noise — haze, never smoke.
float atmosphere(vec2 uv,vec2 P,vec2 src){
  float g=smoothstep(2.,.2,length((P-src)*vec2(.75,1.)));
  return mix(.26,1.,g)*(.8+.4*(texture(fog,uv).r-.5));
}
// Beams: angle, width, intensity, depth (0 near .. 1 far) | phase, packet speed, length, saturation.
const int N=9;
const vec4 A1[N]=vec4[N](vec4(3.50,1.00,.55,.55),vec4(3.58,.55,.80,.15),vec4(3.64,1.60,.42,.85),vec4(3.71,.75,.95,.30),
  vec4(3.79,1.25,.50,.70),vec4(3.86,.60,.70,.20),vec4(3.95,1.90,.32,.95),vec4(4.04,.85,.55,.45),vec4(4.13,1.40,.30,.80));
const vec4 B1[N]=vec4[N](vec4(.10,.050,1.65,.55),vec4(.62,.042,1.85,.95),vec4(.31,.036,1.55,.35),vec4(.84,.047,1.95,.85),
  vec4(.47,.039,1.70,.45),vec4(.18,.052,1.80,.90),vec4(.73,.033,1.45,.30),vec4(.39,.044,1.60,.70),vec4(.95,.038,1.40,.40));
const int K=5;
const vec4 A2[K]=vec4[K](vec4(2.55,.90,.48,.75),vec4(2.63,1.40,.36,.95),vec4(2.70,.60,.60,.70),vec4(2.79,1.10,.40,.90),vec4(2.88,.80,.46,.80));
const vec4 B2[K]=vec4[K](vec4(.27,.045,1.55,.75),vec4(.58,.037,1.45,.40),vec4(.05,.050,1.65,.95),vec4(.80,.040,1.35,.50),vec4(.44,.048,1.50,.80));
vec3 S;float reach;
vec3 coreSum,glowSum,shaftSum,specSum;float coreAmt,glowAmt,sunSum,specAmt;
void beam(vec2 P,vec2 src,vec4 a,vec4 b,float gain){
  // Each beam sways on its own slow cycle; the whole fan leans a touch with the source.
  float ang=a.x-swing+.028*sin(t*(.36+.22*fract(b.x*5.3))+b.x*6.28)+.012*sin(t*.19);
  vec2 dir=vec2(cos(ang),sin(ang)),nrm=vec2(-dir.y,dir.x),v=P-src;
  float u=dot(v,dir);
  if(u<=0.)return;
  float d=dot(v,nrm);
  // The haze this beam passes through: it is brighter and wider where the haze is denser.
  float fd=S.x;
  float sig=a.y*(.0032+.014*u)*(1.+.1*sin(t*.23+b.x*9.))*(1.+.5*a.w)*(.85+.4*fd);
  float x=d/sig;
  float end=b.z*(1.05+.35*fd);
  float tail=1.-smoothstep(end*.38,end,u);
  // The entrance: the beam reaches out from the source into the fog.
  float grow=1.-smoothstep(reach-.45,reach,u);
  float along=smoothstep(0.,.18,u)*exp(-u*.36)*tail*tail*grow;
  // Each beam breathes slowly, on its own phase.
  float breath=.84+.16*sin(t*(.45+.3*fract(b.x*3.7))+b.x*9.);
  float Lr=a.z*along*gain*(1.-.3*a.w)*breath;
  float Ll=tone>.5?a.z*smoothstep(0.,.12,u)*exp(-u*.3)*(1.-smoothstep(end*.7,end*1.45,u))*grow*gain*breath:0.;
  if(Lr<.0003&&Ll<.0003)return;
  // The filament stays legible, brighter where the haze is denser; the shaft around it is pure scattering in the haze.
  float L=Lr*(.35+1.*fd);
  float wisp=fd;
  float wide=exp(-pow(abs(x)/(3.+2.*fd),2.6));
  // A full spectrum travels outward along the beam on its own eased cycle (after F's v5): the segment fades in as it
  // leaves the source, slows into place, fades out at the far end; hue runs violet (trailing) to red (leading).
  float period=7.+5.*fract(b.x*7.31);
  float cyc=fract((t+b.x*23.)/period);
  float centre=mix(.08,b.z*.8,cyc*cyc*(3.-2.*cyc));
  float k=(u-centre)/(.3*b.z);
  // Dark: the packet's colour reaches all the way to a clear red at its leading edge (red-orange to red; the window is
  // a little wider and the hue run warmer than the light theme's, which keeps its own).
  float env=(1.-smoothstep(tone<.5?.6:.55,tone<.5?1.12:1.,abs(k)))*smoothstep(0.,.14,cyc)*(1.-smoothstep(.8,1.,cyc))*(.75+.25*b.w);
  float hue=clamp(tone<.5?.375-.46*k:.4-.42*k,tone<.5?.012:0.,.8);
  vec3 hc=hsv(hue,tone<.5?.97:.95,1.);
  // Red carries little luminance; lift it so it reads as a rich red beside the greens and blues, never pink or dull.
  if(tone<.5)hc*=1.+1.*(1.-smoothstep(.0,.1,hue));
  vec3 tint=mix(vec3(1.,.975,.95),hc,env);
  // A hot filament inside a soft body, with slight dispersion where the color runs; a long glow around both.
  float dp=.3*env;
  vec3 core=vec3(exp(-(x-dp)*(x-dp)),exp(-x*x),exp(-(x+dp)*(x+dp)));
  float hot=exp(-x*x*7.);
  float glow=.45*exp(-x*x*.0625)+.08/(1.+x*x*.03);
  coreSum+=tint*(core+hot*.6)*L;glowSum+=tint*glow*L;shaftSum+=tint*wide*wisp*Lr;coreAmt+=(core.g+hot*.5)*L;glowAmt+=glow*L;
  // Light theme — sunlight through a prism onto a pale wall, designed for light rather than inverted from dark: each
  // beam is a soft shaft of warm sunlight that lifts the wall; the more saturated beams also throw a narrow, dense
  // spectrum along one edge (red outside to violet inside, as a prism disperses it), which strengthens and fades along
  // the beam as the color travels outward.
  float sw=4.+3.*a.w;
  sunSum+=exp(-pow(abs(x)/sw,2.4))*Ll;
  float bx=(x-sw*.9)/(2.4+2.2*u);
  // Restraint: only the three purest beams of the main source carry a spectrum, and it fades sooner than the sunlight.
  float band=exp(-pow(abs(bx)*.85,4.))*smoothstep(.6,.72,b.w)*smoothstep(.04,.25,u)*exp(-u*.3);
  float vis=.4+.6*env;
  specSum+=mix(vec3(.996,.992,.986),hsv(.82*clamp(.5-.42*bx,0.,1.),1.,1.),.5)*band*Ll*vis;specAmt+=band*Ll*vis;
}
void main(){
  vec2 uv=gl_FragCoord.xy/res;
  vec2 P=gl_FragCoord.xy/res.y;
  float A=res.x/res.y;
  P-=pose;
  // The source drifts on a slow ellipse; the second one more slowly still.
  vec2 S1=vec2(A*.96+.05*sin(t*.27),1.17+.03*sin(t*.2+1.));
  float dens=atmosphere(uv,P,S1);
  S=vec3(dens);
  coreSum=vec3(0.);glowSum=vec3(0.);shaftSum=vec3(0.);specSum=vec3(0.);coreAmt=0.;glowAmt=0.;sunSum=0.;specAmt=0.;
  float rise=smoothstep(0.,.45,intro),ignite=smoothstep(.06,.42,intro);
  reach=mix(-.1,3.6,smoothstep(.16,.98,intro));
  if(tone<.5)for(int i=0;i<N;i++)beam(P,S1,A1[i],B1[i],.875);
  vec2 S2=vec2(A*1.02+.03*sin(t*.17+2.),-.16+.02*sin(t*.23));
  if(tone<.5&&second>.001)for(int i=0;i<K;i++)beam(P,S2,A2[i],B2[i],second);
  // Bloom where light enters, scattered by the haze; a wide scatter lets the haze glow softly around the source.
  float r1=length(P-S1),r2=length(P-S2);
  float bloom=(.5425/(1.+r1*r1*6.)*(.35+.9*dens)+second*.3/(1.+r2*r2*12.)*(.4+.9*dens))*ignite;
  float scatter=(.014+.07875/(1.+r1*r1*1.6))*rise;
  vec2 cc=(P-vec2(A*.5,.5))*vec2(.78,1.55);
  float pocket=(1.-smoothstep(.1,.5,length(cc)))*clear;
  float calm=1.-.72*pocket;
  vec3 c;
  if(tone<.5){
    // Haze glows where light reaches it: scatter from the source, the bloom, and the beams' own glow.
    float fogLit=dens*(scatter+.9*bloom+.25*glowAmt);
    vec3 light=(coreSum*1.35+glowSum*.4+shaftSum*.95+vec3(1.,.96,.92)*bloom*.5)*power*calm+vec3(.62,.66,.76)*fogLit*1.35*power*(1.-.35*pocket);
    // Deeper blacks: where the light is faint (the haze between the beams) it falls away toward the black field; where a
    // beam carries real light (any channel above the knee) nothing changes, so beam colour, brightness and glow stay.
    float peak=max(light.r,max(light.g,light.b));
    light*=1.-BLACKS*.92*(1.-smoothstep(0.,.3,peak));
    c=bg+(1.-bg)*(1.-exp(-light));
  }else{
    // Light (the pick, round 5): light through frosted glass. Pale aqua pools of transmitted light drift slowly
    // across true white, the way sunlight through a glass of water lands on a white table; inside them run caustic
    // filaments, refracted by a slow ripple and softened as if seen through frost (four taps a few pixels apart). The
    // three colour channels sit a hair apart, so the brightest filaments catch a faint dispersed fringe. Outside the
    // pools the white stays clean; the calm pocket and the entrance quiet the pools the way they quiet the dark beams.
    vec2 rp=vec2(fbm3(P*1.3+t*.02),fbm3(P*1.3+7.-t*.02))-.5;
    vec2 cu=P*.3+rp*.04;
    float tt=t*.18+23.;
    vec3 k=vec3(0.);
    for(int j=0;j<4;j++){
      vec2 d=(vec2(float(j&1),float(j>>1))-.5)*.0016;
      k+=vec3(caustic(cu+d+vec2(.00375,0.),tt),caustic(cu+d,tt),caustic(cu+d-vec2(.00375,0.),tt));
    }
    k=clamp(k,0.,1.5);
    float pool=smoothstep(.38,.62,fbm4(P*.9+vec2(t*.012,-t*.008)));
    pool=max(pool,smoothstep(.62,.05,length((P-vec2(A*.9,.2))*vec2(.75,1.))));
    pool=max(pool,smoothstep(.55,.05,length((P-vec2(A*.08,.8))*vec2(.75,1.))));
    pool*=rise*power*mix(1.,.55,pocket);
    // R3-03: a little more colour. Two further pools, lilac and warm peach, drift on their own slow fields beside the aqua
    // ones, so the white carries three soft hues instead of one; the aqua is a touch deeper. The filaments still run
    // through all of them, and the fringe on the brightest of them is stronger.
    float lilac=smoothstep(.5,.72,fbm4(P*.75+vec2(11.3,4.1)+vec2(-t*.009,t*.006)))*rise*power*mix(1.,.5,pocket);
    float peach=smoothstep(.54,.76,fbm4(P*.7+vec2(3.7,19.2)+vec2(t*.007,t*.01)))*rise*power*mix(1.,.5,pocket);
    c=vec3(1.);
    c=mix(c,vec3(.82,.77,.97),lilac*.44);
    c=mix(c,vec3(.995,.83,.73),peach*.36);
    c=mix(c,vec3(.60,.83,.935),pool*.86);
    c=mix(c,vec3(1.,.996,.988),clamp(k*pool,0.,1.)*.9);
    c+=(k-dot(k,vec3(.333)))*(pool+.5*(lilac+peach))*1.1;
  }
  o=vec4(c,1.);
}`;

// An eighth-of-a-pixel copy of the light, tent-filtered so moving beams don't shimmer under the glass.
const down = `#version 300 es
precision highp float;
uniform sampler2D src;uniform vec2 res;uniform vec2 texel;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/res;vec3 s=vec3(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(src,uv+vec2(x,y)*texel*1.5).rgb*float((2-abs(x))*(2-abs(y)));
  o=vec4(s/16.,1.);
}`;

// One direction of a separable Gaussian (13 taps, sigma 3.2 texels: about 28 CSS px at an eighth of a pixel).
const blur = `#version 300 es
precision highp float;
uniform sampler2D src;uniform vec2 res;uniform vec2 dir;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/res;vec3 s=vec3(0.);float w=0.;
  for(int i=-6;i<=6;i++){float k=exp(-float(i*i)/20.48);s+=texture(src,uv+dir*float(i)).rgb*k;w+=k;}
  o=vec4(s/w,1.);
}`;

const composite = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D scene;uniform sampler2D frost;uniform vec2 res;uniform float tone;
uniform float glass;uniform vec4 glassRect;uniform float glassR;
// SCENE_GRAIN (sceneLook.ts): 0 clean, 1 the original grain.
const float GRAIN=${SCENE_GRAIN.toFixed(3)};
out vec4 o;
uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
void main(){
  vec2 f=gl_FragCoord.xy;
  vec4 s=texture(scene,f/res);
  vec3 c=s.rgb;
  // Frosted card: inside its rounded rect (antialiased edge), the blurred light at the backdrop's 1.8 saturation.
  float inside=0.;
  if(glass>.001){
    vec2 ce=(glassRect.xy+glassRect.zw)*.5,q=abs(f-ce)-(glassRect.zw-glassRect.xy)*.5+glassR;
    inside=clamp(.5-(length(max(q,0.))+min(max(q.x,q.y),0.)-glassR),0.,1.)*glass;
    if(inside>0.){
      vec3 b=texture(frost,f/res).rgb;
      // Barely more color than the scene itself (round 12: no neon through the glass, a soft tint at most).
      b=max(mix(vec3(dot(b,vec3(.2126,.7152,.0722))),b,tone<.5?1.3:1.2),0.);
      // Dark glass is smoked: it passes most of the light, so the brighter, foggier scene never washes the text out.
      if(tone<.5)b*=.8;
      c=mix(c,b,inside);
    }
  }
  // Stationary grain: a fresh PCG value per device pixel, triangular, applied soft-light so black stays clean.
  uint h=pcg(uint(f.x)+pcg(uint(f.y)));
  float n=float(h&65535u)/65535.+float(h>>16u)/65535.-1.;
  float e=n*(tone<.5?.075:.05)*GRAIN;
  vec3 b=clamp(c,0.,1.);
  vec3 dd=mix(((16.*b-12.)*b+4.)*b,sqrt(b),step(.25,b));
  vec3 soft=e<0.?b+2.*e*b*(1.-b):b+2.*e*(dd-b);
  // Half a level of the same hash, whatever the grain: it breaks the 8-bit steps of the dark gradients (no banding)
  // and is far below what an eye can see as grain.
  o=vec4(soft+n*(.5/255.),1.);
}`;

export type Prism = {
  /** Match the canvas to its box; returns false when the context is lost. */
  resize: () => boolean;
  draw: (seconds: number, inputs: PrismInputs, field: ArrayLike<number>) => void;
  dispose: () => void;
};

/** A prism whose programs are being built: wait for the driver (compiled), then take it (finish). */
type Started = { compiled: (poll?: number, give?: number) => Promise<void>; finish: () => Prism | null };

/** The renderer, built at once: reads the programs' link status, which makes this thread wait for the driver to compile all five (4.5 s on the laptop). */
export function createPrism(canvas: HTMLCanvasElement): Prism | null {
  const started = startPrism(canvas);
  return started ? started.finish() : null;
}

/**
 * The same renderer, without the stall: the five programs are handed to the driver (KHR_parallel_shader_compile: it compiles and links in its own threads and says when it is
 * done) and this thread is free meanwhile; the first-run screen was not on screen for the 4.5 s the synchronous build took on a fresh profile (Skip setup came up 8 to 15 s after
 * the window opened). Without the extension it is the synchronous build, a turn later. `give` caps the wait; after it the status is read as before.
 */
export async function createPrismAsync(canvas: HTMLCanvasElement, poll = 12, give = 20000): Promise<Prism | null> {
  const started = startPrism(canvas);
  if (!started) return null;
  await started.compiled(poll, give);
  return started.finish();
}

function startPrism(canvas: HTMLCanvasElement): Started | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  // Enabled before the first compile: the driver only compiles in its own threads for programs made after the extension is on (asked afterwards, the build was still synchronous).
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const build = (source: string) => {
    const program = gl.createProgram()!;
    for (const [kind, text] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, source],
    ] as const) {
      const shader = gl.createShader(kind)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    return program;
  };
  const fogPass = build(fogShader),
    lightPass = build(scene),
    downPass = build(down),
    blurPass = build(blur),
    finalPass = build(composite);
  const passes = [fogPass, lightPass, downPass, blurPass, finalPass];
  const compiled = async (poll = 12, give = 20000) => {
    if (!parallel) return;
    const until = performance.now() + give;
    while (performance.now() < until && !gl.isContextLost() && !passes.every((program) => gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)))
      await new Promise((resolve) => setTimeout(resolve, poll));
  };
  const finish = (): Prism | null => {
  if (!passes.every((program) => gl.getProgramParameter(program, gl.LINK_STATUS))) {
    for (const program of passes) gl.deleteProgram(program);
    return null;
  }
  const at = (program: WebGLProgram) => (name: string) => gl.getUniformLocation(program, name);
  const f = at(fogPass),
    s = at(lightPass),
    d = at(downPass),
    b = at(blurPass),
    c = at(finalPass);
  const u = {
    fRes: f("res"), fT: f("t"),
    res: s("res"), t: s("t"), tone: s("tone"), power: s("power"), clear: s("clear"), swing: s("swing"), second: s("second"),
    intro: s("intro"), bg: s("bg"), fog: s("fog"), pose: s("pose"),
    dSrc: d("src"), dRes: d("res"), dTexel: d("texel"),
    bSrc: b("src"), bRes: b("res"), bDir: b("dir"),
    cRes: c("res"), cTone: c("tone"), scene: c("scene"), frost: c("frost"),
    glass: c("glass"), glassRect: c("glassRect"), glassR: c("glassR"),
  };
  // Half-float keeps the dark gradients free of banding before the grain; plain 8-bit where it can't render.
  const half = !!gl.getExtension("EXT_color_buffer_float");
  const target = () => {
    const texture = gl.createTexture()!,
      buffer = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    return { texture, buffer, w: 0, h: 0 };
  };
  const fogTarget = target(),
    lightTarget = target(),
    frostA = target(),
    frostB = target();
  const fit = (t: ReturnType<typeof target>, w: number, h: number) => {
    if (w === t.w && h === t.h) return;
    t.w = w;
    t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  let width = 0,
    height = 0,
    ratio = 1;
  const resize = () => {
    if (gl.isContextLost()) return false;
    const rect = canvas.getBoundingClientRect(),
      area = Math.max(1, rect.width * rect.height);
    // Grain needs real device pixels; cap at 2x so 4K stays cheap.
    ratio = Math.min(2, Math.max(1, devicePixelRatio || 1));
    width = Math.max(1, Math.round(rect.width * ratio));
    height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Light is soft: 0.6 of a CSS pixel, never more than about a megapixel. Fog has no fine detail at all: 0.3 of a
    // CSS pixel, at most 0.15 MP. Both stay well inside the frame budget on integrated graphics.
    const light = Math.min(0.6, Math.sqrt(1e6 / area)),
      fog = Math.min(0.3, Math.sqrt(1.5e5 / area));
    fit(lightTarget, Math.max(1, Math.round(rect.width * light)), Math.max(1, Math.round(rect.height * light)));
    fit(fogTarget, Math.max(1, Math.round(rect.width * fog)), Math.max(1, Math.round(rect.height * fog)));
    // The frosting is a 28px blur: an eighth of a CSS pixel holds all of it.
    const fw = Math.max(1, Math.round(rect.width / 8)),
      fh = Math.max(1, Math.round(rect.height / 8));
    fit(frostA, fw, fh);
    fit(frostB, fw, fh);
    return true;
  };
  const draw = (seconds: number, inputs: PrismInputs, field: ArrayLike<number>) => {
    if (gl.isContextLost() || !lightTarget.w) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fogTarget.buffer);
    gl.viewport(0, 0, fogTarget.w, fogTarget.h);
    gl.useProgram(fogPass);
    gl.uniform2f(u.fRes, fogTarget.w, fogTarget.h);
    gl.uniform1f(u.fT, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightTarget.buffer);
    gl.viewport(0, 0, lightTarget.w, lightTarget.h);
    gl.useProgram(lightPass);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fogTarget.texture);
    gl.uniform1i(u.fog, 0);
    gl.uniform2f(u.res, lightTarget.w, lightTarget.h);
    gl.uniform1f(u.t, seconds);
    gl.uniform1f(u.tone, inputs.tone);
    gl.uniform1f(u.power, inputs.power);
    gl.uniform1f(u.clear, inputs.clear);
    gl.uniform1f(u.swing, inputs.swing);
    gl.uniform1f(u.second, inputs.cross);
    gl.uniform1f(u.intro, inputs.intro);
    gl.uniform2f(u.pose, inputs.shiftX, inputs.shiftY);
    gl.uniform3f(u.bg, field[0], field[1], field[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const frosted = inputs.glass > 0.001;
    if (frosted) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frostA.buffer);
      gl.viewport(0, 0, frostA.w, frostA.h);
      gl.useProgram(downPass);
      gl.bindTexture(gl.TEXTURE_2D, lightTarget.texture);
      gl.uniform1i(u.dSrc, 0);
      gl.uniform2f(u.dRes, frostA.w, frostA.h);
      gl.uniform2f(u.dTexel, 1 / lightTarget.w, 1 / lightTarget.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(blurPass);
      gl.uniform1i(u.bSrc, 0);
      gl.uniform2f(u.bRes, frostA.w, frostA.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frostB.buffer);
      gl.bindTexture(gl.TEXTURE_2D, frostA.texture);
      gl.uniform2f(u.bDir, 1 / frostA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frostA.buffer);
      gl.bindTexture(gl.TEXTURE_2D, frostB.texture);
      gl.uniform2f(u.bDir, 0, 1 / frostA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(finalPass);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frostA.texture);
    gl.uniform1i(u.frost, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lightTarget.texture);
    gl.uniform1i(u.scene, 0);
    gl.uniform1f(u.glass, frosted ? inputs.glass : 0);
    gl.uniform4f(u.glassRect, inputs.gx0, inputs.gy0, inputs.gx1, inputs.gy1);
    gl.uniform1f(u.glassR, inputs.gr);
    gl.uniform2f(u.cRes, width, height);
    gl.uniform1f(u.cTone, inputs.tone);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const dispose = () => {
    for (const program of [fogPass, lightPass, downPass, blurPass, finalPass]) gl.deleteProgram(program);
    for (const t of [fogTarget, lightTarget, frostA, frostB]) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.buffer);
    }
  };
  return { resize, draw, dispose };
  };
  return { compiled, finish };
}
