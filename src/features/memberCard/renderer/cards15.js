// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
import { W, H } from './sys12.js';
const TAU = Math.PI * 2;
// his insiderToken(): the coin toned to platinum (every gold-hued pixel takes the target's tone at its own lightness). `img` is an image or a canvas; the result is a canvas.
export function toneSeal(hex, img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data; const t = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const tl = (0.3 * t[0] + 0.59 * t[1] + 0.11 * t[2]) / 255;
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i], g = a[i + 1], b = a[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 8) continue;
    const sat = (mx - mn) / mx; let h = 0; if (mx !== mn) { h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; }
    const gold = Math.min(1, Math.max(0, (sat - 0.12) / 0.25)) * (h > 18 && h < 70 ? 1 : 0); if (!gold) continue;
    const L = (0.3 * r + 0.59 * g + 0.11 * b) / 255, k = L / Math.max(tl, 0.05);
    for (let j = 0; j < 3; j++) { const v = k <= 1 ? t[j] * k : t[j] + (255 - t[j]) * Math.min(1, (k - 1) / (1 / tl - 1 + 1e-3)); a[i + j] = a[i + j] * (1 - gold) + v * gold; }
  }
  x.putImageData(d, 0, 0); return c;
}

// engine-turned ground: concentric waved rings about (cx, cy), 7 px pitch; aux 0.5 = neutral, ridges up, grooves down
export function guilloche(ctx, cx, cy, rMax, o = {}) {
  ctx.save(); ctx.lineWidth = o.w || 3.2; ctx.strokeStyle = o.col || '#d8d8d8';
  for (let k = 1, r = 8; r < rMax; k++, r += o.pitch || 7) { ctx.beginPath();
    for (let i = 0; i <= 720; i++) { const t = i / 720 * TAU, rr = r + 1.7 * Math.sin(30 * t + k * 0.42) + 0.8 * Math.sin(7 * t - k * 0.11); const px = cx + rr * Math.cos(t), py = cy + rr * Math.sin(t); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); }
  ctx.restore();
}
