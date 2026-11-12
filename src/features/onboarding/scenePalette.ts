/** The first run's scene colours, as numbers, for the 2D fallback (LightField.tsx) that draws the scene on a window without WebGL2.
 *
 * Every constant here is copied from the shader (prismRenderer.ts, the light pass) and pinned to it by tests/scene-palette.test.ts, so the two
 * cannot drift apart: the fallback shows the colours the person would see with WebGL2, as closely as 2D allows.
 *
 * Dark: soft beams of warm white; on each, a packet of full spectrum travels outward (violet trailing, red leading), fading in at the source and
 * out at the end. Light: light through frosted glass on white: pools of pale aqua, lilac and warm peach. (Beams are the dark scene's; the light
 * scene has none.) */

export type Rgb = readonly [number, number, number];

export const SCENE_PALETTE = {
  dark: {
    /** The beam's own colour outside the spectrum packet (`vec3(1.,.975,.95)`). */
    warmWhite: [1, 0.975, 0.95] as Rgb,
    /** The haze the beams glow through (`vec3(.62,.66,.76)`). */
    fog: [0.62, 0.66, 0.76] as Rgb,
    /** hue = clamp(origin - slope * k, min, max), k running -1..1 across the packet (violet trailing, red leading). */
    hueOrigin: 0.375,
    hueSlope: 0.46,
    hueMin: 0.012,
    hueMax: 0.8,
    saturation: 0.97,
  },
  light: {
    white: [1, 1, 1] as Rgb,
    /** Pools mix toward their colour by `weight` where they are strongest (`mix(c, aqua, pool*.86)` and so on). */
    aqua: { rgb: [0.6, 0.83, 0.935] as Rgb, weight: 0.86 },
    lilac: { rgb: [0.82, 0.77, 0.97] as Rgb, weight: 0.44 },
    peach: { rgb: [0.995, 0.83, 0.73] as Rgb, weight: 0.36 },
  },
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** GLSL smoothstep, including edge0 > edge1 (a falling edge). */
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The shader's smooth HSV (after iq): no kinks between hues. h, s, v in 0..1. */
export function hsv(h: number, s: number, v: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  [0, 4, 2].forEach((offset, i) => {
    const m = (((h * 6 + offset) % 6) + 6) % 6;
    let k = clamp01(Math.abs(m - 3) - 1);
    k = k * k * (3 - 2 * k);
    out[i] = v * (1 + (k - 1) * s);
  });
  return out;
}

/** The hue (0..1) at k across the dark scene's spectrum packet. */
export function packetHue(k: number) {
  const p = SCENE_PALETTE.dark;
  return Math.min(p.hueMax, Math.max(p.hueMin, p.hueOrigin - p.hueSlope * k));
}

/**
 * The colour of the dark beam at k across its packet (the shader's `tint`): the packet's spectrum, red lifted so it reads as a rich red beside the
 * greens and blues, mixed into the beam's warm white by `env` (0 outside the packet or while it is fading, 1 inside). Linear 0..1, may exceed 1 for red.
 */
export function packetTint(k: number, env: number): [number, number, number] {
  const p = SCENE_PALETTE.dark;
  const hue = packetHue(k);
  const lift = 1 + (1 - smoothstep(0, 0.1, hue));
  const spectrum = hsv(hue, p.saturation, 1).map((c) => c * lift);
  return [0, 1, 2].map((i) => p.warmWhite[i] + (spectrum[i] - p.warmWhite[i]) * clamp01(env)) as [number, number, number];
}

/** "r,g,b" in 0..255 for a linear colour, clamped. */
export function css255(rgb: readonly number[]) {
  return rgb.map((c) => Math.round(clamp01(c) * 255)).join(",");
}

/** How strongly a pool shows at normalized distance p (0 at its centre, 1 at its edge): the shader's `smoothstep(.62, .05, length)`, p = length / .62. */
export function poolFalloff(p: number) {
  return smoothstep(0.62, 0.05, p * 0.62);
}
