// Deploys Acira's site problem reports backend (the write-only `report` function and the read-only `allowlist` function) to Supabase in
// one command. Runbook: docs/SUPABASE_SETUP.md, section 9.
//
//   SUPABASE_PROJECT_REF=<20 letters> SUPABASE_ACCESS_TOKEN=<personal access token> node scripts/deploy-site-reports.mjs [--dry-run] [--write] [--skip-smoke]
//
// 1. Runs supabase/migrations/*.sql in name order through the Management API (all idempotent; the usage migrations come first because
//    `report` uses their rate_limit table and rate_limit_hit()).
// 2. Keeps the function secret ACIRA_USAGE_SALT, or sets it once (32 random bytes) if it is missing. Shared with `usage`; never printed.
// 3. Deploys the `report` and `allowlist` Edge Functions with the Supabase CLI (fetched by npx; JWT verification off, as supabase/config.toml says).
// 4. Health checks, storing nothing: report GET -> 405, an empty message, a host with a path and a 501-character note -> 400, a probe
//    (header X-Acira-Probe: 1) -> 202, which proves the site_reports table has every column; allowlist POST -> 405 and GET -> 200 with
//    exactly {"schema":1,"hosts":[...]}.
// 5. Prints both endpoints. --write puts them into desktop/browser-services/site-reports-config.cjs (addresses, never a key).
// The token and project ref come from the environment only; the token is never printed, written or put on a command line.
// --dry-run checks the inputs and prints the whole plan without any network call or file change.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInputs, migrationFiles, migrate, ensureSalt, deployFunction, SALT_NAME } from './deploy-metrics.mjs';
import { PROBE } from '../supabase/functions/report/handler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(root, 'desktop/browser-services/site-reports-config.cjs');
export const FUNCTIONS = Object.freeze(['report', 'allowlist']);
export const endpointsFor = (ref) => ({ reportEndpoint: `https://${ref}.supabase.co/functions/v1/report`, allowlistEndpoint: `https://${ref}.supabase.co/functions/v1/allowlist` });

/** A plain https address: no user, password, query or fragment, and nothing that could end the quoted value it is written into. */
function plainHttps(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /['"`\\\s]/.test(url.href)) throw new Error('The endpoint must be a plain https address.');
  return url.href;
}

/** Rewrites only the two quoted values of site-reports-config.cjs (reportEndpoint, allowlistEndpoint). Refuses anything that is not a
 * plain https address, and a file that does not have each value exactly once. */
export async function writeEndpoints(file, { reportEndpoint, allowlistEndpoint }) {
  const values = { reportEndpoint: plainHttps(reportEndpoint), allowlistEndpoint: plainHttps(allowlistEndpoint) };
  let text = await fs.readFile(file, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\b${name}: '[^'\\n]*'`, 'g');
    if ((text.match(pattern) || []).length !== 1) throw new Error(`site-reports-config.cjs has no single ${name} value to update.`);
    text = text.replace(pattern, () => `${name}: '${value}'`);
  }
  await fs.writeFile(file, text);
}

