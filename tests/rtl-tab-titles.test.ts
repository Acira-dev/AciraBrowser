import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/** Arabic and Hebrew tab titles in an interface of either direction: every title box of the sidebar, the top strip and the compact strip
 * reads its direction from its title (dir=auto). An Arabic title then starts at the right edge, and its overflow, fade and hover marquee
 * are on the left; before, it was left-aligned and the strip cut off its first words behind the right-hand fade. */
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('RTL titles: each title box takes its direction from the title', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.equal(sidebar.match(/<span className="sb-tab-title">/g), null, 'no sidebar title box without dir');
  assert.ok((sidebar.match(/<span className="sb-tab-title" dir="auto">/g)?.length ?? 0) >= 7, 'tabs and the saved pages beside them');
  assert.match(read('src/components/CompactTabs.tsx'), /<span className="acira-compact-tab-label" dir="auto"><span className="tab-title-text">/);
  assert.match(read('src/components/BrowserTabsHorizontal.tsx'), /items\[title\]=cloneElement\(titleNode,\{dir:'auto'\} as object,<span className="tab-title-text">/);
  const editor = read('src/components/TabTitleEditor.tsx');
  assert.match(editor, /export function TabTitle\(\{tab,dispatch,className,children,dir\}/, 'the strip\'s title component takes the direction');
  assert.match(editor, /return <span ref=\{ref\} className=\{className\} dir=\{dir\} onDoubleClick=/, 'and puts it on its box');
});

test('RTL titles: aligned to their start, and the end fade and the marquee fade are mirrored for a right-to-left box', () => {
  const css = read('src/styles/rtl.css');
  assert.match(css, /\.app :is\(\.sb-tab-title, \.tab-title, \.acira-compact-tab-label\)\[dir='auto'\] \{ text-align: start; \}/);
  for (const selector of [
    /\.app\.style-acira \.acira-sidebar \.sb-tab-title:dir\(rtl\) \{[^}]*mask-image: linear-gradient\(270deg, #000 calc\(100% - 24px\), transparent\)/,
    /\.app\.style-acira \.acira-sidebar \.sb-tab-title\[data-marquee\]:dir\(rtl\) \{[^}]*mask-image: linear-gradient\(to left, transparent, #000 12px/,
    /\.browser-tab > \.tab-title:dir\(rtl\), \.app \.acira-compact-tab-label:dir\(rtl\) \{[^}]*mask-image: linear-gradient\(to left, #000 calc\(100% - 20px\), transparent\)/,
    /\.tab-title\[data-marquee\]:dir\(rtl\), \.app \.acira-compact-tab-label\[data-marquee\]:dir\(rtl\) \{[^}]*mask-image: linear-gradient\(to left, transparent, #000 14px/,
  ]) assert.match(css, selector);
  // Not scoped to an RTL interface: a title is right to left in an English interface too.
  for (const line of css.split('\n').filter(text => text.includes(':dir(rtl)'))) assert.doesNotMatch(line, /html\[dir=/, line);
});

test('RTL titles: the hover marquee runs toward the left for a right-to-left title', () => {
  assert.match(read('src/ui/titleMarquee.ts'), /end=`translateX\(\$\{getComputedStyle\(box\)\.direction==='rtl'\?distance:-distance\}px\)`/);
});
