/** The Favorites behind the panel disperse at its advancing edge (Beta 14, L5), and the panel forms out of them.
 *
 *  the team's description: the panel grows from the stack with a soft edge. Where that edge reaches a Favorite, the tile itself disperses, starting from the side the
 *  edge reaches first and moving across it, smooth and continuous in the character of our blur-and-fade (never grain, particles, clouds or smoke), its substance drawn off in
 *  the direction of travel and thinning out; that matter becomes the panel.
 *
 *  How: one WebGL2 quad over the panel's box draws a still copy of the Favorites (painted once, at the start, from the tiles' own colours and icons). Outside the edge it draws
 *  nothing: the real tiles show there. Inside the edge, over a band `W` wide, every pixel samples the copy along the direction of travel (the line from the stack through that
 *  pixel): the deeper into the band, the longer that smear, the further its drift and the lower its alpha. So a tile thins from its leading side across to its trailing side, and
 *  its colour runs along with the edge before it fades into the panel's material, which condenses over the same band (a CSS mask in favorites-stack.css).
 *
 *  FAIL SAFE (an earlier sample left a white rectangle on screen): the canvas exists only while the edge moves. Any doubt (a hidden page, no WebGL2, a shader or texture refused, an
 *  icon that taints the copy, the context lost half way: GPU restart, driver reset, sleep) removes it at once and calls `onLost`, so the caller falls back to the plain blur-and-fade.
 *  A canvas is never left on screen with a cleared or stale buffer: it leaves the tree the moment the motion ends, however it ends. Its GPU side is freed only after the frames without it have been
 *  presented (afterPresented): the context lost in the same task as the removal drew the canvas as a white box for a frame or two. */
const VS = `#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D T;uniform vec2 size;uniform vec4 front;uniform vec2 origin;uniform float W,L,drift,lat,seam,rad;
out vec4 o;
// the front is a rounded rectangle: no corner ever reads as a box
float sd(vec2 p){vec2 c=(front.xy+front.zw)*.5,h=max((front.zw-front.xy)*.5,vec2(0.));float r=min(rad,min(h.x,h.y));vec2 q=abs(p-c)-h+r;return -(length(max(q,0.))+min(max(q.x,q.y),0.)-r);}
void main(){
 vec2 p=vec2(gl_FragCoord.x,size.y-gl_FragCoord.y);
 float d=sd(p);
 if(d<=0.||W<=0.){o=vec4(0.);return;}
 float s=clamp(d/W,0.,1.);
 if(s>=1.){o=vec4(0.);return;}
 vec2 v=p-origin;float n=length(v);vec2 D=n>.001?v/n:vec2(-1.,0.);vec2 N=vec2(-D.y,D.x);
 // smoothstep-shaped growth: the first few px stay nearly sharp, so the hand-over from the real tile is invisible
 float g=s*s*(3.-2.*s);
 float len=L*g,sh=drift*g,lw=lat*g;
 vec4 acc=vec4(0.);float ws=0.;
 for(int i=0;i<14;i++){
  float t=(float(i)+.5)/14.;
  float w=1.-t*.85;
  for(int j=-1;j<=1;j++){
   float wj=j==0?1.:.55;
   vec2 q=p-D*(sh+len*t)+N*(float(j)*lw);
   acc+=texture(T,q/size)*(w*wj);ws+=w*wj;
  }
 }
 vec4 c=acc/ws;
 // the matter thins as it is drawn off: gone by the band's inner side
 float thin=1.-smoothstep(.05,1.,s);
 // hand-over from the real tile: its mask falls linearly over seam px, this rises over the same px
 o=c*thin*clamp(d/seam,0.,1.);
}`;
export type Front = { l: number; t: number; r: number; b: number };
export interface Disperser { draw(front: Front, band: number, radius: number): void; destroy(): void; ok: boolean }

