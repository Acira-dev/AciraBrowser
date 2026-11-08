import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOLDER_BACK, FOLDER_FRONT_CLOSED, FOLDER_FRONT_OPEN, FOLDER_MAX_SHEETS, FOLDER_SHEET_BOXES, FOLDER_SHEEN_CLOSED, FOLDER_SHEEN_OPEN, folderSheets } from '../src/components/sidebar/folderGlyph';

// Founder (6 Nov, Discord: "make the tab groups look like folders"): a group's header shows a folder in the group's colour where the 10 px
// colour chip was. Beta.13 (item 9, a GitHub user's suggestion, founder's OK 7 Nov): the folder shows small sheets for its tabs, up to a few,
// is glass you can partly see through, and opens, closes and takes tabs in and out with a small motion.
const css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
const glyph = readFileSync(new URL('../src/components/sidebar/GroupFolderGlyph.tsx', import.meta.url), 'utf8');
const rule = (selector: string) => css.split('\n').find(line => line.startsWith('.app.style-acira .acira-sidebar ' + selector + '{')) ?? '';
const group = sidebar.slice(sidebar.indexOf('function SidebarGroup('), sidebar.indexOf('function SidebarGroup(') + 4000);
const commands = (path: string) => path.replace(/[-\d.\s,]+/g, '|').replace(/\|+/g, '|');

test('one sheet per tab, no more than three', () => {
  assert.equal(FOLDER_MAX_SHEETS, 3);
  assert.deepEqual([0, 1, 2, 3, 4, 6, 20].map(folderSheets), [0, 1, 2, 3, 3, 3, 3]);
  assert.equal(folderSheets(Number.NaN), 0);
  assert.equal(folderSheets(-4), 0);
  assert.equal(FOLDER_SHEET_BOXES.length, FOLDER_MAX_SHEETS, 'a box for every sheet');
});

test('the group header draws the folder from its member count, in the icon column, as decoration only', () => {
  const span = group.match(/<span className="sb-tab-icon sb-group-folder"[^>]*>(.*?)<\/span>/)?.[1] ?? '';
  assert.match(span, /<GroupFolderGlyph count=\{members\.length\}\/>/, 'the count is the group\'s tabs, hidden ones too');
  assert.match(group, /className="sb-tab-icon sb-group-folder" aria-hidden="true"/, 'decoration only: the button already says the group, its count and whether it is open');
  assert.ok(!group.includes('sb-group-swatch'), 'the colour chip is gone');
  assert.ok(!/icon=\{Folder(Open)?\}/.test(span), 'the two outline glyphs that crossfaded are gone');
  assert.match(glyph, /aria-hidden="true"/);
});

