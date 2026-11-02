// Can people who are not logged in anywhere reach the update feed named in packaging/release-target.json?
//   node scripts/check-release-target.mjs          prints the result; exit 0 when public and reachable, 1 otherwise
// Read-only: unauthenticated GET requests only. Never creates or changes anything remotely.
import { createRequire } from 'node:module';
const { loadReleaseTarget, describeTarget, checkReleaseTarget } = createRequire(import.meta.url)('../packaging/release-target.cjs');

export function reportTarget(target, result, say = console.log) {
  say(`[release-target] ${describeTarget(target)}`);
  for (const check of result.checks) say(`[release-target]   ${check.ok ? 'ok     ' : 'FAILED '} ${check.name}: ${check.url} -> ${check.status || check.error || 'no answer'}`);
  if (result.ok) say('[release-target] Reachable without logging in: users\' update checks will work.');
  else {
    say(`[release-target] WARNING: users could NOT reach this target (${result.state}).`);
    for (const problem of result.problems) say(`[release-target]   - ${problem}`);
    say('[release-target] Fix: make the releases repository public (or point packaging/release-target.json at a public place), then run this again. docs/launch/RELEASING.md > Going public.');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const target = loadReleaseTarget();
  const result = await checkReleaseTarget(target);
  reportTarget(target, result);
  process.exit(result.ok ? 0 : 1);
}
