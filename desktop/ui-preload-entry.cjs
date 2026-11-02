'use strict';
// Build this source into ui-preload.cjs. Sandboxed preloads cannot require
// sibling files or node_modules at runtime, so both owned sources are bundled.
require('./preload.cjs');
require('./browser-services/extension-toolbar-preload.cjs');
