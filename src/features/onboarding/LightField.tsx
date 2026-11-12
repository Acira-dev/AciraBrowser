import { useEffect, useRef } from "react";
import { SCENE_PALETTE, css255, packetTint, poolFalloff, smoothstep } from "./scenePalette";

/** The 2D fallback for the first run's luminous layer, used only without WebGL2 (a window drawn in software: Chromium 139 and later no longer falls back
 * to software WebGL by itself). Same composition and the same colours as `PrismField`, as closely as 2D allows (scenePalette.ts holds the numbers, pinned
 * to the shader by tests/scene-palette.test.ts). Dark: soft beams from beyond the top-right corner and a quieter set from the bottom-right, each warm white
 * with a packet of full spectrum travelling outward along it (violet trailing, red leading), each drawn three times (a wide halo, a body and a bright core)
 * at half resolution so the browser's upscale softens every edge. Light: light through frosted glass on white, pools of pale aqua, lilac and warm peach
 * drifting slowly (the light scene has no beams). */
type Beam = { angle: number; width: number; power: number; phase: number; second: boolean };

function beams(seed: number) {
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const list: Beam[] = [];
  // Angles in radians, y down: the first set fans down-left from the top-right, the second rises up-left.
  for (let i = 0; i < 9; i++)
    list.push({ angle: 2.15 + i * 0.08 + (random() - 0.5) * 0.03, width: 0.5 + random() * 1.4, power: 0.35 + random() * 0.6, phase: random() * 6.28, second: false });
  for (let i = 0; i < 5; i++)
    list.push({ angle: 3.4 + i * 0.085 + (random() - 0.5) * 0.03, width: 1 + random() * 1.2, power: 0.25 + random() * 0.3, phase: random() * 6.28, second: true });
  return list;
}

/** The slice of the 2D context the painter uses (so a test can hand it a recording stand-in). */
export type Paint2D = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "createRadialGradient" | "createLinearGradient" | "fillRect" | "save" | "restore" | "translate" | "scale" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "fill"
> & { globalCompositeOperation: GlobalCompositeOperation; fillStyle: string | CanvasGradient | CanvasPattern };
export type FieldFrame = { dark: boolean; width: number; height: number; t: number; level: number; clear: number; list: Beam[] };
export { beams };

