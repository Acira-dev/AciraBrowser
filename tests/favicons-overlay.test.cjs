'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

// "Recently closed" in the Acira menu is drawn by the overlay view and asks for the site icons kept on this computer (ui/siteIcons.ts useSiteIcons). Main answered
// only the window's page view, so from the overlay every row had a plain dot instead of its site's icon (the Rewind page, in the page view, showed the real ones)
// and main.log got "Site icons are for the main interface." each time. Both interface views of the window may ask; nothing else.
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const start = main.indexOf("case 'favicons.list':"), handler = main.slice(start, main.indexOf("case '", start + 10));

test('favicons.list answers the window\'s page view and its overlay view, and refuses any other sender', () => {
  assert.ok(start > 0, 'the service exists');
  assert.match(handler, /event\.sender!==chromeView\?\.webContents&&event\.sender!==overlayView\?\.webContents\)throw Error\('Site icons are for the main interface\.'\)/);
});

test('favicons.list still gives a private window nothing and still reads the profile on screen', () => {
  assert.match(handler, /favicons:privateMode\?\{\}:store\.list\(profileId,hosts\)/);
  assert.match(handler, /const profileId=state\.activeBrowserProfileId/);
});
