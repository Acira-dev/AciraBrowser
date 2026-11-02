import { handoffPrism, liftFrost } from "./PrismField";
import { motionSpeed } from "../../ui/sharedMotion";
import { springEasing, type SpringEasing } from "../../ui/springs";
import { classScales, springFor, type SpeedName } from "../../ui/motionTokens";

/** The end of setup (R3-16, R3-67, founder direction 26 Oct): the mark, in glass, over the browser.
 *
 * On Start browsing the setup fades away and the browser is already there, in place and never moved, behind a soft
 * frosted veil. The Acira mark appears in the middle and its two stripes draw out one after the other as Liquid Glass:
 * each stripe is a lens over the frost (the blurred browser behind it bends and brightens), with a lit rim traced by a
 * bright specular tip, a soft inner edge for thickness and a faint caustic glow cast on the frost beneath. It holds a
 * beat; then it un-draws in reverse: the second stripe retracts along its own path, then the first, the specular tip
 * leading the retreat, ending in a point of light that softly blooms and vanishes. In step with the retreat the frost
 * thins from the centre outward, and the sharp browser is simply there as the last light goes. "Make it yours" enters
 * as it clears. Every phase is a spring from the shared motion system (APPLE_MORPH_RESEARCH); a click or key finishes
 * it in a few frames (the click itself is only a skip); reduced motion and the Off speed get a 120 ms fade.
 *
 * Rendering: the setup frame leaves in a view transition (still captures fade off the live browser). The veil and the
 * mark are plain overlays in the live document; the browser under them never changes. The veil is a constant blur
 * whose radial mask opens; the mark is an SVG whose strokes draw. The browser is laid out and painted under setup
 * beforehand (onboarding.css column rule and the prewarm), so nothing in it changes on the click. */

/** Perceptual spring durations at Fast in seconds (Premium stretches spatial S by 1.7 and effects E by 1.4). */
export const FINALE = {
  /** The mark enters this long after the click (E), while the setup fades. */
  enter: 0.07,
  /** Each stripe draws out (S spring). */
  draw: 0.3,
  /** The second stripe starts this far into the first one's drawing. */
  stagger: 0.42,
  /** The mark holds, drawn (S). */
  hold: 0.1,
  /** Each stripe retracts on the draw's spring run backwards (S); the first starts this far into the second's retreat. */
  retract: 0.3,
  retractStagger: 0.75,
  /** The last point of light blooms and goes (E). */
  bloom: 0.12,
  /** "Make it yours" enters at this share of the clearing, as the browser comes clear. */
  arriveAt: 0.7,
  /** The mark's box in CSS px. */
  mark: 156,
} as const;

/**
 * A spring run backwards in time: it gathers speed and arrives at full velocity, so a stripe un-drawing on it pulls
 * into its start point instead of crawling the last few pixels (a forward spring's tail). The reversed curve's first
 * stretch barely moves (the spring's settle tail), so it is trimmed at `trim` of the travel and the duration shortened
 * to match: the retreat starts with a little velocity, never a dead hold.
 */
export function reverseSpring(spring: SpringEasing, trim = 0.02): SpringEasing {
  const stops = /^linear\((.*)\)$/.exec(spring.easing)![1].split(",").map((stop, i, all) => {
    const [v, at] = stop.trim().split(/\s+/);
    return { x: at ? parseFloat(at) / 100 : i === 0 ? 0 : i === all.length - 1 ? 1 : NaN, y: parseFloat(v) };
  });
  const back = stops.map(({ x, y }) => ({ x: 1 - x, y: 1 - y })).reverse();
  const from = Math.max(0, back.findIndex((p) => p.y >= trim) - 1);
  const x0 = back[from].x, y0 = back[from].y;
  const kept = back.slice(from).map(({ x, y }) => ({ x: (x - x0) / (1 - x0), y: (y - y0) / (1 - y0) }));
  const easing = `linear(${kept.map(({ x, y }, i) => (i === 0 || i === kept.length - 1 ? `${+y.toFixed(4)}` : `${+y.toFixed(4)} ${+(x * 100).toFixed(2)}%`)).join(", ")})`;
  return { duration: Math.round(spring.duration * (1 - x0)), easing, peak: 1 };
}

