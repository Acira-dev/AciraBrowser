import { useEffect, useRef, useState } from "react";
import { LightField } from "./LightField";
import { createPrismAsync, type Prism, type PrismInputs } from "./prismRenderer";
import { poseDrift, poseOmega, settle } from "./poseSpring";
import { motionScale } from "../../ui/sharedMotion";

/** The first run's one luminous layer: light through fog (founder review 24 Oct, bible §11) — see `prismRenderer.ts`.
 * Renders on every display frame (60/75/120/144Hz alike): motion is time-based and the per-step easing is
 * frame-rate independent; the loop allocates nothing; it stops while the window is hidden or minimised. One still frame
 * for reduced motion, and the 2D field only without WebGL2.
 *
 * Glass contract: an element inside the stage marked `data-prism-glass` (the frosted setup card) gets its frosting drawn
 * by the scene — inside its rounded rect the light is blurred and saturated — and the canvas carries `data-glass` while
 * it does, so the card's CSS can drop `backdrop-filter` (which would re-blur the whole animating canvas every frame):
 * `.fr-stage:has(> .fr-prism[data-glass]) [data-prism-glass] { backdrop-filter: none }`. The card's rect, corner radius
 * and the inline opacity of it and its ancestors (motion's enter/exit) are followed while anything in the stage moves. */

// Where the clock starts: color is already partway along the beams on the first frame (and the reduced-motion still).
const START = 6;
// The second set of beams frames the composition at roughly half the strength of the first.
const CROSS = 0.55;
// The entrance (bible §11 welcome sequence): smoke rises from black, the source ignites, beams reach into the smoke.
const INTRO = 1.2;
// Every step reaches its pose on a critically damped spring (poseSpring.ts), at every refresh rate.
const finaleOwners = new WeakMap<HTMLCanvasElement, (copy: HTMLCanvasElement, hold: number) => void>();
/** Continue the existing GPU scene in an inert copy of the stage (finale.ts's quiet fade), without compiling a second
 * renderer: the card's frosting lifts, then the last frame holds until `hold` ms, when every GPU resource is released. */
export function handoffPrism(source: HTMLCanvasElement | undefined, copy: HTMLCanvasElement, hold: number) {
  const transfer = source && finaleOwners.get(source);
  if (!transfer) return false;
  transfer(copy, hold);
  return true;
}
// The card's frosting lifts off the scene in this long once setup hands over (ms).
const FROST_LIFT = 220;
const frostOwners = new WeakMap<HTMLCanvasElement, () => void>();
/** Draw the scene once more at once without the card's frosting (finale.ts, before it captures the scene as a still). */
export function liftFrost(canvas: HTMLCanvasElement | null | undefined) {
  const lift = canvas && frostOwners.get(canvas);
  if (!lift) return false;
  lift();
  return true;
}
// After the card moves, resizes or animates, follow its rect on every frame for this long (ms).
const GLASS_SETTLE = 700;

