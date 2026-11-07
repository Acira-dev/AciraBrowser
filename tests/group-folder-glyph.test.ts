import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Founder (6 Nov, Discord: "make the tab groups look like folders"): a group's header shows Acira's own Folder (closed) or FolderOpen glyph
// in the group's colour, where the 10 px colour chip was. Chevron, rail, indent and the fold itself are unchanged.
const css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../src/components/AppIcons.tsx', import.meta.url), 'utf8');
const rule = (selector: string) => css.split('\n').find(line => line.startsWith('.app.style-acira .acira-sidebar ' + selector + '{')) ?? '';
const group = sidebar.slice(sidebar.indexOf('function SidebarGroup('), sidebar.indexOf('function SidebarGroup(') + 4000);

test('the group header draws the folder glyphs of the icon set, the closed one first, in the icon column', () => {
  assert.match(icons, /export const Folder=wrap\('Folder'\)/);
  assert.match(icons, /export const FolderOpen=wrap\('FolderOpen'\)/);
  const span = group.match(/<span className="sb-tab-icon sb-group-folder"[^>]*>(.*?)<\/span>/)?.[1] ?? '';
  assert.equal([...span.matchAll(/icon=\{(\w+)\}\s+size=\{16\}/g)].map(match => match[1]).join(','), 'Folder,FolderOpen', 'closed first, open last, both 16 px like the bookmark folders');
  assert.match(group, /className="sb-tab-icon sb-group-folder" aria-hidden="true"/, 'decoration only: the button already says the group, its count and whether it is open');
  assert.ok(!group.includes('sb-group-swatch'), 'the colour chip is gone');
});

test('the closed glyph shows while the group is collapsed, the open one otherwise, and they crossfade', () => {
  const both = rule('.sb-group-folder>svg');
  assert.match(both, /grid-area:1\/1/, 'stacked in one cell of the icon column');
  const hidden = css.split('\n').find(line => line.includes('.sb-group-folder>svg:first-child,')) ?? '';
  assert.match(hidden, /\.sb-group-folder>svg:first-child,[^{]*\.sb-group\[data-collapsed\] \.sb-group-folder>svg:last-child\{opacity:0\}/, 'open: the closed glyph is hidden; collapsed: the open glyph is hidden');
  assert.match(css, /\.sb-group\[data-collapsed\] \.sb-group-folder>svg:first-child\{opacity:1\}/, 'collapsed: the closed glyph shows');
  assert.match(both, /transition:opacity calc\(\.12s \* var\(--motion-scale,1\)\) var\(--sb-ease\)/, 'the sidebar\'s 120 ms, scaled by the speed setting (Off is instant)');
});

test('the glyph carries the group colour: the colour as the stroke, a tint of it as the fill; "none" keeps its neutral grey', () => {
  assert.match(rule('.sb-group-folder'), /^[^{]*\{color:var\(--group-color\)\}$/, 'the exact colour (mixing in --sb-fg, which is translucent, dimmed it in the dark sidebar)');
  assert.match(rule('.sb-group-folder>svg'), /fill:color-mix\(in srgb,var\(--group-color\) 22%,transparent\)/);
  // The colour reaches the row the way it did for the chip: --group-color on the group, from tabGroupColor (none: the frame's muted ink).
  assert.match(group, /style=\{\{'--group-color':tabGroupColor\(group\.color\)\}/);
  const theme = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');
  assert.match(theme, /color==='none'\?\(selected\?'var\(--frame-selection-muted\)':'var\(--frame-muted\)'\)/);
});

test('the rest of the group row is as it was: chevron, rail, indent and the fold', () => {
  assert.match(css, /\.sb-group\[data-collapsed\]>\.sb-group-header>svg\{transform:rotate\(-90deg\)\}/);
  assert.match(css, /\.sb-group-header:is\(:hover,:focus-visible\)>svg,[^{]*\.sb-group\[data-collapsed\]>\.sb-group-header>svg\{opacity:1\}/);
  assert.match(css, /--sb-rail-x:13px;--sb-group-indent:calc\(var\(--sb-rail-x\) \+ 2px \+ 6px\)/);
  assert.match(css, /\.sb-group-members::before\{content:'';[^}]*background:var\(--group-color\)/);
  assert.match(sidebar, /aria-expanded=\{showMembers\?!group\.collapsed:undefined\}/);
});

test('a Windows contrast theme draws the folder in the text colour, unfilled', () => {
  const block = css.slice(css.indexOf('@media(forced-colors:active){\n .app.style-acira .acira-sidebar :is(.sb-app,.sb-tab)[aria-current]'));
  const forced = block.slice(0, block.indexOf('\n}\n'));
  assert.match(forced, /\.sb-group-folder\{color:CanvasText\}/);
  assert.match(forced, /\.sb-group-folder>svg\{fill:none\}/);
  assert.match(forced, /\.sb-group-members::before\{background:CanvasText\}/);
});