/** The moment's timeline at a speed, in ms, with the springs' easings: each spring's duration is its settle time. */
export function finaleTimeline(speed: SpeedName) {
  const { S, E } = classScales[speed];
  const spring = (d: number, scale: number) => springEasing({ duration: d, bounce: 0 }, scale);
  const drawSpring = spring(FINALE.draw, S),
    retractSpring = reverseSpring(spring(FINALE.retract, S)),
    bloomSpring = spring(FINALE.bloom, E);
  const enter = Math.round(FINALE.enter * E * 1000);
  const stripeGap = Math.round(drawSpring.duration * FINALE.stagger);
  const draw = stripeGap + drawSpring.duration;
  const hold = Math.round(FINALE.hold * S * 1000);
  const retreatAt = enter + draw + hold;
  const retreatGap = Math.round(retractSpring.duration * FINALE.retractStagger);
  const retreat = retreatGap + retractSpring.duration;
  const bloomAt = retreatAt + retreat - Math.round(bloomSpring.duration * 0.35);
  // The frost starts thinning a beat into the retreat and reaches the corners as the bloom fades (its curve covers
  // most of the window in its last stretch), so the browser comes clear with the last light, not before it.
  const clearAt = retreatAt + Math.round(retreatGap * 0.35);
  const total = bloomAt + Math.round(bloomSpring.duration * 1.2);
  return { enter, stripeGap, draw, drawSpring, hold, retreatAt, retreatGap, retreat, retractSpring, bloomAt, bloomSpring, clearAt, total };
}

let running: (() => void) | null = null;

/** Input that lands the moment early must be a deliberate gesture (R4-18). Never: the second press of a double click or
 * a key bounce in the first beat after the click that started it, a held key's auto-repeat, a lone modifier, or a wheel
 * (a touchpad's scrolling momentum from the last card keeps sending wheel events for a second after the fingers lift). */
export const SKIP_GRACE = 350;
export function deliberateSkip(kind: "pointer" | "key" | "wheel", sinceStart: number, key?: { key?: string; repeat?: boolean }) {
  if (kind === "wheel" || sinceStart < SKIP_GRACE) return false;
  if (kind === "key" && (key?.repeat || /^(Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|NumLock|Fn)$/.test(key?.key || ""))) return false;
  return true;
}

/** The moment's clock runs from its first frame on screen, never from the click (R4-18): on a fresh profile or a busy
 * machine the first frame can come late (GPU programs compiling, the browser's first layout), and timers counted from
 * the click would end the moment before it had been seen. `at` is ms on the moment's own timeline. */
export function finaleSchedule(t: { total: number }, clearAt: number, clearFor: number) {
  return { arrive: clearAt + Math.round(clearFor * FINALE.arriveAt), end: Math.max(t.total, clearAt + clearFor) + 80 };
}

/** Reduced motion and the Off speed still end on the mark, quietly (R4-18): no drawing, no movement — the mark in glass
 * fades in over a soft frosted veil, rests, and both fade away; only opacity changes. Durations in ms. */
export const QUIET = { in: 220, hold: 650, out: 320 } as const;

/** Reduced motion, the Off speed, or no view transitions: the setup stage fades off the browser (one short opacity fade
 * of a still copy outside React; the app root is a grid, so never inside `.app`). */
function fade(app: HTMLElement, stage: HTMLElement) {
  const layer = document.createElement("div");
  layer.className = "app fr-ghost";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  for (const name of ["data-theme", "data-appearance"]) {
    const value = app.getAttribute(name);
    if (value) layer.setAttribute(name, value);
  }
  layer.style.cssText = app.style.cssText;
  const frame = stage.cloneNode(true) as HTMLElement;
  for (const name of ["id", "data-leaving", "data-prewarm"]) frame.removeAttribute(name);
  frame.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  frame.querySelectorAll(".fr-drag, .fr-skip").forEach((node) => node.remove());
  layer.appendChild(frame);
  const sources = stage.querySelectorAll("canvas");
  frame.querySelectorAll("canvas").forEach((copy, i) => {
    const source = sources[i];
    if (!source || handoffPrism(source, copy, 200)) return;
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
  });
  document.body.appendChild(layer);
  stage.style.visibility = "hidden";
  const animation = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "linear", fill: "both" });
  const done = () => layer.remove();
  animation.onfinish = done;
  setTimeout(done, 400);
}

