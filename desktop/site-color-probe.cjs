'use strict';
// Site colour research probe (beta.12 item 19, researcher A). DEV ONLY: nothing here runs unless ACIRA_SITE_COLOR_PROBE=1 AND the app runs on a throwaway
// profile (ACIRA_BROWSER_TEST_DATA set), and nothing in it touches the visible UI, the saved state or the network beyond what is listed below.
//
// What it does: for a page's WebContents it reads every candidate source of "the site's colour" and times each one:
//   1. theme-color    every <meta name="theme-color"> with its media query and whether it matches now, plus what Chromium itself reports through the
//                     webContents 'did-change-theme-color' event (kept in `chromium`);
//   2. manifest       <link rel="manifest"> fetched through the TAB'S OWN session (so a private or Tor tab uses its own route), theme_color / background_color;
//   3. top edge       one capturePage of the top 160 DIP, summarised as strips of 2 / 8 / 24 / 64 DIP, and the same page's elementsFromPoint(x, 2) walked up to the
//                     first opaque background (the "what is painted at the top" answer without pixels);
//   4. left edge      a capturePage of the left 24 DIP (what the sidebar sits against);
//   5. favicon        the icon the existing icon pipeline would pick, decoded in main, mode colour and the most colourful one;
//   6. body           computed background of <html>, <body> and the rendered colour of the whole viewport (sampled).
// Pixels never leave the main process: only a few "#rrggbb" strings are produced. Everything is local; there is no request except the single manifest and
// favicon fetch, both through the tab's session (a normal browser makes both too). The module is read-only on the page: it runs in an isolated world.
const fs = require('node:fs'), path = require('node:path');
const math = require('./site-color-math.cjs');
const iconPick = require('./browser-services/icon-pick.cjs');
const iconImage = require('./browser-services/icon-image.cjs');

const WORLD = 2077;
const now = () => Number(process.hrtime.bigint()) / 1e6;

/** Runs in the page's isolated world. Synchronous, reads only. Returns plain JSON. */
const FACTS_CODE = `(()=>{
const out={};
const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
const cx=canvas.getContext('2d',{willReadFrequently:true});
const px=(value)=>{try{if(typeof value!=='string'||!value.trim())return null;const take=(base)=>{cx.clearRect(0,0,1,1);cx.fillStyle=base;cx.fillStyle=value;cx.fillRect(0,0,1,1);return cx.getImageData(0,0,1,1).data;};const a=take('#000'),b=take('#fff');if(a[0]!==b[0]||a[1]!==b[1]||a[2]!==b[2]||a[3]!==b[3])return null;return [a[0],a[1],a[2],Math.round(a[3]/2.55)/100];}catch(e){return null;}};
const tag=(el)=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/)[0]:'');
out.url=location.href;out.title=document.title;out.vw=innerWidth;out.vh=innerHeight;out.dpr=devicePixelRatio;out.scrollY=Math.round(scrollY);out.docHeight=document.documentElement.scrollHeight;
out.prefersDark=matchMedia('(prefers-color-scheme: dark)').matches;
out.metas=[...document.querySelectorAll('meta[name="theme-color" i]')].map((m)=>{const media=m.getAttribute('media')||'';let matches=true;try{matches=!media||matchMedia(media).matches;}catch(e){}return {content:m.getAttribute('content'),media,matches,rgba:px(m.getAttribute('content')||'')};});
const cs=document.querySelector('meta[name="color-scheme" i]');out.colorSchemeMeta=cs?cs.getAttribute('content'):'';
out.rootColorScheme=getComputedStyle(document.documentElement).colorScheme;
const man=document.querySelector('link[rel~="manifest" i]');out.manifestHref=man?man.href:'';
out.links=[...document.querySelectorAll('link[rel]')].slice(0,60).map((n)=>({rel:String(n.rel||''),href:String(n.href||''),sizes:String((n.sizes&&n.sizes.value)||''),type:String(n.type||'')}));
const bg=(el)=>{if(!el)return null;const s=getComputedStyle(el);return {rgba:px(s.backgroundColor),image:s.backgroundImage!=='none'?s.backgroundImage.slice(0,60):''};};
out.html=bg(document.documentElement);out.body=bg(document.body);
const W=innerWidth,xs=[0.04,0.2,0.35,0.5,0.65,0.8,0.96].map((f)=>Math.round(f*(W-1)));
out.top=xs.map((x)=>{let stack=[];try{stack=document.elementsFromPoint(x,2);}catch(e){}const layers=[];
 for(const el of stack){const s=getComputedStyle(el);const rgba=px(s.backgroundColor),img=s.backgroundImage!=='none';
  if(img)return {x,tag:tag(el),kind:/gradient/.test(s.backgroundImage)?'gradient':'image',rgba,pos:s.position,layers:layers.length};
  if(/^(IMG|VIDEO|CANVAS|PICTURE|SVG|IFRAME)$/i.test(el.tagName)&&!layers.length)return {x,tag:tag(el),kind:'media',rgba,pos:s.position,layers:0};
  if(rgba&&rgba[3]>=0.97)return {x,tag:tag(el),kind:'bg',rgba,pos:s.position,layers:layers.length,under:layers.length?layers.slice().reverse():undefined};
  if(rgba&&rgba[3]>0.01)layers.push(rgba);}
 return {x,tag:'',kind:layers.length?'translucent':'none',rgba:null,layers:layers.length,under:layers.length?layers.slice().reverse():undefined};});
return out;})()`;

