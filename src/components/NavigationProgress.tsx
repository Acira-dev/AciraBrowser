/*
 * Loading line painter adapted from Helium's LocationBarProgressView
 * (github.com/imputnet/helium @ f29a259, patches/helium/ui/progress-bar.patch, GPL-3.0;
 * see docs/research/helium-ui/progress-bar.patch and THIRD_PARTY_NOTICES.md).
 * Geometry, opacities, gradient stops and timings follow that patch; the renderer drives it from
 * the native navigation lifecycle instead of WebContents observers.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { TabSession } from "../runtime/types";
import { Line, MIN_PROGRESS, lineStep, lerp } from "../ui/navigationLine";
import "../styles/navigation-progress.css";

export const G = { barHeight: 1.25, shineHeight: .5, glowHeight: 4, glowSigma: 4, edgeGlowRadius: 2.5, glowHeadWidth: 280, exitFeatherWidth: 140, glowExitOutsetInSigmas: 3 };
export const A = { shineWhiteMix: .36, lineOpacity: .64, lineExitOpacity: .45, glowMin: .5, glowMax: .88, glowTail: .18, glowMid: .68, headMin: .48, headMax: .84, headTail: .16, headMid: .68, stops: [0, .45, .82, 1] };
export type Rgb = [number, number, number];
export const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
export function parseColor(value: string): Rgb {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : [43, 127, 255];
}

export function NavigationProgress({ tab, placement, reduced, hidden = false }: { tab: TabSession; placement: "address" | "boundary"; reduced: boolean; hidden?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), line = useRef(new Line()), frame = useRef(0), last = useRef<{ loading: boolean; progress?: number }>({ loading: false });
  const draw = useRef<() => void>(() => {});
  // Size and colors are read when the canvas resizes or a navigation begins, never per frame: a read after React has
  // changed the DOM forces a synchronous style and layout pass.
  const metrics = useRef<{ width: number; height: number; primary: Rgb; radius: number } | null>(null);
  const measure = () => {
    const node = canvas.current; if (!node) return null;
    const host = node.parentElement, primary = parseColor(getComputedStyle(node).getPropertyValue("--navigation-core") || getComputedStyle(node).color);
    return metrics.current = { width: node.clientWidth, height: node.clientHeight, primary, radius: placement === "address" && host ? parseFloat(getComputedStyle(host).borderBottomLeftRadius) || 0 : 0 };
  };
  const web = tab.contentKind === "web" && /^https?:/i.test(tab.url);
  const loading = web && !!tab.loading && !tab.error, progress = tab.progress;
  draw.current = () => {
    cancelAnimationFrame(frame.current);
    const node = canvas.current, ctx = node?.getContext("2d"), state = line.current, now = performance.now();
    if (!node || !ctx) return;
    state.tick(now);
    if (!state.active && node.dataset.active === "false") return;
    const size = metrics.current || measure(); if (!size) return;
    const dpr = Math.max(1, devicePixelRatio || 1), { width, height, primary, radius } = size;
    if (node.width !== Math.round(width * dpr) || node.height !== Math.round(height * dpr)) { node.width = Math.round(width * dpr); node.height = Math.round(height * dpr); }
    // Clear in device pixels (the bitmap is rounded up from width x dpr, so a clear in CSS pixels can miss the last row and column), then scale.
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, node.width, node.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const shown = state.displayed(now);
    // A line that is over is cleared and hidden (CSS), so no stale frame can be shown. A running line with nothing to paint yet (first frame of a load, or no width) stays empty and keeps its frame loop.
    if (!state.active) { node.dataset.active = "false"; return; }
    if (shown <= 0 || !width) { node.dataset.active = "false"; if (state.animating(now)) frame.current = requestAnimationFrame(() => draw.current()); return; }
    if (node.dataset.active !== "true") node.dataset.active = "true";
    const shine: Rgb = [0, 1, 2].map(i => Math.round(lerp(primary[i], 255, A.shineWhiteMix))) as Rgb;
    const fade = state.fade(now), pulse = state.pulse(now), progressWidth = width * shown, bottom = height;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, width, height, radius); ctx.clip();
    const exit = state.finishing ? 1 - fade : 0;
    const glowHead = progressWidth + exit * (G.glowHeadWidth + G.glowExitOutsetInSigmas * G.glowSigma);
    const shaderStart = glowHead - G.glowHeadWidth, glowStart = Math.max(0, shaderStart), glowEnd = Math.min(width, glowHead), glowWidth = Math.max(0, glowEnd - glowStart);
    const glowOpacity = fade * lerp(A.glowMin, A.glowMax, pulse);
    // Thin line, feathered in from the left as it exits.
    const featherStart = -G.exitFeatherWidth + exit * (progressWidth + G.exitFeatherWidth);
    const lineGradient = ctx.createLinearGradient(featherStart, 0, featherStart + G.exitFeatherWidth, 0);
    lineGradient.addColorStop(0, rgba(primary, 0)); lineGradient.addColorStop(1, rgba(primary, lerp(A.lineExitOpacity, A.lineOpacity, fade)));
    ctx.fillStyle = lineGradient; ctx.beginPath(); ctx.roundRect(0, bottom - G.barHeight, progressWidth, G.barHeight, G.barHeight / 2); ctx.fill();
    // Head glow: screen-blended, blurred, only across the last 280px, brightest at the tip.
    ctx.globalCompositeOperation = "screen";
    const glow = ctx.createLinearGradient(shaderStart, 0, glowHead, 0);
    [0, A.glowTail, A.glowMid, 1].forEach((alpha, i) => glow.addColorStop(A.stops[i], rgba(primary, glowOpacity * alpha)));
    ctx.filter = `blur(${G.glowSigma}px)`;
    ctx.fillStyle = glow; ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.glowHeight, glowWidth, G.glowHeight, G.glowHeight / 2); ctx.fill();
    ctx.fillStyle = rgba(shine, glowOpacity); ctx.beginPath(); ctx.arc(glowHead, bottom - G.barHeight / 2, G.edgeGlowRadius, 0, Math.PI * 2); ctx.fill();
    ctx.filter = "none";
    // Bright core of the head with its shine strip.
    const headOpacity = fade * lerp(A.headMin, A.headMax, pulse), head = ctx.createLinearGradient(shaderStart, 0, glowHead, 0);
    head.addColorStop(A.stops[0], rgba(primary, 0)); head.addColorStop(A.stops[1], rgba(primary, headOpacity * A.headTail)); head.addColorStop(A.stops[2], rgba(primary, headOpacity * A.headMid)); head.addColorStop(A.stops[3], rgba(shine, headOpacity));
    ctx.fillStyle = head;
    ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.barHeight, glowWidth, G.barHeight, G.barHeight / 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.barHeight, glowWidth, G.shineHeight, G.shineHeight / 2); ctx.fill();
    ctx.restore();
    if (state.animating(now)) frame.current = requestAnimationFrame(() => draw.current());
  };
  useLayoutEffect(() => {
    const state = line.current, now = performance.now(), previous = last.current;
    state.reduced = reduced;
    switch (lineStep({ loading, progress, web, error: !!tab.error }, previous, state)) {
      case "begin": state.begin(progress ?? MIN_PROGRESS, now); metrics.current = null; break;
      case "advance": state.set(progress!, now); break;
      case "finish": state.finish(now); break;
      case "cancel": state.cancel(now); break;
    }
    last.current = { loading, progress };
    draw.current();
  }, [loading, progress, tab.error, web, reduced]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { const node = canvas.current; if (!node) return; const observer = new ResizeObserver(() => { metrics.current = null; draw.current(); }); observer.observe(node); return () => observer.disconnect(); }, []);
  return <canvas ref={canvas} className="navigation-progress" data-placement={placement} data-hidden={hidden || undefined} aria-hidden="true"/>;
}
