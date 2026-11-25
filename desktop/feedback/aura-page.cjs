'use strict';
// Beta 14: the page the aura's layer shows (a transparent WebContentsView, like page-scrim.cjs's). It is painted with CSS only: radial gradients with the
// softness painted in (stops that fall to nothing well inside the box, so no edge can ever be seen or clipped), no blur filter, nothing animated but the
// layer's opacity and scale (which the compositor draws) and the ring's stroke. One colour plus a near-white core, never a rainbow. Flat.
//
// The page runs the timeline of aura-timeline.cjs (its own source is stringified into the page) every animation frame; main runs the same function. A frame
// can also be asked for at any time (`renderAt`), which is how the prototype rig steps the motion without waiting for the real clock.
const { createTimeline } = require('./aura-timeline.cjs');

/** The numbers of the look, in one place (CSS px at 100 % interface scale; the layer multiplies them by the interface scale). Judged in the prototype (README). */
const LOOK = Object.freeze({
  width: 150, height: 120,
  /** Peak strength of the one colour: about a third. */
  peak: 0.33,
  /** The near-white core: its own strength at the centre. */
  core: 0.38,
  /** The ring around the profile picture: stroke and gap, in CSS px. The real ring (rank-ring.css) uses the same two numbers. */
  ring: Object.freeze({ stroke: 1.5, gap: 2 }),
});

