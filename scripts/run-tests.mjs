// npm test's runner steps. The file lists live in package.json "testSuites" (one path per line, so merges add tests without
// touching one giant line): Windows runs npm scripts through cmd.exe, which refuses a command line over 8191 characters, and the
// old one-line "test" script passed that on 27 Oct. Each suite is spawned without a shell (CreateProcess allows 32767).
// Suites run in order and stop at the first failure, like the && chain they replace:
//   node   - node --test, in parallel
//   serial - node --test --test-concurrency=1 (real-input Electron tests that must not steal each other's focus)
//   tsx    - tsx --test (TypeScript tests)
// Usage: node scripts/run-tests.mjs [suite ...]   (all suites when none is named)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suites = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).testSuites;
const tsxCli = createRequire(path.join(root, 'package.json')).resolve('tsx/cli');
// A bounded CI/VM override prevents parallel native Electron fixtures exhausting a Linux test host.
const concurrency=process.env.ACIRA_TEST_CONCURRENCY;
if(concurrency&&!/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(concurrency))throw Error('ACIRA_TEST_CONCURRENCY must be 1 through 64.');
const parallel=concurrency?['--test-concurrency='+concurrency]:[];
const runners = {
  node: files => [process.execPath, ['--test', ...parallel, ...files]],
  serial: files => [process.execPath, ['--test', '--test-concurrency=1', ...files]],
  tsx: files => [process.execPath, [tsxCli, '--test', ...parallel, ...files]],
};
const wanted = process.argv.slice(2);
for (const name of Object.keys(runners)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const files = suites?.[name] || [];
  if (!files.length) continue;
  const [command, args] = runners[name](files);
  const run = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
