'use strict';
// The URL types the Mac browser bundle claims (Info.plist CFBundleURLTypes): web addresses, and acira:// (the personal Insider link acira://insider/activate?t=...; macOS hands it to
// Acira with 'open-url', desktop/insider/insider-link.cjs). 17 Nov 2026: the scheme was never claimed, so a link clicked outside Acira never reached it.
// scripts/package-mac.mjs writes it into a fresh bundle; scripts/package-mac-widevine.mjs (the release) writes it over its signed template's own list, which has web addresses only.
const macUrlTypes = () => [
  { CFBundleURLName: 'Web URLs', CFBundleURLSchemes: ['http', 'https'], CFBundleTypeRole: 'Viewer' },
  { CFBundleURLName: 'Acira links', CFBundleURLSchemes: ['acira'], CFBundleTypeRole: 'Viewer' },
];
module.exports = { macUrlTypes };
