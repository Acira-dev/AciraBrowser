import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Settings > Privacy > Hide selected sources: a refused domain ("not a domain!") printed its message as the last line of the group, below the
// reset row and below the window's bottom edge, so Add source seemed to do nothing. The line scrolls into view when it appears.
test('the content-filter error line scrolls into view when it appears', () => {
  const source = fs.readFileSync('src/features/ContentFilters.tsx', 'utf8');
  assert.match(source, /useEffect\(\(\)=>\{if\(error\)alertLine\.current\?\.scrollIntoView\(\{block:'nearest',behavior:'instant'\}\);\},\[error\]\)/);
  assert.match(source, /\{error&&<p ref=\{alertLine\} className="st-error" role="alert">/);
});
