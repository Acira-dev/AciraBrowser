// R4-39: the state plan of qa/r4-responsive-sweep.mjs, pure so a test can prove its coverage.
// Window content sizes are DIPs: the work area (display size / display scale, minus a 48px taskbar) for a maximized window, Windows Snap
// halves and quarters of it, plus the small ones. Sizes below the 900x600 window minimum are clamped to it (and merged when equal).
export const MIN = [900, 600];
export const SIZES = {
  100: [['min 900x600', 900, 600], ['1280x720', 1280, 720], ['1366x768', 1366, 768], ['1080p max', 1920, 1032], ['1080p half', 960, 1032], ['1080p quarter', 960, 516], ['1440p max', 2560, 1392], ['1440p half', 1280, 1392], ['1440p quarter', 1280, 696], ['ultrawide 3440x1440', 3440, 1392]],
  125: [['1080p max', 1536, 816], ['1080p half', 768, 816], ['1080p quarter', 768, 408], ['1440p max', 2048, 1104], ['1440p half', 1024, 1104], ['1440p quarter', 1024, 552]],
  150: [['4K max', 2560, 1392], ['4K half', 1280, 1392], ['4K quarter', 1280, 696], ['1080p max', 1280, 672], ['1080p half', 640, 672], ['1080p quarter', 640, 384]],
};
export const SCALES = [80, 100, 125, 150], TABS = ['top', 'sidebar'], VIEWS = ['full', 'compact', 'focus', 'seamless'];
export const POPUPS = ['menu', 'more-tools', 'profile', 'protection'], PAGES = ['newtab-framed', 'newtab-full', 'settings-appearance', 'settings-privacy', 'history'];

export const clampSizes = list => {
  const seen = new Map();
  for (const [label, w, h] of list) { const W = Math.max(w, MIN[0]), H = Math.max(h, MIN[1]), k = W + 'x' + H; if (seen.has(k)) seen.get(k)[0] += ' / ' + label; else seen.set(k, [label, W, H]); }
  return [...seen.values()];
};
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Greedy pairwise covering array over factors with `counts[i]` values each: every pair of values of any two factors appears in at least one row. */
export function pairwise(counts, seed) {
  const rnd = rng(seed), key = (i, a, j, b) => i + ':' + a + '|' + j + ':' + b, need = new Set(), rows = [];
  for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) for (let a = 0; a < counts[i]; a++) for (let b = 0; b < counts[j]; b++) need.add(key(i, a, j, b));
  for (let guard = 0; need.size && guard < 400; guard++) {
    let best = null, gain = -1;
    for (let c = 0; c < 400; c++) { const row = counts.map(n => Math.floor(rnd() * n)); let g = 0; for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) if (need.has(key(i, row[i], j, row[j]))) g++; if (g > gain) { gain = g; best = row; } }
    rows.push(best); for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) need.delete(key(i, best[i], j, best[j]));
  }
  return rows;
}
/** The rows for one display scale. Each row also names the popup and page surface it visits (rotating so every size meets them all) and whether it shows a toast. */
export function planFor(display, theme = 'mix') {
  const sizes = clampSizes(SIZES[display]), rows = pairwise([sizes.length, SCALES.length, TABS.length, VIEWS.length], 4039 + display), seenSize = new Map();
  return rows.map((r, n) => {
    const k = seenSize.get(r[0]) || 0; seenSize.set(r[0], k + 1);
    return { n, display, size: sizes[r[0]], scale: SCALES[r[1]], tabs: TABS[r[2]], view: VIEWS[r[3]], theme: theme === 'mix' ? (n % 2 ? 'light' : 'dark') : theme,
      popup: POPUPS[(k + r[0]) % POPUPS.length], page: PAGES[(k + r[0] * 2) % PAGES.length], toast: k % 2 === 0 };
  });
}
