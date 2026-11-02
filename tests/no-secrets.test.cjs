// The repository will be published as open source. No credential may ever be committed: Supabase service or access
// keys, JWTs, GitHub/AWS/Azure/Google tokens, private keys. The app only ever holds the public usage endpoint address.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const patterns = [
  [/sb_secret_[A-Za-z0-9_-]{20,}/, 'Supabase secret key'],
  [/sbp_[a-f0-9]{40}/, 'Supabase personal access token'],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT (Supabase anon/service key)'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{60,}/, 'GitHub fine-grained token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/(?:client_secret|AZURE_CLIENT_SECRET)\s*[:=]\s*['"][^'"\s]{16,}['"]/i, 'Azure client secret'],
];
const textExt = /\.(?:c?js|mjs|ts|tsx|json|md|html|css|toml|sql|yml|yaml|ps1|cmd|txt|env)$/i;

test('no credentials are committed anywhere in the repository', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split(/\r?\n/)
    .filter((f) => f && textExt.test(f) && !f.startsWith('qa/artifacts/') && f !== 'tests/no-secrets.test.cjs');
  const hits = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (text.length > 5_000_000) continue;
    for (const [re, what] of patterns) {
      const found = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
      // Obvious fixtures (e.g. 'AIzaSyDtestKEY_…' in a unit test) are allowed; anything else is a leak.
      if (found.some((value) => !/test|example|dummy|fake|placeholder/i.test(value))) hits.push(`${file}: ${what}`);
    }
  }
  assert.deepStrictEqual(hits, [], `credentials found:\n${hits.join('\n')}`);
});

test('.env files stay out of git', () => {
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env\*/m);
});