/** The real symbol geometry, as the 2026 logo pipeline writes it (resources/brand/build-brand-assets.mjs →
 * public/acira-symbol.svg): read once and split into its two stripes, so the mark is never a redrawn copy. Until it
 * has loaded, the moment plays without the mark (the veil still clears). */
let symbol: { viewBox: number[]; stripes: { d: string; length: number; start: DOMPoint }[] } | null = null;
let symbolLoading = false;
const SVG = "http://www.w3.org/2000/svg";
function loadSymbol() {
  if (symbol || symbolLoading || typeof fetch === "undefined") return;
  symbolLoading = true;
  fetch("./acira-symbol.svg")
    .then((response) => (response.ok ? response.text() : ""))
    .then((text) => {
      const d = /<path[^>]*\sd="([^"]+)"/.exec(text)?.[1],
        viewBox = /viewBox="([^"]+)"/.exec(text)?.[1]?.trim().split(/[\s,]+/).map(Number);
      if (!d || !viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n))) return;
      const stripes = d
        .split(/(?=M)/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const path = document.createElementNS(SVG, "path");
          path.setAttribute("d", part);
          return { d: part, length: path.getTotalLength(), start: path.getPointAtLength(0) };
        })
        .filter((stripe) => stripe.length > 0);
      if (stripes.length) symbol = { viewBox, stripes };
    })
    .catch(() => {})
    .finally(() => (symbolLoading = false));
}

/** The mark as Liquid Glass. Per stripe: a lens (an HTML layer clipped to the stripe whose backdrop filter bends and
 * brightens the frost behind it, see onboarding.css), a tinted body, a soft dark inner edge (thickness), a lit rim and
 * the specular tip that runs along it. Under it, a faint caustic glow on the frost; at the first stripe's start, the
 * point of light the retreat ends in. Tinted by the setup light: spectral white on the dark scene, the logo's
 * cyan-to-violet on the pale one. `drawn` gives the finished state (for the prewarm). */
