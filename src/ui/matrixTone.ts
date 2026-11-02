export type MatrixTone = 'ink' | 'accent' | 'soft';

const LIGHT_INK: [number, number, number, number] = [37, 38, 43, 1];
const DEFAULT_ACCENT = '#3b6eea';

function parseRgb(value: string): [number, number, number, number] | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
}
const rgba = ([r, g, b]: number[], alpha: number) => `rgba(${r},${g},${b},${+alpha.toFixed(3)})`;

/** The lit and unlit colors for a dot matrix. Ink and soft lights take the color of the surrounding text, so they read on
 * light, dark and every finish; accent lights follow the finish accent. */
export function toneColors(tone: MatrixTone, textColor: string, accent: string): [string, string] {
  if (tone === 'accent') {
    const hex = /^#([0-9a-f]{6})$/i.exec(accent.trim()), value = hex ? accent.trim() : DEFAULT_ACCENT, n = parseInt(value.slice(1), 16);
    return [value, rgba([n >> 16, (n >> 8) & 255, n & 255], .16)];
  }
  const ink = parseRgb(textColor) ?? LIGHT_INK;
  return tone === 'soft' ? [rgba(ink, ink[3] * .42), rgba(ink, .06)] : [rgba(ink, ink[3]), rgba(ink, .085)];
}
