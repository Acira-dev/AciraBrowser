/**
 * Noël's frost, made by code (no image is shipped). The first study's frosted glass: a soft haze with a few bright specks that reaches down unevenly and is gone by the middle of the
 * tab, drawn sharp at 3x so there are no square blocks. One tile 300 x 36 px, worked out pixel by pixel; the noise runs round a cylinder, so the tile repeats across a tab with no seam.
 * Ported from `frostStrip` in the design notes; the numbers are the study's.
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export const FROST_W = 300, FROST_H = 36;

/** The tile as RGBA bytes at `K` times its size (a pure function: a test can hold it). */
export function frostPixels(dark: boolean, seedN: number, K = 3): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer>; points: [number, number, number][] } {
  const TW = FROST_W, TH = FROST_H, W = TW * K, H = TH * K, d = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  let a = seedN >>> 0; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  // gradient noise in three dimensions (no grid blocks)
  const P = new Uint8Array(512); { const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
  const fd5 = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const gr = (h: number, x: number, y: number, z: number) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  const pn = (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255; x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z); const u = fd5(x), v = fd5(y), w = fd5(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return lerp(lerp(lerp(gr(P[AA], x, y, z), gr(P[BA], x - 1, y, z), u), lerp(gr(P[AB], x, y - 1, z), gr(P[BB], x - 1, y - 1, z), u), v), lerp(lerp(gr(P[AA + 1], x, y, z - 1), gr(P[BA + 1], x - 1, y, z - 1), u), lerp(gr(P[AB + 1], x, y - 1, z - 1), gr(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
  // a point of the strip, in noise units for features `f` px across: x runs round a circle (seamless), y runs down it
  const RC = TW / (2 * Math.PI);
  const N = (xp: number, yp: number, f: number, off: number) => { const ang = xp / RC; return pn(Math.cos(ang) * RC / f + off, Math.sin(ang) * RC / f + off * 1.7, yp / f + off * .3); };
  // colours (the first frost's): white-blue in dark, a cool blue that reads on a white plate in light
  const cTop = dark ? [238, 247, 255, .95] : [128, 170, 228, .85], cLow = dark ? [200, 224, 252, .85] : [176, 206, 244, .7];
  for (let py = 0; py < H; py++) {
    const yp = (py + .5) / K;
    const t = clamp(yp / 34, 0, 1), cr = lerp(cTop[0], cLow[0], t), cg = lerp(cTop[1], cLow[1], t), cb = lerp(cTop[2], cLow[2], t), ca = lerp(cTop[3], cLow[3], t);
    for (let px = 0; px < W; px++) {
      const xp = (px + .5) / K;
      // it reaches a little further down in some places than others, softly (patches about 20 px across)
      const f = yp / (34 * (1 + .3 * N(xp, yp * .5, 20, 3.1)));
      // the first frost's fade: all of it at the top, 40 % a quarter of the way down, little by the middle, gone by 70 %
      const haze = f < .24 ? 1 - .6 * f / .24 : f < .5 ? .4 - .34 * (f - .24) / .26 : f < .7 ? .06 * (1 - (f - .5) / .2) : 0;
      if (haze <= 0 && yp > 3) { d[(py * W + px) * 4 + 3] = 0; continue; }
      // the first frost's soft clouds (patches about 16 px) and its bright specks, round now instead of square
      const cloud = .5 + .5 * (N(xp, yp, 16, 1.3) + .5 * N(xp, yp, 8, 4.2) + .25 * N(xp, yp, 4, 6.6));
      const speck = Math.pow(clamp(.5 + .5 * N(xp, yp, 2.4, 9.4), 0, 1), 9) * 1.7;
      // a crisp grain a pixel across, so it reads as ice and not blur
      const grain = .5 + .5 * N(xp, yp, 1.1, 5.5);
      let al = clamp(.33 + .4 * clamp((cloud - .3) * 1.8, 0, 1) + speck, 0, 1) * (.84 + .32 * grain) * haze;
      // where the snow sits: a dense rime right under it, so the frost starts in the snow (one material, no line between them); in light a blue line would read as a border, so half
      al += Math.exp(-yp / 1.7) * (.26 + .26 * grain) * (dark ? 1 : .5);
      al = clamp(al, 0, 1);
      const k = (py * W + px) * 4; d[k] = cr; d[k + 1] = cg; d[k + 2] = cb; d[k + 3] = Math.round(al * ca * 255);
    }
  }
  // a few grains catch the light (drawn over the pixels by `frostStrip`): tiny round points
  const points: [number, number, number][] = []; for (let i = 0; i < 7; i++) points.push([r() * TW, 1 + Math.pow(r(), 1.5) * 6, .18 + r() * .18]);
  return { width: W, height: H, data: d, points };
}

/** The tile as a PNG data URL (about 20 ms per appearance on a laptop; call it when the theme turns on, one appearance at a time). */
export function frostStrip(dark: boolean, seedN = 7, K = 3): string {
  const { width: W, height: H, data, points } = frostPixels(dark, seedN, K), TW = FROST_W;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.putImageData(new ImageData(data, W, H), 0, 0); g.scale(K, K);
  for (const dx of [-TW, 0, TW]) for (const [x0, y, rad] of points) {
    const x = x0 + dx, hg = g.createRadialGradient(x, y, 0, x, y, rad * 4.2); hg.addColorStop(0, dark ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.85)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg; g.fillRect(x - rad * 4.2, y - rad * 4.2, rad * 8.4, rad * 8.4);
    g.fillStyle = dark ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,1)'; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  return c.toDataURL('image/png');
}
