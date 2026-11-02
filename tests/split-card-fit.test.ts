import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Founder, 27 Oct: an indented split card ran off the sidebar, and group rows' fills spread left under the group's rail.
// The real-app numbers come from qa/splitgroup-fit.mjs; these pin the CSS that makes them true.
const css = fs.readFileSync('src/components/sidebar/sidebar.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, `missing rule ${selector}`); return css.slice(at + selector.length + 1, css.indexOf('}', at)); };
const S = '.app.style-acira .acira-sidebar ';

test('the split card draws its hairline inside its own box and never outside it', () => {
  const card = rule(S + '.sb-split-group');
  assert.match(card, /box-sizing:border-box/); assert.match(card, /max-width:100%/); assert.match(card, /min-width:0/); assert.match(card, /padding:2px/);
  assert.doesNotMatch(card, /outline|transform|(^|;)width:|(^|;)left:/, 'no outline drawn outside, no transform or forced width that keeps the old width');
  const line = rule(S + '.sb-split-group::after');
  assert.match(line, /position:absolute/); assert.match(line, /inset:0/); assert.match(line, /border:1px solid var\(--sb-card-line\)/); assert.match(line, /pointer-events:none/);
  assert.doesNotMatch(css, /\.sb-split-group[^{]*\{[^}]*outline(-offset|-color)?:/, 'no split-card rule uses an outline any more');
});

test('a split card in a group loses the indent from its width (margin, not a transform), like every other member row', () => {
  const members = rule(S + '.sb-group-members>:is(.sb-tab,.sb-tab-leaving,.sb-split-group)');
  assert.match(members, /margin-left:var\(--sb-group-indent\)/); assert.match(members, /min-width:0/);
  assert.doesNotMatch(members, /transform|(^|;)width:/);
  const list = rule(S + '.sb-group-members');
  assert.match(list, /--sb-rail-x:13px/);
  assert.match(list, /--sb-group-indent:calc\(var\(--sb-rail-x\) \+ 2px \+ 6px\)/, 'rows start right of the 2px rail with the 6px text inset as their gap');
  assert.match(rule(S + '.sb-group-members::before'), /left:var\(--sb-rail-x\)/);
  assert.ok(!css.includes('.sb-group-members>.sb-tab>.sb-tab-main,'), 'member rows no longer fake the indent with padding inside a full-width fill');
});

test('the nested card only recolours its line; its rows keep the card\'s own insets', () => {
  assert.match(rule(S + '.sb-group-members>.sb-split-group[data-nested]'), /^--sb-card-line:color-mix\(in srgb,var\(--split-tint\) 38%,transparent\)$/);
  assert.ok(!/\.sb-split-group\[data-nested\]>\.split-group-sidebar\{padding-left/.test(css));
  assert.match(rule(S + '.sb-split-group [data-split-child]'), /min-width:0/);
  assert.match(rule(S + '.sb-split-group>.sb-header-add'), /top:8px/, 'the hover + stays centred on the header inside the 2px inset');
});

test('a split\'s name ends before the header\'s hover "+", and New tab stays on one line (qa/splitgroup-fit.mjs, 28 Oct: a long name ran 14px under the "+")', () => {
  assert.match(rule(S + '.sb-split-group:has(>.sb-header-add)>.split-group-sidebar .split-group-open>span'), /^margin-right:calc\(var\(--sb-add-right\) \+ var\(--tab-control,20px\) - 32px\)$/);
  assert.match(css, /\.acira-sidebar \.sb-split-group\{--sb-add-right:30px\}/, 'the 32px in the calc is 36px (where the name ended) minus the 4px gap');
  const newTab = rule(S + '.sb-new-tab>span:nth-child(2)');
  for (const part of ['min-width:0', 'overflow:hidden', 'white-space:nowrap', 'text-overflow:ellipsis']) assert.ok(newTab.includes(part), part);
});

test('only the selected pane reads as current: no pane row or chip is lit just for being in the split on screen, and the card header takes no fill (founder, 27 and 28 Oct)', () => {
  const strips = fs.readFileSync('src/styles/split-groups.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [name, text] of [['sidebar.css', css], ['split-groups.css', strips]] as const) assert.doesNotMatch(text, /data-split-shown/, `${name}: no shown-split tint on panes`);
  assert.match(rule(S + '.split-group-sidebar[data-active]'), /^background:none;box-shadow:none$/);
});