const rgbOf = (rgba) => (rgba && rgba.length >= 3 ? rgba.slice(0, 3) : null);
/** Composites a layered top sample down to one opaque colour. */
function resolveTop(sample, fallback) {
  if (!sample) return null;
  if (sample.kind === 'bg') {
    let colour = rgbOf(sample.rgba);
    for (const layer of sample.under || []) colour = math.over([...layer.slice(0, 3), layer[3]], colour);
    return colour;
  }
  if (sample.kind === 'translucent' || sample.kind === 'none') {
    let colour = fallback || [255, 255, 255];
    for (const layer of sample.under || []) colour = math.over([...layer.slice(0, 3), layer[3]], colour);
    return sample.kind === 'none' ? null : colour;
  }
  return null; // image / gradient / media: no single colour from the DOM
}

async function withTimeout(promise, ms, fallback = null) {
  let timer;
  try { return await Promise.race([Promise.resolve(promise), new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); })]); } catch { return fallback; } finally { clearTimeout(timer); }
}

async function readFacts(wc) {
  const t0 = now();
  const facts = await withTimeout(wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: FACTS_CODE }], false), 2500);
  return { facts, ms: now() - t0 };
}

/** The first <meta name=theme-color> that applies now (document order, media matched), as Chrome picks it. */
function pickMeta(metas) {
  for (const meta of metas || []) if (meta.matches && meta.rgba) return meta;
  return null;
}

async function readManifest(wc, href) {
  const t0 = now();
  if (!href || !/^https?:/i.test(href)) return { ms: 0, href: href || '' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await wc.session.fetch(href, { credentials: 'omit', signal: controller.signal, headers: { accept: 'application/manifest+json, application/json' } });
    if (!response.ok) return { ms: now() - t0, href, status: response.status };
    const text = (await response.text()).slice(0, 200000);
    const json = JSON.parse(text.replace(/^﻿/, ''));
    return { ms: now() - t0, href, status: 200, theme_color: json.theme_color || '', background_color: json.background_color || '', name: json.name || json.short_name || '', display: json.display || '' };
  } catch (error) { return { ms: now() - t0, href, error: String(error && error.message || error).slice(0, 80) }; } finally { clearTimeout(timer); }
}

/** One capture of `rect` (DIP). The bitmap is in device pixels; strips below are given in DIP and converted with `scale`. */
async function capture(wc, rect) {
  const t0 = now();
  let image;
  try { image = await withTimeout(wc.capturePage(rect, { stayHidden: true, stayAwake: false }), 3000); } catch { image = null; }
  const tCap = now() - t0;
  if (!image || image.isEmpty()) return null;
  const t1 = now();
  const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 });
  if (bitmap.length !== size.width * size.height * 4) return null;
  // The image comes back at device pixels (2x on a Retina screen) with scale factor 1, so `scale` converts DIP to bitmap pixels.
  return { bitmap, width: size.width, height: size.height, scale: size.width / Math.max(1, rect.width), captureMs: tCap, bitmapMs: now() - t1 };
}