const parsePx = (v: string) => parseFloat(v) || 0;
/** An element's own opacity for the still copy: a finite 0 is 0 (a tile or icon that is not drawn is not painted); `|| 1` made it a fully drawn tile. Only a value that is not a number counts as 1. */
export const alphaOf = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 1; };
/** Runs `fn` once the page has produced a few frames since now and a quarter of a second has passed (a window that draws no frames, hidden or throttled, gets it after a second). */
function afterPresented(fn: () => void) {
  let done = false, frames = 0;
  const t0 = performance.now(), once = () => { if (done) return; done = true; fn(); };
  const step = () => { if (++frames < 3) requestAnimationFrame(step); else window.setTimeout(once, Math.max(0, 250 - (performance.now() - t0))); };
  requestAnimationFrame(step); window.setTimeout(once, 1000);
}
/** Paints the tiles (background, ring, icon) into a 2D canvas at the panel's device scale. */
function paintTiles(ctx: CanvasRenderingContext2D, tiles: HTMLElement[], P: DOMRect, k: number) {
  for (const tile of tiles) {
    const r = tile.getBoundingClientRect(), cs = getComputedStyle(tile), x = (r.left - P.left) * k, y = (r.top - P.top) * k, w = r.width * k, h = r.height * k;
    const zoom = tile.offsetWidth ? r.width / tile.offsetWidth : 1, radius = parsePx(cs.borderTopLeftRadius) * zoom * k;
    ctx.save(); ctx.globalAlpha = alphaOf(cs.opacity);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = cs.backgroundColor; ctx.fill();
    const ring = /inset/.test(cs.boxShadow) ? /(rgba?\([^)]+\)|oklch\([^)]+\)|color\([^)]+\)|#[0-9a-f]+).*?(\d+(?:\.\d+)?)px inset/i.exec(cs.boxShadow) : null;
    if (ring) { const lw = parseFloat(ring[2]) * zoom * k; ctx.beginPath(); ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, radius - lw / 2)); ctx.lineWidth = lw; ctx.strokeStyle = ring[1]; ctx.stroke(); }
    const icon = tile.querySelector<HTMLElement>('img,svg,.sb-app-initial');
    if (icon) {
      const ir = icon.getBoundingClientRect(), ix = (ir.left - P.left) * k, iy = (ir.top - P.top) * k, iw = ir.width * k, ih = ir.height * k, io = alphaOf(getComputedStyle(icon).opacity);
      ctx.globalAlpha *= io;
      if (icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth) ctx.drawImage(icon, ix, iy, iw, ih);
      else if (icon.classList.contains('sb-app-initial')) { const ics = getComputedStyle(icon); ctx.font = `${ics.fontWeight} ${parsePx(ics.fontSize) * zoom * k}px ${ics.fontFamily}`; ctx.fillStyle = ics.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon.textContent || '', ix + iw / 2, iy + ih / 2); }
    }
    ctx.restore();
  }
}

/** Sets up the quad over `panel` (as its own layer under the material), painting `tiles` once. `origin` is the stack's centre (viewport px). `onLost` is called once if the
 *  canvas had to be dropped while it was in use (the caller then runs the plain fade). */