/** One frame of the fallback scene (the component below eases `level` and `clear`, picks the time and the size). */
export function paintLightField(context: Paint2D, frame: FieldFrame) {
  const { dark, width, height, t, level, clear, list } = frame;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, width, height);
  if (dark) drawBeams(t);
  else drawPools(t);
  if (dark && clear > 0.01) {
    // Fade the light out of the centre so hero type never sits on the brightest rays.
    context.globalCompositeOperation = "destination-out";
    const pool = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * 0.62);
    pool.addColorStop(0, `rgba(0,0,0,${0.8 * clear})`);
    pool.addColorStop(0.55, `rgba(0,0,0,${0.5 * clear})`);
    pool.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = pool;
    context.fillRect(0, 0, width, height);
  }
  context.globalCompositeOperation = "source-over";
  // Dark: additive beams of warm white, each with its packet of spectrum travelling outward (the shader's `beam`).
  function drawBeams(t: number) {
    context.globalCompositeOperation = "lighter";
    const H = height,
      first = { x: width + H * 0.02, y: -H * 0.17 },
      second = { x: width + H * 0.05, y: H * 1.16 };
    const fog = css255(SCENE_PALETTE.dark.fog);
    // Haze: a broad glow where the light enters, and two slow drifting banks of fog.
    const haze = (x: number, y: number, r: number, alpha: number) => {
      const g = context.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${fog},${alpha})`);
      g.addColorStop(1, `rgba(${fog},0)`);
      context.fillStyle = g;
      context.fillRect(0, 0, width, height);
    };
    haze(first.x, first.y, H * 1.5, 0.4 * level);
    // Bloom where the light enters, scattered by the haze (the shader's `bloom`): warm white.
    const bloom = context.createRadialGradient(first.x, first.y, 0, first.x, first.y, H * 0.55);
    bloom.addColorStop(0, `rgba(255,245,235,${0.55 * level})`);
    bloom.addColorStop(0.35, `rgba(255,245,235,${0.18 * level})`);
    bloom.addColorStop(1, "rgba(255,245,235,0)");
    context.fillStyle = bloom;
    context.fillRect(0, 0, width, height);
    haze(width * (0.55 + 0.05 * Math.sin(t * 0.03)), H * 0.3, H * 0.9, 0.09 * level);
    haze(width * (0.3 + 0.05 * Math.cos(t * 0.025)), H * 0.75, H * 0.7, 0.04 * level);
    for (const beam of list) {
      const from = beam.second ? second : first,
        angle = beam.angle + Math.sin(t * 0.09 + beam.phase) * 0.012,
        dx = Math.cos(angle),
        dy = Math.sin(angle),
        px = -dy,
        py = dx,
        length = H * (beam.second ? 1.5 : 1.8),
        ex = from.x + dx * length,
        ey = from.y + dy * length,
        flicker = beam.power * level * (beam.second ? 0.7 : 1) * (0.85 + 0.15 * Math.sin(t * 0.23 + beam.phase));
      // The packet: on its own eased cycle it leaves the source, slows into place and fades out at the far end (the shader's `cyc`, `centre`, `env`).
      const own = (beam.phase / 6.28) % 1,
        period = 7 + 5 * ((own * 7.31) % 1),
        cycle = (((t + own * 23) / period) % 1 + 1) % 1,
        eased = cycle * cycle * (3 - 2 * cycle),
        centre = 0.08 + (0.8 - 0.08) * eased,
        half = 0.36,
        cyc = smoothstep(0, 0.14, cycle) * (1 - smoothstep(0.8, 1, cycle)) * (0.75 + 0.25 * own);
      // Along the beam its light fades in from the source and out at the end; its colour is the packet's where the packet is, warm white elsewhere.
      const along = (s: number, alpha: number) => (s < 0.12 ? (alpha * s) / 0.12 : s < 0.5 ? alpha + (alpha * 0.45 - alpha) * ((s - 0.12) / 0.38) : alpha * 0.45 * (1 - (s - 0.5) / 0.5));
      const wedge = (spread: number, alpha: number, core: boolean) => {
        const g = context.createLinearGradient(from.x, from.y, ex, ey);
        const steps = core ? 2 : 14;
        for (let i = 0; i <= steps; i++) {
          const s = i / steps;
          const k = (s - centre) / half;
          const env = (1 - smoothstep(0.6, 1.12, Math.abs(k))) * cyc;
          const color = core ? "255,250,244" : css255(packetTint(k, env));
          g.addColorStop(s, `rgba(${color},${along(s, alpha)})`);
        }
        context.fillStyle = g;
        context.beginPath();
        context.moveTo(from.x - px * spread * 0.35, from.y - py * spread * 0.35);
        context.lineTo(ex - px * spread, ey - py * spread);
        context.lineTo(ex + px * spread, ey + py * spread);
        context.lineTo(from.x + px * spread * 0.35, from.y + py * spread * 0.35);
        context.closePath();
        context.fill();
      };
      const w = beam.width * H * 0.014;
      // Five layers, each narrower and brighter, so a beam fades out across its width instead of ending at a hard edge.
      wedge(w * 11, flicker * 0.05, false);
      wedge(w * 6.5, flicker * 0.1, false);
      wedge(w * 3.5, flicker * 0.2, false);
      wedge(w * 1.8, flicker * 0.34, false);
      wedge(w * 0.8, flicker * 0.34, true);
    }
  }
  // Light: pools of pale aqua, lilac and warm peach over the white stage, drifting slowly (the shader's light branch: `mix(c, colour, pool * weight)`).
  function drawPools(t: number) {
    const H = height,
      calm = 1 - 0.45 * clear,
      { aqua, lilac, peach } = SCENE_PALETTE.light;
    const pool = (cx: number, cy: number, radius: number, stretch: number, spec: { rgb: readonly number[]; weight: number }, amount: number) => {
      const rgb = css255(spec.rgb);
      context.save();
      context.translate(cx, cy);
      context.scale(stretch, 1);
      const g = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      for (const p of [0, 0.08, 0.2, 0.35, 0.5, 0.7, 0.85, 1]) g.addColorStop(p, `rgba(${rgb},${spec.weight * poolFalloff(p) * amount})`);
      context.fillStyle = g;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);
      context.restore();
    };
    const drift = (speed: number, phase: number) => Math.sin(t * speed + phase);
    // The real light scene is an opaque white ground (`c = vec3(1.)`) the pools are mixed into; the stage behind the canvas is a pearl grey (--fr-bg),
    // which a transparent canvas would let through (the pools would sit on grey, not on white).
    context.fillStyle = "rgb(255,255,255)";
    context.fillRect(0, 0, width, height);
    // Lilac and peach first, so the aqua pools lie over them as the shader mixes them.
    pool(width * (0.78 + 0.05 * drift(0.04, 1)), H * (0.62 + 0.05 * drift(0.03, 2)), H * 0.42, 1.5, lilac, 1.25 * level * calm);
    pool(width * (0.12 + 0.05 * drift(0.035, 3)), H * (0.9 + 0.04 * drift(0.045, 4)), H * 0.5, 1.6, lilac, 1.25 * level * calm);
    pool(width * (0.45 + 0.05 * drift(0.03, 7)), H * (0.3 + 0.05 * drift(0.04, 8)), H * 0.36, 1.5, peach, 1.3 * level * calm);
    pool(width * (0.28 + 0.05 * drift(0.04, 9)), H * (0.78 + 0.04 * drift(0.03, 10)), H * 0.34, 1.5, peach, 1.3 * level * calm);
    // Aqua: one where the light enters at the top right, one low on the left (the shader's two fixed pools), one drifting between them.
    pool(width * 0.9, H * 0.2, H * 0.62, 1 / 0.75, aqua, 0.78 * level * calm);
    pool(width * 0.08, H * 0.8, H * 0.55, 1 / 0.75, aqua, 0.78 * level * calm);
    pool(width * (0.38 + 0.08 * drift(0.025, 5)), H * (0.42 + 0.08 * drift(0.02, 6)), H * 0.3, 1.5, aqua, 0.62 * level * calm);
  }
}

export function LightField({
  tone,
  strength = 1,
  reducedMotion,
  className = "",
  seed = 11,
  clearCenter = false,
}: {
  tone: "dark" | "light";
  strength?: number;
  reducedMotion: boolean;
  className?: string;
  seed?: number;
  /** Keep a quiet pool in the middle, where hero text sits. */
  clearCenter?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const power = useRef(strength),
    clearTarget = useRef(clearCenter ? 1 : 0);
  power.current = strength;
  clearTarget.current = clearCenter ? 1 : 0;
  useEffect(() => {
    const node = canvas.current,
      context = node?.getContext("2d");
    if (!node || !context) return;
    const list = beams(seed),
      dark = tone === "dark";
    let width = 0,
      height = 0,
      frame = 0,
      last = 0,
      level = power.current,
      clear = clearTarget.current;
    const resize = () => {
      const rect = node.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width * 0.5));
      height = Math.max(1, Math.round(rect.height * 0.5));
      node.width = width;
      node.height = height;
    };
    const draw = (t: number) => {
      level += (power.current - level) * 0.06;
      clear += (clearTarget.current - clear) * 0.06;
      paintLightField(context, { dark, width, height, t, level, clear, list });
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now / 1000);
    };
    const observer = new ResizeObserver(() => {
      resize();
      draw(reducedMotion ? 0 : performance.now() / 1000);
    });
    observer.observe(node);
    resize();
    draw(reducedMotion ? 0 : performance.now() / 1000);
    if (!reducedMotion) frame = requestAnimationFrame(loop);
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion) frame = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [tone, reducedMotion, seed]);
  return <canvas ref={canvas} className={`fr-light ${className}`} data-tone={tone} aria-hidden="true" />;
}
