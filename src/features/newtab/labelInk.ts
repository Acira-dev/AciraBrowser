/** Full-background new tab (R3-76): the ink of the shortcut labels follows the painting behind them.
 *  Sampled once per picture and per layout change (never per frame) from the image that is already decoded:
 *  pale ground gets near-black ink with a very soft light glow, dark ground gets white ink with a very soft dark glow. */
export type Ink = 'light' | 'dark';

const WHITE = 1.05, INK_DARK = 0.0044 + 0.05; // (L + .05) of white ink and of the near-black ink (rgb 14 14 16)
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** Relative luminance of one sRGB pixel. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** The lightest and darkest ground a label sits on (10th and 90th percentile of the pixels behind it): the worst case for each ink. */
export function groundOf(values: ArrayLike<number>): { dark: number; light: number } {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return { dark: 0, light: 0 };
  return { dark: sorted[Math.floor(sorted.length * 0.1)], light: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] };
}
/** Contrast of white ink over its lightest ground, and of near-black ink over its darkest ground. */
export const inkContrast = (ground: { dark: number; light: number }) => ({ light: WHITE / (ground.light + 0.05), dark: (ground.dark + 0.05) / INK_DARK });

/** The ink with the better worst case. A tie-break toward white keeps dark and mid paintings on the house default. */
export function pickInk(ground: { dark: number; light: number }): Ink {
  const c = inkContrast(ground);
  return c.dark > c.light * 1.15 ? 'dark' : 'light';
}

/** Where `object-fit: cover` puts the picture in a box: scale, and the offset of its top-left corner. `position` is CSS object-position ("50% 30%"). */
export function coverPlacement(box: { width: number; height: number }, natural: { width: number; height: number }, position = '50% 50%') {
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const [px, py] = position.split(/\s+/).map((part) => (part.endsWith('%') ? Number.parseFloat(part) / 100 : 0.5));
  const x = Number.isFinite(px) ? px : 0.5, y = Number.isFinite(py) ? py : 0.5;
  return { scale, x: (box.width - natural.width * scale) * x, y: (box.height - natural.height * scale) * y };
}

const STEP = 6; // css px per sample: a 1300 x 830 page reads as about 215 x 140 pixels

/** Reads the picture behind each label. Returns null when the canvas cannot be read (a cross-origin picture): the caller keeps the safe default. */
export function measureInks(art: HTMLElement, image: HTMLImageElement, labels: HTMLElement[]): Map<HTMLElement, Ink> | null {
  const box = art.getBoundingClientRect();
  if (!box.width || !box.height || !image.naturalWidth || !labels.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(box.width / STEP); canvas.height = Math.ceil(box.height / STEP);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const place = coverPlacement(box, { width: image.naturalWidth, height: image.naturalHeight }, getComputedStyle(image).objectPosition);
  try {
    context.drawImage(image, place.x / STEP, place.y / STEP, image.naturalWidth * place.scale / STEP, image.naturalHeight * place.scale / STEP);
    const read = (rect: { left: number; top: number; right: number; bottom: number }) => {
      const x0 = Math.max(0, Math.floor((rect.left - box.left - 4) / STEP)), x1 = Math.min(canvas.width, Math.ceil((rect.right - box.left + 4) / STEP));
      const y0 = Math.max(0, Math.floor((rect.top - box.top - 4) / STEP)), y1 = Math.min(canvas.height, Math.ceil((rect.bottom - box.top + 4) / STEP));
      if (x1 <= x0 || y1 <= y0) return [] as number[];
      const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0), out: number[] = [];
      for (let i = 0; i < data.length; i += 4) out.push(luminance(data[i], data[i + 1], data[i + 2]));
      return out;
    };
    const textRect = (label: HTMLElement) => { const range = document.createRange(); range.selectNodeContents(label.querySelector('bdi') ?? label); const rect = range.getBoundingClientRect(); return rect.width ? rect : label.getBoundingClientRect(); };
    const rects = labels.map(textRect);
    // One ink for the row when it works for every label (a row that flips colour label by label looks broken); a label that the row's ink cannot serve takes the other.
    const band = groundOf(rects.flatMap(read)), rowInk = pickInk(band), result = new Map<HTMLElement, Ink>();
    labels.forEach((label, index) => {
      const ground = groundOf(read(rects[index])), c = inkContrast(ground);
      const own = pickInk(ground), rowContrast = rowInk === 'dark' ? c.dark : c.light;
      result.set(label, rowContrast >= 4.5 ? rowInk : own);
    });
    return result;
  } catch {
    return null; // tainted canvas
  }
}

/** The ink for a picture whose pixels cannot be read: from its catalog average color (#rrggbb), or undefined. */
export function inkFromColor(color?: string): Ink | undefined {
  const match = color && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return undefined;
  const value = luminance(parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16));
  return pickInk({ dark: value, light: value });
}
