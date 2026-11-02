// Prepares an isolated profile for a by-hand launch: starts the app once, skips first-run setup, closes it. Nothing is browsed here.
//   node qa/privacy-plus/prepare-hand-profile.mjs <name>      -> .qa-profiles/<name>
// Then launch by hand, with no debugging port and no automation:
//   ACIRA_BROWSER_TEST_DATA=<abs path of .qa-profiles/<name>> electron desktop/main.cjs https://accounts.google.com/
// (add ACIRA_KEEP_ELECTRON_UA=1 to compare against Electron's own user agent). Used for the Google sign-in check on 24 Oct 2026.
import fs from 'node:fs/promises';
import {startApp} from '../d-harness.mjs';
const name = process.argv[2] || 'j-hand';
const root = '.qa-profiles/' + name; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const app = await startApp({root});
try { console.log('prepared', root); } finally { await app.close(); process.exit(0); }
