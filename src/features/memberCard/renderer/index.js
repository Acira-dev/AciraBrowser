// @ts-nocheck
// Beta 14 member cards: the renderer's entry (the app side is ../MemberCard.tsx). One card = his scene (scene.js, a three.js chunk the page loads only
// when a card is shown) drawn from his card builders (cards12/14/16.js) with the member's own name, month and number.
import { CARD } from './sys12.js';
import { TIERS } from './art10.js';
import { early, contributor } from './cards12.js';
import { CARDS16 } from './cards16.js';
import { founding, preloadHands } from './cards20.js';
import { createCardScene, fitDist } from './scene.js';
import { loadCardResources } from './resources.js';
import { createFoundingFoil } from './foil.js';
import { memberToken } from './coin.js';
import { pickH264, encodeMp4, clipSize } from './mp4.js';

const BUILD = { early, contributor, trusted: CARDS16.trusted, insider: CARDS16.insider, founding };
// How far the member's name may run on each card, in master pixels (1600 wide), so it never reaches the number, the token, the rule or the edge.
const NAME_MAX = { early: 650, contributor: 650, trusted: 1100, insider: 950, founding: 1300 };
// Tilt (the sample, Shimmer): "rotate the card up to about 0.34 rad left-right and 0.15 rad up-down, and turn the light with it".
const AMP = 0.34;
export const CARD_ASPECT = 2 / 3;

const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
// his builders keep their layout bookkeeping in module state, so two cards are never built at once
let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => {}, () => {}); return run; };

async function makeSpec(data) {
  await loadCardResources();
  const { rank } = data;
  if (rank === 'founding') await preloadHands();
  CARD.name = data.name; CARD.since = data.since; CARD.nameMax = NAME_MAX[rank]; TIERS[rank].num = String(data.number);
  const spec = BUILD[rank]();
  // the Insider and Founding tokens carry the member's own number on the rim (coin.js); if the coin cannot be drawn the pack's own token file stands in
  if (rank === 'insider' || rank === 'founding') { try { spec.seal.img = memberToken(rank, String(data.number)); } catch (error) { console.warn('member token', error); spec.seal.img = await loadImage(spec.seal.src); } }
  else spec.seal.img = await loadImage(spec.seal.src);
  return spec;
}

/** Tilt for a pointer position: x and y run from -1 to 1 across the card (y down). His clip's pose: yaw, pitch, a hair of roll, and the light turning with it. */
// `flat` is the stills' fixed studio sheen: full head-on, so the card at rest is the picture the team approved, gone by the time it has turned a little.
export function tiltPose(x, y) { const ry = AMP * x, rx = 0.15 * y; return { ry, rx, rz: 0.02 * x, env: 0.35 * x, flat: Math.max(0, 1 - Math.hypot(ry / 0.10, rx / 0.07)) }; }
export const REST_POSE = { ry: 0, rx: 0, rz: 0, env: 0, flat: 1 };

/**
 * Draws one member's card on `canvas`. Resolves once it is built and drawn head-on.
 * live: true keeps the plates so the card can tilt; the handle's exportFlat() draws the front-on picture of the same card.
 */
export function createMemberCard(canvas, data, { backdrop = null, alpha = true } = {}) {
  return serial(async () => {
    const spec = await makeSpec(data);
    const scene = createCardScene(canvas, { alpha, backdrop });
    const built = await scene.build(spec);
    const foil = data.rank === 'founding' ? await createFoundingFoil({ number: data.number, plate: built.plates[0], amp: AMP }) : null;
    const size = { w: 0, h: 0, ratio: 1 };
    const draw = (p = REST_POSE, { margin = 1.2, shadow = true } = {}) => {
      if (!size.w) return;
      if (foil) { if (Math.abs(p.ry) < 1e-4 && Math.abs(p.rx) < 1e-4) foil.rest(); else foil.paint(p.ry, p.foilRx ?? p.rx); }
      scene.pose({ ...p, w: size.w, h: size.h, pixelRatio: 1, dist: fitDist(18, size.h, margin), shadow });
    };
    return {
      /** Sets the drawing size in device pixels (canvas.width / height); the page sets the canvas' CSS size. */
      resize(w, h) { size.w = Math.max(2, Math.round(w)); size.h = Math.max(2, Math.round(h)); },
      draw, spec, canvas,
      /** The flat front-on picture at `width` px wide (corners transparent), made on a canvas of its own so the live card is not disturbed. */
      async exportFlat(width = 1200) { return renderFlat(spec, width, foil); },
      /** One slow tilt as a video: the card turns to the left, to the right and back to head-on, on the pack's stage grey. An MP4 (H.264) where this browser can encode one (mp4.js), else a WebM. */
      async recordTilt(options) { return recordTilt(spec, foil, options); },
      dispose() { scene.dispose(); foil?.dispose(); },
    };
  });
}

