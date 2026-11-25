'use strict';
/**
 * The open site's colour, for the frame's glow (beta.13, item 19). Researcher A's pipeline, built for real.
 *
 * What it answers: "what colour would a person call this site's?" A brand colour: saturated, neither near-black nor near-white. Most big
 * sites paint white or black along their top edge, so the answer is often NOTHING, and then the frame shows no glow (it is absent, never
 * black). Sources, in this order, the first that holds a brand colour wins:
 *   1. <meta name=theme-color>, as Chromium resolved it (the `did-change-theme-color` event: media queries and alpha done)
 *   2. the page's own top edge: one thin capturePage of the top 24 DIP, when it is one flat colour
 *   3. the site's icon, from the icon store the sidebar already uses (nothing is fetched: a brand colour of the icon's colourful pixels)
 *   4. (14.1) the page's own colour: one capturePage of the top BAND_DIP of the page, the brand colour that covers the most of it, when it covers at least
 *      BAND_SHARE (a page that is its colour: coveryourtracks.eff.org's green under a black logo bar, no theme-color, a grey icon, had no colour at all; the tester,
 *      21 Nov). A white or black page, or one of photos in many colours, still gives nothing.
 * A reading never repaints at once: `createHold` (math module) shows a new colour only when it is more than dE 3.5 from the shown one and
 * the same candidate was read twice over 220 ms. A navigation to another site skips the dwell, not the distance. Re-reads happen on the
 * triggers in researcher A's table (load + 250 ms, +1.5 s, +4 s; an in-page navigation +400 ms; a theme-color change; an icon change),
 * never on a timer and never while the tab is off screen. Nothing leaves the machine: pixels are reduced to one #rrggbb string here.
 *
 * Never sampled, never emitted: Off, a private, Tor or secured tab, a window in private or Tor mode. The colour is not saved
 * (core.persistedSnapshot drops it); a colour per site is remembered in memory for this run only, in normal windows only.
 */
const math = require('./site-color-math.cjs');

const STRIP_DIP = 24, FLAT_SHARE = .85, SEGMENT_AGREE = 6, TIMEOUT_MS = 3000, HOST_MEMORY = 200;
/** Source 4 (14.1): the band of the page that is read for its own colour, and the share of it one brand colour must cover. */
const BAND_DIP = 200, BAND_SHARE = .3;
const rgbOf = hex => { const p = math.fromHex(hex); return p ? p.slice(0, 3) : null; };
/** A colour a person would call the site's colour (A: saturated, luminance between near-black and near-white). */
function isBrand(rgb) {
  if (!rgb || rgb.length < 3) return false;
  const lum = math.luminance(rgb);
  return math.saturation(rgb) >= .3 && lum > .02 && lum < .8;
}
const hostOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; } };

/** The colour of one flat strip, or null: the strip's mode colour when at least 85% of it sits in one cell and its left, middle and right
 *  fifths agree (so a photo, a gradient or a half-and-half header gives nothing). `bitmap` is BGRA. */
function flatStrip(bitmap, width, height) {
  const rows = Math.max(1, Math.min(height, height)), region = (a, b) => math.summarise(bitmap, width, height, { x0: Math.round(width * a), y0: 0, x1: Math.round(width * b), y1: rows }, 2);
  const whole = region(0, 1); if (!whole || whole.share < FLAT_SHARE) return null;
  const parts = [region(0, .2), region(.4, .6), region(.8, 1)]; if (parts.some(p => !p)) return null;
  for (let i = 1; i < parts.length; i++) if (math.deltaE(math.fromHex(parts[0].hex), math.fromHex(parts[i].hex)) > SEGMENT_AGREE) return null;
  return { rgb: whole.rgb, hex: whole.hex, share: whole.share };
}

/** Source 4 (14.1): the brand colour covering the most of a band of the page (BGRA), with the share of the band it covers: {rgb, hex, share} when that share is at
 *  least BAND_SHARE, else null. Pixels are binned 4 bits a channel (as `math.summarise` does); a bin and its neighbours count as one colour, so a gradient or
 *  text anti-aliasing does not split it; only pixels that are brand colours on their own (isBrand) vote. Every 2nd pixel each way. */
