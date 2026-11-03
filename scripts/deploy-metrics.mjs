// Deploys Acira's anonymous usage backend (daily usage counts, feature ratings, the Windows uninstall message) to Supabase in one command. Runbook: docs/SUPABASE_SETUP.md.
//
//   SUPABASE_PROJECT_REF=<20 letters> SUPABASE_ACCESS_TOKEN=<personal access token> node scripts/deploy-metrics.mjs [--dry-run] [--write] [--skip-smoke]
//
// 1. Runs supabase/migrations/*.sql in name order (v1 -> v3, site reports, churn) through the Management API (idempotent; row level security on, no public policies).
// 2. Sets the function secret ACIRA_USAGE_SALT (32 random bytes) once, server side, if it is not set yet. It is never printed or written.
// 3. Deploys the `usage` Edge Function with the Supabase CLI (fetched by npx; JWT verification off, as supabase/config.toml says).
// 4. Health checks, storing nothing: GET -> 405, an empty message -> 400, a bad daily, rating and uninstall message -> 400, and a probe of
//    each message type (header X-Acira-Probe: 1) -> 202, which proves the function validates all three and every table and column exists.
// 5. Prints the endpoint. --write puts it into desktop/browser-services/metrics-config.cjs (an address, never a key).
// The token and project ref come from the environment only; the token is never printed, written or put on a command line.
// --dry-run checks the inputs and prints the whole plan without any network call or file change.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROBES } from '../supabase/functions/usage/handler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(root, 'desktop/browser-services/metrics-config.cjs');
export const REF = /^[a-z0-9]{20}$/;
export const SALT_NAME = 'ACIRA_USAGE_SALT';
export const endpointFor = (ref) => `https://${ref}.supabase.co/functions/v1/usage`;
const API = 'https://api.supabase.com/v1/projects';
const today = () => new Date().toISOString().slice(0, 10);

export function readInputs(env, argv) {
  const ref = String(env.SUPABASE_PROJECT_REF || '').trim(), token = String(env.SUPABASE_ACCESS_TOKEN || '').trim();
  const flags = new Set(argv);
  for (const flag of flags) if (!['--write', '--dry-run', '--skip-smoke'].includes(flag)) throw new Error(`Unknown option ${flag}.`);
  if (!REF.test(ref)) throw new Error('SUPABASE_PROJECT_REF must be the project reference: 20 lowercase letters and digits (Project Settings > General).');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at supabase.com/dashboard/account/tokens.');
  return { ref, token, write: flags.has('--write'), dryRun: flags.has('--dry-run'), smoke: !flags.has('--skip-smoke') };
}

/** Rewrites only the endpoint line of metrics-config.cjs. Refuses anything that is not a plain https address. */
export async function writeEndpoint(file, endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('The endpoint must be a plain https address.');
  const text = await fs.readFile(file, 'utf8');
  const next = text.replace(/endpoint: '[^']*'/, `endpoint: '${url.href}'`);
  if (next === text && !text.includes(`'${url.href}'`)) throw new Error('metrics-config.cjs has no endpoint line to update.');
  await fs.writeFile(file, next);
}

