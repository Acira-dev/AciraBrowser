'use strict';
// A JPEG has no transparency: a transparent logo chosen as a profile photo used to come out on black.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('a transparent image becomes a profile photo on white, not on the black a JPEG gives transparent pixels', () => {
  const model = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'accounts', 'profileModel.tsx'), 'utf8');
  assert.match(model, /context\.fillStyle = "#fff";\n\s*context\.fillRect\(0, 0, out, out\);\n\s*context\.imageSmoothingQuality = "high";\n\s*context\.drawImage\(bitmap,/);
});