function bandBrand(bitmap, width, height, { share = BAND_SHARE, step = 2 } = {}) {
  if (!bitmap || !(width > 0) || !(height > 0) || bitmap.length < width * height * 4) return null;
  const bins = new Map(); let total = 0;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const at = (y * width + x) * 4, b = bitmap[at], g = bitmap[at + 1], r = bitmap[at + 2]; total++;
    if (!isBrand([r, g, b])) continue;
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4), bin = bins.get(key);
    if (bin) { bin[0]++; bin[1] += r; bin[2] += g; bin[3] += b; } else bins.set(key, [1, r, g, b]);
  }
  if (!total || !bins.size) return null;
  let best = null;
  for (const [key, bin] of bins) {
    const kr = key >> 8, kg = (key >> 4) & 15, kb = key & 15; let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) { const near = bins.get((kr + dr) << 8 | (kg + dg) << 4 | (kb + db)); if (near && kr + dr >= 0 && kg + dg >= 0 && kb + db >= 0 && kr + dr < 16 && kg + dg < 16 && kb + db < 16) n += near[0]; }
    if (!best || n > best.n || (n === best.n && bin[0] > best.bin[0])) best = { n, bin };
  }
  const covered = best.n / total; if (covered < share) return null;
  const rgb = [best.bin[1], best.bin[2], best.bin[3]].map(v => Math.round(v / best.bin[0]));
  return isBrand(rgb) ? { rgb, hex: math.toHex(rgb), share: Math.round(covered * 1000) / 1000 } : null;
}

/** The brand colour of a stored icon (a data URL) via the bitmap the caller decoded: {rgb} or null. */
function iconBrand(bitmap, width, height) {
  const colours = math.iconColours(bitmap, width, height);
  return colours.brand && colours.brand.share >= .05 ? { rgb: math.fromHex(colours.brand.hex).slice(0, 3), hex: colours.brand.hex } : null;
}

/** How long after a page's first declared theme-color a following one is still part of the page settling (applied without the hold's dwell). */
const SETTLE_MS = 600;

