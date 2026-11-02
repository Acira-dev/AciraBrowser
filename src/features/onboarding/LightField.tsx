import { useEffect, useRef } from "react";

/** The 2D fallback for the first run's luminous layer, used only without WebGL2. Same composition as `PrismField`:
 * soft beams from beyond the top-right corner, a quieter set from the bottom-right, slow haze. Each beam is a wedge
 * drawn three times — a wide halo, a body and a bright core — with its light fading along its length, at half
 * resolution so the browser's upscale softens every edge. Dark: additive light with a faint warm/cool tint. Light:
 * pale iridescent film. */
type Beam = { angle: number; width: number; power: number; hue: number; phase: number; second: boolean };

function beams(seed: number) {
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const list: Beam[] = [];
  // Angles in radians, y down: the first set fans down-left from the top-right, the second rises up-left.
  for (let i = 0; i < 9; i++)
    list.push({ angle: 2.15 + i * 0.08 + (random() - 0.5) * 0.03, width: 0.5 + random() * 1.4, power: 0.35 + random() * 0.6, hue: 170 + random() * 160, phase: random() * 6.28, second: false });
  for (let i = 0; i < 5; i++)
    list.push({ angle: 3.4 + i * 0.085 + (random() - 0.5) * 0.03, width: 1 + random() * 1.2, power: 0.25 + random() * 0.3, hue: 170 + random() * 160, phase: random() * 6.28, second: true });
  return list;
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
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = dark ? "lighter" : "source-over";
      const H = height,
        first = { x: width + H * 0.02, y: -H * 0.17 },
        second = { x: width + H * 0.05, y: H * 1.16 };
      // Haze: a broad glow where the light enters, and two slow drifting banks of fog.
      const haze = (x: number, y: number, r: number, alpha: number) => {
        const g = context.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? `rgba(200,206,222,${alpha})` : `rgba(255,255,255,${alpha * 2.2})`);
        g.addColorStop(1, "rgba(200,206,222,0)");
        context.fillStyle = g;
        context.fillRect(0, 0, width, height);
      };
      haze(first.x, first.y, H * 0.9, 0.1 * level);
      haze(width * (0.55 + 0.05 * Math.sin(t * 0.03)), H * 0.3, H * 0.7, 0.035 * level);
      haze(width * (0.3 + 0.05 * Math.cos(t * 0.025)), H * 0.75, H * 0.6, 0.025 * level);
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
        const hue = (beam.hue + t * 4) % 360;
        const wedge = (spread: number, alpha: number, core: boolean) => {
          const color = dark ? (core ? "255,250,244" : `${hsl(hue, 0.35, 0.8)}`) : core ? "255,255,255" : hsl(hue, 0.85, 0.74);
          const g = context.createLinearGradient(from.x, from.y, ex, ey);
          g.addColorStop(0, `rgba(${color},0)`);
          g.addColorStop(0.12, `rgba(${color},${alpha})`);
          g.addColorStop(0.5, `rgba(${color},${alpha * 0.45})`);
          g.addColorStop(1, `rgba(${color},0)`);
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
        wedge(w * 6, flicker * (dark ? 0.08 : 0.22), false);
        wedge(w * 2.2, flicker * (dark ? 0.16 : 0.3), false);
        wedge(w * 0.6, flicker * (dark ? 0.3 : 0.45), true);
      }
      if (clear > 0.01) {
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

// "r,g,b" for an HSL color (s, l in 0..1).
function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l),
    f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
    };
  return `${f(0)},${f(8)},${f(4)}`;
}
