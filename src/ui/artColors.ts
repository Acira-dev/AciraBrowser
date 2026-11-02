import { useEffect, useState } from 'react';

const cache = new Map<string, string[]>();

/** Up to `count` distinct, lively colors from a painting: bucketed on a small canvas, weighted by saturation, skipping near black and near white. */
function sample(image: HTMLImageElement, count: number): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; score: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 36 || min > 225) continue;
    const saturation = max ? (max - min) / max : 0;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1; bucket.score += 1 + saturation * 3;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score).map((bucket) => [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]);
  const picked: number[][] = [];
  for (const color of ranked) {
    if (picked.every((other) => Math.hypot(other[0] - color[0], other[1] - color[1], other[2] - color[2]) > 72)) picked.push(color);
    if (picked.length >= count) break;
  }
  return picked.map(([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`);
}

/** Dominant colors of a same-origin image for the new-tab glow. Falls back to the catalog's average color; never throws. */
export function useArtColors(src: string, fallback?: string, enabled = true): string[] {
  const [colors, setColors] = useState<string[]>(() => cache.get(src) ?? (fallback ? [fallback] : []));
  useEffect(() => {
    if (!enabled) return;
    const known = cache.get(src);
    if (known) { setColors(known); return; }
    let live = true;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const found = sample(image, 3);
        if (found.length) cache.set(src, found);
        if (live) setColors(found.length ? found : fallback ? [fallback] : []);
      } catch {
        if (live && fallback) setColors([fallback]);
      }
    };
    image.onerror = () => { if (live && fallback) setColors([fallback]); };
    image.src = src;
    return () => { live = false; };
  }, [src, fallback, enabled]);
  return colors;
}
