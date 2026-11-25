// @ts-nocheck
// The Founding number's foil, moving with the tilt. From the sample pack's shimmer job (src/jobs13.js, jobs.shimmer, foilShift): "slide the foil
// texture with the tilt (the clip uses up to 18 px at 1600 px card width) and sweep a soft light band (white, about 40% peak) across the digits
// with the left-right angle. The keyline stays fixed." Every number below is his. `amp` is the left-right angle his clip turned through.
import { W, H, heroNumber, REG } from './sys12.js';
import { FOIL_DIGITS } from './assets.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const loadImg = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

export async function createFoundingFoil({ number, plate, amp = 0.34 }) {
  const imgs = await Promise.all(FOIL_DIGITS.map(loadImg));
  const colCv = plate.canvas, cx = colCv.getContext('2d'), orig = mk(W, H); orig.getContext('2d').drawImage(colCv, 0, 0);
  const NUMS = String(number), no = { x: 100, y: 1950, cap: 450, align: 'l', track: 0.06, wt: 500 }; // as the Founding card builder (cards20.js, fit 1500)
  { const t = heroNumber(mk(4, 4).getContext('2d'), NUMS, no); REG.pop(); if (100 + t.w + 2 > 1500) no.cap = Math.floor(no.cap * 1400 / (t.w + 2)); }
  const N = heroNumber(mk(4, 4).getContext('2d'), NUMS, no); REG.pop();
  const tc = mk(W, H), t2 = tc.getContext('2d'), nx0 = no.x + N.l, nx1 = no.x + N.r;
  // only this box of the card changes (the number and its keyline): every canvas operation below touches it and nothing else, which keeps a repaint cheap
  const rx0 = Math.max(0, Math.floor(nx0 - 50)), ry0 = Math.max(0, Math.floor(no.y - no.cap - 70)), rw = Math.min(W - rx0, Math.ceil(nx1 - nx0 + 100)), rh = Math.min(H - ry0, Math.ceil(no.cap + 150));
  const textures = new Set([plate.texture]); // the card's colour texture on every scene that shows it (the live card, and the one recording the video)
  const touch = () => { for (const t of textures) t.needsUpdate = true; };
  const paint = (ry, rx) => {
    // `rx` here is the card's pitch from head-on (his clip adds a resting 0.05 to it). `s` is how far the card has turned (0 head-on, 1 at the clip's full tilt): the
    // growth and the band are scaled by it, so the first movement does not jump from the still picture's foil.
    const s = Math.min(1, Math.max(Math.abs(ry / amp), Math.abs(rx / 0.15)));
    const dx = 18 * ry / amp, dy = 18 * rx / 0.15, k = 1 + 0.12 * s; // patch slides up to 18 px; 1.12x keeps the glyph covered
    t2.globalCompositeOperation = 'source-over'; t2.clearRect(rx0, ry0, rw, rh); heroNumber(t2, NUMS, { ...no, fill: '#fff' }); REG.pop();
    t2.globalCompositeOperation = 'source-in';
    N.boxes.forEach((q, i) => { const im = imgs[i % 4], gw = im.naturalWidth * k, gh = im.naturalHeight * k, gx = no.x + (q.l + q.r) / 2 + dx, gy = no.y - no.cap / 2 + dy;
      t2.save(); t2.beginPath(); t2.rect(no.x + q.l - 30, no.y - no.cap - 30, q.r - q.l + 60, no.cap + 60); t2.clip(); t2.drawImage(im, gx - gw / 2, gy - gh / 2, gw, gh); t2.restore(); });
    // a soft light band that crosses the number as the card turns
    const c0 = (nx0 + nx1) / 2 + (ry / amp) * 0.75 * (nx1 - nx0), gr = t2.createLinearGradient(c0 - 260, no.y, c0 + 260, no.y - no.cap);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${(0.42 * s).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    t2.globalCompositeOperation = 'source-atop'; t2.fillStyle = gr; t2.fillRect(rx0, ry0, rw, rh);
    cx.drawImage(orig, rx0, ry0, rw, rh, rx0, ry0, rw, rh); cx.drawImage(tc, rx0, ry0, rw, rh, rx0, ry0, rw, rh); heroNumber(cx, NUMS, { ...no, stroke: 4, strokeCol: 'rgba(18,19,23,1)' }); REG.pop();
    touch();
  };
  // the still picture's own foil (one patch per digit, 1:1, no band): what the saved and copied pictures show
  const rest = () => { cx.drawImage(orig, rx0, ry0, rw, rh, rx0, ry0, rw, rh); touch(); };
  return { paint, rest, attach: (t) => { textures.add(t); }, detach: (t) => { textures.delete(t); }, dispose() { orig.width = orig.height = tc.width = tc.height = 0; } };
}