function createSiteColour({
  now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout,
  level = () => 'soft',            // 'off' | 'soft' | 'rich' (the setting)
  blocked = () => false,           // private, Tor, secured: no sampling, no colour
  visible = () => true,            // is this tab's page on screen right now
  stripOf = async () => null,      // (tabId) -> {bitmap,width,height} of the top 24 DIP, or null
  iconOf = async () => null,       // (tabId, urls) -> '#rrggbb' brand colour of the icon the page announced, or null (one cached fetch, never repeated)
  bandOf = async () => null,       // (14.1) (tabId) -> {bitmap,width,height} of the top BAND_DIP of the page, or null
  rememberHosts = true,
} = {}) {
  const tabs = new Map(), hostMemory = new Map();
  const remember = (host, hex) => { if (!rememberHosts || !host) return; hostMemory.delete(host); hostMemory.set(host, hex); if (hostMemory.size > HOST_MEMORY) hostMemory.delete(hostMemory.keys().next().value); };

  function attach(tabId, { emit, url = () => '' }) {
    const tab = { id: tabId, emit, url, host: null, shownHost: null, theme: null, themeSeen: false, settleUntil: 0, hold: math.createHold(), shown: null, none: 0, timers: new Set(), generation: 0, force: false, disposed: false, icons: [], iconColour: undefined, sampledVisible: false };
    tabs.set(tabId, tab);
    const later = (ms, fn) => { const t = schedule(() => { tab.timers.delete(t); if (!tab.disposed) fn(); }, ms); t.unref?.(); tab.timers.add(t); return t; };
    const clear = () => { for (const t of tab.timers) cancel(t); tab.timers.clear(); };
    // (14.1) every colour goes out with the site it was read for: the interface's ring and folder use it only while that site is the one shown
    const publish = hex => { const host = hex ? tab.host : null; if (hex === tab.shown && host === tab.shownHost) return; tab.shown = hex; tab.shownHost = host; emit({ siteColor: hex, siteColorHost: host }); };

    async function resolve() {
      if (tab.disposed) return;
      if (level() === 'off' || blocked(tabId)) { tab.none = 0; if (tab.shown) publish(null); return; }
      const token = ++tab.generation;
      let found = null;
      if (tab.theme && isBrand(tab.theme)) found = { rgb: tab.theme, from: 'theme-color' };
      if (!found && visible(tabId)) {
        const strip = await stripOf(tabId).catch(() => null);
        if (token !== tab.generation || tab.disposed) return;
        const flat = strip && flatStrip(strip.bitmap, strip.width, strip.height);
        if (flat && isBrand(flat.rgb)) found = { rgb: flat.rgb, from: 'edge' };
      }
      if (!found && (tab.icons.length || tab.iconColour)) {
        if (tab.iconColour === undefined) {
          tab.iconColour = null; const asked = tab.icons, hex = await iconOf(tabId, asked).catch(() => null);
          if (tab.disposed) return;
          // D164: the answer is kept for the icons it was asked for, also when another pass started meanwhile (it was thrown away, and the page had no icon colour until its next icon event)
          if (tab.icons === asked && !tab.iconColour) tab.iconColour = hex || null;
          if (token !== tab.generation) { if (hex && tab.icons === asked) later(0, () => resolve()); return; }
        }
        if (tab.iconColour) found = { rgb: rgbOf(tab.iconColour), from: 'icon' };
      }
      if (!found && visible(tabId)) {
        const band = await bandOf(tabId).catch(() => null);
        if (token !== tab.generation || tab.disposed) return;
        const brand = band && bandBrand(band.bitmap, band.width, band.height);
        if (brand) found = { rgb: brand.rgb, from: 'page' };
      }
      if (token !== tab.generation || tab.disposed) return;
      const force = tab.force; tab.force = false;
      if (found) {
        tab.none = 0;
        const result = tab.hold.push(found.rgb, now(), { force });
        // The hold's first colour shows at once; later ones only past dE 3.5 and a dwell. Fading back from nothing counts as a first.
        if (tab.shown === null && tab.hold.shown) { const hex = math.toHex(tab.hold.shown); publish(hex); remember(tab.host, hex); }
        else if (result.changed) { const hex = math.toHex(result.rgb); publish(hex); remember(tab.host, hex); }
        return;
      }
      // D164: a site keeps the colour it was shown with until a DIFFERENT colour is read. A reading that finds nothing on the same site (a preload's sub-load ending, a capture that came back
      // empty, a same-site page whose icon is still being fetched, a remembered colour before the page announced its icon) is no reason to drop it: that was the glow leaving and coming back
      // on one page. Off, private and another site are decided above and below, as before.
      if (tab.shown && tab.host && tab.shownHost === tab.host) { tab.none = 0; return; }
      // Nothing with a brand colour on a site whose colour is not the one shown: the glow goes away, but only when it is not a one-off (twice, or right after a change of site).
      tab.none++;
      if (tab.shown && (force || tab.none >= 2)) { tab.hold = math.createHold(); publish(null); remember(tab.host, null); }
      else if (tab.shown) later(500, () => resolve());
    }

    const schedulePass = () => { clear(); later(250, () => resolve()); later(1500, () => resolve()); later(4000, () => resolve()); };
    return {
      /** A main-frame navigation committed: keep the last colour; another site resets the hold and gets the remembered colour at once. */
      navigated(newUrl) {
        tab.themeSeen = false; tab.settleUntil = 0; // a new page: its first declared colour is applied at once (themeColor below), the same site or not
        const host = hostOf(newUrl);
        if (host !== tab.host) {
          tab.host = host; tab.theme = null; tab.hold = math.createHold(); tab.force = true; tab.none = 0; tab.icons = []; tab.iconColour = undefined; tab.iconHanded = false;
          if (host && hostMemory.has(host) && level() !== 'off' && !blocked(tabId)) { const hex = hostMemory.get(host); if (hex !== tab.shown || (hex ? host : null) !== tab.shownHost) { tab.shown = hex; tab.shownHost = hex ? host : null; emit({ siteColor: hex, siteColorHost: tab.shownHost }); if (hex) tab.hold.push(rgbOf(hex), now(), { force: true }); } }
        }
        clear();
      },
      loaded() { schedulePass(); },
      inPage() { clear(); later(400, () => resolve()); },
      /** A page's theme-color. The FIRST brand colour a page declares after a navigation is applied at once, with no debounce and no dwell (13.5: the glow used to start about 165 ms
       *  after the page knew its colour, and a same-site page that changed colour waited for the 1.5 s pass for its second read). Declared colours that follow within SETTLE_MS (a page
       *  that boots with a default and then sets its own) are applied after the short debounce, also without the dwell; after that a change is debounced and goes through the hold
       *  as before, so a page that animates its theme-color cannot flicker the glow. Anything that is not a brand colour (white, black, grey) keeps the old path. */
      themeColor(color) {
        tab.theme = color ? rgbOf(color) : null; clear();
        const declared = !!(tab.theme && isBrand(tab.theme)), first = !tab.themeSeen; tab.themeSeen = true;
        if (declared && first) { tab.settleUntil = now() + SETTLE_MS; tab.force = true; later(0, () => resolve()); return; }
        if (declared && now() < tab.settleUntil) { tab.force = true; later(120, () => resolve()); return; }
        later(120, () => resolve());
      },
      /** The icon the tab itself resolved (tab-icons: the page's best declared icon, fetched once with the longer wait) gave this brand colour (or none): it replaces a reading that found
       *  nothing, so the colour never depends on the second, 4 s fetch alone. A colour handed over this way stays through the page's own icon announcement (`iconChanged` keeps it; the glow does not drop while the second fetch runs) and is replaced only by another handed over for a new icon. */
      iconResolved(hex) { if (typeof hex === 'string' && hex && tab.iconColour !== hex && isBrand(rgbOf(hex))) { tab.iconColour = hex; tab.iconHanded = true; clear(); later(120, () => resolve()); later(400, () => resolve()); } },
      iconChanged(urls) { tab.icons = Array.isArray(urls) ? urls.filter(u => typeof u === 'string').slice(0, 4) : []; if (!tab.iconHanded) tab.iconColour = undefined; later(600, () => resolve()); },
      /** The tab came on screen (or the setting changed): read it once now. */
      shown() { clear(); later(300, () => resolve()); },
      /** Called whenever the tab is on screen (cheap): the first time it is seen with nothing read yet, read it. */
      visibleNow() { if (!tab.sampledVisible) { tab.sampledVisible = true; later(300, () => resolve()); } },
      recheck() { clear(); later(0, () => resolve()); },
      get current() { return tab.shown; },
      dispose() { tab.disposed = true; clear(); tabs.delete(tabId); },
    };
  }
  return { attach, get tabs() { return tabs; }, hostMemory, forgetMemory: () => hostMemory.clear() };
}

