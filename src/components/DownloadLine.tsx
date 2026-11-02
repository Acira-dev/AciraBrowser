import { useEffect, useLayoutEffect, useRef } from 'react';
import { Line, MIN_PROGRESS, lerp } from '../ui/navigationLine';
import { A, G, parseColor, rgba, type Rgb } from './NavigationProgress';
import './DownloadLine.css';

/** A download's progress line: the address bar's loading line (NavigationProgress: Helium's painter, same geometry, colours,
 * glow and exit), driven by the bytes received instead of a navigation. It runs to the end and fades when the file is done
 * (`finishing`), rests like the loading line when nothing moves for six seconds (a paused or stalled download draws no
 * frames), and with no known size it creeps toward the end so it still reads as alive. */
export function DownloadLine({ progress, paused = false, finishing = false, reduced }: { progress: number | null; paused?: boolean; finishing?: boolean; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), line = useRef(new Line()), frame = useRef(0), creep = useRef(MIN_PROGRESS);
  const metrics = useRef<{ width: number; height: number; primary: Rgb } | null>(null), draw = useRef<() => void>(() => {});
  const measure = () => {
    const node = canvas.current; if (!node) return null;
    const style = getComputedStyle(node);
    return metrics.current = { width: node.clientWidth, height: node.clientHeight, primary: parseColor(style.getPropertyValue('--navigation-core') || style.color) };
  };
  draw.current = () => {
    cancelAnimationFrame(frame.current);
    const node = canvas.current, ctx = node?.getContext('2d'), state = line.current, now = performance.now();
    if (!node || !ctx) return;
    state.tick(now);
    if (!state.active && node.dataset.active === 'false') return;
    const size = metrics.current || measure(); if (!size) return;
    const dpr = Math.max(1, devicePixelRatio || 1), { width, height, primary } = size;
    if (node.width !== Math.round(width * dpr) || node.height !== Math.round(height * dpr)) { node.width = Math.round(width * dpr); node.height = Math.round(height * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, node.width, node.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const shown = state.displayed(now);
    if (!state.active) { node.dataset.active = 'false'; return; }
    if (shown <= 0 || !width) { node.dataset.active = 'false'; if (state.animating(now)) frame.current = requestAnimationFrame(() => draw.current()); return; }
    if (node.dataset.active !== 'true') node.dataset.active = 'true';
    const shine: Rgb = [0, 1, 2].map(i => Math.round(lerp(primary[i], 255, A.shineWhiteMix))) as Rgb;
    const fade = state.fade(now), pulse = state.pulse(now), progressWidth = width * shown, bottom = height;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    const exit = state.finishing ? 1 - fade : 0;
    const glowHead = progressWidth + exit * (G.glowHeadWidth + G.glowExitOutsetInSigmas * G.glowSigma);
    const shaderStart = glowHead - G.glowHeadWidth, glowStart = Math.max(0, shaderStart), glowEnd = Math.min(width, glowHead), glowWidth = Math.max(0, glowEnd - glowStart);
    const glowOpacity = fade * lerp(A.glowMin, A.glowMax, pulse);
    const featherStart = -G.exitFeatherWidth + exit * (progressWidth + G.exitFeatherWidth);
    const lineGradient = ctx.createLinearGradient(featherStart, 0, featherStart + G.exitFeatherWidth, 0);
    lineGradient.addColorStop(0, rgba(primary, 0)); lineGradient.addColorStop(1, rgba(primary, lerp(A.lineExitOpacity, A.lineOpacity, fade)));
    ctx.fillStyle = lineGradient; ctx.beginPath(); ctx.roundRect(0, bottom - G.barHeight, progressWidth, G.barHeight, G.barHeight / 2); ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createLinearGradient(shaderStart, 0, glowHead, 0);
    [0, A.glowTail, A.glowMid, 1].forEach((alpha, i) => glow.addColorStop(A.stops[i], rgba(primary, glowOpacity * alpha)));
    ctx.filter = `blur(${G.glowSigma}px)`;
    ctx.fillStyle = glow; ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.glowHeight, glowWidth, G.glowHeight, G.glowHeight / 2); ctx.fill();
    ctx.fillStyle = rgba(shine, glowOpacity); ctx.beginPath(); ctx.arc(glowHead, bottom - G.barHeight / 2, G.edgeGlowRadius, 0, Math.PI * 2); ctx.fill();
    ctx.filter = 'none';
    const headOpacity = fade * lerp(A.headMin, A.headMax, pulse), head = ctx.createLinearGradient(shaderStart, 0, glowHead, 0);
    head.addColorStop(A.stops[0], rgba(primary, 0)); head.addColorStop(A.stops[1], rgba(primary, headOpacity * A.headTail)); head.addColorStop(A.stops[2], rgba(primary, headOpacity * A.headMid)); head.addColorStop(A.stops[3], rgba(shine, headOpacity));
    ctx.fillStyle = head;
    ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.barHeight, glowWidth, G.barHeight, G.barHeight / 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(glowStart, bottom - G.barHeight, glowWidth, G.shineHeight, G.shineHeight / 2); ctx.fill();
    ctx.restore();
    if (state.animating(now)) frame.current = requestAnimationFrame(() => draw.current());
  };
  useLayoutEffect(() => {
    const state = line.current, now = performance.now(), known = progress !== null;
    state.reduced = reduced;
    if (finishing) state.finish(now);
    else if (!state.active || (known && progress + .05 < state.target)) { creep.current = MIN_PROGRESS; metrics.current = null; state.begin(known ? progress : MIN_PROGRESS, now); }
    else if (known) state.set(progress, now);
    draw.current();
  }, [progress, finishing, reduced]);
  // No known size: ease toward the end, never reaching it.
  useEffect(() => {
    if (progress !== null || paused || finishing) return;
    const timer = window.setInterval(() => { creep.current += (.92 - creep.current) * .06; line.current.set(creep.current, performance.now()); draw.current(); }, 500);
    return () => window.clearInterval(timer);
  }, [progress, paused, finishing]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { const node = canvas.current; if (!node) return; const observer = new ResizeObserver(() => { metrics.current = null; draw.current(); }); observer.observe(node); return () => observer.disconnect(); }, []);
  return <canvas ref={canvas} className="download-line" data-paused={paused || undefined} aria-hidden="true"/>;
}
