import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Founder (28 Oct): the group's vertical line fades at both ends, but only inside the first and last member rows,
// so the line still clearly spans exactly the tabs in the group.
test('the group line fades at its ends within the first and last rows', () => {
  const css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  const rule = css.match(/\.sb-group-members::before\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /top:0;bottom:0/, 'the line runs the full height of the members');
  assert.match(rule, /--sb-rail-fade:(\d+)px/);
  const fade = Number(rule.match(/--sb-rail-fade:(\d+)px/)![1]);
  const row = Number(css.match(/--sb-row:\s*(\d+)px/)?.[1] ?? 32);
  assert.ok(fade > 0 && fade <= row / 2, `fade ${fade}px stays within half a ${row}px row`);
  assert.match(rule, /mask-image:linear-gradient\(to bottom,transparent,#000 var\(--sb-rail-fade\),#000 calc\(100% - var\(--sb-rail-fade\)\),transparent\)/);
});