export function PrismField({
  tone,
  strength = 1,
  clearCenter = false,
  swing = 0,
  shiftX = 0,
  shiftY = 0,
  reducedMotion,
  className = "",
}: {
  tone: "dark" | "light";
  strength?: number;
  clearCenter?: boolean;
  /** Angle offset in radians; the fan eases toward it, so each step can lean the light a little differently. */
  swing?: number;
  shiftX?: number;
  shiftY?: number;
  reducedMotion: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const goal = (): PrismInputs => ({
    power: strength,
    clear: clearCenter ? 1 : 0,
    swing: reducedMotion ? 0 : swing,
    shiftX: reducedMotion ? 0 : shiftX,
    shiftY: reducedMotion ? 0 : shiftY,
    tone: tone === "light" ? 1 : 0,
    cross: CROSS,
    intro: 1,
    glass: 0,
    gx0: 0,
    gy0: 0,
    gx1: 0,
    gy1: 0,
    gr: 0,
  });
  const target = useRef(goal());
  target.current = goal();
  const [failed, setFailed] = useState(false);
  // A lost context comes back on its own; a new generation rebuilds the renderer for it.
  const [generation, setGeneration] = useState(0);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    const host = canvas.current;
    if (!host) return;
    // The shaders compile in the driver's own threads (createPrismAsync): the first-run screen is on screen meanwhile, not after a stall of this thread.
    const mount = (node: HTMLCanvasElement, prism: Prism): (() => void) => {
    const stage = node.parentElement || node;
    // The field color comes from the stage (finish-tinted, theme-aware): read on mount, on prop changes and once a
    // second, never per frame.
    const field = new Float32Array([0.02, 0.02, 0.024]);
    const readField = () => {
      const value = getComputedStyle(stage).backgroundColor;
      const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(value),
        rgb = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
      if (srgb) field.set([+srgb[1], +srgb[2], +srgb[3]]);
      else if (rgb) field.set([+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255]);
    };
    readField();
    // The entrance plays once per mount; tone switches at once.
    const now: PrismInputs = { ...target.current, intro: reducedMotion ? 1 : 0 };
    const begin = performance.now();
    let transferred = false, last = begin;
    // The pose channels' velocities (R4-12: carried across moves and into the idle drift).
    const velocity = { power: 0, clear: 0, swing: 0, shiftX: 0, shiftY: 0 };
    let frame = 0;
    // Glass: find the marked card, follow its box and the opacity motion gives it while anything in the stage moves.
    const glass = { el: null as HTMLElement | null, radius: 0, until: 0 };
    const readGlass = () => {
      const el = glass.el;
      if (!el || !el.isConnected) {
        now.glass = 0;
        return;
      }
      const box = el.getBoundingClientRect(),
        frameBox = node.getBoundingClientRect(),
        k = node.width / Math.max(1, frameBox.width);
      // The animated opacity, not the inline one: motion runs its fades as compositor animations (WAAPI) and writes the
      // inline value only at the end, so reading `style.opacity` held the frost at 0 through the card's entrance and
      // then cut it in at full strength (R4-02). Computed style reports the running value on every frame.
      let opacity = 1;
      for (let n: HTMLElement | null = el; n && n !== stage; n = n.parentElement) if (n.style.opacity || n.getAnimations().length) opacity *= parseFloat(getComputedStyle(n).opacity) || 0;
      now.glass = box.width > 0 && box.height > 0 ? Math.max(0, Math.min(1, opacity)) : 0;
      now.gx0 = (box.left - frameBox.left) * k;
      now.gx1 = (box.right - frameBox.left) * k;
      now.gy0 = (frameBox.bottom - box.bottom) * k;
      now.gy1 = (frameBox.bottom - box.top) * k;
      now.gr = glass.radius * k;
    };
    const draw = (seconds: number) => {
      const next = target.current;
      const time = performance.now(),
        dt = Math.min(0.064, Math.max(0, (time - last) / 1000));
      last = time;
      // Each step's pose: a critically damped spring toward it (poseSpring.ts), so the move eases into a soft settle and
      // its last velocity runs on into a slow drift; never a dead stop. Reduced motion and the Off speed jump.
      const scale = reducedMotion ? 0 : motionScale("S");
      const [driftSwing, driftX, driftY] = scale ? poseDrift(seconds) : [0, 0, 0];
      const goals = { power: next.power, clear: next.clear, swing: next.swing + driftSwing, shiftX: next.shiftX + driftX, shiftY: next.shiftY + driftY };
      for (const key of Object.keys(goals) as (keyof typeof goals)[]) {
        if (!scale) {
          now[key] = goals[key];
          velocity[key] = 0;
        } else [now[key], velocity[key]] = settle(now[key], velocity[key], goals[key], poseOmega(scale), dt);
      }
      now.cross = next.cross;
      now.tone = next.tone;
      if (!reducedMotion) now.intro = Math.min(1, (performance.now() - begin) / 1000 / INTRO);
      if (performance.now() < glass.until) readGlass();
      prism.draw(seconds, now, field);
    };
    const still = () => {
      readGlass();
      draw(START);
    };
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      draw(START + (time - begin) / 1000);
    };
    frostOwners.set(node, () => {
      glass.el = null;
      glass.until = 0;
      now.glass = 0;
      prism.draw(reducedMotion ? START : START + (performance.now() - begin) / 1000, now, field);
    });
    finaleOwners.set(node, (copy, hold) => {
      transferred = true;
      cancelAnimationFrame(frame);
      readGlass();
      copy.replaceWith(node);
      const started = performance.now(), frosting = now.glass;
      let finalFrame = 0, ended = false;
      const done = () => {
        if (ended) return;
        ended = true;
        cancelAnimationFrame(finalFrame);
        prism.dispose();
      };
      // The light itself does not change: the quiet fade (finale.ts) only fades the copy it now lives in.
      const lift = (time: number) => {
        if (ended) return;
        const progress = reducedMotion ? 1 : Math.min(1, (time - started) / FROST_LIFT);
        now.glass = frosting * (1 - progress);
        prism.draw(reducedMotion ? START : START + (time - begin) / 1000, now, field);
        if (progress < 1 && node.isConnected) finalFrame = requestAnimationFrame(lift);
      };
      lift(started);
      // A hidden window can suspend rAF; cleanup must still release every GPU resource on time.
      setTimeout(done, hold + 50);
    });
    let pending = 0;
    const findGlass = () => {
      const el = stage.querySelector<HTMLElement>("[data-prism-glass]");
      if (el !== glass.el) {
        if (glass.el) sizes.unobserve(glass.el);
        glass.el = el;
        if (el) {
          sizes.observe(el);
          glass.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        }
      }
      glass.until = performance.now() + GLASS_SETTLE;
      // Reduced motion has no loop: repaint the still once things have moved.
      if (reducedMotion && !pending) pending = requestAnimationFrame(() => ((pending = 0), still()));
    };
    const sizes = new ResizeObserver(() => {
      if (!prism.resize()) return;
      glass.until = performance.now() + GLASS_SETTLE;
      if (reducedMotion) still();
      else draw(START + (performance.now() - begin) / 1000);
    });
    sizes.observe(node);
    const moves = new MutationObserver(findGlass);
    // data-stage: the card's exit (back to the welcome) starts with no other mutation; follow its fade from that frame.
    moves.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-prism-glass", "style", "data-stage"] });
    prism.resize();
    // Warm the frost passes once, invisibly (an empty glass rect), at mount, while the window may still be hidden: the
    // GPU builds a program's executables on its first draw, ~100ms that otherwise landed on the frame the first card's
    // frost appeared (the welcome click).
    prism.draw(START, { ...now, glass: 0.002, gx0: 0, gy0: 0, gx1: 0, gy1: 0, gr: 0 }, field);
    findGlass();
    node.dataset.glass = "";
    // Paint at once so the canvas never shows its cleared black before the first frame. The shader owns the entrance,
    // so the stage's own fade-in is switched off; reduced motion gets a plain short fade instead.
    node.style.animation = "none";
    if (reducedMotion) {
      still();
      node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
    } else {
      draw(START);
      frame = requestAnimationFrame(loop);
    }
    const ticker = setInterval(readField, 1000);
    refresh.current = () => {
      readField();
      if (reducedMotion) still();
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion) frame = requestAnimationFrame(loop);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      delete node.dataset.glass;
    };
    const restored = () => setGeneration((value) => value + 1);
    document.addEventListener("visibilitychange", visibility);
    node.addEventListener("webglcontextlost", lost);
    node.addEventListener("webglcontextrestored", restored);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      clearInterval(ticker);
      sizes.disconnect();
      moves.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      node.removeEventListener("webglcontextlost", lost);
      node.removeEventListener("webglcontextrestored", restored);
      if (!transferred) delete node.dataset.glass;
      refresh.current = null;
      finaleOwners.delete(node);
      frostOwners.delete(node);
      if (!transferred) prism.dispose();
    };
    };
    let live = true,
      release: (() => void) | undefined;
    void createPrismAsync(host).then((prism) => {
      if (!live) {
        prism?.dispose();
        return;
      }
      if (!prism) {
        setFailed(true);
        return;
      }
      release = mount(host, prism);
    });
    return () => {
      live = false;
      release?.();
    };
  }, [reducedMotion, generation]);
  // New props reach the loop through `target`; the field color and the reduced-motion still refresh here.
  useEffect(() => {
    refresh.current?.();
  }, [reducedMotion, tone, strength, clearCenter, swing, shiftX, shiftY]);
  return (
    <>
      {!failed && <canvas ref={canvas} className={`fr-prism ${className}`} data-tone={tone} aria-hidden="true" />}
      {failed && <LightField tone={tone} strength={strength} clearCenter={clearCenter} reducedMotion={reducedMotion} className={className} />}
    </>
  );
}