/** The health checks, in order: [label, function, request init, wanted status, optional check of the answer]. None of them stores a row. */
export function healthChecks() {
  // Every report check carries the probe header, so even a report the function wrongly accepted would not be stored.
  const report = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Acira-Probe': '1' }, body: JSON.stringify(body) });
  const listShape = async (response) => {
    const body = await response.json();
    return Boolean(body) && Object.keys(body).sort().join(',') === 'hosts,schema' && body.schema === 1 && Array.isArray(body.hosts);
  };
  return [
    ['report: GET is refused', 'report', { method: 'GET' }, 405],
    ['report: an empty message is refused', 'report', report({}), 400],
    ['report: a host with a URL path is refused', 'report', report({ ...PROBE, host: 'example.com/login' }), 400],
    ['report: a 501-character note is refused', 'report', report({ ...PROBE, note: 'x'.repeat(501) }), 400],
    ['report probe: validated, site_reports has every column, nothing stored', 'report', report(PROBE), 202],
    ['allowlist: POST is refused', 'allowlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 405],
    ['allowlist: GET answers {"schema":1,"hosts":[...]}', 'allowlist', { method: 'GET' }, 200, listShape],
  ];
}

export async function smoke(endpoints, fetchImpl = fetch, { attempts = 6, wait = 5000 } = {}) {
  const urls = { report: endpoints.reportEndpoint, allowlist: endpoints.allowlistEndpoint };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const failed = [], passed = [];
    for (const [label, name, init, want, inspect] of healthChecks()) {
      let status = 0, shaped = true;
      try {
        const response = await fetchImpl(urls[name], init);
        status = response.status;
        if (status === want && inspect) shaped = await inspect(response).catch(() => false);
      } catch { status = 0; }
      if (status !== want) failed.push(`${label}: got ${status || 'no answer'}, want ${want}`);
      else if (!shaped) failed.push(`${label}: got ${status} with an unexpected body`);
      else passed.push(`ok  ${label} (${status})`);
    }
    if (!failed.length) { console.log(passed.join('\n')); return; }
    if (attempt === attempts) throw new Error(`Health check failed:\n  ${failed.join('\n  ')}`);
    await new Promise((resolve) => setTimeout(resolve, wait)); // a fresh deploy can take a few seconds to answer
  }
}

const exists = (file) => fs.access(file).then(() => true, () => false);

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const inputs = readInputs(env, argv), endpoints = endpointsFor(inputs.ref);
  const configName = 'desktop/browser-services/site-reports-config.cjs';
  if (inputs.dryRun) {
    const lines = [`Dry run for project ${inputs.ref}. Nothing is sent and no file changes. The real run would:`];
    for (const name of await migrationFiles()) lines.push(`  migrate   supabase/migrations/${name}`);
    lines.push(`  secret    ${SALT_NAME} (kept if set, otherwise random and set once server side; shared with "usage"; never printed)`);
    lines.push('  deploy    Edge Function "report" (verify_jwt off; write-only site problem reports, schema 1)');
    lines.push('  deploy    Edge Function "allowlist" (verify_jwt off; read-only list of cleared hosts)');
    if (inputs.smoke) for (const [label, , , want] of healthChecks()) lines.push(`  check     ${label} -> ${want}`);
    else lines.push('  check     skipped (--skip-smoke)');
    if (inputs.write) {
      lines.push(`  write     reportEndpoint ${endpoints.reportEndpoint} into ${configName}`);
      lines.push(`  write     allowlistEndpoint ${endpoints.allowlistEndpoint} into ${configName}`);
      if (!(await exists(CONFIG_FILE))) lines.push(`  warning   ${configName} does not exist yet, so --write would stop before deploying`);
    } else lines.push(`  print     ${endpoints.reportEndpoint} and ${endpoints.allowlistEndpoint} (add --write to put them into site-reports-config.cjs)`);
    console.log(lines.join('\n'));
    return { ...endpoints, dryRun: true };
  }
  if (inputs.write && !(await exists(CONFIG_FILE))) throw new Error(`${configName} does not exist; nothing was deployed.`);
  await migrate(inputs);
  await ensureSalt(inputs);
  for (const name of FUNCTIONS) await deployFunction(inputs, name);
  if (inputs.smoke) await smoke(endpoints);
  if (inputs.write) { await writeEndpoints(CONFIG_FILE, endpoints); console.log('wrote site-reports-config.cjs'); }
  console.log(`\nReport endpoint:     ${endpoints.reportEndpoint}\nAllow-list endpoint: ${endpoints.allowlistEndpoint}`);
  if (!inputs.write) console.log('Paste them into desktop/browser-services/site-reports-config.cjs (or rerun with --write).');
  return { ...endpoints, dryRun: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(String(error.message || error)); process.exit(1); });
