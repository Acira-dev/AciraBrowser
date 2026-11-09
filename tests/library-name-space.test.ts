import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// 13.3 (9 Nov 2026). A long file name is shown in two pieces (the head gives way with an ellipsis, the tail never disappears). The two pieces are flex items, and
// a flex item drops the space at its edge, so "Quarterly report.pdf", cut between "Quarterly " and "report.pdf", read "Quarterlyreport.pdf" on the Downloads page and in the popup.
// The cut is made on the 10th (or 7th) character from the end, so any name with a space there is hit. White space is kept in both pieces.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } } });
const { MiddleName } = await import('../src/features/Library');

const pieces = (name: string) => {
  const html = renderToStaticMarkup(createElement(MiddleName, { name }));
  return { head: /<span class="lib-name-head">([^<]*)<\/span>/.exec(html)?.[1] ?? '', tail: /<span class="lib-name-tail">([^<]*)<\/span>/.exec(html)?.[1] ?? '' };
};

test('the two pieces of a long name put the cut at a space for names like these, so the space must survive layout', () => {
  for (const name of ['Quarterly report.pdf', 'Invoice 2026 final copy.pdf', 'holiday photos from rome.zip']) {
    const { head, tail } = pieces(name);
    assert.equal(head + tail, name, 'nothing is lost in the markup');
    assert.ok(head.endsWith(' ') || tail.startsWith(' ') || /\S/.test(head.slice(-1) + tail.slice(0, 1)), name);
  }
  const { head, tail } = pieces('Quarterly report.pdf');
  assert.ok(head.endsWith(' ') && !tail.startsWith(' '), 'the space is the head\'s last character: a flex item drops it unless white space is preserved');
});

test('both pieces keep their white space, so the space at the cut is drawn', () => {
  const css = read('../src/features/library.css');
  for (const selector of ['.lib-name-head', '.lib-name-tail']) {
    const rule = new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    assert.match(rule, /white-space:\s*pre\b/, `${selector} keeps white space (the head still clips with an ellipsis)`);
  }
  assert.match(/\.lib-name-head \{([^}]*)\}/.exec(css)?.[1] ?? '', /text-overflow:\s*ellipsis/, 'the head still ends in an ellipsis when the row is narrow');
});

// A name is cut by UTF-16 units; a cut between the two halves of an emoji (or any character outside the basic plane) left a lone half in the head and another in the tail, each drawn as "�".
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
test('the cut never falls inside an emoji', () => {
  // "….pdf" ends in 9 characters after the emoji, so the cut (the 10th from the end) falls between the emoji's two halves: the old pieces were "…\uD83D" and "\uDE00…".
  for (const mark of ['😀', '📄', '𝒳']) {
    for (let before = 6; before < 14; before++) {
      const name = 'r'.repeat(before) + mark + 'eeeee.pdf';
      assert.equal((name.charCodeAt(name.length - 10) & 0xFC00), 0xDC00, 'the natural cut is inside the pair');
      const { head, tail } = pieces(name);
      assert.equal(head + tail, name, name);
      assert.ok(!lone.test(head) && !lone.test(tail), `${JSON.stringify(name)} is cut into ${JSON.stringify(head)} + ${JSON.stringify(tail)}`);
    }
  }
});

// In a right-to-left interface (Arabic) the row is right-to-left, so the head (first piece) sat on the right and the tail on the left: an English name read "report.pdfQuarterly ".
// The two pieces are ordered by the name's own direction (dir="auto" on the pair); the row itself keeps the interface's direction, so where the name sits does not move.
test('the pair of pieces takes the name\'s direction, not the interface\'s', () => {
  const html = renderToStaticMarkup(createElement(MiddleName, { name: 'Quarterly report.pdf' }));
  assert.match(html, /<span class="lib-name" title="Quarterly report\.pdf"><span class="lib-name-pair" dir="auto"><span class="lib-name-head">[^<]*<\/span><span class="lib-name-tail">[^<]*<\/span><\/span><\/span>/);
  const css = read('../src/features/library.css');
  assert.match(css, /\.lib-name-pair \{ display: flex; min-width: 0; \}/, 'the pair is a flex row that can shrink, so the head still ends in an ellipsis');
  assert.doesNotMatch(/\.lib-name \{([^}]*)\}/.exec(css)?.[1] ?? '', /direction/, 'the row itself keeps the interface\'s direction');
});
