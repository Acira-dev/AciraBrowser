import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FOLDER_DRAWINGS, FOLDER_EASE, FOLDER_GEOMETRY, FOLDER_SILHOUETTE, FOLDER_SPAN, folderPath, type FolderGrid } from '../src/components/sidebar/folderGlyph';

// Beta 14, section M (brief 12-13 Nov): the tab group's folder is an OUTLINE in the group's colour, flat; nothing white inside, no background colour behind it. The
// the team decided the icon on 13 Nov: closed = a plain outline folder (no line through it), open = the "drop front" folder, no papers; it is ONE line that morphs
// (the front drops and widens while its top edge sweeps across from the right wall) and closing is the exact reverse. These tests hold that and the pixel grids.
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = read('src/components/sidebar/folders.css'), sidebarCss = read('src/components/sidebar/sidebar.css'), glyph = read('src/components/sidebar/GroupFolderGlyph.tsx'), glyphTs = read('src/components/sidebar/folderGlyph.ts');
const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
const groupAt = sidebar.indexOf('function SidebarGroup('), group = sidebar.slice(groupAt, sidebar.indexOf('\n}\n', groupAt));
const GRIDS: FolderGrid[] = ['x1', 'x15'];
const stateOf = (grid: FolderGrid) => [['closed', FOLDER_DRAWINGS[grid].closed], ['open', FOLDER_DRAWINGS[grid].open]] as const;

type Run = { from: [number, number]; to: [number, number]; cmd: string };
/** Absolute points of a path of M, L, H, V and Q commands, with the straight runs between them (a curve is not a run) and the command letters in order. */
function parse(d: string): { runs: Run[]; commands: string; numbers: number[]; points: [number, number][] } {
  const runs: Run[] = [], points: [number, number][] = [], numbers: number[] = [];
  let x = 0, y = 0, commands = '';
  for (const [, cmd, args] of d.matchAll(/([MLHVQ])([^MLHVQ]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number); numbers.push(...n); commands += cmd;
    const go = (nx: number, ny: number, straight: boolean) => { if (straight) runs.push({ from: [x, y], to: [nx, ny], cmd }); x = nx; y = ny; points.push([x, y]); };
    if (cmd === 'M') { x = n[0]; y = n[1]; points.push([x, y]); }
    else if (cmd === 'L') go(n[0], n[1], true);
    else if (cmd === 'H') go(n[0], y, true);
    else if (cmd === 'V') go(x, n[0], true);
    else if (cmd === 'Q') go(n[2], n[3], false);
  }
  return { runs, commands, numbers, points };
}
const length = (run: Run) => Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);

test('the glyph is ONE line: closed and open are the same path with the same command list, so the line moves number for number', () => {
  for (const grid of GRIDS) {
    const closed = parse(FOLDER_DRAWINGS[grid].closed), open = parse(FOLDER_DRAWINGS[grid].open);
    assert.equal(closed.commands, open.commands, `${grid}: the same commands in the same order`);
    assert.equal(closed.numbers.length, open.numbers.length, `${grid}: the same number of numbers`);
    assert.equal(closed.commands, 'MVQHQLQHQVHLQHQLH', `${grid}: the order: the back (wall, top edge, tab, wall), a piece of lip, the front (side, bottom, side), the lip`);
    assert.ok(!/[ZA]/.test(FOLDER_DRAWINGS[grid].closed + FOLDER_DRAWINGS[grid].open), `${grid}: one open line, no second shape`);
    // the line is never cut: the closed folder starts and ends on the same point; the open one ends on the left wall at the lip
    assert.deepEqual(closed.points[0], closed.points.at(-1), `${grid}: the closed outline closes on itself`);
  }
  assert.equal((FOLDER_DRAWINGS.x1.closed.match(/M/g) ?? []).length, 1);
});

