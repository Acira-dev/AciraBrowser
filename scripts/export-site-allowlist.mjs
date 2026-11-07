// Writes site-allowlist.json, the static copy of Acira's reviewed-sites list that is published beside the update feed
// (https://update.acirabrowser.com/site-allowlist.json, docs/ of Acira-dev/AciraBrowserUpdates), from the current list.
// Read-only and local: one plain GET of the existing allowlist function (the same request an installed Acira makes today, no key, no query), then a file
// on this computer. It publishes nothing; copying the file into the feed repository is the founder's step (docs/launch/SITE_ALLOWLIST.md).
//
//   node scripts/export-site-allowlist.mjs [--out site-allowlist.json] [--from <https address of the allowlist function>] [--check <file>]
//
//   (no option)       fetch the shipped function, validate every host the way the app does, write ./site-allowlist.json
//   --out <file>      where to write it
//   --from <address>  read another address (https, or http on 127.0.0.1 for a local copy of the function)
//   --check <file>    only check a file with the app's own parser and print what is in it; nothing is fetched or written
//
// File format (schema 1, the same answer the Supabase function gives, plus a human date):
//   {"schema":1,"updated":"2026-11-06","hosts":["example.com","another.example.org"]}
// `hosts` is sorted, without repeats, every host one that "Report a problem" could name (lowercase DNS name, no scheme, path or port); at most 20,000
// and 512 KB. `updated` is the date the list last changed (a run that finds the same hosts keeps the file and its date as they are).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { parseAllowlist, FILE_NAME, MAX_BYTES } = require(path.join(here, '..', 'desktop', 'browser-services', 'site-allowlist.cjs'));
const { checkedEndpoint } = require(path.join(here, '..', 'desktop', 'browser-services', 'metrics.cjs'));

/** The file's text for a set of hosts. `previous` is the text of the file already there (or ''), so an unchanged list keeps its date. */
export function buildFile(hosts, { today = new Date().toISOString().slice(0, 10), previous = '' } = {}) {
  const sorted = [...new Set(hosts)].sort();
  parseAllowlist(JSON.stringify({ schema: 1, hosts: sorted })); // the app's own check: refuses any host the app would refuse
  try {
    const before = JSON.parse(previous);
    if (before && before.schema === 1 && Array.isArray(before.hosts) && JSON.stringify(before.hosts) === JSON.stringify(sorted) && typeof before.updated === 'string') return previous;
  } catch { /* no earlier file */ }
  const text = JSON.stringify({ schema: 1, updated: today, hosts: sorted }, null, 1) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('The list is larger than the app accepts (512 KB).');
  return text;
}

/** What a published file holds, as the app would read it, or throws the app's own error. */
export function readFileText(text) {
  const hosts = [...parseAllowlist(text)].sort();
  const value = JSON.parse(text);
  return { hosts, updated: typeof value.updated === 'string' ? value.updated : null };
}

function option(argv, name) { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] || ''; }

async function main(argv) {
  const check = option(argv, '--check');
  if (check !== null) {
    const { hosts, updated } = readFileText(fs.readFileSync(check, 'utf8'));
    console.log(`${check}: valid. ${hosts.length} host${hosts.length === 1 ? '' : 's'}${updated ? `, last changed ${updated}` : ''}.`);
    return;
  }
  const out = path.resolve(option(argv, '--out') || 'site-allowlist.json');
  const from = checkedEndpoint(option(argv, '--from') || require(path.join(here, '..', 'desktop', 'browser-services', 'site-reports-config.cjs')).allowlistEndpoint, { allowLocal: true });
  if (!from) throw new Error('No valid address to read the list from (--from).');
  const response = await fetch(from, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) throw new Error(`${from} answered HTTP ${response.status}.`);
  const answer = await response.text();
  const hosts = [...parseAllowlist(answer)];
  let previous = ''; try { previous = fs.readFileSync(out, 'utf8'); } catch { /* first export */ }
  const text = buildFile(hosts, { previous });
  if (text === previous) { console.log(`${out}: unchanged (${hosts.length} host${hosts.length === 1 ? '' : 's'}).`); return; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out + '.tmp', text); fs.renameSync(out + '.tmp', out);
  console.log(`${out}: written, ${hosts.length} host${hosts.length === 1 ? '' : 's'}. Publish it as feed/${FILE_NAME} in the update repository (docs/launch/SITE_ALLOWLIST.md).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(String(error && error.message || error)); process.exit(1); });
}
