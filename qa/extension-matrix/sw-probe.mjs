// Scratch: where do extension service workers show up? (REUSE profile ext-<slug>)
import {CATALOG} from './catalog.mjs';
import {launch, sleep} from './lib.mjs';
const slug = process.argv[2] || 'dark-reader', item = CATALOG.find(i => i.slug === slug);
const app = await launch('ext-' + slug, {fresh: false, env: {ACIRA_MEMORY_SAVER_DEBUG: '1', ACIRA_MEMORY_SAVER_FREEZE_MS: '3000', ACIRA_MEMORY_SAVER_IDLE_MS: '9000', ACIRA_MEMORY_SAVER_TICK_MS: '2000'}});
try {
  await sleep(6000);
  const partition = (await app.state()).browserProfiles[0].partition;
  console.log('playwright serviceWorkers:', app.context.serviceWorkers().map(w => w.url()));
  console.log('ses.serviceWorkers running:', JSON.stringify(await app.main(async ({session}, p) => { const ses = session.fromPartition(p); const r = ses.serviceWorkers.getAllRunning(); return r; }, partition)));
  console.log('extensions:', JSON.stringify(await app.main(({session}, p) => session.fromPartition(p).extensions.getAllExtensions().map(e => ({id: e.id, name: e.name, url: e.url})), partition)));
  const cdp = await app.context.newCDPSession(app.context.pages()[0]);
  const targets = await cdp.send('Target.getTargets').catch(e => ({error: String(e)}));
  console.log('targets:', JSON.stringify((targets.targetInfos || targets).map ? (targets.targetInfos || []).map(t => t.type + ' ' + t.url.slice(0, 70)) : targets));
  await sleep(30000);
  console.log('logs:', app.logs.join('').split(/\r?\n/).filter(l => /tab-sleep/.test(l)).slice(-6).join('\n'));
} finally { await app.close(); process.exit(0); }