test('closed = a plain outline folder, no line through it; its two lip pieces have zero length, so the front\'s corners sit on the back\'s walls', () => {
  for (const grid of GRIDS) {
    const geo = FOLDER_GEOMETRY[grid].closed, { runs } = parse(FOLDER_DRAWINGS[grid].closed);
    const horizontals = runs.filter(run => run.from[1] === run.to[1] && length(run) > 0).map(run => run.from[1]);
    assert.deepEqual([...new Set(horizontals)].sort((a, b) => a - b), [geo.TT, geo.T, geo.B].sort((a, b) => a - b), `${grid}: only the tab's top, the top edge and the bottom run across: nothing across the body`);
    assert.equal(geo.Lf, geo.Lb, `${grid}: the front's left corner is on the left wall`);
    assert.equal(geo.Rf, geo.Rb, `${grid}: and its right corner on the right wall`);
    assert.equal(geo.xe, geo.Rb, `${grid}: the lip ends where it began`);
    assert.equal(geo.s, 0, `${grid}: upright`);
    const zero = runs.filter(run => run.cmd === 'H' && length(run) === 0);
    assert.equal(zero.length, 2, `${grid}: exactly the two lip pieces are empty`);
  }
});

test('open = the drop front: a lip across the folder, the front wider than the back and leaning out, the back\'s walls stepped in', () => {
  for (const grid of GRIDS) {
    const closed = FOLDER_GEOMETRY[grid].closed, open = FOLDER_GEOMETRY[grid].open;
    assert.ok(open.y > closed.y, `${grid}: the front drops`);
    assert.ok(open.Lf < closed.Lf && open.Rf > closed.Rf, `${grid}: and widens out of the walls`);
    assert.ok(open.Lb > closed.Lb && open.Rb < closed.Rb, `${grid}: the back's walls step in`);
    assert.ok(open.s > 0, `${grid}: the sides lean out`);
    assert.equal(open.xe, open.Lb, `${grid}: the lip sweeps across to the left wall`);
    const { runs } = parse(FOLDER_DRAWINGS[grid].open);
    assert.equal(runs.filter(run => run.cmd === 'H' && length(run) === 0).length, 0, `${grid}: nothing is empty any more`);
  }
});

test('the two drawings are exactly the approved ones (brief section M, NOTES_r6): 16 grid at 1.25 and the 150% grid at 1.875', () => {
  assert.equal(FOLDER_DRAWINGS.x1.closed, 'M14.5 7V6Q14.5 4.5 13 4.5H8.1Q7.6 4.5 7.3 4.1L6.4 2.9Q6.1 2.5 5.6 2.5H3Q1.5 2.5 1.5 4V7H1.5L1.5 12Q1.5 13.5 3 13.5H13Q14.5 13.5 14.5 12L14.5 7H14.5');
  assert.equal(FOLDER_DRAWINGS.x1.open, 'M13.5 8.5V6Q13.5 4.5 12 4.5H8.1Q7.6 4.5 7.3 4.1L6.4 2.9Q6.1 2.5 5.6 2.5H4Q2.5 2.5 2.5 4V8.5H1.1L1.7 12.25Q1.9 13.5 3.15 13.5H12.85Q14.1 13.5 14.3 12.25L14.9 8.5H2.5');
  assert.equal(FOLDER_DRAWINGS.x15.closed, 'M22 10V9.25Q22 7 19.75 7H12.15Q11.4 7 10.95 6.4L9.6 4.6Q9.15 4 8.4 4H4.25Q2 4 2 6.25V10H2L2 17.75Q2 20 4.25 20H19.75Q22 20 22 17.75L22 10H22');
  assert.equal(FOLDER_DRAWINGS.x15.open, 'M20 13V9.25Q20 7 17.75 7H12.15Q11.4 7 10.95 6.4L9.6 4.6Q9.15 4 8.4 4H6.25Q4 4 4 6.25V13H1.65L2.47 18.125Q2.77 20 4.645 20H19.355Q21.23 20 21.53 18.125L22.35 13H4');
  assert.deepEqual([FOLDER_DRAWINGS.x1.box, FOLDER_DRAWINGS.x1.stroke, FOLDER_DRAWINGS.x15.box, FOLDER_DRAWINGS.x15.stroke], [16, 1.25, 24, 1.875]);
  assert.equal(folderPath(FOLDER_GEOMETRY.x1.closed), FOLDER_DRAWINGS.x1.closed);
});

