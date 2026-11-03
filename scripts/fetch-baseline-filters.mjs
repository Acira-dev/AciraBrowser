// Refreshes the offline filter baseline in resources/filters from the same official sources the in-app updater uses (mirrors included).
//   node scripts/fetch-baseline-filters.mjs [filters directory] [--soft]
//   --soft: release builds. If a download fails, say so loudly and keep the lists already in the directory instead of failing the build.
// Release builds run this before build-filter-engine.cjs, so an installer never ships last month's lists. Everything is downloaded and validated first and written only if all of it is good.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {SOURCES, SCRIPTLET_SOURCE, validateList, validateResources} = createRequire(import.meta.url)('../desktop/browser-services/filter-updates.cjs');
const args = process.argv.slice(2), soft = args.includes('--soft'), directory = args.find(arg => !arg.startsWith('--'));
const root = path.resolve(directory || fileURLToPath(new URL('../resources/filters/', import.meta.url)));
await fs.mkdir(root, {recursive: true});

// Keep build-time downloads on Node's HTTPS client: the bundled Node 24 fetch parser
// can assert during a paused/closed response. TLS verification and content validators stay on.
function downloadText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (new URL(url).protocol !== 'https:' || redirects > 5) return reject(new Error('Unsafe filter redirect'));
    const request = https.get(url, {headers: {'user-agent': 'AciraBrowser filter baseline'}}, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(downloadText(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('HTTP ' + response.statusCode)); return; }
      let text = '', bytes = 0;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 16 * 1024 * 1024) { request.destroy(new Error('Filter response is too large')); return; }
        text += chunk;
      });
      response.on('aborted', () => reject(new Error('Filter response interrupted')));
      response.on('error', reject);
      response.on('end', () => response.complete ? resolve(text) : reject(new Error('Incomplete filter response')));
    });
    request.setTimeout(60000, () => request.destroy(new Error('Filter download timed out')));
    request.on('error', reject);
  });
}

async function fetchText(source, validate) {
  let failure;
  for (const url of [source.url, ...(source.mirrors || [])]) {
    try {
      return {url, value: validate(await downloadText(url), source)};
    } catch (error) { failure = new Error(source.id + ' from ' + url + ': ' + (error.message || error)); }
  }
  throw failure;
}

let fetched;
try { fetched = await Promise.all([...SOURCES.map(source => fetchText(source, validateList)), fetchText(SCRIPTLET_SOURCE, text => validateResources(text))]); } catch (error) {
  if (!soft) throw error;
  const kept = await fs.readFile(path.join(root, 'NOTICE.md'), 'utf8').then(text => /Downloaded on (\S+)/.exec(text)?.[1], () => undefined);
  console.warn(`\n!!! FILTER BASELINE NOT REFRESHED: ${error.message || error}\n!!! This build ships the lists and scriptlets already in ${root}${kept ? ` (downloaded ${kept})` : ''}. Run it again online before publishing.\n`);
  process.exit(0);
}
const lists = fetched.slice(0, SOURCES.length), scriptlets = fetched[SOURCES.length];
const lines = [];
for (let i = 0; i < SOURCES.length; i++) {
  const {url, value} = lists[i], modified = /^! (?:Last modified|Version): ?(.+)$/m.exec(value.text)?.[1] || 'unknown';
  await fs.writeFile(path.join(root, SOURCES[i].id), value.text);
  lines.push(`- ${SOURCES[i].title}: ${url} (${modified}; sha256 ${value.sha256.slice(0, 16)}…)`);
  console.log(SOURCES[i].id, value.text.length, modified);
}
// uBlock Origin scriptlet resources, converted for @ghostery/adblocker by Ghostery (MPL-2.0 package; scriptlets are GPL-3.0-or-later from uBlock Origin).
await fs.writeFile(path.join(root, 'resources.json'), scriptlets.value.text);
console.log('resources.json', scriptlets.value.text.length);
lines.push('- uBlock Origin scriptlet resources: ' + scriptlets.url + ` (sha256 ${scriptlets.value.sha256.slice(0, 16)}…)`);
const date = new Date().toISOString().slice(0, 10);
await fs.writeFile(path.join(root, 'NOTICE.md'), `# Offline filter baseline

Downloaded on ${date} by \`scripts/fetch-baseline-filters.mjs\` (run by every release build) from the official list sources, the same endpoints the in-app updater uses:

${lines.join('\n')}

- The uBlock Origin lists are uBlock's compiled \`.min.txt\` files with the rules for other browsers (Firefox, Safari, uBlock Origin Lite) removed. EasyList, EasyPrivacy and the uBlock Origin lists keep their original authors and license declarations (GPL-3.0-or-later / CC-BY-SA where specified upstream) in the list headers.
- Peter Lowe's list is a hosts file; its entries are converted to network rules, the way uBlock Origin reads it.
- Ghostery Electron integration: MPL-2.0.

These lists block ads and trackers. They are not a phishing/malware reputation service and they do not reject or accept cookie consent. The baseline works without an account or network refresh; Acira checks the same endpoints in the background on every start and every few hours (only downloading what changed) unless turned off.
`);