function markElement(tone: string, drawn: boolean) {
  if (!symbol) return null;
  const [vx, vy, vw, vh] = symbol.viewBox;
  const host = document.createElement("div");
  host.className = "fr-finale-mark";
  host.dataset.tone = tone;
  host.setAttribute("aria-hidden", "true");
  const light = tone === "light";
  const tint = light
    ? [["0", "#35F2FF", ".34"], [".45", "#578BFB", ".26"], [".75", "#0051FF", ".2"], ["1", "#ED94FF", ".28"]]
    : [["0", "#d6f8ff", ".22"], [".5", "#ffffff", ".14"], [".8", "#e9e0ff", ".14"], ["1", "#ffe3f5", ".2"]];
  const id = `fr-glass-${Math.random().toString(36).slice(2, 8)}`;
  // The lenses: one HTML layer per stripe, the size of the viewBox, scaled to the mark, clipped to its stripe.
  const scale = FINALE.mark / vw;
  host.innerHTML =
    `<div class="fr-glass-caustic"></div>` +
    symbol.stripes
      .map((_, i) => `<div class="fr-glass-lens" data-stripe="${i}" style="width:${vw}px;height:${vh}px;transform:scale(${scale});clip-path:url(#${id}-clip-${i});backdrop-filter:url(#${id}-refract) brightness(1.18) saturate(1.5)"></div>`)
      .join("") +
    // Refraction: the frost seen through a stripe is displaced by a smooth noise field, so the glass bends it.
    `<svg class="fr-glass-filters" width="0" height="0" aria-hidden="true"><filter id="${id}-refract" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  svg.innerHTML =
    `<defs>` +
    `<linearGradient id="${id}-body" gradientUnits="userSpaceOnUse" x1="77" y1="23" x2="-7" y2="89">${tint.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>` +
    `<linearGradient id="${id}-rim" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="80" y2="100"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".42" stop-color="#fff" stop-opacity=".3"/><stop offset=".7" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>` +
    `<radialGradient id="${id}-spark"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".35" stop-color="${light ? "#bfeaff" : "#e6f0ff"}" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    // The lens clips, in the lens layers' own (viewBox-sized, origin at the viewBox corner) coordinates.
    symbol.stripes.map((stripe, i) => `<clipPath id="${id}-clip-${i}" clipPathUnits="userSpaceOnUse"><path transform="translate(${-vx} ${-vy})" d="${stripe.d}"/></clipPath><clipPath id="${id}-in-${i}"><path d="${stripe.d}"/></clipPath>`).join("") +
    `</defs>` +
    symbol.stripes
      .map(
        (stripe, i) =>
          `<g class="fr-glass-stripe" data-stripe="${i}">` +
          `<g class="fr-glass-body"><path d="${stripe.d}" fill="url(#${id}-body)"/>` +
          `<path d="${stripe.d}" fill="none" stroke="#000" stroke-opacity="${light ? ".12" : ".26"}" stroke-width="3.4" clip-path="url(#${id}-in-${i})"/></g>` +
          `<path class="fr-glass-rim" d="${stripe.d}" fill="none" stroke="url(#${id}-rim)" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="butt" stroke-dasharray="${stripe.length} ${stripe.length}" stroke-dashoffset="${drawn ? 0 : stripe.length}"/>` +
          `<path class="fr-glass-tip" d="${stripe.d}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${stripe.length * 0.07} ${stripe.length}" stroke-dashoffset="${stripe.length * 0.07}" opacity="0"/>` +
          `</g>`,
      )
      .join("") +
    `<circle class="fr-glass-spark" cx="${symbol.stripes[0].start.x}" cy="${symbol.stripes[0].start.y}" r="9" fill="url(#${id}-spark)" opacity="0"/>`;
  host.appendChild(svg);
  if (drawn) host.querySelectorAll<SVGElement>(".fr-glass-body").forEach((body) => (body.style.opacity = "1"));
  return host;
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
type StartViewTransition = (update: () => void) => ViewTransition;

/** The setup images the view transition captures (see `playFinale`). */
const captured = (stage: HTMLElement): [HTMLElement | null | undefined, string][] => {
  const card = stage.querySelector<HTMLElement>(".fr-card");
  return [
    [stage, "fr-scene"],
    [card, "fr-card"],
    [card?.querySelector<HTMLElement>(".fr-card-main"), "fr-words"],
    [card?.querySelector<HTMLElement>(".fr-foot"), "fr-foot"],
  ];
};

/** The veil's radial opening is a registered custom property, so it can be animated (with a spring easing). */
let registered = false;
function registerVeil() {
  if (registered) return;
  registered = true;
  try {
    (CSS as unknown as { registerProperty?: (definition: object) => void }).registerProperty?.({ name: "--fr-veil-open", syntax: "<percentage>", inherits: false, initialValue: "-30%" });
  } catch {
    // Already registered (a second window in the same renderer): fine.
  }
}

let prewarmed = false;
/** On a fresh profile the GPU compiles programs the first time it draws each kind of thing, tens of milliseconds that
 * would stall the first frames of whatever uses them. Draw them once, invisibly, at idle and early in setup, one kind
 * at a time (each hitch small, none on an input frame or on the last card): `prewarmEffects` on the resting welcome
 * (the card's entrance blur, the veil's blur and mask, the mark's glass), `prewarmCapture` on the first card (a view
 * transition that shows the page as it is: the Look step's crossfade and the finale use the same captures). */
let effectsWarm = false;
export function prewarmEffects(stage: HTMLElement | null) {
  if (effectsWarm || !stage || document.documentElement.hasAttribute("data-fr-finale")) return;
  effectsWarm = true;
  loadSymbol();
  registerVeil();
  const tone = stage.getAttribute("data-tone") || "dark";
  // The first card itself is rehearsed by Onboarding (the real card at its real size under the transition's blur sweep);
  // here the finale's veil, then its mark: one per idle slot, after the rehearsal.
  const makers: [() => HTMLElement | null, number][] = [[() => null, 1300], [() => veilElement(tone), 400], [() => markElement(tone, true), 400]];
  const next = (i: number) => {
    if (i >= makers.length || !stage.isConnected || document.documentElement.hasAttribute("data-fr-finale")) return;
    const [make, life] = makers[i];
    const swatch = make();
    if (swatch) {
      swatch.classList.add("fr-finale-prewarm");
      stage.appendChild(swatch);
      setTimeout(() => swatch.remove(), life);
    }
    idle(() => next(i + 1), life + 120);
  };
  next(0);
}
let captureWarm = false;
export function prewarmCapture(stage: HTMLElement | null) {
  const root = document.documentElement;
  const transition = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (captureWarm || !stage || !transition || root.hasAttribute("data-fr-switch") || root.hasAttribute("data-fr-finale") || root.hasAttribute("data-mode-switch")) return;
  captureWarm = true;
  const named = captured(stage);
  for (const [element, name] of named) if (element) element.style.viewTransitionName = name;
  root.setAttribute("data-fr-prewarm", "");
  const view = transition.call(document, () => {});
  const done = () => {
    root.removeAttribute("data-fr-prewarm");
    if (!root.hasAttribute("data-fr-finale")) for (const [element] of named) if (element) element.style.viewTransitionName = "";
  };
  view.finished.then(done, done);
}
/** After `delay` ms, at the next idle moment (or at once where idle callbacks are missing). */
function idle(run: () => void, delay: number) {
  setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 1000 }) : run()), delay);
}
/** The last card: whatever has not been warmed yet (a short setup, or the person went straight through). */
export function prewarmFinale(stage: HTMLElement | null) {
  const root = document.documentElement;
  const transition = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (prewarmed || !stage || !transition || root.hasAttribute("data-fr-switch") || root.hasAttribute("data-fr-finale")) return;
  prewarmed = true;
  prewarmEffects(stage);
  if (captureWarm) return;
  captureWarm = true;
  const named = captured(stage);
  for (const [element, name] of named) if (element) element.style.viewTransitionName = name;
  root.setAttribute("data-fr-prewarm", "");
  const view = transition.call(document, () => {});
  const done = () => {
    root.removeAttribute("data-fr-prewarm");
    if (!root.hasAttribute("data-fr-finale")) for (const [element] of named) if (element) element.style.viewTransitionName = "";
  };
  view.finished.then(done, done);
}

