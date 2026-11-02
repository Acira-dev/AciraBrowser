// Lists the phishing and malware feeds' whole-host entries that would block a well-known site (threat-lists.cjs, topSiteEntries). The feeds list a whole
// host when phishing was found on one page there; on a shared service (Google Sites, Gravatar, pastebin) that blocks every legitimate page and image on it.
// Also lists the top sites that Acira's own look-alike address check (page-risk.cjs) would block (telegra.ph read as a typo of telegram).
// Each flagged host needs a decision before a release: add it to SHARED_HOSTS in desktop/browser-services/threat-lists.cjs (only the listed paths on it stay
// blocked) or keep blocking it (a real phishing domain that happens to be popular). A look-alike hit that is the brand's own domain goes into its `domains`
// in desktop/browser-services/lookalike-brands.json, a real unrelated site into its `distinct`.
//   node scripts/check-threat-lists.mjs [--top N] [--services-top N] [--soft] [--feeds <folder>] [--tranco <top-1m.csv>]
//   --top N     a whole-host entry that is one of Tranco's top N sites is flagged (default 10000)
//   --services-top N   a host under one of the top N sites is flagged when the feeds list at most 3 hosts under it (default 1000)
//   --soft      release builds: print the flagged hosts and a failed download, but exit 0
//   --feeds     read phishing.txt, malware.txt and phishing-db.txt from a folder instead of downloading them
//   --tranco    read the Tranco list (rank,domain lines) from a file instead of downloading https://tranco-list.eu/top-1m.csv.zip
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {SOURCES, topSiteEntries} = require('../desktop/browser-services/threat-lists.cjs'), {hostRisk} = require('../desktop/browser-services/page-risk.cjs'), {parse} = require('tldts');
const args = process.argv.slice(2), soft = args.includes('--soft'), value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const top = Number(value('--top') || 10000), servicesTop = Number(value('--services-top') || 1000);
const say = message => console.log(`[threat-lists] ${message}`);

async function download(url, binary) {
  const response = await fetch(url, {signal: AbortSignal.timeout(120000), headers: {'user-agent': 'AciraBrowser threat-list check'}});
  if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.text();
}
async function feed(source) {
  if (value('--feeds')) return fs.readFile(path.join(value('--feeds'), source.file), 'utf8');
  let failure; for (const url of source.urls) { try { return await download(url); } catch (error) { failure = error; } }
  throw failure;
}
async function topSites() {
  let csv;
  if (value('--tranco')) csv = await fs.readFile(value('--tranco'), 'utf8');
  else { const AdmZip = require('adm-zip'), zip = new AdmZip(await download('https://tranco-list.eu/top-1m.csv.zip', true)); csv = zip.getEntries().find(entry => entry.entryName.endsWith('.csv')).getData().toString('utf8'); }
  const rank = new Map();
  for (const line of csv.split('\n')) { const [place, domain] = line.trim().split(','); if (domain && Number(place) <= top) rank.set(domain.toLowerCase(), Number(place)); }
  if (rank.size < Math.min(top, 1000)) throw new Error('The top-sites list has only ' + rank.size + ' entries.');
  return rank;
}

try {
  const rank = await topSites(), domainOf = host => parse(host, {allowPrivateDomains: true}).domain;
  const feeds = []; for (const source of SOURCES) feeds.push({source, text: await feed(source)});
  const {exact, services, allowed, suffixes} = topSiteEntries(feeds, {rank, domainOf, servicesWithin: servicesTop});
  say(`${suffixes.length} whole-host entries are public suffixes (a storage region, a platform, an EC2 instance name) and never block anything: ${suffixes.slice(0, 8).map(item => item.host).join(', ')}${suffixes.length > 8 ? ', …' : ''}`);
  say(`${allowed.length} Phishing.Database whole-host entries are well-known sites the app never blocks (top-sites.cjs, KNOWN_SITES in threat-lists.cjs)`);
  const lookalikes = [...rank].map(([host, place]) => ({host, rank: place, risk: hostRisk(host)})).filter(item => item.risk), flagged = exact.length + services.length + lookalikes.length;
  say(`${exact.length} whole-host entries are top-${top} sites; ${services.length} are a service under a top-${servicesTop} site`);
  for (const item of exact) console.log(`  #${item.rank} ${item.host}  [${item.lists.join(', ')}]`);
  for (const item of services) console.log(`  #${item.rank} ${item.host} (under ${item.domain})  [${item.lists.join(', ')}]`);
  say(`${lookalikes.length} top-${top} sites are blocked by the look-alike address check`);
  for (const item of lookalikes) console.log(`  #${item.rank} ${item.host}  [${item.risk.reason}${item.risk.brand ? ' of ' + item.risk.brand : ''}]`);
  if (!flagged) say('no whole-host entry blocks a top site');
  else if (soft) console.warn(`\n!!! ${flagged} whole-host threat-list entries block well-known sites (listed above). Review them before publishing: add shared services to SHARED_HOSTS in desktop/browser-services/threat-lists.cjs.\n`);
  else { console.error(`[threat-lists] ${flagged} entries to review (listed above).`); process.exitCode = 1; }
} catch (error) {
  if (!soft) throw error;
  console.warn(`\n!!! THREAT-LIST CHECK NOT RUN: ${error.message || error}\n!!! Run node scripts/check-threat-lists.mjs online before publishing.\n`);
}
