import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const arg = process.argv.indexOf('--baseline');
const baseline = await fs.realpath(path.resolve(arg < 0 ? 'qa/fixtures/palette-responsive/theme-before.txt' : process.argv[arg + 1] || ''));
const allowed = await Promise.all(['docs/design/color-research/production-qa', 'qa/fixtures/palette-responsive'].map(directory => fs.realpath(directory)));
if (!allowed.some(directory => baseline.toLowerCase().startsWith((directory + path.sep).toLowerCase()))) throw Error('Baseline must stay in the palette fixture or evidence directory.');
const out = path.resolve('docs/design/color-research/production-qa/responsive-theme-' + Date.now()); await fs.mkdir(out, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const before = await fs.readFile(baseline, 'utf8'), files = ['src/ui/theme.ts', 'src/frost-preview.css', 'desktop/interface-scale.cjs'];
const source = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await fs.readFile(file)) })));
await build({ stdin: { contents: before, resolveDir: path.resolve('src/ui'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'before.cjs') });
await build({ entryPoints: ['src/ui/theme.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'after.cjs') });
await build({ entryPoints: ['src/runtime/appearancePalettes.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'palettes.cjs') });
const require = createRequire(import.meta.url), old = require(path.join(out, 'before.cjs')).themeTokens, current = require(path.join(out, 'after.cjs')).themeTokens, { appearancePalettes } = require(path.join(out, 'palettes.cjs')), { interfaceScale } = require(path.resolve('desktop/interface-scale.cjs'));
const checks = [], record = (name, pass, detail = {}) => checks.push({ name, pass, ...detail }); let configurations = 0;
for (const finish of appearancePalettes) for (const dark of [false, true]) for (const opacity of [60, 64, 80, 88, 89, 90, 93, 98, 99, 100]) for (const forced of [false, true]) {
  const settings = { colorPreset: finish.name, browserTint: finish.tint, accentColor: finish.accent, glassOpacity: opacity, interfaceScale: 150 }, a = old(settings, dark, forced), b = current(settings, dark, forced);
  configurations++; const changed = Object.keys(a).filter(key => a[key] !== b[key]); record('all prior material and color roles remain identical', changed.length === 0, { finish: finish.name, dark, opacity, forced, changed });
}
for (const value of [80, 90, 100, 110, 125, 150, undefined, null, 0, 75, 95, 200, NaN, Infinity, '125']) {
  const settings = { colorPreset: 'Porcelain', browserTint: '#f8fbff', accentColor: '#1769c2', interfaceScale: value }, tokens = current(settings, false);
  record('caption scale token matches actual native canonical scale', Number(tokens['--interface-scale']) === interfaceScale(settings), { value: String(value), token: tokens['--interface-scale'], native: interfaceScale(settings) });
}
const css = await fs.readFile('src/frost-preview.css'), candidate = await fs.readFile('docs/design/color-research/compact-caption-candidate.css');
const marker = css.indexOf('\n/* Responsive native caption and rail allocation;');
record('all previously captured frost rules stay byte-identical', marker >= 0 && hash(css.subarray(0, marker)) === 'b1594ee8c09bcdccf212377ece4e801b3c3dff1fdb33d6754837a0ef9597917f');
record('applied responsive rules match the qualified candidate exactly', css.subarray(css.length - candidate.length).equals(candidate));
const sourceStable = (await Promise.all(source.map(async file => hash(await fs.readFile(file.path)) === file.sha256))).every(Boolean); record('scoped source stays stable', sourceStable);
const report = { checkedAt: new Date().toISOString(), qualification: 'Actual current theme against saved pre-change source,480finish/mode/opacity/accessibility configurations; canonical native interface-scale function valid/invalid inputs; exact prior captured frost prefix and qualified responsive suffix. No native package/delivery claim.', baseline, baselineSha256: hash(before), source, sourceStable, configurations, checks, failures: checks.filter(check => !check.pass) };
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, configurations, checks: checks.length, failures: report.failures, sourceStable })); if (report.failures.length) process.exitCode = 1;