const SCRIPT = `
const makeTimeline = (${createTimeline.toString()});
let tl = makeTimeline();
const g = document.getElementById('g'), gi = document.getElementById('gi'), ringBox = document.getElementById('ringbox'), ring = document.getElementById('ring');
let cfg = null, timeline = null, frozen = false, frame = 0, ringFade = null;
const stats = { frames: 0, first: 0, last: 0, worst: 0 };
const num = (value) => Math.round(value * 100) / 100;
function paint() {
  const { w, h, ox, S, above, rgb, core, peak, stroke } = cfg;
  const oy = above ? h - cfg.oy : cfg.oy; // where the glow is DESIGNED (the button at the top); an 'above' layer is that picture turned over
  const c = rgb.join(' ');
  const stop = (alpha) => 'rgb(' + c + ' / ' + num(alpha) + ')';
  // The halo is centred on the button where the layer has room (150 px wide: 75 each side); a button near a side of the layer gets a narrower halo that leans away
  // from that side, and every edge of it falls to nothing inside the layer.
  const room = Math.min(ox, w - ox), haloX = Math.min(75 * S, Math.max(room, 44 * S)), haloAt = Math.min(w - haloX, Math.max(haloX, ox));
  const halo = 'radial-gradient(ellipse ' + num(haloX) + 'px ' + num(54 * S) + 'px at ' + num(haloAt) + 'px ' + num(oy + 48 * S) + 'px,' + stop(peak) + ' 0%,' + stop(peak * 0.82) + ' 24%,' + stop(peak * 0.52) + ' 48%,' + stop(peak * 0.24) + ' 70%,' + stop(peak * 0.07) + ' 87%,' + stop(0) + ' 100%)';
  // The tip and the near-white core are centred on the button; where the button is close to a side of the layer (a button near the window's edge) they get narrower
  // instead of being cut by it, so nothing ends in a hard line.
  const tipX = Math.min(28 * S, room), coreR = Math.min(24 * S, room);
  const tip = 'radial-gradient(ellipse ' + num(tipX) + 'px ' + num(36 * S) + 'px at ' + num(ox) + 'px ' + num(oy + 22 * S) + 'px,' + stop(peak * 0.95) + ' 0%,' + stop(peak * 0.45) + ' 55%,' + stop(0) + ' 100%)';
  const white = (alpha) => 'rgb(255 255 255 / ' + num(alpha) + ')';
  const center = 'radial-gradient(circle ' + num(coreR) + 'px at ' + num(ox) + 'px ' + num(oy + 26 * S) + 'px,' + white(core) + ' 0%,' + white(core * 0.5) + ' 45%,' + white(0) + ' 100%)';
  gi.style.cssText = 'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;background:' + [center, tip, halo].join(',') + ';' + (above ? 'transform:scaleY(-1);' : '');
  g.style.cssText = 'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;transform-origin:' + num(ox) + 'px ' + num(oy) + 'px;opacity:0;will-change:transform,opacity';
  // The ring is drawn the way the resting ring is (rank-ring.css): a circle box with a CSS outline, so the two rasterise alike and match to the pixel; a conic mask draws it on.
  const half = cfg.avatar / 2, pad = Math.ceil(cfg.gap + stroke + 2), box = cfg.avatar + 2 * pad;
  ringBox.style.cssText = 'position:absolute;left:' + num(ox - half - pad) + 'px;top:' + num(cfg.oy - half - pad) + 'px;width:' + num(box) + 'px;height:' + num(box) + 'px';
  ring.style.cssText = 'position:absolute;left:' + pad + 'px;top:' + pad + 'px;width:' + num(cfg.avatar) + 'px;height:' + num(cfg.avatar) + 'px;border-radius:50%;box-sizing:border-box;outline:' + num(stroke) + 'px solid rgb(' + c + ');outline-offset:' + num(cfg.gap) + 'px';
}
function render(now) {
  if (!cfg || !timeline) return null;
  if (!frozen) { stats.frames += 1; if (stats.last) stats.worst = Math.max(stats.worst, now - stats.last); else stats.first = now; stats.last = now; }
  const s = timeline.sample(now);
  g.style.opacity = String(num(s.p * 1000) / 1000);
  const scale = 0.18 + 0.82 * s.p;
  g.style.transform = 'scale(' + (Math.round(scale * 1000) / 1000) + ')';
  ringBox.style.visibility = s.r > 0 ? 'visible' : 'hidden';
  if (s.r >= 1) ringBox.style.maskImage = 'none';
  else { const deg = Math.round(s.r * 36000) / 100; ringBox.style.maskImage = 'conic-gradient(from 0deg at 50% 50%, #000 0deg, #000 ' + deg + 'deg, transparent ' + deg + 'deg)'; }
  return s;
}
function loop() {
  frame = 0;
  if (frozen || !timeline) return;
  const s = render(Date.now());
  if (s && s.phase !== 'done' && s.phase !== 'idle') frame = requestAnimationFrame(loop);
}
window.__aura = {
  /** The profile picture moved (a resize, the toolbar sliding in): the glow, its core and the ring are painted for the new place, and the very same frame is drawn again, so nothing blinks. */
  reanchor(next, now) { if (!cfg) return; cfg = Object.assign({}, cfg, next, { timeline: cfg.timeline }); paint(); render(now); },
  setup(next) { cfg = next; tl = makeTimeline(next.timeline); timeline = tl; paint(); ringBox.style.visibility = 'hidden'; g.style.opacity = '0'; },
  freeze(on) { frozen = !!on; if (frozen && frame) { cancelAnimationFrame(frame); frame = 0; } },
  start(now, options) { timeline.start(now, options); if (!frozen) { render(now); if (!frame) frame = requestAnimationFrame(loop); } },
  end(now, reason, options) { timeline.end(now, reason, options); if (!frozen && !frame) frame = requestAnimationFrame(loop); },
  renderAt(now) { return render(now); },
  state(now) { return timeline ? timeline.sample(now) : null; },
  /** How many frames the page drew while it ran for real, and the longest gap between two (QA only). */
  stats() { return Object.assign({}, stats); },
  /** The ring's last act: the real ring beneath is showing, this one fades out over \`ms\` (the same colour, the same place: nothing visible changes). */
  fadeRing(ms) { ringBox.style.transition = 'opacity ' + ms + 'ms linear'; ringBox.style.opacity = '0'; },
};
`;

/** The layer's page as a data: URL (no network, nothing to load; the layer runs it with scripts on and nothing else). */
function pageUrl() {
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}#ringbox{visibility:hidden}</style><div id="g"><div id="gi"></div></div><div id="ringbox"><div id="ring"></div></div><script>${SCRIPT}</script>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { LOOK, SCRIPT, pageUrl };
