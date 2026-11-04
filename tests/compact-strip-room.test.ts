import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captionWidth, compactLeadFloor, fitMetrics, fitToolbar, type FitItem } from '../src/ui/toolbarFit';

// Compact lost its tab strip at 150% in a ~1,280 pt Mac window: the row's left column was sized for the strip folded to its +
// (34px) and the address field took every pixel above that, so the strip had 106px and showed no tab at all. The left column now
// keeps the strip at its usable minimum whenever the field can give that room and keep its own minimum.
// The test sizes the real grid (toolbar-controls.css) with the CSS grid track sizing rules, for every interface size and window
// width, on Mac (traffic lights on the left) and Windows (caption buttons on the right).

const css = fs.readFileSync(new URL('../src/styles/toolbar-controls.css', import.meta.url), 'utf8');
const rule = css.match(/:is\(\[data-layout=compact\],\[data-layout=focus\]\) \.acira-persistent-toolbar\{--compact-field:([^;]+);display:grid;grid-template-columns:([^;]+);column-gap:(\d+)px;padding:0 (\d+)px\}/);
const platformCss = fs.readFileSync(new URL('../src/styles/platform.css', import.meta.url), 'utf8');

/** A small evaluator for the lengths the rule uses: px, vw, %, calc, min, max, clamp and var() with a fallback. */
function length(source: string, env: { vw: number; pct: number; vars: Record<string, string> }): number {
  let at = 0;
  const peek = () => source.slice(at).match(/^\s*/)![0].length + at;
  const eat = (text: string) => { at = peek(); if (!source.startsWith(text, at)) throw new Error(`expected ${text} at ${at} in ${source}`); at += text.length; };
  const args = (): number[] => { const list = [sum()]; while (source[peek()] === ',') { eat(','); list.push(sum()); } eat(')'); return list; };
  const atom = (): number => {
    at = peek();
    const fn = source.slice(at).match(/^(calc|min|max|clamp|var)\(/);
    if (fn) {
      at += fn[0].length;
      if (fn[1] === 'var') { const name = source.slice(at).match(/^--[\w-]+/)![0]; at += name.length; const fallback = source[peek()] === ',' ? (eat(','), source.slice(at, source.indexOf(')', at))) : undefined; at = source.indexOf(')', at) + 1; return length(env.vars[name] ?? fallback ?? '0px', env); }
      const list = args();
      return fn[1] === 'calc' ? list[0] : fn[1] === 'min' ? Math.min(...list) : fn[1] === 'max' ? Math.max(...list) : Math.max(list[0], Math.min(list[1], list[2]));
    }
    if (source[at] === '(') { eat('('); const value = sum(); eat(')'); return value; }
    const number = source.slice(at).match(/^-?[\d.]+(px|vw|%)?/);
    if (!number) throw new Error(`cannot read ${source.slice(at)}`);
    at += number[0].length;
    const value = Number.parseFloat(number[0]);
    return number[1] === 'vw' ? value * env.vw / 100 : number[1] === '%' ? value * env.pct / 100 : value;
  };
  const product = (): number => { let value = atom(); for (;;) { const next = source[peek()]; if (next !== '*' && next !== '/') return value; eat(next); value = next === '*' ? value * atom() : value / atom(); } };
  const sum = (): number => { let value = product(); for (;;) { at = peek(); const next = source.slice(at).match(/^[+-]\s/); if (!next) return value; at += 1; value = next[0][0] === '+' ? value + product() : value - product(); } };
  const value = sum();
  return value;
}

/** Splits `minmax(a,b) minmax(c,d) ...` into its tracks. */
function tracks(template: string) {
  const list: Array<{ min: string; max: string }> = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= template.length; i++) {
    const c = template[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if ((c === ' ' || i === template.length) && depth === 0) {
      const part = template.slice(start, i).trim(); start = i + 1;
      if (!part) continue;
      const inside = part.match(/^minmax\((.*)\)$/)![1];
      let d = 0, comma = -1;
      for (let j = 0; j < inside.length; j++) { if (inside[j] === '(') d++; if (inside[j] === ')') d--; if (inside[j] === ',' && d === 0) { comma = j; break; } }
      list.push({ min: inside.slice(0, comma), max: inside.slice(comma + 1) });
    }
  }
  return list;
}

/** CSS grid track sizing (css-grid-1 §12) for one row of items: base sizes, growth limits, maximize, then expand the fr tracks. */
function columns(template: string, inner: number, gap: number, vw: number, vars: Record<string, string>, maxContent: number[]) {
  const env = { vw, pct: inner, vars };
  const list = tracks(template);
  const avail = inner - gap * (list.length - 1);
  const base = list.map((track, i) => track.min === 'max-content' ? maxContent[i] : length(track.min, env));
  const flex = list.map(track => /^[\d.]+fr$/.test(track.max.trim()));
  const limit = list.map((track, i) => flex[i] ? base[i] : Math.max(base[i], length(track.max, env)));
  // Maximize: free space grows the fixed-limit tracks up to their limits.
  let free = avail - base.reduce((a, b) => a + b, 0);
  const size = [...base];
  for (let round = 0; free > 1e-9 && round < 10; round++) {
    const open = size.map((value, i) => value < limit[i] - 1e-9 ? i : -1).filter(i => i >= 0);
    if (!open.length) break;
    const share = free / open.length;
    for (const i of open) { const grow = Math.min(share, limit[i] - size[i]); size[i] += grow; free -= grow; }
  }
  // Expand flexible tracks: one fr; a track whose base beats its share is sized as fixed.
  const flexible = new Set(size.map((_, i) => i).filter(i => flex[i]));
  for (;;) {
    const leftover = avail - size.reduce((sum, value, i) => sum + (flexible.has(i) ? 0 : value), 0);
    const fr = Math.max(0, leftover / Math.max(1, flexible.size));
    const over = [...flexible].find(i => base[i] > fr);
    if (over !== undefined) { flexible.delete(over); continue; }
    for (const i of flexible) size[i] = Math.max(base[i], fr);
    break;
  }
  return size;
}

const control = fitMetrics.control, navGroup = 3 * control + 2 * 4, home = control + 4, navGap = 6;
const defaults: FitItem[] = ['extensions', 'focus', 'profile'].map(id => ({ id, width: control }));
const scales = [80, 90, 100, 110, 125, 150];

/** The compact row with tabs on top, as useToolbarOverflow measures it: [sidebar toggle hidden] back forward reload home | tab viewer | strip. */
function compactRow(width: number, scale: number, mac: boolean, floor: (lead: number, address: number) => number) {
  const vw = width / (scale / 100);
  // Mac: the traffic lights' room on the left (platform.css --mac-caption-space, 86pt in CSS px), no caption buttons on the right.
  // Windows: the caption buttons' width is kept free as the actions' right margin.
  const padLeft = mac ? 86 / (scale / 100) : 12, padRight = 12, reserve = mac ? 0 : captionWidth(scale) - 12;
  const inner = vw - padLeft - padRight;
  const leading = navGroup + home + control + fitMetrics.stripFolded + 2 * navGap;
  const fit = fitToolbar({ inner: inner - reserve, caption: 0, gap: 12, leading, tabViewer: control + navGap, home, items: defaults, fixed: [control] });
  const lead = leading - (fit.dropTabViewer ? control + navGap : 0) - (fit.hidden.includes('home') ? home : 0);
  const fitLead = Math.ceil(floor(lead, fit.address));
  const [c1, c2, c3] = columns(rule![2], inner, Number(rule![3]), vw, { '--fit-lead': `${fitLead}px`, '--compact-field': rule![1] }, [0, 0, fit.actions + reserve]);
  // The strip is the flexible part of the left column (CompactTabs.css flex:1 1 420px): what the other controls leave.
  return { vw, inner, fit, lead, fitLead, c1, c2, c3, strip: c1 - (lead - fitMetrics.stripFolded), gap: Number(rule![3]) };
}
const before = (lead: number) => lead;
const after = (lead: number, address: number) => compactLeadFloor(lead, address, true);

test('the compact row rule is the one this test sizes, and Mac keeps the traffic lights\' room on its left', () => {
  assert.ok(rule, 'compact grid rule found in toolbar-controls.css');
  assert.match(rule![2], /^minmax\(var\(--fit-lead,0px\),1fr\) minmax\(0,var\(--compact-field\)\) minmax\(max-content,1fr\)$/);
  assert.match(platformCss, /\.acira-persistent-toolbar\{padding-left:var\(--mac-caption-space,86px\)\}/);
  // The grid sizer agrees with the app at the reported size (measured in the dev build: 270 | 220 | 270 before the fix).
  const old = compactRow(1280, 150, true, before);
  assert.deepEqual([old.c1, old.c2, old.c3].map(Math.round), [270, 220, 270]);
  assert.ok(old.strip < fitMetrics.strip, `before the fix the strip had ${old.strip.toFixed(1)}px: folded, no tab shown`);
});

test('the founder\'s case: 150% in a 1,280 pt Mac window keeps the tab strip, the field keeps its width and moves aside', () => {
  const r = compactRow(1280, 150, true, after), old = compactRow(1280, 150, true, before);
  assert.ok(r.strip >= fitMetrics.strip - 0.01, `strip ${r.strip.toFixed(1)}px`);
  assert.equal(Math.round(r.c2), 220, 'the field keeps its deliberate width');
  assert.deepEqual([r.c1, r.c2, r.c3].map(Math.round), [288, 220, 252], 'as measured in the dev build with the fix');
  assert.deepEqual(r.fit.hidden, old.fit.hidden, 'no extra button leaves the row for the strip');
});

test('at every interface size and window width the strip keeps its minimum whenever the field can still keep its own', () => {
  let rows = 0, shown = 0;
  for (const mac of [true, false]) for (const scale of scales) for (let width = 900; width <= 2560; width += 4) {
    const label = `${mac ? 'Mac' : 'Windows'} ${width} DIP at ${scale}%`;
    const old = compactRow(width, scale, mac, before), now = compactRow(width, scale, mac, after);
    rows++;
    // The row never overflows: the menu stays at its end, clear of the caption buttons.
    assert.ok(now.c1 + now.c2 + now.c3 + 2 * now.gap <= now.inner + 0.01, `${label}: the columns overflow the row`);
    if (now.fit.address - (fitMetrics.strip - fitMetrics.stripFolded) >= fitMetrics.addressMin) {
      assert.ok(now.strip >= fitMetrics.strip - 0.01, `${label}: strip ${now.strip.toFixed(1)}px`);
      assert.ok(now.c2 >= fitMetrics.addressMin - 0.01, `${label}: the field fell to ${now.c2.toFixed(1)}px`);
    } else assert.deepEqual([now.c1, now.c2, now.c3], [old.c1, old.c2, old.c3], `${label}: too narrow for both, so nothing changes`);
    // Where the strip already had its minimum nothing moves: the field keeps its place and width.
    if (old.strip >= fitMetrics.strip - 0.01) assert.deepEqual([now.c1, now.c2, now.c3].map(v => v.toFixed(3)), [old.c1, old.c2, old.c3].map(v => v.toFixed(3)), `${label}: changed a row that already fitted`);
    else if (now.strip >= fitMetrics.strip - 0.01) shown++;
  }
  assert.ok(rows > 4000);
  assert.ok(shown > 200, `rows whose strip comes back: ${shown}`);
});

test('the floor adds the strip\'s room only when the field can spare it, and only when the row holds the strip', () => {
  const room = fitMetrics.strip - fitMetrics.stripFolded;
  assert.equal(room, 90);
  assert.equal(compactLeadFloor(198, fitMetrics.addressMin + room, true), 198 + room);
  assert.equal(compactLeadFloor(198, fitMetrics.addressMin + room - 0.5, true), 198, 'the field would fall below its minimum: the strip folds as before');
  assert.equal(compactLeadFloor(198, 600, false), 198, 'tabs in the sidebar: no strip in the row');
});

test('the toolbar fit sets the floor from its own answer, and the strip folds exactly below the minimum it is given', () => {
  const overflow = fs.readFileSync(new URL('../src/ui/toolbarOverflow.ts', import.meta.url), 'utf8');
  assert.match(overflow, /compactLeadFloor\(leadingWidth - \(result\.dropTabViewer && overviewShown \? overview!\.getBoundingClientRect\(\)\.width \+ navGap : 0\), result\.address, strip\)/);
  assert.match(overflow, /node\.classList\.contains\('acira-compact-tabs'\) \? fitMetrics\.stripFolded :/);
  const strip = fs.readFileSync(new URL('../src/components/CompactTabs.tsx', import.meta.url), 'utf8');
  // CompactTabs: available = width - 34 (the + and its margin); under 90 the viewport is 0 wide (condensed).
  assert.match(strip, /condensed=available<90/);
  assert.match(strip, /setAvailable\(Math\.max\(0,node\.clientWidth-34\)\)/);
  assert.equal(fitMetrics.stripFolded + 90, fitMetrics.strip);
  assert.match(fs.readFileSync(new URL('../src/components/CompactTabs.css', import.meta.url), 'utf8'), /\.acira-compact-tabs\{[^}]*min-width:124px/);
});