export function createDisperser(panel: HTMLElement, tiles: HTMLElement[], origin: { x: number; y: number }, onLost: () => void = () => {}): Disperser {
  const P = panel.getBoundingClientRect(), dpr = devicePixelRatio || 1, k = dpr, cw = Math.max(1, Math.round(P.width * k)), ch = Math.max(1, Math.round(P.height * k));
  const canvas = document.createElement('canvas'); canvas.className = 'sb-disperse'; canvas.setAttribute('aria-hidden', 'true'); canvas.width = cw; canvas.height = ch;
  const nothing: Disperser = { ok: false, draw() {}, destroy() { canvas.remove(); } };
  if (document.hidden || (globalThis as { __aciraNoWebGL?: boolean }).__aciraNoWebGL || cw * ch > 16_000_000) return nothing;
  const paint = document.createElement('canvas'); paint.width = cw; paint.height = ch;
  const c2 = paint.getContext('2d'); if (!c2) return nothing;
  try { paintTiles(c2, tiles, P, k); } catch { return nothing; }
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl || gl.isContextLost()) return nothing;
  const release = () => { if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
  let prog: WebGLProgram;
  try { prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog) || 'link'); }
  catch (error) { console.warn('[favorites] disperse shader', error); release(); return nothing; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint); }
  catch (error) { console.warn('[favorites] disperse: icon copy refused', error); release(); return nothing; }
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uSize = u('size'), uFront = u('front'), uOrigin = u('origin'), uW = u('W'), uL = u('L'), uDrift = u('drift'), uLat = u('lat'), uSeam = u('seam'), uRad = u('rad');
  gl.uniform1i(u('T'), 0); gl.uniform2f(uSize, cw, ch); gl.uniform2f(uOrigin, (origin.x - P.left) * k, (origin.y - P.top) * k);
  gl.viewport(0, 0, cw, ch); gl.clearColor(0, 0, 0, 0);
  // the canvas sits in the panel's own (zoomed) box: its CSS size is the panel's layout size
  const zoom = panel.offsetWidth ? P.width / panel.offsetWidth : 1;
  Object.assign(canvas.style, { width: `${P.width / zoom}px`, height: `${P.height / zoom}px` });
  let lost = false, gone = false;
  // The canvas leaves the tree at once, but its GPU side (texture, program, the context itself) is freed a little LATER, after the frames without it have been presented: losing the context in
  // the same task as the removal left the compositor drawing the canvas's last frame with its image gone, a white box the size of the panel for a frame or two (measured in the real app:
  // about half of the open and close cycles, 8 of 18; with the release deferred, or never made, 0 of 18).
  const destroy = () => { if (gone) return; gone = true; canvas.removeEventListener('webglcontextlost', onContextLost); canvas.remove(); if (!lost && !gl.isContextLost()) afterPresented(() => { if (!lost && !gl.isContextLost()) { gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteProgram(prog); release(); } }); };
  function onContextLost(event: Event) { event.preventDefault(); if (gone) return; lost = true; console.warn('[favorites] disperse: WebGL context lost, plain fade'); destroy(); onLost(); }
  canvas.addEventListener('webglcontextlost', onContextLost);
  panel.appendChild(canvas);
  return {
    ok: true,
    draw(front, band, radius) {
      // front, band, radius: viewport px
      if (gone || lost) return;
      if (gl.isContextLost()) { onContextLost(new Event('webglcontextlost')); return; }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(uFront, (front.l - P.left) * k, (front.t - P.top) * k, (front.r - P.left) * k, (front.b - P.top) * k);
      const W = band * k; gl.uniform1f(uW, W); gl.uniform1f(uRad, radius * k); gl.uniform1f(uL, W * 0.45); gl.uniform1f(uDrift, W * 0.3); gl.uniform1f(uLat, W * 0.36); gl.uniform1f(uSeam, 2 * k * (P.width / (panel.offsetWidth || P.width)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy,
  };
}

/** WARM-UP (Beta 14.0, the first open of a launch): the panel's first open used to cost the interface's main thread up to ~0.5 s inside the click (a WebGL2 context, the program's link
 *  (getProgramParameter blocks until the GPU process has linked it), the first texture upload and draw, and the first raster of the panel's blur and masks), so nothing moved for that long and the
 *  morph's first frames were missing. The same work is done once here, while the browser is idle, on a 4 x 4 canvas that is never in the tree, and freed again at once: the GPU process then has
 *  the program and its pipelines when the person presses the stack, and the open costs what every later open costs. Nothing stays resident (the context is lost a quarter of a second after its
 *  one draw). Only when a stack exists (the caller), only after start-up has settled, never while a tab is loading or the sidebar is moving (`busy`, retried every 2 s, at most 8 times), and
 *  only with KHR_parallel_shader_compile, so neither this thread nor the GPU process waits on the link (without the extension nothing is warmed and the first open stays as it was). Once per page. */
let warmed = false;
const SIDEBAR_MOVING = ['data-sm-morph', 'data-sm-pin', 'data-sidebar-resizing'];
export function warmFavoritesPanelWhenIdle(busy: () => boolean = () => false): () => void {
  if (warmed || typeof document === 'undefined' || typeof requestIdleCallback !== 'function' || (globalThis as { __aciraNoWebGL?: boolean }).__aciraNoWebGL) return () => {};
  let timer = 0, idle = 0, poll = 0, cancelled = false, tries = 0;
  const later = (ms: number) => { timer = window.setTimeout(() => { idle = requestIdleCallback(run, { timeout: 5000 }); }, ms); };
  const run = () => {
    if (cancelled || warmed) return;
    if (document.hidden || busy() || SIDEBAR_MOVING.some(name => document.documentElement.hasAttribute(name))) { if (++tries < 8) later(2000); return; }
    warmed = true;
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl || gl.isContextLost()) return;
    const free = () => { try { if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone */ } };
    const ext = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
    if (!ext) { free(); return; }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(prog, s); }
      gl.linkProgram(prog);
    } catch { free(); return; }
    let waited = 0;
    const finish = () => {
      poll = 0; if (gl.isContextLost()) return;
      if (!gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) { if ((waited += 50) < 3000) poll = window.setTimeout(finish, 50); else free(); return; }
      try {
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { free(); return; }
        // the same path a real open takes: a 2D canvas painted like the still copy, uploaded as the texture, one draw of the program
        const paint = document.createElement('canvas'); paint.width = 4; paint.height = 4; const c2 = paint.getContext('2d');
        if (c2) { c2.beginPath(); c2.roundRect(0, 0, 4, 4, 1); c2.fillStyle = 'rgba(128,128,128,.5)'; c2.fill(); }
        gl.useProgram(prog);
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        if (c2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint);
        for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
        const u = (name: string) => gl.getUniformLocation(prog, name);
        gl.uniform1i(u('T'), 0); gl.uniform2f(u('size'), 4, 4); gl.uniform2f(u('origin'), 4, 4); gl.uniform4f(u('front'), 0, 0, 4, 4);
        gl.uniform1f(u('W'), 4); gl.uniform1f(u('L'), 2); gl.uniform1f(u('drift'), 1); gl.uniform1f(u('lat'), 1); gl.uniform1f(u('seam'), 1); gl.uniform1f(u('rad'), 1);
        gl.viewport(0, 0, 4, 4); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.flush();
        // the raster side: one 1 px element with the panel's kinds of paint (a blur, a mask) at an opacity nobody can see, for two frames
        const probe = document.createElement('div'); probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;opacity:.01;pointer-events:none;background:#808080;filter:blur(4px);-webkit-mask-image:linear-gradient(#000,transparent);mask-image:linear-gradient(#000,transparent);will-change:opacity,transform';
        document.body.appendChild(probe); requestAnimationFrame(() => requestAnimationFrame(() => probe.remove()));
      } catch { /* a refusal here only means the first open is not warmed */ }
      window.setTimeout(free, 400);
    };
    poll = window.setTimeout(finish, 50);
  };
  later(2500);
  return () => { cancelled = true; clearTimeout(timer); clearTimeout(poll); if (idle) cancelIdleCallback(idle); };
}
