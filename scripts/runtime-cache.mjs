// The extracted Widevine runtimes of the release builds (release/runtime-cache/widevine/<win32-x64|arm64|x64>-XXXXXX, about 370 MB each): one new folder per build, from the verified archive.
// They were removed only when a Windows build got through packaging, and never on the Mac, so every stopped or failed build left one behind (the Windows laptop had 22, about 8 GB; a Mac had 7, 2.4 GB).
//
// A folder is now (1) removed by the build that made it however that build ends (build-windows.mjs: try/finally; package-mac-widevine.mjs: right after its copies), and (2) swept at the start of
// the next fetch when it is stale: its build is not running any more (a killed process cannot clean up after itself). Each build writes `<folder>.owner` beside its folder (never inside it: the folder
// is copied into the package) with its process id and start; the sweep keeps a folder whose owner is alive and started less than a day ago (no build lasts that long), removes one whose owner is gone, and
// removes one with no owner file (made by an older script) only when it is 12 hours old. It touches nothing else in the cache: not the verified archives (electron-*.zip), not a download in progress
// (*.download-<pid>), and nothing outside the cache: the Mac build templates (release/mac-widevine-*.noindex) are not in it and are never touched.
import fs from 'node:fs/promises';
import path from 'node:path';

export const OWNER_SUFFIX = '.owner';
const HOUR = 3600 * 1000;
export const MAX_BUILD_MS = 24 * HOUR, MAX_UNCLAIMED_MS = 12 * HOUR;
/** What fs.mkdtemp makes (six random letters and digits) after each platform's prefix: the only names the sweep may remove. */
export const WINDOWS_RUNTIME_FOLDER = /^win32-(?:x64|arm64)-[A-Za-z0-9]{6}$/;
export const MAC_RUNTIME_FOLDER = /^(?:x64|arm64)-[A-Za-z0-9]{6}$/;

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error && error.code === 'EPERM'; }
}

/** Marks `folder` as made by this process (a file beside it). */
export async function claimRuntimeFolder(folder, { pid = process.pid, now = Date.now } = {}) {
  await fs.writeFile(folder + OWNER_SUFFIX, JSON.stringify({ pid, startedAt: now() }));
}

/** The folder and its owner file; nothing to do when they are gone. */
export async function removeRuntimeFolder(folder) {
  await fs.rm(folder, { recursive: true, force: true });
  await fs.rm(folder + OWNER_SUFFIX, { force: true });
}

async function readOwner(file) {
  try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return value && Number.isInteger(value.pid) && Number.isFinite(value.startedAt) ? value : { broken: true }; } catch (error) { return error && error.code === 'ENOENT' ? null : { broken: true }; }
}

/**
 * Removes the stale runtime folders of `cache` that `match` names. Returns {removed, kept} (names, with why a folder was kept). It never throws: a folder that cannot be removed now (a file open in it)
 * stays for the next build, and a build is never stopped by a sweep.
 */
export async function sweepRuntimeCache(cache, { match, isAlive = processAlive, now = Date.now, maxBuildMs = MAX_BUILD_MS, maxUnclaimedMs = MAX_UNCLAIMED_MS, log = () => {} } = {}) {
  const removed = [], kept = [];
  let names;
  try { names = await fs.readdir(cache, { withFileTypes: true }); } catch { return { removed, kept }; }
  const folders = new Set(names.filter(entry => entry.isDirectory() && match.test(entry.name)).map(entry => entry.name));
  for (const name of folders) {
    const folder = path.join(cache, name);
    try {
      const owner = await readOwner(folder + OWNER_SUFFIX);
      let why = null;
      if (owner && !owner.broken) {
        if (isAlive(owner.pid) && now() - owner.startedAt < maxBuildMs) { kept.push({ name, why: 'its build is running (process ' + owner.pid + ')' }); continue; }
        why = isAlive(owner.pid) ? 'its build started more than a day ago' : 'its build (process ' + owner.pid + ') is gone';
      } else {
        const age = now() - (await fs.stat(folder)).mtimeMs;
        if (age < maxUnclaimedMs) { kept.push({ name, why: 'no owner file and younger than 12 hours' }); continue; }
        why = owner ? 'its owner file is unreadable' : 'no owner file and older than 12 hours';
      }
      await removeRuntimeFolder(folder);
      removed.push(name);
      log('Removed the stale runtime folder ' + name + ' (' + why + ').');
    } catch (error) { kept.push({ name, why: 'could not be removed now: ' + String(error && error.message || error).slice(0, 100) }); }
  }
  // an owner file whose folder is gone (its build removed the folder and was stopped before the file)
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith(OWNER_SUFFIX)) continue;
    const base = entry.name.slice(0, -OWNER_SUFFIX.length);
    if (!match.test(base) || folders.has(base)) continue;
    try { await fs.rm(path.join(cache, entry.name), { force: true }); } catch { /* the next sweep */ }
  }
  return { removed, kept };
}