function topStrips(shot) {
  const { bitmap, width: w, height: h, scale } = shot, out = {}, d = (dip) => Math.max(1, Math.round(dip * scale)), step = Math.max(1, Math.round(scale));
  for (const dip of [1, 2, 8, 24, 64]) {
    const rows = d(dip);
    if (rows > h) continue;
    out['h' + dip] = math.summarise(bitmap, w, h, { x0: 0, y0: 0, x1: w, y1: rows }, dip <= 2 ? 1 : step);
  }
  const rows = Math.min(d(24), h), seg = (a, b) => math.summarise(bitmap, w, h, { x0: Math.round(w * a), y0: 0, x1: Math.round(w * b), y1: rows }, step);
  out.segments = { left: seg(0, 0.2), mid: seg(0.4, 0.6), right: seg(0.8, 1) };
  // How the top changes with depth: the 24 DIP block starting at y = 0, 40, 80, 120 DIP.
  out.depth = [0, 40, 80, 120].filter((y) => d(y + 24) <= h).map((y) => math.summarise(bitmap, w, h, { x0: 0, y0: d(y), x1: w, y1: d(y + 24) }, step)?.hex);
  return out;
}

function leftStrips(shot) {
  const { bitmap, width: w, height: h, scale } = shot, edge = Math.min(Math.round(8 * scale), w), step = Math.max(1, Math.round(scale));
  const thirds = [0, 1, 2].map((i) => math.summarise(bitmap, w, h, { x0: 0, y0: Math.round(h * i / 3), x1: edge, y1: Math.round(h * (i + 1) / 3) }, step)?.hex);
  return { all: math.summarise(bitmap, w, h, { x0: 0, y0: 0, x1: edge, y1: h }, step), thirds };
}

async function readEdges(wc, facts) {
  const vw = Math.max(200, Math.round(facts && facts.vw || 1000)), vh = Math.max(200, Math.round(facts && facts.vh || 700));
  const top = await capture(wc, { x: 0, y: 0, width: vw, height: Math.min(160, vh) });
  const left = await capture(wc, { x: 0, y: 0, width: 24, height: Math.min(vh, 700) });
  return {
    top: top && { ...topStrips(top), captureMs: top.captureMs, bitmapMs: top.bitmapMs, pixels: top.width * top.height },
    left: left && { ...leftStrips(left), captureMs: left.captureMs, bitmapMs: left.bitmapMs },
  };
}

async function readViewport(wc, facts) {
  const vw = Math.max(200, Math.round(facts && facts.vw || 1000)), vh = Math.max(200, Math.round(facts && facts.vh || 700));
  const shot = await capture(wc, { x: 0, y: 0, width: vw, height: vh });
  if (!shot) return null;
  return { ...math.summarise(shot.bitmap, shot.width, shot.height, { x0: 0, y0: 0, x1: shot.width, y1: shot.height }, 8), captureMs: shot.captureMs, bitmapMs: shot.bitmapMs, pixels: shot.width * shot.height };
}

async function readFavicon(wc, facts, { nativeImage }) {
  const t0 = now();
  try {
    const candidates = iconPick.candidatesFrom({ links: facts && facts.links, announced: [], pageUrl: facts && facts.url || wc.getURL() });
    let list = iconPick.plan(candidates, 64, 2);
    if (!list.length) { try { const origin = new URL(facts.url).origin; list = [{ url: origin + '/favicon.ico', fallback: true }]; } catch { /* no page */ } }
    for (const pick of list) {
      const response = await withTimeout(wc.session.fetch(pick.url, { credentials: 'omit' }), 4000);
      if (!response || !response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, 400000);
      const kind = iconImage.sniff(bytes);
      if (kind === 'svg') {
        const list = math.svgColours(bytes.toString('utf8')), chromatic = list.find((item) => math.saturation(math.fromHex(item.hex)) >= 0.3 && math.luminance(math.fromHex(item.hex)) < 0.8);
        if (!list.length) return { ms: now() - t0, url: pick.url, kind, note: 'svg names no colours' };
        const total = list.reduce((sum, item) => sum + item.count, 0);
        return { ms: now() - t0, url: pick.url, kind, all: { hex: list[0].hex, share: list[0].count / total }, brand: chromatic ? { hex: chromatic.hex, share: chromatic.count / total } : null, note: 'svg: colours named in the file' };
      }
      let size = null, bitmap = null;
      if (kind === 'ico') {
        const pictures = iconImage.icoPictures(bytes), best = pictures && iconImage.icoPreference(pictures, 64)[0];
        if (!best) continue;
        if (best.png) { const image = nativeImage.createFromBuffer(Buffer.from(bytes.subarray(best.offset, best.offset + best.size))); if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); } }
        else { const dib = math.decodeIcoBitmap(bytes, best.offset); if (dib) { size = { width: dib.width, height: dib.height }; bitmap = dib.bgra; } }
      } else {
        const image = nativeImage.createFromBuffer(bytes);
        if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); }
      }
      if (!bitmap || bitmap.length !== size.width * size.height * 4) continue;
      const colours = math.iconColours(bitmap, size.width, size.height);
      return { ms: now() - t0, url: pick.url, kind, px: size.width, ...colours };
    }
    return { ms: now() - t0, none: true };
  } catch (error) { return { ms: now() - t0, error: String(error && error.message || error).slice(0, 80) }; }
}