test('the glyph draws a back plate, a sheet for each tab (the one behind first) and a glass front plate over them', () => {
  assert.match(glyph, /className="gf-back" d=\{FOLDER_BACK\}/);
  assert.match(glyph, /Array\.from\(\{length:drawn\},\(_,index\)=>drawn-1-index\)/, 'the deepest sheet first, so each one in front covers the one behind');
  assert.match(glyph, /className="gf-sheet" data-depth=\{depth\}/);
  assert.ok(glyph.indexOf('className="gf-front"') > glyph.indexOf('className="gf-sheet"'), 'the front plate is drawn after the sheets and sees them through');
  assert.match(glyph, /<linearGradient id=\{id\}/, 'a gradient of the group\'s colour: stronger at the top edge, fading down');
  assert.match(glyph, /useId\(\)\.replace\(/, 'one gradient id for each folder on the page');
  // The sheets stand behind the front plate, each wider than the one behind it, and their bottoms hide under the plate.
  const frontTop = 6.7;
  FOLDER_SHEET_BOXES.forEach((box, depth) => {
    assert.ok(box.y + box.h - frontTop >= 2, `sheet ${depth} hides at least 2 units behind the front plate`);
    if (depth) assert.ok(box.w < FOLDER_SHEET_BOXES[depth - 1].w && box.y < FOLDER_SHEET_BOXES[depth - 1].y, `sheet ${depth} is narrower and shows more than the one in front`);
  });
});

test('closed, the sheets stand square; open, the front plate tilts and the sheets lift and fan (CSS on the group\'s fold state)', () => {
  assert.equal(commands(FOLDER_FRONT_CLOSED), commands(FOLDER_FRONT_OPEN), 'same commands, so `d` can be transitioned');
  assert.equal(commands(FOLDER_SHEEN_CLOSED), commands(FOLDER_SHEEN_OPEN));
  assert.ok(FOLDER_BACK.startsWith('M') && FOLDER_BACK.endsWith('Z'));
  assert.ok(css.includes(`.gf-front{stroke:currentColor;stroke-opacity:.82;stroke-width:.85;stroke-linejoin:round;d:path("${FOLDER_FRONT_CLOSED}")`), 'closed front plate in CSS is the one the glyph carries');
  assert.ok(css.includes(`.sb-group:not([data-collapsed]) .gf-front{d:path("${FOLDER_FRONT_OPEN}")}`), 'open front plate');
  assert.ok(css.includes(`.gf-sheen{fill:none;stroke:var(--gf-sheen);stroke-width:.6;stroke-linecap:round;d:path("${FOLDER_SHEEN_CLOSED}")`));
  assert.ok(css.includes(`.sb-group:not([data-collapsed]) .gf-sheen{d:path("${FOLDER_SHEEN_OPEN}")}`));
  for (const depth of [0, 1, 2]) assert.match(css, new RegExp(`\\.sb-group:not\\(\\[data-collapsed\\]\\) \\.gf-sheet\\[data-depth="${depth}"\\]\\{transform:translate\\(`), `sheet ${depth} lifts when open`);
  assert.match(rule('.gf-sheet'), /transform-box:fill-box;transform-origin:50% 100%/, 'turns about its bottom edge, where it sits in the folder');
  assert.ok(!css.includes('.sb-group[data-collapsed] .gf-sheet'), 'a closed folder has no transform of its own: the sheets stand square');
});

test('every move runs on the chevron\'s clock: .24s (.2s leaving) times --motion-scale, so Fast is quicker and Off is instant', () => {
  for (const selector of ['.gf-sheet', '.gf-front', '.gf-sheen'])
    assert.match(rule(selector), /transition:(transform|d) calc\(\.24s \* var\(--motion-scale,1\)\) var\(--sb-spring\)/, selector);
  assert.match(rule('.gf-sheet[data-leaving]'), /--gf-out:calc\(\.2s \* var\(--motion-scale,1\)\);animation:gf-sheet-out var\(--gf-out\)/, 'the duration is a token first, so the glide test\'s rule on view-transition animations never mistakes it for one');
  assert.match(glyph, /const MOVE_MS=220;/);
  assert.match(glyph, /getPropertyValue\('--motion-scale'\)/, 'the bump and the arriving sheet take the speed setting from the page');
  assert.match(glyph, /if\(ms<=0\)return;/, 'Off: no bump, no arriving sheet, no waiting for a leaving one');
  assert.match(glyph, /if\(sheets<before\.sheets&&ms>0\)\{setLeaving\(before\.sheets\)/, 'a leaving sheet is kept only while it has a move to make');
});

test('a tab going in or out starts the motion: a sheet rises behind the others or sinks, and the folder bumps; nothing moves on first paint', () => {
  assert.match(glyph, /if\(!before\|\|before\.count===count\)return;/, 'first paint and unrelated renders do nothing');
  assert.match(glyph, /const peak=count>before\.count\?1\.13:\.92;/, 'a little larger for a tab in, a little smaller for one out');
  assert.match(glyph, /translate:'0 5\.5px'/, 'the new sheet comes up from behind the front plate');
  assert.match(css, /@keyframes gf-sheet-out\{to\{opacity:0;translate:0 3px\}\}/);
  assert.match(glyph, /window\.clearTimeout\(timer\.current\)/, 'no timer outlives the glyph or a newer change');
});

test('the glyph carries the group colour: the exact colour is the stroke and the tint; "none" keeps its neutral grey', () => {
  assert.match(rule('.sb-group-folder'), /^[^{]*\{color:var\(--group-color\)\}$/, 'the exact colour (mixing in --sb-fg, which is translucent, dimmed it in the dark sidebar)');
  assert.match(rule('.gf-back'), /fill:currentColor;fill-opacity:\.1;stroke:currentColor;stroke-opacity:\.5/);
  assert.match(glyph, /stopColor="currentColor" stopOpacity="\.34"/);
  assert.match(glyph, /stopColor="currentColor" stopOpacity="\.12"/);
  // The colour reaches the row the way it did for the chip: --group-color on the group, from tabGroupColor (none: the frame's muted ink).
  assert.match(group, /style=\{\{'--group-color':tabGroupColor\(group\.color\)\}/);
  const theme = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');
  assert.match(theme, /color==='none'\?\(selected\?'var\(--frame-selection-muted\)':'var\(--frame-muted\)'\)/);
});

test('the sheets are white on a light sidebar and a translucent white on a dark one (the same tone test as the lighter group colours)', () => {
  assert.match(css, /--sb-rail:\.55;--gf-sheet:#fff;--gf-sheen:rgb\(255 255 255 \/ \.72\);/);
  const dark = css.slice(css.indexOf('@container style(--sidebar-tone: dark)'));
  assert.match(dark.slice(0, dark.indexOf('}}')), /--gf-sheet:rgb\(255 255 255 \/ \.56\);--gf-sheen:rgb\(255 255 255 \/ \.24\);/);
});

test('the rest of the group row is as it was: chevron, rail, indent and the fold', () => {
  assert.match(css, /\.sb-group\[data-collapsed\]>\.sb-group-header>svg\{transform:rotate\(-90deg\)\}/);
  assert.match(css, /\.sb-group-header:is\(:hover,:focus-visible\)>svg,[^{]*\.sb-group\[data-collapsed\]>\.sb-group-header>svg\{opacity:1\}/);
  assert.match(css, /--sb-rail-x:13px;--sb-group-indent:calc\(var\(--sb-rail-x\) \+ 2px \+ 6px\)/);
  assert.match(css, /\.sb-group-members::before\{content:'';[^}]*background:var\(--group-color\)/);
  assert.match(sidebar, /aria-expanded=\{showMembers\?!group\.collapsed:undefined\}/);
});

test('a Windows contrast theme draws the folder in the text colour, unfilled, with plain sheets', () => {
  const block = css.slice(css.indexOf('@media(forced-colors:active){\n .app.style-acira .acira-sidebar :is(.sb-app,.sb-tab)[aria-current]'));
  const forced = block.slice(0, block.indexOf('\n}\n'));
  assert.match(forced, /\.sb-group-folder\{color:CanvasText\}/);
  assert.match(forced, /:is\(\.gf-back,\.gf-front\)\{fill:none;stroke:CanvasText;stroke-opacity:1\}/);
  assert.match(forced, /\.gf-sheet\{fill:Canvas;stroke:CanvasText\}/);
  assert.match(forced, /\.gf-sheen\{display:none\}/);
  assert.match(forced, /\.sb-group-members::before\{background:CanvasText\}/);
});
