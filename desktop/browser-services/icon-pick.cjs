'use strict';
// Which of a page's own icons to show. A page declares several (`<link rel="icon" sizes=...>`, an .ico, an SVG, an apple-touch-icon) and the
// browser engine reports them only as a list of addresses sorted by name, so "the first one" was alphabetical luck: a 16 px file stretched
// to 32, 48 or 72 device pixels. This module reads what the page declares, ranks it for the biggest place an icon is drawn, and says which
// few files are worth fetching. Pure (no network); only icons the page itself declares are ever candidates.

/** The biggest place a site icon is drawn: a New Tab tile, 24 CSS px. The screen's pixel ratio is at least 2 (Retina, and a 1x display's
 *  window can move to one), so a 1x or 1.25x display also gets a file that is sharp when the window is dragged to a Retina one. */
const TILE_CSS_PX = 24;
const needFor = (scale) => Math.ceil(TILE_CSS_PX * Math.max(2, Number.isFinite(scale) ? scale : 2));
/** The most files fetched for one page. A pick by declared size is usually right at the first; a second and third cover an icon that is
 *  smaller than it said, or one that is not there. */
const MAX_TRIES = 3;

const TOUCH = /(?:^|\s)apple-touch-icon(?:-precomposed)?(?:\s|$)/i;
const isIconRel = (rel) => String(rel || '').toLowerCase().split(/\s+/).includes('icon');
/** Runs in the page, in an isolated world (so the page cannot answer differently): every `<link rel>` with its resolved address. Reads the
 *  document only; it asks the network for nothing. */
const PAGE_LINKS_CODE = "(()=>[...document.querySelectorAll('link[rel]')].slice(0,60).map(n=>({rel:String(n.rel||''),href:String(n.href||''),sizes:String((n.sizes&&n.sizes.value)||''),type:String(n.type||'')})))()";

const stripHash = (url) => { try { const parsed = new URL(url); parsed.hash = ''; return parsed.href; } catch { return ''; } };
const isWeb = (url) => /^https?:\/\//i.test(url);

/** The biggest width in a `sizes` attribute ("16x16 32x32"), or 0 when it says none ("any" counts as none). */
function parseSizes(value) {
  let best = 0;
  for (const token of String(value || '').toLowerCase().split(/\s+/)) { const match = /^(\d{1,4})x(\d{1,4})$/.exec(token); if (match) best = Math.max(best, Number(match[1])); }
  return best;
}
/** A size a file name gives away ("favicon-32x32.png", "192x192.png", "favicon-32-ab12.png"), or 0. Only a hint: the file is measured when fetched. */
function sizeHint(url) {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return 0; }
  const square = /(?:^|[^0-9])(\d{2,3})x\1(?![0-9])/.exec(name);
  if (square) return Number(square[1]);
  const single = /[-_.](16|24|32|48|57|60|64|72|76|96|114|120|128|144|152|167|180|192|256|384|512)(?=[-_.]|$)/.exec(name);
  return single ? Number(single[1]) : 0;
}
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return ''; } };
const isIco = (url, type) => /x-icon|vnd\.microsoft/i.test(type || '') || /\.ico$/i.test(pathOf(url));
const isSvg = (url, type) => /svg/i.test(type || '') || /\.svg$/i.test(pathOf(url));

/** The candidates a page offers: its `<link>` icons (links: [{rel, href, sizes, type}] from PAGE_LINKS_CODE, or null when they could not be
 *  read) plus the addresses the engine announced. [{url, touch, vector, px}]: px is the declared size in pixels, 0 when unknown (an .ico's
 *  declared size is not trusted: it holds several pictures and pages mis-state it). */
function candidatesFrom({ links = null, announced = [], pageUrl = '' } = {}) {
  const out = [], seen = new Set();
  const add = (href, rel, sizes, type) => {
    let url = '';
    try { url = stripHash(new URL(href, pageUrl || undefined).href); } catch { return; }
    if (!isWeb(url) || seen.has(url)) return;
    seen.add(url);
    const vector = isSvg(url, type), ico = isIco(url, type);
    out.push({ url, touch: TOUCH.test(rel), vector, px: vector || ico ? 0 : parseSizes(sizes) || sizeHint(url) });
  };
  for (const link of Array.isArray(links) ? links : []) {
    if (!link || typeof link.href !== 'string' || typeof link.rel !== 'string') continue;
    if (TOUCH.test(link.rel) || isIconRel(link.rel)) add(link.href, link.rel, link.sizes, link.type);
  }
  for (const url of announced) if (typeof url === 'string') add(url, 'icon', '', '');
  return out;
}

/** The files worth fetching, best first, for a place `need` device pixels wide. The page's own plain icons come first, in this order:
 *  the smallest declared bitmap that is big enough; files of unknown size (measured when fetched); the SVG (sharp at any size); then the
 *  smaller bitmaps, biggest first. An apple-touch-icon is used only when the page declares nothing else (its artwork is a different,
 *  square app icon, so it never replaces the page's favicon). */
function plan(candidates, need = needFor(2), max = MAX_TRIES) {
  const plain = candidates.filter((candidate) => !candidate.touch), pool = plain.length ? plain : candidates;
  const bitmaps = pool.filter((candidate) => !candidate.vector);
  const enough = bitmaps.filter((candidate) => candidate.px >= need).sort((a, b) => a.px - b.px);
  const unknown = bitmaps.filter((candidate) => !candidate.px);
  const vectors = pool.filter((candidate) => candidate.vector);
  const small = bitmaps.filter((candidate) => candidate.px && candidate.px < need).sort((a, b) => b.px - a.px);
  return [...enough, ...unknown, ...vectors, ...small].slice(0, max);
}

/** Reads the page's `<link>` icons in an isolated world: [{rel, href, sizes, type}], or null when the page cannot be asked in time. */
async function readPageLinks(contents, { world = 2001, timeoutMs = 1500 } = {}) {
  let timer;
  try {
    if (!contents || contents.isDestroyed?.()) return null;
    const answer = await Promise.race([
      Promise.resolve(contents.executeJavaScriptInIsolatedWorld(world, [{ code: PAGE_LINKS_CODE }], false)),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return Array.isArray(answer) ? answer : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

module.exports = { needFor, parseSizes, sizeHint, candidatesFrom, plan, readPageLinks, PAGE_LINKS_CODE, MAX_TRIES, TILE_CSS_PX };