/** The frosted veil over the browser: a constant blur and a scrim in the stage's tone; only its radial opening and,
 * at the very end, its opacity move. */
function veilElement(tone: string) {
  const veil = document.createElement("div");
  veil.className = "fr-finale-veil";
  veil.dataset.tone = tone;
  veil.setAttribute("aria-hidden", "true");
  return veil;
}

export type FinaleOptions = {
  reduced: boolean;
  /** Runs once the motion is on screen (or at once when quiet): the place to close setup. */
  onStart?: () => void;
  /** Runs as the browser clears (or at once when skipped or quiet): the next surface enters with it. */
  onArrive?: () => void;
  /** Draw the mark (Start browsing, and the short version for Skip setup). */
  mark?: boolean;
  /** The short version (Skip setup): the same moment on the Fast timeline, whatever the speed setting. */
  short?: boolean;
};

/** The quiet ending (reduced motion, Off): the setup fades off as before, and the mark, drawn, fades in over a soft
 * frosted veil, rests and fades away with it (opacity only). */
function quietMark(tone: string, withMark: boolean, arrive: () => void) {
  const veil = veilElement(tone);
  veil.classList.add("fr-finale-quiet");
  const mark = withMark ? markElement(tone, true) : null;
  document.body.append(veil, ...(mark ? [mark] : []));
  const total = QUIET.in + QUIET.hold + QUIET.out;
  const frames = [{ opacity: 0 }, { opacity: 1, offset: QUIET.in / total }, { opacity: 1, offset: (QUIET.in + QUIET.hold) / total }, { opacity: 0 }];
  const animations = [veil, mark].filter((node): node is HTMLDivElement => !!node).map((node) => node.animate(frames, { duration: total, easing: "linear", fill: "both" }));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    veil.remove();
    mark?.remove();
    arrive();
  };
  animations[0].onfinish = finish;
  // A hidden window can hold animations; the browser must never stay behind the veil.
  setTimeout(finish, total + 400);
  setTimeout(arrive, QUIET.in + QUIET.hold);
}

