import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRtlTarget } from '../qa/rtl-target.mjs';

test('RTL native target selects exact source or packaged files and fails closed on invalid explicit targets', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-rtl-target-'));
  try {
    const electron = path.join(fixture, 'electron.exe'), packaged = path.join(fixture, 'AciraBrowser.exe');
    const entry = path.join(fixture, 'desktop', 'main.cjs'), archive = path.join(fixture, 'resources', 'app.asar');
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.mkdir(path.dirname(archive), { recursive: true });
    await Promise.all([fs.writeFile(electron, 'source-executable-fixture'), fs.writeFile(packaged, 'packaged-executable-fixture'), fs.writeFile(entry, 'source-main-fixture'), fs.writeFile(archive, 'packaged-app-fixture')]);
    const source = await resolveRtlTarget({ env: {}, sourceRoot: fixture, sourceExecutable: electron });
    assert.equal(source.metadata.kind, 'source');
    assert.equal(source.args[0], await fs.realpath(entry));
    const target = await resolveRtlTarget({ env: { D_APP_EXE: packaged } });
    assert.equal(target.executablePath, await fs.realpath(packaged));
    assert.equal(target.metadata.kind, 'packaged');
    assert.equal(target.metadata.entrypoint, null);
    assert.ok(target.args.every(arg => arg.startsWith('--')));
    assert.equal(target.metadata.appArchive.path, await fs.realpath(archive));
    assert.equal(target.metadata.appArchive.sha256, createHash('sha256').update('packaged-app-fixture').digest('hex'));
    assert.equal((await resolveRtlTarget({ env: { ACIRA_APP_EXE: packaged } })).metadata.kind, 'packaged');
    for (const env of [{ D_APP_EXE: '' }, { D_APP_EXE: 'relative.exe' }, { D_APP_EXE: path.join(fixture, 'missing.exe') }, { D_APP_EXE: entry }, { D_APP_EXE: fixture }, { D_APP_EXE: packaged, ACIRA_APP_EXE: electron }]) {
      await assert.rejects(resolveRtlTarget({ env, sourceRoot: fixture, sourceExecutable: electron }));
    }
    await fs.unlink(archive);
    await assert.rejects(resolveRtlTarget({ env: { D_APP_EXE: packaged } }), /ENOENT/);
  } finally {
    const resolved = path.resolve(fixture), temporary = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(temporary) && path.basename(resolved).startsWith('acira-rtl-target-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