/** Everything about one page, once. options.skip = ['manifest', 'favicon', 'viewport'] leaves a stage out. */
async function probe(wc, { nativeImage, skip = [], chromium = null } = {}) {
  const t0 = now(), record = { at: new Date().toISOString(), ms: {} };
  const { facts, ms: factsMs } = await readFacts(wc);
  record.ms.facts = Math.round(factsMs);
  if (!facts) { record.error = 'page facts unavailable'; return record; }
  record.facts = { url: facts.url, title: facts.title, scrollY: facts.scrollY, docHeight: facts.docHeight, dpr: facts.dpr, vw: facts.vw, vh: facts.vh, prefersDark: facts.prefersDark, colorSchemeMeta: facts.colorSchemeMeta, rootColorScheme: facts.rootColorScheme };
  const meta = pickMeta(facts.metas);
  record.themeColor = { metas: facts.metas, chosen: meta ? { content: meta.content, media: meta.media, hex: math.toHex(meta.rgba), alpha: meta.rgba[3], opaqueOnWhite: math.toHex(math.over(meta.rgba, [255, 255, 255])), opaqueOnBlack: math.toHex(math.over(meta.rgba, [0, 0, 0])) } : null, chromium };
  const htmlBg = rgbOf(facts.html && facts.html.rgba), bodyBg = rgbOf(facts.body && facts.body.rgba);
  const resolveBg = (item) => (item && item.rgba && item.rgba[3] >= 0.97 ? math.toHex(item.rgba.slice(0, 3)) : null);
  record.bodyBackground = { html: resolveBg(facts.html), body: resolveBg(facts.body), htmlImage: facts.html && facts.html.image || '', bodyImage: facts.body && facts.body.image || '' };
  const base = (facts.html && facts.html.rgba && facts.html.rgba[3] >= 0.97 ? htmlBg : null) || [255, 255, 255];
  const tops = (facts.top || []).map((sample) => ({ x: sample.x, tag: sample.tag, kind: sample.kind, pos: sample.pos, hex: (() => { const rgb = resolveTop(sample, base); return rgb ? math.toHex(rgb) : null; })() }));
  const flat = tops.filter((sample) => sample.hex);
  const counts = new Map(); for (const sample of flat) counts.set(sample.hex, (counts.get(sample.hex) || 0) + 1);
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  record.topElements = { samples: tops, hex: commonest ? commonest[0] : null, agree: commonest ? commonest[1] / tops.length : 0, kinds: [...new Set(tops.map((sample) => sample.kind))] };
  const t1 = now();
  const edges = await readEdges(wc, facts);
  record.ms.edges = Math.round(now() - t1);
  record.top = edges.top; record.left = edges.left;
  if (!skip.includes('viewport')) { const t2 = now(); record.viewport = await readViewport(wc, facts); record.ms.viewport = Math.round(now() - t2); }
  if (!skip.includes('manifest')) { record.manifest = await readManifest(wc, facts.manifestHref); record.ms.manifest = Math.round(record.manifest.ms || 0); }
  if (!skip.includes('favicon')) { record.favicon = await readFavicon(wc, facts, { nativeImage }); record.ms.favicon = Math.round(record.favicon.ms || 0); }
  record.ms.total = Math.round(now() - t0);
  return record;
}