/** Play the moment (see the file comment). */
export function playFinale(stage: HTMLElement | null, { reduced, onStart, onArrive, mark: withMark = false, short = false }: FinaleOptions) {
  running?.();
  loadSymbol();
  const app = stage?.closest<HTMLElement>(".app");
  let started = false,
    arrived = false;
  const start = () => {
    if (started) return;
    started = true;
    onStart?.();
  };
  const arrive = () => {
    if (arrived) return;
    arrived = true;
    onArrive?.();
  };
  if (!stage || !app) {
    start();
    arrive();
    return;
  }
  const root = document.documentElement;
  const transition = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  // The animation speed (R3-17, sharedMotion): Premium stretches S by 1.7 and E by 1.4; Off (or reduced motion) fades.
  const speed = motionSpeed();
  const tone = stage.getAttribute("data-tone") || "dark";
  if (reduced || speed === "off" || !transition) {
    fade(app, stage);
    start();
    quietMark(tone, withMark, arrive);
    return;
  }
  // A theme crossfade still running (the Look step) is taken over: starting this transition skips it. It never turns
  // the moment into the quiet fade (R4-18).
  root.removeAttribute("data-fr-switch");
  registerVeil();

  // Reads first, while layout is clean.
  const card = stage.querySelector<HTMLElement>(".fr-card");
  const box = card?.getBoundingClientRect();
  const drawn = withMark && !!symbol;
  const t = finaleTimeline(short && speed === "premium" ? "fast" : speed);
  // Without the mark the veil clears right after the setup has left.
  const clearAt = drawn ? t.clearAt : t.enter,
    clearFor = drawn ? t.total - t.clearAt : t.retreat;
  // The setup leaves on `materialize` (E), its words first on `menu.fade`.
  const leave = springEasing(springFor("materialize", speed) ?? { duration: 0.17, bounce: 0 }),
    words = springEasing(springFor("menu.fade", speed) ?? { duration: 0.085, bounce: 0 });
  const vars: Record<string, string> = {
    "--fr-finale-leave-d": `${leave.duration + Math.round(60 * classScales[speed].E)}ms`,
    "--fr-finale-leave-ease": leave.easing,
    "--fr-finale-words-d": `${words.duration}ms`,
    "--fr-finale-words-ease": words.easing,
    // The card's glass gathers toward the mark as it fades.
    "--fr-finale-card-x": `${box ? Math.min(1, FINALE.mark / Math.max(1, box.width)) * 0.6 + 0.4 : 0.9}`,
    "--fr-finale-card-y": `${box ? Math.min(1, FINALE.mark / Math.max(1, box.height)) * 0.6 + 0.4 : 0.9}`,
  };
  // On the transition's pseudo-elements only: a custom property on :root would restyle the whole document.
  const sheet = document.createElement("style");
  sheet.dataset.frFinale = "";
  sheet.textContent = `:root[data-fr-finale]::view-transition,:root[data-fr-finale]::view-transition-group(*),:root[data-fr-finale]::view-transition-image-pair(*),:root[data-fr-finale]::view-transition-old(*),:root[data-fr-finale]::view-transition-new(*){${Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";")}}`;
  document.head.appendChild(sheet);
  root.setAttribute("data-fr-finale", tone);
  // The scene draws the card's frosting itself (PrismField's glass contract): lift it before the capture so no frosted
  // rectangle stays in the still scene while the card fades; the card's CSS backdrop blur stays off meanwhile.
  if (card) {
    card.style.setProperty("backdrop-filter", "none");
    card.style.setProperty("-webkit-backdrop-filter", "none");
    card.removeAttribute("data-prism-glass");
    liftFrost(stage.querySelector<HTMLCanvasElement>("canvas.fr-prism"));
  }
  const named = captured(stage);
  for (const [element, name] of named) if (element) element.style.viewTransitionName = name;

  const veil = veilElement(tone);
  const mark = drawn ? markElement(tone, false) : null;
  const overlayAnimations: Animation[] = [];
  const run = (element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    if (element) overlayAnimations.push(element.animate(frames, { fill: "both", ...options }));
  };
  const clear = { duration: clearFor, easing: t.retractSpring.easing };

  let ended = false,
    transitionDone = false;
  const timers: number[] = [];
  const motions = () =>
    document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.pseudoElement;
      return !!target && target.startsWith("::view-transition");
    });
  const unname = () => {
    if (transitionDone) return;
    transitionDone = true;
    root.removeAttribute("data-fr-finale");
    sheet.remove();
    for (const [element] of named) if (element) element.style.viewTransitionName = "";
  };
  const end = () => {
    if (ended) return;
    ended = true;
    running = null;
    for (const timer of timers) clearTimeout(timer);
    removeEventListener("pointerdown", skipPointer, true);
    removeEventListener("keydown", skipKey, true);
    for (const animation of overlayAnimations) animation.cancel();
    veil.remove();
    mark?.remove();
    unname();
    start();
    arrive();
  };
  // Skipping lands the moment in a few frames instead of cutting it.
  const hurry = () => {
    if (ended) return;
    for (const animation of [...motions(), ...overlayAnimations]) animation.updatePlaybackRate(Math.max(6, t.total / 120));
    timers.push(window.setTimeout(() => {
      view.skipTransition();
      end();
    }, 200));
    start();
    arrive();
  };
  const clicked = performance.now();
  // A click during the moment only skips it: the press and the click it makes are not passed on (the second press of
  // the double click that started it is swallowed too, but does not skip).
  const skipPointer = (event: PointerEvent) => {
    event.preventDefault();
    if (!deliberateSkip("pointer", performance.now() - clicked)) {
      event.stopImmediatePropagation();
      return;
    }
    event.stopImmediatePropagation();
    const swallow = (click: Event) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, true), 600);
    hurry();
  };
  // A key lands it; if setup has not closed yet it closes in this same task (synchronously, see Onboarding's `close`),
  // so the browser's own key handling already receives this key. Keys are never swallowed.
  const skipKey = (event: KeyboardEvent) => {
    if (deliberateSkip("key", performance.now() - clicked, event)) hurry();
  };

  // The new frame is the browser under the veil (and the mark, still blank): the stage leaves the document.
  const view = transition.call(document, () => {
    stage.style.display = "none";
    document.body.append(veil, ...(mark ? [mark] : []));
    // The frost opens from the centre outward, in step with the mark's retreat, and is gone as its last light goes.
    // On the retreat's accelerating curve: the frost holds while the mark retracts over it, thins from the centre as the
    // first stripe pulls in, and reaches the corners as the last light goes.
    run(veil, [{ "--fr-veil-open": "-30%" } as Keyframe, { "--fr-veil-open": "100%" } as Keyframe], { duration: clear.duration, delay: clearAt, easing: clear.easing });
    run(veil, [{ opacity: 1 }, { opacity: 1, offset: 0.97 }, { opacity: 0 }], { duration: clear.duration, delay: clearAt, easing: clear.easing });
    if (!mark || !symbol) return;
    const { enter, stripeGap, drawSpring, retreatAt, retreatGap, retractSpring, bloomAt, bloomSpring } = t;
    const stripes = [...mark.querySelectorAll<SVGGElement>(".fr-glass-stripe")],
      lenses = [...mark.querySelectorAll<HTMLElement>(".fr-glass-lens")];
    const fadeE = springEasing(springFor("materialize", speed) ?? { duration: 0.17, bounce: 0 });
    // The caustic glow comes up with the drawing and goes with the retreat.
    run(mark.querySelector(".fr-glass-caustic"), [{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "none" }], { duration: drawSpring.duration, delay: enter, easing: drawSpring.easing });
    run(mark.querySelector(".fr-glass-caustic"), [{ opacity: 1 }, { opacity: 0 }], { duration: retractSpring.duration + retreatGap, delay: retreatAt, easing: fadeE.easing, fill: "forwards" });
    stripes.forEach((group, i) => {
      const stripe = symbol!.stripes[i];
      if (!stripe) return;
      const length = stripe.length,
        tipLength = length * 0.07,
        drawAt = enter + stripeGap * i,
        // The retreat runs in reverse order: the last stripe drawn retracts first.
        backAt = retreatAt + retreatGap * (stripes.length - 1 - i);
      const rim = group.querySelector(".fr-glass-rim"),
        tip = group.querySelector(".fr-glass-tip"),
        body = group.querySelector(".fr-glass-body"),
        lens = lenses[i];
      // Draw: the rim traces the stripe behind the specular tip; the glass body and its lens fill in behind the pen.
      run(rim, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: drawSpring.duration, delay: drawAt, easing: drawSpring.easing });
      run(tip, [{ strokeDashoffset: tipLength, opacity: 0 }, { strokeDashoffset: tipLength - length * 0.08, opacity: 1, offset: 0.08 }, { strokeDashoffset: tipLength - length, opacity: 1 }], { duration: drawSpring.duration, delay: drawAt, easing: drawSpring.easing });
      run(tip, [{ opacity: 1 }, { opacity: 0 }], { duration: fadeE.duration, delay: drawAt + drawSpring.duration * 0.8, easing: fadeE.easing, fill: "forwards", composite: "replace" });
      for (const glass of [body, lens]) run(glass, [{ opacity: 0 }, { opacity: 1 }], { duration: drawSpring.duration, delay: drawAt + Math.round(drawSpring.duration * 0.25), easing: drawSpring.easing });
      // Retreat: the rim retracts back along its own path, the tip leading; the glass empties ahead of it.
      run(rim, [{ strokeDashoffset: 0 }, { strokeDashoffset: length }], { duration: retractSpring.duration, delay: backAt, easing: retractSpring.easing, fill: "forwards" });
      run(tip, [{ strokeDashoffset: tipLength - length, opacity: 0 }, { strokeDashoffset: tipLength - length * 0.92, opacity: 1, offset: 0.08 }, { strokeDashoffset: tipLength - length * 0.04, opacity: 1, offset: 0.85 }, { strokeDashoffset: tipLength, opacity: 0 }], { duration: retractSpring.duration, delay: backAt, easing: retractSpring.easing, fill: "forwards" });
      for (const glass of [body, lens]) run(glass, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.round(retractSpring.duration * 0.85), delay: backAt, easing: retractSpring.easing, fill: "forwards" });
    });
    // The retreat ends at the first stripe's start in a point of light that blooms and is gone.
    run(mark.querySelector(".fr-glass-spark"), [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)", offset: 0.35 }, { opacity: 0, transform: "scale(2.4)" }], { duration: bloomSpring.duration * 1.6, delay: bloomAt, easing: bloomSpring.easing });
  });
  running = () => {
    view.skipTransition();
    end();
  };
  addEventListener("pointerdown", skipPointer, true);
  addEventListener("keydown", skipKey, true);
  // The moment's own clock starts with its first frame (see `finaleSchedule`).
  const schedule = finaleSchedule(t, clearAt, clear.duration);
  let clocked = false;
  const clock = () => {
    if (clocked || ended) return;
    clocked = true;
    timers.push(window.setTimeout(arrive, schedule.arrive));
    timers.push(window.setTimeout(end, schedule.end));
  };
  view.ready.then(
    () => {
      // Setup closes underneath one frame in (the browser is already laid out and painted under it).
      requestAnimationFrame(() => {
        clock();
        start();
      });
    },
    () => {
      clock();
      start();
    },
  );
  // The view transition only covers the setup leaving; the veil and the mark carry on in the live document.
  view.finished.then(unname, unname);
  timers.push(window.setTimeout(start, 160));
  // Only if no frame ever comes (a hidden window): never leave the browser behind the veil.
  timers.push(window.setTimeout(() => (clocked ? undefined : (clock(), start())), 1500));
}

// Read the symbol as soon as setup loads this module (a small local file), so the mark is ready by the last card.
if (typeof document !== "undefined") loadSymbol();