/** Electron glue: a thin capture of the top strip of a page, as BGRA. */
async function captureStrip(wc, { dip = STRIP_DIP, width: viewWidth = 1200 } = {}) {
  const width = Math.max(200, Math.round(viewWidth));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), TIMEOUT_MS));
  const image = await Promise.race([wc.capturePage({ x: 0, y: 0, width, height: dip }, { stayHidden: true, stayAwake: false }).catch(() => null), timeout]);
  if (!image || image.isEmpty()) return null;
  const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 });
  return bitmap.length === size.width * size.height * 4 ? { bitmap, width: size.width, height: size.height } : null;
}
/** The brand colour of an icon file's bytes (A: SVG by the colours the file names; ICO by its bitmap; PNG and the rest through nativeImage): `{hex}` when it has one,
 *  `{none: true}` when it is a picture with no brand colour (a white tile with a grey mark), `{skip: true}` when it cannot be read. Pure but for `nativeImage`. */
function brandOfIcon(bytes, { nativeImage, iconImage }) {
  bytes = Buffer.from(bytes).subarray(0, 400000);
  const kind = iconImage.sniff(bytes);
  if (kind === 'svg') {
    const list = math.svgColours(bytes.toString('utf8')), brand = list.find(item => isBrand(math.fromHex(item.hex).slice(0, 3)));
    return brand ? { hex: brand.hex } : { skip: true };
  }
  let size = null, bitmap = null;
  if (kind === 'ico') {
    const pictures = iconImage.icoPictures(bytes), best = pictures && iconImage.icoPreference(pictures, 64)[0];
    if (!best) return { skip: true };
    if (best.png) { const image = nativeImage.createFromBuffer(Buffer.from(bytes.subarray(best.offset, best.offset + best.size))); if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); } }
    else { const dib = math.decodeIcoBitmap(bytes, best.offset); if (dib) { size = { width: dib.width, height: dib.height }; bitmap = dib.bgra; } }
  } else { const image = nativeImage.createFromBuffer(bytes); if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); } }
  if (!bitmap || bitmap.length !== size.width * size.height * 4) return { skip: true };
  const brand = iconBrand(bitmap, size.width, size.height);
  return brand ? { hex: brand.hex } : { none: true };
}
/** Electron glue: the brand colour of the icon a page announced, fetched through the TAB's own session, without cookies, answered from the HTTP cache when the page just loaded it;
 *  at most 400 KB, 4 s. This is the FALLBACK: the icon the tab already resolved for its own tab and sidebar row (tab-icons.resolvePageIcon, one fetch with 15 s) is handed to the colour
 *  as it arrives (`iconResolved` below), so a heavy page whose second, shorter fetch times out still gets its colour (Twitch: no theme-color, no flat top edge, only the icon). */
async function iconColour(wc, urls, { nativeImage, iconImage }) {
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const response = await withTimeout(wc.session.fetch(url, { credentials: 'omit', cache: 'force-cache' }), 4000);
      if (!response || !response.ok) continue;
      const read = brandOfIcon(Buffer.from(await response.arrayBuffer()), { nativeImage, iconImage });
      if (read.hex) return read.hex;
      if (read.none) return null;
    } catch { /* an icon that does not load gives nothing */ }
  }
  return null;
}
/** Kept for tests: a stored icon (data URL) as BGRA. */
function decodeIcon(nativeImage, dataUrl) {
  if (!dataUrl) return null;
  try { const image = nativeImage.createFromDataURL(dataUrl); if (image.isEmpty()) return null; const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 }); return bitmap.length === size.width * size.height * 4 ? { bitmap, width: size.width, height: size.height } : null; } catch { return null; }
}

module.exports = { createSiteColour, isBrand, flatStrip, bandBrand, BAND_DIP, BAND_SHARE, iconBrand, hostOf, captureStrip, decodeIcon, iconColour, brandOfIcon };
