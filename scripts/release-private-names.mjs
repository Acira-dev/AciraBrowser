import fs from 'node:fs/promises';
import path from 'node:path';

/** The names of the private repositories must never ship (Beta 14, 17 Nov: the usage page's "Read the source" button and THIRD_PARTY_NOTICES.md carried the private repository's address, so every user who pressed it
 *  got a GitHub 404, and the notices file told everyone where the closed source lives). A packager calls assertNoPrivateNames on the app folder it has just staged; tests/release-private-names.test.mjs runs the
 *  same scan over the source that is copied into the app. Plain byte search, so it also finds a name inside a bundle, a JSON file, an .asar archive or a binary. */
// Written in two halves on purpose: this file is part of the public source export, and the names themselves must not appear in it.
export const PRIVATE_NAMES = Object.freeze(['AciraBrowser' + 'NoAI', 'AciraBrowser' + '-dev']);

/** Every file under `target` (a folder or one file) that holds a private name: [{file (relative to target, / separators), name}]. A folder named in `skip` is not entered (test use only: a packager scans everything). */
export async function findPrivateNames(target, {skip = []} = {}) {
  const found = [], needles = PRIVATE_NAMES.map((name) => [name, Buffer.from(name)]);
  const visit = async (entry, relative) => {
    const info = await fs.lstat(entry);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const child of await fs.readdir(entry)) if (!skip.includes(child)) await visit(path.join(entry, child), relative ? `${relative}/${child}` : child);
      return;
    }
    if (!info.isFile()) return;
    const bytes = await fs.readFile(entry);
    for (const [name, needle] of needles) if (bytes.includes(needle)) found.push({file: relative || path.basename(entry), name});
  };
  await visit(target, '');
  return found;
}

/** Throws, naming every file, when the staged app holds a private name. `label` says what was scanned. */
export async function assertNoPrivateNames(target, label = 'the shipped app') {
  const found = await findPrivateNames(target);
  if (found.length) throw new Error(`${label} contains the name of a private repository (a user would be sent to a 404, or told where the closed source is):\n${found.map(({file, name}) => `  ${name}  in  ${file}`).join('\n')}`);
}
