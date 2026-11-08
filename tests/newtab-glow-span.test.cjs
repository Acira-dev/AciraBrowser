// Item 34 (beta.12): the artwork's soft colour glow (.nt-glow, behind the framed painting on the new tab and a profile's page) must cover the whole page.
// It used to be capped at 1500px wide and centred, so on a page wider than ~1340px (a big monitor, or a wide window) a strip next to the sidebar had no hue at all
// and the wash ended in a hard vertical edge where the capped box stopped. The box is now never narrower than the page plus 80px each side, and is unchanged on
// the pages it was already right for. The page clips it (overflow: hidden), so the bleed never shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src/styles/new-tab-page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} rule exists`);
  return css.slice(start, css.indexOf('\n}', start));
};
const glow = rule('.nt-glow');
const declared = (block, property) => (block.match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`)) || [])[1];

/** Width in px of the glow box on a page `page` px wide, from the declared CSS value (min(), max(), calc(), px and %). */
function boxWidth(value, page) {
  const js = value.replace(/(\d+(?:\.\d+)?)px/g, '$1').replace(/(\d+(?:\.\d+)?)%/g, (_, n) => `(${n}/100*${page})`).replace(/calc\(/g, '(').replace(/\bmax\(/g, 'Math.max(').replace(/\bmin\(/g, 'Math.min(');
  assert.match(js, /^[\d\s.+\-*/(),a-zA-Z]+$/, 'only numbers, operators and min/max/calc');
  return Function(`return ${js}`)();
}
const oldBox = (page) => Math.min(1500, 1.24 * page);

test('the glow is centred on the page and the page clips it', () => {
  assert.equal(declared(glow, 'left'), '50%');
  assert.equal(declared(glow, 'translate'), '-50% -50%');
  assert.match(rule('.app.style-acira .nt-page'), /overflow:\s*hidden/);
});

test('the glow box covers the whole page at every width, with 80px to spare each side', () => {
  const width = declared(glow, 'width');
  assert.ok(width, 'the glow has a width');
  for (let page = 280; page <= 7680; page += 8) assert.ok(boxWidth(width, page) >= page + 160 - 1e-6, `page ${page}px: box ${boxWidth(width, page)}px must reach 80px past both edges`);
  assert.ok(boxWidth(width, 1954) >= 2114, 'a 2200px window with the sidebar open (1954px page) has no hue-less strip: the old 1500px box left 227px bare');
});

test('on the pages it was already right for, the glow is exactly as before', () => {
  const width = declared(glow, 'width');
  for (let page = 700; page <= 1340; page += 4) assert.ok(Math.abs(boxWidth(width, page) - oldBox(page)) < 1e-6, `page ${page}px keeps its old width`);
  assert.equal(declared(glow, 'height'), '124%');
});
