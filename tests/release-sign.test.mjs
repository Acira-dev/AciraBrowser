import test from 'node:test';
import assert from 'node:assert/strict';
import { signCommand, signFiles, signingMode } from '../scripts/release-sign.mjs';

test('release signing: no configuration signs nothing and says so', () => {
  const lines = [];
  const result = signFiles(['a.exe'], {}, line => lines.push(line));
  assert.deepEqual(result, { mode: 'none', signed: [] });
  assert.match(lines[0], /unsigned/);
});

test('release signing: Azure uses signtool with the Artifact Signing dlib and a metadata file', () => {
  const env = { ACIRA_SIGN: 'azure', ACIRA_SIGNTOOL: 'C:\sdk\signtool.exe', ACIRA_AZURE_DLIB: 'C:\azure\Azure.CodeSigning.Dlib.dll' };
  assert.equal(signingMode(env), 'azure');
  const { command, args } = signCommand('x.exe', env, 'azure', 'C:\tmp\metadata.json');
  assert.equal(command, 'C:\sdk\signtool.exe');
  assert.deepEqual(args.slice(0, 4), ['sign', '/v', '/fd', 'SHA256']);
  assert.ok(args.includes('/dlib') && args.includes('/dmdf') && args.at(-1) === 'x.exe');
  assert.ok(args.includes('http://timestamp.acs.microsoft.com'));
  assert.throws(() => signCommand('x.exe', { ACIRA_SIGNTOOL: 's' }, 'azure', 'm'), /ACIRA_AZURE_DLIB/);
});

test('release signing: Azure refuses to start without its account settings', () => {
  assert.throws(() => signFiles(['a.exe'], { ACIRA_SIGN: 'azure', ACIRA_SIGNTOOL: 's', ACIRA_AZURE_DLIB: 'd' }, () => {}), /AZURE_TENANT_ID/);
});

test('release signing: a signing command receives each file; a certificate file uses signtool /f', () => {
  assert.deepEqual(signCommand('x.exe', { ACIRA_SIGN_COMMAND: 'sign.cmd' }, 'command'), { command: 'sign.cmd', args: ['x.exe'] });
  const pfx = signCommand('x.exe', { CSC_LINK: 'c.pfx', CSC_KEY_PASSWORD: 'p', ACIRA_SIGNTOOL: 's' }, 'pfx');
  assert.deepEqual(pfx.args.slice(0, 3), ['sign', '/f', 'c.pfx']);
});
