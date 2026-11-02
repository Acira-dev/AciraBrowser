// QA evidence/isolation only. Importing this module never starts an application.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkedName(value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value || '')) throw Error('Use a simple extension run/name identifier.');
  return value;
}
export function matrixContext({root = process.cwd(), runId = process.env.ACIRA_EXT_MATRIX_RUN} = {}) {
  const id = checkedName(runId ?? `run-${Date.now()}-${randomUUID().slice(0, 8)}`);
  return {id, root: path.resolve(root), output: path.resolve(root, 'qa/artifacts/ext-matrix/runs', id),
    profiles: path.resolve(root, '.qa-profiles/ext-matrix', id)};
}
export const RUN = matrixContext();

export async function matrixProfile(name, fresh) {
  checkedName(name);
  await fs.mkdir(RUN.profiles, {recursive: true});
  if ((await fs.realpath(RUN.profiles)).toLowerCase() !== RUN.profiles.toLowerCase())
    throw Error('Extension fixture must not traverse a redirected directory.');
  const directory = path.join(RUN.profiles, name);
  if (fresh) await fs.mkdir(directory); // Existing data is refused, never deleted.
  else if (!(await fs.stat(directory)).isDirectory()) throw Error('Missing same-run extension fixture.');
  if ((await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Redirected extension fixture.');
  return directory;
}

export async function artifactIdentity(app) {
  const runtime = await app.main(({app}) => ({executable: process.execPath, appPath: app.getAppPath(),
    packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome}));
  const executable = await fs.realpath(runtime.executable), appPath = await fs.realpath(runtime.appPath);
  if (process.env.D_APP_EXE && executable.toLowerCase() !== (await fs.realpath(process.env.D_APP_EXE)).toLowerCase())
    throw Error('Extension probe did not launch its requested artifact.');
  const identity = {...runtime, executable, appPath, executableSha256: sha(await fs.readFile(executable))};
  if ((await fs.stat(appPath)).isFile()) identity.appArchiveSha256 = sha(await fs.readFile(appPath));
  else identity.directoryApplication = true; // Exact contents are bound separately by the qualification manifest.
  return identity;
}

/** Check only explicitly selected source/build files. Never read a browsing profile or unresolved artwork. */
export async function verifyQualificationManifest(filename) {
  const bytes = await fs.readFile(filename), manifest = JSON.parse(bytes);
  if (!Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.outputs) || !manifest.outputs.length)
    throw Error('Qualification manifest must contain nonempty files and outputs arrays.');
  const entries = [...manifest.files, ...manifest.outputs];
  if (entries.length > 15000) throw Error('Qualification file inventory exceeds its bound.');
  const mismatches = [];
  for (const entry of entries) {
    const name = String(entry.file || '').replaceAll('\\', '/');
    if (!name || path.isAbsolute(name) || name.split('/').includes('..') ||
      /(?:^|\/)(?:\.qa-profiles|\.preview-profile|\.profile|Cookies|History|Login Data|browser\.sqlite)(?:\/|$)/i.test(name) ||
      /(?:^|\/)(?:workspace-coast\.png|inherited-workspace-coast-unresolved-rights\.png)$/i.test(name))
      throw Error('Unsafe qualification inventory entry.');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw Error('Missing qualification file hash.');
    try {
      const actual = await fs.readFile(path.resolve(name));
      if (sha(actual) !== entry.sha256 || entry.bytes !== undefined && actual.length !== entry.bytes) mismatches.push(name);
    } catch { mismatches.push(name); }
  }
  if (mismatches.length) throw Error('Qualification source/build changed: ' + mismatches.join(', '));
  return {file: path.resolve(filename), sha256: sha(bytes), filesVerified: manifest.files.length,
    outputsVerified: manifest.outputs.length, sourceDigest: manifest.currentFileListDigest || manifest.sourceDigest || null};
}
