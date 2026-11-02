import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The docked sidebar's slide (view-morph.css) and the page card's group (sidebar.css) and the native page's glide (desktop/page-motion.cjs) are one
// 480 ms spring at every animation speed. The sidebar's was once scaled by --motion-scale (Premium, the default, is 1.7), so it ran 816 ms against
// the page's 480 and trailed it by up to a quarter of the travel, a darker band opening between them (sidebar-hunt, 1 Nov).
const here = path.dirname(fileURLToPath(import.meta.url)), read = (file: string) => fs.readFileSync(path.join(here, '..', file), 'utf8');

test('the docked sidebar slides on the page card\'s own fixed 480ms, not on the animation-speed scale', () => {
  const morph = read('src/styles/view-morph.css'), sidebar = read('src/components/sidebar/sidebar.css');
  const slide = /view-transition-(old|new)\(acira-sidebar\):only-child\{animation:([^ ]+) /g, durations = [...morph.matchAll(slide)].map(match => match[2]);
  assert.equal(durations.length, 2, 'a leave and an arrive');
  assert.ok(durations.every(duration => duration === '480ms'), `fixed 480ms, got ${durations.join(' / ')}`);
  assert.ok(/view-transition-group\(acira-page\)[^{]*\{animation-duration:480ms/.test(sidebar.replace(/\n/g, ' ')) || /acira-page-content\)\{animation-duration:480ms/.test(sidebar), 'the page card group is 480ms too');
  assert.ok(/duration = own \? Math\.round\(springSettle\(own\) \* 1000\) : slide \? 480 : 280/.test(read('desktop/page-motion.cjs')), 'and so is the native glide');
});