export async function migrationFiles() {
  const files = (await fs.readdir(path.join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No migrations found in supabase/migrations.');
  return files;
}

/** Runs every migration in name order (each is idempotent). Also used by scripts/deploy-site-reports.mjs. */
export async function migrate({ ref, token }, fetchImpl = fetch) {
  for (const name of await migrationFiles()) {
    const query = await fs.readFile(path.join(root, 'supabase/migrations', name), 'utf8');
    const response = await fetchImpl(`${API}/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (!response.ok) throw new Error(`Migration ${name} failed (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    console.log(`migrated ${name}`);
  }
}

/** Sets the rate-limit salt as a function secret once. An existing salt is kept (rotating it only resets today's rate-limit counters). */
export async function ensureSalt({ ref, token }, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const listed = await fetchImpl(`${API}/${ref}/secrets`, { method: 'GET', headers });
  if (!listed.ok) throw new Error(`Reading the function secrets failed (HTTP ${listed.status}).`);
  const names = (await listed.json()).map((secret) => secret?.name);
  if (names.includes(SALT_NAME)) { console.log(`secret ${SALT_NAME} already set (kept)`); return false; }
  const created = await fetchImpl(`${API}/${ref}/secrets`, { method: 'POST', headers, body: JSON.stringify([{ name: SALT_NAME, value: randomBytes(32).toString('hex') }]) });
  if (!created.ok) throw new Error(`Setting ${SALT_NAME} failed (HTTP ${created.status}).`);
  console.log(`secret ${SALT_NAME} set`);
  return true;
}

/** Deploys one Edge Function (`usage` here; scripts/deploy-site-reports.mjs passes its own names) with JWT verification off. */
export function deployFunction({ ref, token }, name = 'usage') {
  const cli = (process.env.SUPABASE_CLI || 'npx --yes supabase@2').split(' ').filter(Boolean);
  return new Promise((resolve, reject) => {
    // The token travels in the environment (the CLI's own variable), never in the arguments.
    const child = spawn(cli[0], [...cli.slice(1), 'functions', 'deploy', name, '--project-ref', ref, '--no-verify-jwt', '--use-api'], { cwd: root, env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`supabase functions deploy exited with ${code}.`))));
  });
}

/** The health checks, in order: [label, request init, wanted status]. None of them stores a row. */
export function healthChecks(day = today()) {
  const json = (body, probe = false) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(probe ? { 'X-Acira-Probe': '1' } : {}) }, body: JSON.stringify(body) });
  return [
    ['GET is refused', { method: 'GET' }, 405],
    ['an empty message is refused', json({}), 400],
    ['a daily message with a URL in it is refused', json({ ...PROBES.daily(day), windowView: 'https://example.org/' }, true), 400],
    ['a rating with 9 stars is refused', json({ ...PROBES.rating(day), stars: 9 }, true), 400],
    ['an uninstall message from a Mac is refused', json({ ...PROBES.uninstall(day), platform: 'darwin' }, true), 400],
    ['daily usage probe: validated, daily_usage has every schema-3 column, nothing stored', json(PROBES.daily(day), true), 202],
    ['feature rating probe: validated, feature_ratings has every column, nothing stored', json(PROBES.rating(day), true), 202],
    ['uninstall probe: validated, usage_uninstalls has every column, nothing stored', json(PROBES.uninstall(day), true), 202],
  ];
}

export async function smoke(endpoint, fetchImpl = fetch, { attempts = 6, wait = 5000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const failed = [], passed = [];
    for (const [label, init, want] of healthChecks()) {
      let status = 0;
      try { status = (await fetchImpl(endpoint, init)).status; } catch { status = 0; }
      if (status !== want) failed.push(`${label}: got ${status || 'no answer'}, want ${want}`);
      else passed.push(`ok  ${label} (${status})`);
    }
    if (!failed.length) { console.log(passed.join('\n')); return; }
    if (attempt === attempts) throw new Error(`Health check failed:\n  ${failed.join('\n  ')}`);
    await new Promise((resolve) => setTimeout(resolve, wait)); // a fresh deploy can take a few seconds to answer
  }
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const inputs = readInputs(env, argv), endpoint = endpointFor(inputs.ref);
  if (inputs.dryRun) {
    const lines = [`Dry run for project ${inputs.ref}. Nothing is sent and no file changes. The real run would:`];
    for (const name of await migrationFiles()) lines.push(`  migrate   supabase/migrations/${name}`);
    lines.push(`  secret    ${SALT_NAME} (random, set once server side, never printed)`);
    lines.push('  deploy    Edge Function "usage" (verify_jwt off; accepts event "daily" schema 2/3, event "rating" schema 1 and event "uninstall" schema 1)');
    if (inputs.smoke) for (const [label, , want] of healthChecks()) lines.push(`  check     ${label} -> ${want}`);
    else lines.push('  check     skipped (--skip-smoke)');
    lines.push(inputs.write ? `  write     ${endpoint} into desktop/browser-services/metrics-config.cjs` : `  print     ${endpoint} (add --write to put it into metrics-config.cjs)`);
    console.log(lines.join('\n'));
    return { endpoint, dryRun: true };
  }
  await migrate(inputs);
  await ensureSalt(inputs);
  await deployFunction(inputs);
  if (inputs.smoke) await smoke(endpoint);
  if (inputs.write) { await writeEndpoint(CONFIG_FILE, endpoint); console.log('wrote metrics-config.cjs'); }
  console.log(`\nEndpoint: ${endpoint}`);
  if (!inputs.write) console.log("Paste it into desktop/browser-services/metrics-config.cjs as endpoint: '...' (or rerun with --write).");
  return { endpoint, dryRun: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(String(error.message || error)); process.exit(1); });
