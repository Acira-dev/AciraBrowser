import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

async function fileIdentity(file) {
  const realPath = await fs.realpath(file);
  const stat = await fs.stat(realPath);
  if (!stat.isFile() || !stat.size) throw new Error(`Native target must be a nonempty file: ${file}`);
  return { path: realPath, bytes: stat.size, sha256: createHash('sha256').update(await fs.readFile(realPath)).digest('hex') };
}

/** Same target contract as d-harness: packaged exe gets no source main argument.
 * Resolving identities performs no process launch and never reads a profile. */
export async function resolveRtlTarget({ env = process.env, sourceRoot = process.cwd(), sourceExecutable } = {}) {
  const requested = ['D_APP_EXE', 'ACIRA_APP_EXE'].filter(key => Object.hasOwn(env, key));
  for (const key of requested) {
    if (!env[key]?.trim() || !path.isAbsolute(env[key])) throw new Error(`${key} must name an absolute executable path.`);
  }
  if (requested.length === 2 && path.resolve(env.D_APP_EXE).toLowerCase() !== path.resolve(env.ACIRA_APP_EXE).toLowerCase()) {
    throw new Error('D_APP_EXE and ACIRA_APP_EXE select different native targets.');
  }
  const flags = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  if (requested.length) {
    const selected = env[requested[0]];
    if (path.extname(selected).toLowerCase() !== '.exe') throw new Error('Packaged Windows target must be an .exe file.');
    const executable = await fileIdentity(selected);
    const appArchive = await fileIdentity(path.join(path.dirname(executable.path), 'resources', 'app.asar'));
    return { executablePath: executable.path, args: flags, metadata: { kind: 'packaged', selectedBy: requested[0], executable, appArchive, entrypoint: null } };
  }
  const executable = await fileIdentity(sourceExecutable ?? createRequire(import.meta.url)('electron'));
  const entrypoint = await fileIdentity(path.resolve(sourceRoot, 'desktop/main.cjs'));
  return { executablePath: executable.path, args: [entrypoint.path, ...flags], metadata: { kind: 'source', selectedBy: 'source-default', executable, appArchive: null, entrypoint } };
}