// the flat, front-on picture: his `flat()` pose (no shadow, head-on, the studio sheen on), on a transparent background
async function renderFlat(spec, width, foil) {
  const c = document.createElement('canvas'), w = Math.round(width), h = Math.round(width * 1.5);
  const scene = createCardScene(c, { alpha: true, backdrop: null, preserveDrawingBuffer: true });
  try {
    foil?.rest();
    await scene.build(spec);
    scene.pose({ w, h, pixelRatio: 1, dist: fitDist(18, h, 1.0), shadow: false, env: 0, flat: 1, ry: 0, rx: 0, rz: 0 });
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('card picture failed'))), 'image/png'));
  } finally { scene.dispose(); }
}

// the saved video: one slow tilt on the pack's stage grey. An MP4 (H.264, yuv420p, even sizes, `moov` first: it can be posted as it is) where the browser has an H.264 encoder (Mac, Windows; Linux where it has one),
// else (and whenever the MP4 cannot be made) the WebM the recorder makes. Never fails because the MP4 could not be made.
async function recordTilt(spec, foil, options = {}) {
  const config = await pickH264(options.width ?? 720, options.fps ?? 30);
  if (config) { try { return await recordTiltMp4(spec, foil, options, config); } catch (error) { console.warn('member card: no MP4, making a WebM', error); } }
  return recordTiltWebm(spec, foil, options);
}

// the MP4: every frame is drawn and handed to the encoder in turn (not in real time), 30 per second, head-on at both ends
async function recordTiltMp4(spec, foil, { seconds = 6, width = 720, fps = 30, onProgress } = {}, config) {
  const { width: w, height: h } = clipSize(width), c = document.createElement('canvas');
  const scene = createCardScene(c, { alpha: false, backdrop: '#C2C6CC', preserveDrawingBuffer: true }); let attached = null;
  try {
    const built = await scene.build(spec), tex = built.plates[0].texture; foil?.attach(tex); attached = tex;
    const draw = (u) => {
      const a = u * Math.PI * 2, p = tiltPose(Math.sin(a), 0.5 * Math.sin(a) * Math.cos(a));
      if (foil) { if (Math.abs(p.ry) < 1e-4 && Math.abs(p.rx) < 1e-4) foil.rest(); else foil.paint(p.ry, p.rx); }
      scene.pose({ ...p, w, h, pixelRatio: 1, dist: fitDist(18, h, 1.18), shadow: true });
    };
    const frames = Math.max(2, Math.round(seconds * fps));
    draw(0);
    const bytes = await encodeMp4({ canvas: c, frames, fps, config, onProgress, drawFrame: (i) => draw(i / (frames - 1)) });
    return new Blob([bytes], { type: 'video/mp4' });
  } finally { if (attached) foil?.detach(attached); foil?.rest(); scene.dispose(); }
}

// the WebM: drawn in real time on a canvas of its own and recorded as it plays
async function recordTiltWebm(spec, foil, { seconds = 6, width = 720, fps = 30, onProgress } = {}) {
  const c = document.createElement('canvas'), w = Math.round(width), h = Math.round(width * 1.5);
  const scene = createCardScene(c, { alpha: false, backdrop: '#C2C6CC' }); let attached = null;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) { scene.dispose(); throw new Error('no video format'); }
  try {
    const built = await scene.build(spec), tex = built.plates[0].texture; foil?.attach(tex); attached = tex;
    const draw = (u) => { // u 0..1 over the clip: head-on at both ends
      const a = u * Math.PI * 2, p = tiltPose(Math.sin(a), 0.5 * Math.sin(a) * Math.cos(a));
      if (foil) { if (Math.abs(p.ry) < 1e-4 && Math.abs(p.rx) < 1e-4) foil.rest(); else foil.paint(p.ry, p.rx); }
      scene.pose({ ...p, w, h, pixelRatio: 1, dist: fitDist(18, h, 1.18), shadow: true });
    };
    draw(0);
    const rec = new MediaRecorder(c.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error || new Error('recording failed')); });
    rec.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => { const step = (now) => { const u = Math.min(1, (now - t0) / (seconds * 1000)); draw(u); onProgress?.(u); if (u < 1) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step); });
    await new Promise((r) => setTimeout(r, 120)); rec.stop(); await done;
    return new Blob(chunks, { type: 'video/webm' });
  } finally { if (attached) foil?.detach(attached); foil?.rest(); scene.dispose(); }
}