/** Cost of the cheap path, for the README: `count` captures of the top strip back to back (or spaced by `everyMs`), with the CPU the app's processes used. */
async function cost(wc, { app, count = 40, everyMs = 0, what = 'strip' } = {}) {
  const facts = (await readFacts(wc)).facts || { vw: 1000, vh: 700 };
  const cpu = () => Object.fromEntries(app.getAppMetrics().map((item) => [item.pid + ':' + item.type, item.cpu.cumulativeCPUUsage]));
  const before = cpu(), t0 = now(), times = [];
  for (let i = 0; i < count; i++) {
    const t = now();
    const shot = what === 'viewport' ? await capture(wc, { x: 0, y: 0, width: facts.vw, height: facts.vh }) : await capture(wc, { x: 0, y: 0, width: facts.vw, height: 24 });
    if (shot) { const w = shot.width, h = shot.height; math.summarise(shot.bitmap, w, h, { x0: 0, y0: 0, x1: w, y1: h }, what === 'viewport' ? 8 : Math.max(1, Math.round(shot.scale))); }
    times.push(now() - t);
    if (everyMs) await new Promise((resolve) => setTimeout(resolve, Math.max(0, everyMs - (now() - t))));
  }
  const wall = (now() - t0) / 1000, after = cpu(), perType = {};
  for (const key of Object.keys(after)) { const type = key.split(':')[1]; perType[type] = (perType[type] || 0) + (after[key] - (before[key] || 0)); }
  times.sort((a, b) => a - b);
  return { what, count, everyMs, wallSeconds: +wall.toFixed(2), msMedian: +times[Math.floor(times.length / 2)].toFixed(2), msP95: +times[Math.floor(times.length * 0.95)].toFixed(2), msMax: +times[times.length - 1].toFixed(2), cpuSecondsByProcess: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, +v.toFixed(3)])) };
}

/** Wires the probe to every http(s) page of the running app and logs a record after each load / in-page navigation / theme-color change. */
function install({ app, webContents, nativeImage }) {
  if (process.env.ACIRA_SITE_COLOR_PROBE !== '1') return null;
  if (!process.env.ACIRA_BROWSER_TEST_DATA) { console.warn('[site-color-probe] refused: not a throwaway profile'); return null; }
  const logFile = process.env.ACIRA_SITE_COLOR_PROBE_LOG || path.join(process.env.ACIRA_BROWSER_TEST_DATA, 'site-color-probe.jsonl');
  const themeEvents = new WeakMap();
  const api = { probe: (wc, options) => probe(wc, { nativeImage, chromium: themeEvents.get(wc) || null, ...options }), cost: (wc, options) => cost(wc, { app, ...options }), math, themeEvents, logFile, auto: true };
  const tracked = new WeakSet();
  const isPage = (wc) => { try { return !wc.isDestroyed() && /^https?:/i.test(wc.getURL()); } catch { return false; } };
  const record = (wc, why) => {
    if (!api.auto || !isPage(wc)) return;
    setTimeout(async () => {
      if (!isPage(wc)) return;
      try { const entry = await api.probe(wc, { skip: ['manifest', 'favicon', 'viewport'] }); fs.appendFileSync(logFile, JSON.stringify({ why, ...entry }) + '\n'); } catch { /* a page that went away mid-read */ }
    }, 500).unref?.();
  };
  app.on('web-contents-created', (_event, wc) => {
    if (tracked.has(wc)) return; tracked.add(wc);
    wc.on('did-change-theme-color', (_e, color) => { const list = themeEvents.get(wc) || { events: [] }; list.events.push({ t: Date.now(), color }); list.last = color; themeEvents.set(wc, list); record(wc, 'theme-color'); });
    wc.on('did-finish-load', () => record(wc, 'load'));
    wc.on('did-navigate-in-page', () => record(wc, 'in-page'));
  });
  globalThis.__aciraSiteColorProbe = api;
  return api;
}

module.exports = { install, probe, cost, readFacts, readManifest, readEdges, FACTS_CODE, pickMeta, resolveTop };