test('no papers and no choice left to make: one drawing, no open-icon switch, no second drawing of lines', () => {
  assert.ok(!existsSync(new URL('../src/components/sidebar/folderLineDraw.ts', import.meta.url)), 'the per-line draw is gone: the folder is one morphing line');
  for (const text of [glyph, glyphTs, css]) assert.ok(!/open-icon|openIcon|FOLDER_OPEN_DEFAULT|OPEN_ICON_IDS|paper|pathLength|data-show|stroke-dasharray/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\*\*[\s\S]*?\*\//g, '')), 'no papers, no dash-drawn lines, no variant switch');
  assert.ok(!/fill=|linearGradient|<rect|stopColor|fill-opacity/.test(glyph), 'no fill, no gradient in the glyph');
  assert.match(css, /\.fg-svg\{[^}]*fill:none;stroke:currentColor/, 'the line is drawn with the folder colour and nothing else');
  assert.ok(!/#fff|\bwhite\b(?!-)|Canvas\b(?!Text)/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'nothing white in the folder');
  assert.ok(FOLDER_SILHOUETTE.startsWith('M') && FOLDER_SILHOUETTE.endsWith('Z'));
});

test('the drawing stays inside its box with its ink, and every straight wall and edge sits on a pixel (half pixels at 100%/200%, whole device pixels at 150%)', () => {
  for (const grid of GRIDS) for (const [state, d] of stateOf(grid)) {
    const size = FOLDER_DRAWINGS[grid].box, half = FOLDER_DRAWINGS[grid].stroke / 2, lattice = grid === 'x1' ? .5 : 0;
    const { runs, numbers } = parse(d);
    for (const v of numbers) assert.ok(v - half >= -1e-9 && v + half <= size + 1e-9, `${grid}/${state}: ink of ${v} stays in the box`);
    for (const run of runs) {
      if (run.from[0] === run.to[0] && length(run) > 0) assert.equal(Math.abs(run.from[0] % 1), lattice, `${grid}/${state}: the vertical at x=${run.from[0]} is on a pixel`);
      if (run.from[1] === run.to[1] && length(run) > 0) assert.equal(Math.abs(run.from[1] % 1), lattice, `${grid}/${state}: the horizontal at y=${run.from[1]} is on a pixel`);
    }
  }
});

test('opening and closing are one transition played both ways, on a symmetric curve; the speed setting scales it and Off makes it instant', () => {
  assert.equal(FOLDER_EASE, 'cubic-bezier(.65,0,.35,1)', 'the website hero\'s curve');
  const [x1, y1, x2, y2] = /cubic-bezier\(([^)]+)\)/.exec(FOLDER_EASE)![1].split(',').map(Number);
  assert.deepEqual([x1 + x2, y1 + y2], [1, 1], 'point-symmetric: its reverse is itself, so the close is the exact reverse of the open');
  assert.equal(FOLDER_SPAN, 240);
  assert.equal(FOLDER_SPAN * 1.7, 408, 'Premium');
  assert.ok(Math.abs(FOLDER_SPAN * .6 - 144) < 1e-9, 'Fast');
  assert.match(css, /--fg-u:calc\(1ms \* var\(--motion-scale,1\)\)/, 'a unit is --motion-scale ms: Off (0) is instant');
  assert.match(css, /--fg-ease:cubic-bezier\(\.65,0,\.35,1\)/);
  // one rule moves `d` (the same one both ways: there is no separate closing rule), and the open state only changes the value it moves to
  assert.match(css, /\.fg-m\{d:var\(--dc\);transition:d calc\(240 \* var\(--fg-u\)\) var\(--fg-ease\)\}/);
  assert.match(css, /\.fg\[data-open\] \.fg-m\{d:var\(--do\)\}/);
  assert.equal((css.match(/transition:d calc/g) ?? []).length, 2, 'no second transition of the folder for closing: the header\'s `.fg-m` and the carried chip\'s (item24 groupNest.css gives the chip the same morph); the connecting line has its own, nestRail.ts');
  // the settled icon is the last animated frame: the same element and the same end value, nothing is swapped when it settles
  assert.match(glyph, /<path className="fg-m" d=\{drawing\.closed\} style=\{MORPH\[grid\]\} \/>/);
  assert.match(glyph, /'--dc': `path\('\$\{FOLDER_DRAWINGS\.x1\.closed\}'\)`, '--do': `path\('\$\{FOLDER_DRAWINGS\.x1\.open\}'\)`/);
  assert.match(glyph, /'--dc': `path\('\$\{FOLDER_DRAWINGS\.x15\.closed\}'\)`, '--do': `path\('\$\{FOLDER_DRAWINGS\.x15\.open\}'\)`/);
});

test('Reduce Motion (the app\'s setting or the system\'s): the line does not travel; the two settled drawings swap with a 120 ms cross-fade', () => {
  assert.match(glyph, /<path className="fg-c" d=\{drawing\.closed\} \/>/);
  assert.match(glyph, /<path className="fg-o" d=\{drawing\.open\} \/>/);
  assert.match(css, /\.fg-c,\.app\.style-acira \.acira-sidebar \.fg-o\{display:none\}/, 'they exist only for Reduce Motion');
  assert.match(css, /\[data-reduced-motion\] \.fg-m\{display:none\}/);
  assert.match(css, /\[data-reduced-motion\] \.fg-c,\.app\.style-acira \.acira-sidebar\[data-reduced-motion\] \.fg-o\{display:inline;transition:opacity 120ms linear!important\}/, 'more specific and !important, to beat the sidebar\'s blanket transition:none');
  assert.match(css, /\[data-reduced-motion\] \.fg\[data-open\] \.fg-o\{opacity:1\}/);
  assert.match(css, /\[data-reduced-motion\] \.fg\[data-open\] \.fg-c\{opacity:0\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\.fg-m\{display:none\}[^@]*\.fg-o\{opacity:1\}/, 'the same under the system setting');
  assert.match(sidebarCss, /\[data-reduced-motion\] \*,[^{]*\{transition:none!important/, 'the blanket rule this one has to beat is there');
});

test('CSS: both grids are in the DOM and the screen picks one: 100%/200% the 16 grid at 1.25, 150% the device-pixel grid at 1.875', () => {
  assert.match(css, /\.fg-x1\{display:block;stroke-width:1\.25\}/);
  assert.match(css, /\.fg-x15\{stroke-width:1\.875\}/);
  assert.match(css, /@media \(min-resolution:1\.4dppx\) and \(max-resolution:1\.6dppx\)\{[^@]*\.fg-x1\{display:none\}[^@]*\.fg-x15\{display:block\}/);
  assert.match(glyph, /const GRIDS: readonly FolderGrid\[\] = \['x1', 'x15'\];/);
  assert.match(glyph, /viewBox=\{`0 0 \$\{drawing\.box\} \$\{drawing\.box\}`\}/);
});

test('the folder\'s style cost is low: no rule keyed by a tag or *, none ends in :is()/:where()/:has(), every rightmost compound starts with a class', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, ''), bad: string[] = [];
  for (const [, selectors] of rules.matchAll(/([^{}@;]+)\{[^{}]*\}/g)) for (const selector of selectors.split(/,(?![^(]*\))/)) {
    const text = selector.trim(); if (!text || text.startsWith('property ')) continue; // @property --gc
    const rightmost = text.split(/\s+|>/).filter(Boolean).at(-1)!;
    if (!/^[.\[]/.test(rightmost) || /:(is|where|has)\(/.test(rightmost) || rightmost.includes('*')) bad.push(text);
    if (/:(is|where|has)\(|\*/.test(text)) bad.push(text);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('the guide line beside the tabs draws downward on opening and retracts upward on closing, on the same curve', () => {
  assert.match(css, /\.sb-group-members::before\{background:var\(--gc\);clip-path:inset\(0 0 0 0 round 1px\);transition:clip-path calc\(173 \* var\(--fg-u\)\) var\(--fg-ease\) 0s\}/);
  assert.match(css, /\[data-collapsed\]:not\(\[data-holds-active\]\) \.sb-group-members::before\{opacity:var\(--sb-rail\);clip-path:inset\(0 0 100% 0 round 1px\);transition:none\}/, 'closed, nothing of it is left: no 1 px remnant');
  const rail = read('src/components/sidebar/folderRail.ts');
  assert.match(rail, /clipPath: connector \? 'inset\(0 0 0 0\)' : 'inset\(0 0 0 0 round 1px\)' \}, \{ clipPath: connector \? 'inset\(0 0 100% 0\)' : 'inset\(0 0 100% 0 round 1px\)'/, 'the copy (of the line, or of a parent\'s whole connector) retracts upward');
  assert.match(rail, /duration: end \|\| RAIL_UNITS \* scale, easing: FOLDER_EASE/, 'item05 railRetract: the leaving pictures\' fade, else 173 units, on the draw curve');
  assert.match(rail, /animation\.finished\.then\(done, done\)/, 'the copy removes itself');
  assert.match(rail, /if \(!scale \|\| !height/, 'speed Off: nothing is drawn');
  assert.match(group, /useFolderRail\(root,!!group\.collapsed\)/);
});

test('opening: the rows are uncovered by an edge that travels with the row below, so a new row never shows through a row still sliding', () => {
  const rail = read('src/components/sidebar/folderRail.ts');
  assert.match(rail, /getAnimations\(\{ subtree: true \}\)\.find\(item => item\.id === 'sb-flip'\)/, 'the timing is the sidebar\'s own slide of the row below (a folder below slides by its header, so the subtree is searched)');
  assert.match(rail, /members\.animate\(\[\{ clipPath: `inset\(0 -12px \$\{added\}px -12px\)` \}, \{ clipPath: 'inset\(0 -12px 0 -12px\)' \}\], \{ \.\.\.timing, id: 'fg-uncover', fill: 'backwards' \}\)/, 'item05 b14Folders.ts: a clip whose bottom edge starts at the old end of the folder and moves down with that slide (inset(0 -12px {growth}px -12px) -> inset(0 -12px 0 -12px))');
  assert.match(rail, /timing \?\?= \{ delay: 0, duration: 480 \* Math\.min\(scaleOf\(group\), 1\.28\)/, 'item05: with no sliding row to copy, 480 x min(scale, 1.28)');
  assert.match(rail, /UNFOLD_WINDOW_MS/, 'only an unfold is covered, not a tab added later');
});

test('no background colour behind a folder: no tint, no pill, no card; a carried tab gets a 1 px ring in the folder\'s colour', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const backgrounds = [...rules.matchAll(/([^{}]+)\{[^}]*?(?<![-\w])background:([^;}]+)/g)].map(match => [match[1].trim(), match[2].trim()]);
  for (const [selector, value] of backgrounds) assert.ok(/::before|fg-rail-copy|\.group-auto|@|data-nest-target/.test(selector) || value === 'none' || value === 'CanvasText', `only the guide line (a 2 px line), "none" and the wash of the group a carried group would nest into (Beta 14 AE) set a background: ${selector} -> ${value}`);
  assert.match(css, /\.sb-group\[data-joining\]>\.sb-group-header,\.app\.style-acira \.acira-sidebar \.sb-group\[data-joining\]>\.sb-group-header:hover\{background:none;box-shadow:inset 0 0 0 1px color-mix\(in oklab,var\(--gc\) 70%,transparent\)\}/, 'also while the pointer is on it (the carried tab\'s pointer always is)');
  assert.ok(!sidebarCss.includes('.sb-group[data-joining]>.sb-group-header{background:var(--sb-drop)}'), 'the old tint behind a folder is gone');
  assert.ok(!/\.gf-|--gf-/.test(sidebarCss), 'the old glass folder\'s rules are gone');
});

test('the colour lives in the line work and the name: lines and name take the group colour (automatic or picked); the name is tinted only when there is a colour', () => {
  assert.match(css, /\.sb-group-folder\{color:var\(--gc\)\}/);
  assert.match(css, /\.sb-group\[data-tint\]>\.sb-group-header \.sb-group-name\{color:oklch\(from var\(--gc\) var\(--gc-name-l\) calc\(min\(c,var\(--gc-name-max\)\) \* var\(--gc-name-c\)\) h\)\}/, 'item05 b14-folders-r2.css lines 31-32');
  assert.match(css, /--gc-name-c:1;--gc-name-max:\.13/, 'the light name keeps chroma up to .13 (r2 line 31)');
  assert.match(css, /--gc-name-c:\.7;--gc-name-max:1\}/, 'the dark name is c x .7 with no cap (r2 line 32)');
  assert.match(css, /@property --gc\{syntax:'<color>';inherits:true;initial-value:transparent\}/, '--gc is a real colour property so a change of colour cross-fades');
  assert.match(css, /\.sb-group\[data-tint=auto\]\{--gc:oklch\(var\(--gc-line-l\) var\(--gc-c\) calc\(var\(--gc-h\) \* 1deg\)\)\}/);
  assert.match(css, /@container style\(--sidebar-tone: dark\)\{[^}]*--gc-line-l:\.72;--gc-name-l:\.86/, 'lighter lines and a paler name on a dark sidebar');
  assert.match(css, /--gc-line-l:\.555;--gc-name-l:\.45/, 'item05 b14-folders-r2.css line 12: --b14-l .555 on a light sidebar (.72 dark)');
  assert.match(css, /\.sb-group-folder\{color:oklch\(from var\(--gc\) calc\(l - \.07\) c h\)\}/, 'item05 line 29: a light sidebar takes the line work a step deeper, whatever its colour');
  assert.match(css, /@container style\(--sidebar-tone: dark\)\{\.app\.style-acira \.acira-sidebar \.sb-group-folder\{color:var\(--gc\)\}\}/, 'and a dark one takes the colour as it is');
});

test('the header shows no tab count, and the folder is decoration only: the button already says the group, its tabs and whether it is open', () => {
  assert.ok(!/<small/.test(group), 'no count in the header');
  assert.match(group, /className="sb-tab-icon sb-group-folder" aria-hidden="true"><GroupFolderGlyph count=\{count\} open=\{!group\.collapsed\|\|joining\}\/>/);
  assert.match(group, /aria-label=\{t\("acirasidebar\.groupCountTabs"/, 'the count is still said to a screen reader');
  assert.match(glyph, /aria-hidden="true"/);
});

test('the group row carries its colour: an automatic colour from the sites, the neutral look when none of them has one, a picked colour as it is', () => {
  assert.match(sidebar, /const autoColors=useGroupAutoColors\(\[\.\.\.pinnedFolders,\.\.\.entries\]\.flatMap\(entry=>entry\.kind==='group'/, 'all folders are settled at once, in the order shown, so neighbours differ');
  assert.match(sidebar, /auto=\{autoColors\.get\(entry\.group\.id\)\}/);
  assert.match(group, /const automatic=isAutoGroup\(group\)&&auto!==undefined,tint=automatic\?\(auto\?'auto':undefined\):group\.color==='none'\?undefined:'palette'/);
  assert.match(group, /'--gc-h':String\(auto\.h\),'--gc-c':String\(auto\.c\)/);
  assert.match(group, /data-tint=\{tint\}/);
});

test('a tab joining or leaving gives the folder one small bump, as before; nothing moves on first paint and Off has none', () => {
  assert.match(glyph, /if \(before === null \|\| before === count\) return;/);
  assert.match(glyph, /scale\(\$\{count > before \? 1\.13 : \.92\}\)/);
  assert.match(glyph, /if \(ms <= 0\) return;/);
});

test('a carried folder\'s chip is the closed folder as a solid shape in the folder\'s own colour (the header\'s lines are drawn by its state, so they are not copied)', () => {
  const chip = sidebar.slice(sidebar.indexOf('function groupFolderChip('), sidebar.indexOf('let tabDragActive'));
  assert.match(chip, /path\.setAttribute\('d',FOLDER_SILHOUETTE\)/);
  assert.match(chip, /path\.setAttribute\('fill','currentColor'\)/);
  assert.match(chip, /mark\.style\.color=getComputedStyle\(folder\)\.color/, 'the colour the row shows now, automatic or picked');
  assert.ok(!/cloneNode/.test(chip), 'no copy of the header\'s two drawings');
});

test('folders in an area of their own sit together as one distinct area: the line that ends it is the sidebar\'s stronger line, and there is still no tray', () => {
  assert.match(css, /\.sb-sep\[data-flip="sep:folders"\]\{--sb-line:var\(--sb-line-strong\);margin-block:8px\}/);
  assert.match(sidebar, /key="sep-folders" className="sb-sep" role="separator" data-flip="sep:folders"/, 'the separator the area is drawn with');
});
