'use strict';
// 13.5 · Linux report (13.4 AppImage, CachyOS): "profile picture/initial is off center in the side tab bar". The letter in a round
// profile chip sat about one device pixel high. Cause: the chip centred the letter on the font's ascent and descent, and on Linux
// Blink rounds those to device pixels and, when the descent rounded down, moves one pixel from the ascent to the descent
// (subpixel positioning), which lifts the glyph. A fallback font with other metrics moves it further. Inter's own tables agree and
// put its cap centre exactly on the content-area centre (below), so on Mac and Windows the old centring is right and stays.
//
// What this proves, in the real Electron renderer, from the real stylesheets, by reading the anti-aliased pixels:
//  - on Linux the ink box of the letter is centred in the chip within the physical pixel tolerance with Inter, with Inter under the Linux
//    rounding, with fonts whose ascent and descent are far off, and with the system serif / sans / mono, at 1, 1.5 and 2 scale;
//  - the 13.4 markup and stylesheet fail that on the same pages (the control that shows the measurement can fail);
//  - on Mac and Windows every chip is pixel for pixel identical to 13.4, every font, every scale.
// The synthetic metric cases use @font-face overrides computed the way Blink rounds them. The main
// geometry and parity checks use native hosts because generic fallback fonts and rasterization differ by platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// ---- static: where the letter is wrapped, where the rule lives ---------------------------------------------------------------
test('every profile letter chip wraps its letter in .chip-letter, and the rule is Linux only', () => {
  const wraps = {
    'src/features/accounts/profileModel.tsx': /<bdi className="chip-letter">\{profileInitial\(name, avatar\)\}<\/bdi>/,
    'src/features/BrowserSettings.tsx': /<bdi className="chip-letter">\{p\.name\[0\]\}<\/bdi>/,
    'src/features/import-export/ImportPanel.tsx': /<bdi className="chip-letter">/,
    'src/features/onboarding/marks.tsx': /<bdi className="chip-letter">\{source\.initial/,
    'src/features/FrostWorkspace.tsx': /<span className="ed-profile-initial"><bdi className="chip-letter">/,
  };
  for (const [file, pattern] of Object.entries(wraps)) assert.match(read(file), pattern, `${file} wraps the letter`);
  assert.match(read('src/App.tsx'), /import '\.\/styles\/initials\.css';/, 'the stylesheet is loaded by the app');
  const css = read('src/styles/initials.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => [match[1].trim(), match[2].replace(/\s+/g, ' ').trim()]);
  assert.deepEqual(rules, [
    ["html[data-platform='linux'] .chip-letter", 'display: block; text-rendering: geometricPrecision; text-box: trim-both cap alphabetic;'],
    ["html[data-platform='linux'] .chip-letter", 'position: relative; top: -0.0625px;'],
  ], 'both glyph adjustments are Linux only');
  assert.match(css, /@supports \(text-box: trim-both cap alphabetic\)/, 'a browser without text-box keeps the old centring');
});

const hasFontTools = (() => { try { return spawnSync('python3', ['-c', 'import fontTools'], { encoding: 'utf8' }).status === 0; } catch { return false; } })();
test('Inter puts its capital letters exactly on the middle of its ascent and descent, in all three metric tables', { skip: hasFontTools ? false : 'python3 with fontTools is not available' }, () => {
  const py = spawnSync('python3', ['-c', `
from fontTools.ttLib import TTFont
f = TTFont(${JSON.stringify(path.join(root, 'public/fonts/InterVariable.woff2'))}); u = f['head'].unitsPerEm; o = f['OS/2']; h = f['hhea']
for asc, desc in [(h.ascent, -h.descent), (o.sTypoAscender, -o.sTypoDescender), (o.usWinAscent, o.usWinDescent)]:
    print(round((asc - desc) / 2 / u - o.sCapHeight / 2 / u, 5))`], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  for (const line of py.stdout.trim().split(/\s+/)) assert.ok(Math.abs(Number(line)) < 0.0005, `cap centre minus content-area centre is ${line} em`);
});

// ---- the pixel test ---------------------------------------------------------------------------------------------------------
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const skip = !electron ? 'electron binary not available' : false;

const INTER = pathToFileURL(path.join(root, 'public/fonts/InterVariable.woff2')).href;
const noComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
// Commas inside :is( ) do not separate selectors.
const splitSelectors = list => { const parts = []; let depth = 0, from = 0; for (let i = 0; i < list.length; i++) { const c = list[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) { parts.push(list.slice(from, i)); from = i + 1; } } parts.push(list.slice(from)); return parts.map(part => part.trim().replace(/\s+/g, ' ')); };
// The real rules for a chip: every rule of the file whose selector list names one of these exact selectors.
const rulesFor = (file, selectors) => {
  const wanted = new Set(selectors.map(selector => selector.replace(/\s+/g, ' ')));
  const found = [...noComments(read(file)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => splitSelectors(match[1]).some(part => wanted.has(part)));
  for (const selector of selectors) assert.ok(found.some(match => splitSelectors(match[1]).includes(selector.replace(/\s+/g, ' '))), `${file}: a rule for ${selector}`);
  return found.map(match => `${match[1].trim()}{${match[2].trim()}}`).join('\n');
};

const SIZES = [16, 18, 20, 22, 24, 28, 32, 56, 72];
// family: how a chip is written, the font size it gets, the real css it uses, and the wrapper its selectors expect.
const FAMILIES = [
  { name: 'profile-avatar', sizes: SIZES, offsets: [0, 0.5], fontSize: size => Math.round(size * 0.42),
    css: () => rulesFor('src/features/accounts/profile-manager.css', ['.profile-avatar']),
    chip: (box, letter, style) => `<span data-chip="${box}" class="profile-avatar" style="${style}">${letter}</span>` },
  { name: 'st-avatar', sizes: [32], offsets: [0], fontSize: () => 13,
    css: () => rulesFor('src/features/settings/settings.css', ['.st-avatar']),
    chip: (box, letter, style) => `<span data-chip="${box}" class="st-avatar" style="${style}">${letter}</span>` },
  { name: 'aip-avatar', sizes: [24], offsets: [0], fontSize: () => 12, bdi: true,
    css: () => rulesFor('src/features/settings/settings.css', ['.app.style-acira .browser-settings.settings-acira .acira-import-panel .aip-avatar']),
    chip: (box, letter, style) => `<div class="app style-acira"><div class="browser-settings settings-acira"><div class="acira-import-panel"><span data-chip="${box}" class="aip-avatar" style="${style}">${letter}</span></div></div></div>` },
  { name: 'fr-avatar', sizes: [18, 20, 24], offsets: [0], fontSize: size => Math.round(size * 0.46),
    css: () => rulesFor('src/features/onboarding/onboarding.css', ['.fr-ico', '.fr-ico .fr-avatar']),
    chip: (box, letter, style) => `<span class="fr-ico" style="position:static"><span data-chip="${box}" class="fr-avatar" style="${style}">${letter}</span></span>` },
  { name: 'ed-profile-initial', sizes: [18, 25], offsets: [0], fontSize: () => 12,
    css: () => rulesFor('src/frost-preview.css', ['.ed-profile-initial', '.ed-rail.is-expanded .ed-profile-initial']),
    chip: (box, letter, style, size) => `<div class="ed-rail${size === 18 ? ' is-expanded' : ''}" style="position:static;visibility:visible"><span data-chip="${box}" class="ed-profile-initial" style="${style}">${letter}</span></div>` },
  // The contexts that style the profile chip from outside: each brings the rules that reach it, so a rule that also reaches the letter's
  // wrapper (the toolbar button's `.profile-button span` did, when the wrapper was a span) changes the pixels and fails the parity check.
  { name: 'toolbar-profile-button', sizes: [20], offsets: [0], fontSize: size => Math.round(size * 0.42),
    css: () => [rulesFor('src/styles/toolbar-controls.css', ['.app .acira-shell :is(.toolbar-actions,.focus-actions) .profile-button span', '.app.style-acira .acira-shell .profile-button>.profile-avatar']),
      rulesFor('src/frost-preview.css', ['.app.style-acira .profile-button span']), rulesFor('src/shell-references.css', ['.focus-actions .profile-button span']), rulesFor('src/features/accounts/profile-manager.css', ['.profile-avatar'])].join('\n'),
    chip: (box, letter, style) => `<div class="app style-acira" style="display:contents"><div class="browser-shell acira-shell" style="display:contents"><div class="toolbar-actions focus-actions" style="display:contents"><button class="profile-button toolbar-optional-profile" style="display:contents"><span data-chip="${box}" class="profile-avatar" style="${style}">${letter}</span></button></div></div></div>` },
  { name: 'sidebar-footer', sizes: [22], offsets: [0, 0.5], fontSize: size => Math.round(size * 0.42),
    css: () => [rulesFor('src/components/sidebar/sidebar.css', ['.app.style-acira .acira-sidebar .sb-foot-profile>span', '.app.style-acira .acira-sidebar .sb-foot-profile .profile-avatar']), rulesFor('src/features/accounts/profile-manager.css', ['.profile-avatar'])].join('\n'),
    chip: (box, letter, style) => `<div class="app style-acira" style="display:contents"><nav class="acira-sidebar" style="display:contents"><div class="sb-foot" style="display:contents"><button class="sb-foot-profile" style="display:contents"><span data-chip="${box}" class="profile-avatar" style="${style}">${letter}</span></button></div></nav></div>` },
  { name: 'switcher-row', sizes: [20], offsets: [0], fontSize: () => 8,
    css: () => [rulesFor('src/styles/panels.css', ['.acira-menu-avatar']), rulesFor('src/features/accounts/profile-manager.css', ['.profile-avatar'])].join('\n'),
    chip: (box, letter, style) => `<span data-chip="${box}" class="profile-avatar acira-menu-avatar" style="${style}">${letter}</span>` },
  { name: 'popup-menu-row', sizes: [16], offsets: [0], fontSize: size => Math.round(size * 0.42),
    css: () => [rulesFor('src/styles/popup-menu.css', ['.app .browser-popup .menu-row>.profile-avatar', '.app .browser-popup .menu-row>span:not(.profile-avatar)']), rulesFor('src/features/accounts/profile-manager.css', ['.profile-avatar'])].join('\n'),
    chip: (box, letter, style) => `<div class="app" style="display:contents"><div class="browser-popup" style="display:contents"><div class="menu-row" style="display:contents"><span data-chip="${box}" class="profile-avatar" style="${style}">${letter}</span></div></div></div>` },
];

const FONTS = ['inter', 'linux', 'mac', 'tallAscent', 'tallDescent', 'bigGap', 'serif', 'sans-serif', 'monospace'];

// A page of chips for one platform and one scale. fixed: the 13.5 markup and stylesheet; otherwise the 13.4 ones.
function pageFor({ platform, fixed, dsf }) {
  const face = (name, extra = '') => `@font-face{font-family:'${name}';src:url('${INTER}') format('woff2');font-weight:100 900;${extra}}`;
  const sizesUsed = new Set();
  FAMILIES.forEach(family => family.sizes.forEach(size => sizesUsed.add(family.fontSize(size))));
  // Blink's rounding of ascent and descent to device pixels, with and without the Linux "borrow one pixel" step.
  const metricFaces = [...sizesUsed].map(px => {
    const device = px * dsf, ascent = 0.96875 * device, descent = 0.2412 * device;
    let a = Math.round(ascent), d = Math.round(descent);
    const mac = [a, d];
    if (d < descent && a >= 1) { d++; a--; }
    const pct = (value) => (value / device * 100).toFixed(4) + '%';
    return face(`InterMac${px}`, `ascent-override:${pct(mac[0])};descent-override:${pct(mac[1])};line-gap-override:0%`)
      + face(`InterLinux${px}`, `ascent-override:${pct(a)};descent-override:${pct(d)};line-gap-override:0%`);
  }).join('');
  const stack = (font, px) => ({ inter: "'Inter'", linux: `'InterLinux${px}'`, mac: `'InterMac${px}'`, tallAscent: "'InterTallAscent'", tallDescent: "'InterTallDescent'", bigGap: "'InterBigGap'" }[font] || font);
  let index = 0, body = '';
  const place = () => { const i = index++; return { left: (i % 12) * 80 + 6, top: Math.floor(i / 12) * 84 + 4 }; };
  for (const family of FAMILIES) for (const size of family.sizes) for (const offset of family.offsets) for (const font of FONTS) {
    const px = family.fontSize(size), { left, top } = place();
    const letter = fixed ? '<bdi class="chip-letter">H</bdi>' : (family.bdi ? '<bdi>H</bdi>' : 'H');
    const style = `position:absolute;left:${left}px;top:${top + offset}px;font-size:${px}px;font-family:${stack(font, px)};background:#fff;color:#000;border-radius:0` + (['profile-avatar', 'fr-avatar', 'toolbar-profile-button', 'sidebar-footer', 'switcher-row', 'popup-menu-row'].includes(family.name) ? `;width:${size}px;height:${size}px` : '');
    body += family.chip(`${family.name}|${font}|${size}|${offset}`, letter, style, size);
  }
  const html = `<!doctype html><html data-platform="${platform}"><head><meta charset="utf-8"><style>
${face('Inter')}${metricFaces}${face('InterTallAscent', 'ascent-override:112%;descent-override:18%;line-gap-override:0%')}${face('InterTallDescent', 'ascent-override:80%;descent-override:40%;line-gap-override:10%')}${face('InterBigGap', 'ascent-override:96.88%;descent-override:24.12%;line-gap-override:40%')}
html,body{margin:0;background:#fff}*,::before,::after{font-feature-settings:'cv11','ss03'!important}:root{--font-ui:'Inter';--ed-selected:#444;--ed-ink:#eee;--menu-t3:#888}
${FAMILIES.map(family => family.css()).join('\n')}
${fixed ? read('src/styles/initials.css') : ''}
</style></head><body style="position:relative;width:1000px;height:${Math.ceil(index / 12) * 84 + 20}px">${body}</body></html>`;
  return html;
}

const SCALES = [1, 1.5, 2];
const SCENARIOS = [['linux', true], ['linux', false], ['darwin', true], ['darwin', false], ['win32', true], ['win32', false]];
let measured = null, problem = '';
if (electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-chip-ink-'));
  try {
    const jobs = [];
    for (const [platform, fixed] of SCENARIOS) for (const dsf of SCALES) {
      const page = path.join(dir, `${platform}-${fixed ? 'fixed' : 'old'}-${dsf}.html`);
      fs.writeFileSync(page, pageFor({ platform, fixed, dsf }));
      jobs.push({ name: `${platform}|${fixed ? 'fixed' : 'old'}`, dsf, page });
    }
    const list = path.join(dir, 'jobs.json');
    fs.writeFileSync(list, JSON.stringify(jobs));
    const args = ['--use-mock-keychain', '--mute-audio', path.join(__dirname, 'fixtures', 'chip-ink', 'run.cjs'), list];
    if (process.platform === 'darwin') args.push('-ApplePersistenceIgnoreState', 'YES');
    const run = spawnSync(electron, args, { encoding: 'utf8', timeout: 175000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '0' } });
    const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
    if (line) measured = JSON.parse(fs.readFileSync(line.slice(7).trim(), 'utf8'));
    else problem = ((run.stdout || '') + (run.stderr || '')).split(/\r?\n/).filter(text => !/^\[\d+:/.test(text)).join('\n').slice(0, 900) || 'electron produced no result';
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// CHIP_INK_REPORT=1 prints the worst offset of each font on each page (what the report quotes).
if (measured && process.env.CHIP_INK_REPORT) {
  for (const entry of measured) {
    const byFont = new Map();
    for (const chip of entry.chips) { const font = chip.id.split('|')[1]; if (!byFont.has(font) || Math.abs(chip.dy) >= Math.abs(byFont.get(font).dy)) byFont.set(font, chip); }
    console.log(`# ${entry.name.padEnd(14)} ${String(entry.dsf).padEnd(4)} ` + [...byFont].map(([font, chip]) => `${font} ${chip.dy >= 0 ? '+' : ''}${chip.dy.toFixed(2)}`).join('  '));
  }
}
const at = (name, dsf) => { const entry = measured.find(item => item.name === name && item.dsf === dsf); assert.ok(entry, `measured ${name} at ${dsf}`); return new Map(entry.chips.map(chip => [chip.id, chip])); };
const worst = (chips, filter) => [...chips.values()].filter(chip => filter(chip.id.split('|'))).reduce((best, chip) => (Math.abs(chip.dy) > Math.abs(best.dy) ? chip : best), { dy: 0, id: '' });

test('the measurement itself works: every chip has an ink box', { skip }, () => {
  assert.ok(measured, problem);
  for (const [platform, fixed] of SCENARIOS) for (const dsf of SCALES) {
    const chips = at(`${platform}|${fixed ? 'fixed' : 'old'}`, dsf);
    assert.ok(chips.size > 200, 'a full page of chips');
    for (const chip of chips.values()) assert.ok(typeof chip.dy === 'number' && typeof chip.dx === 'number', `${chip.id} at ${dsf} has ink`);
  }
});

// At fractional scale, Blink quantizes the cap box and glyph ink separately. Allow up to one physical pixel there.
const LIMIT = { 1: 0.8, 1.5: 1 / 1.5, 2: 0.5 };

test('Linux: the letter is centred in the chip within the pixel tolerance, whatever the font\'s ascent and descent', { skip: skip || process.platform !== 'linux' }, () => {
  assert.ok(measured, problem);
  for (const dsf of SCALES) {
    const chips = at('linux|fixed', dsf);
    for (const chip of chips.values()) {
      assert.ok(Math.abs(chip.dy) <= LIMIT[dsf], `${chip.id} at ${dsf}x: ink ${chip.dy}px from the middle (limit ${LIMIT[dsf]})`);
      assert.ok(Math.abs(chip.dx) <= LIMIT[dsf], `${chip.id} at ${dsf}x: ink ${chip.dx}px sideways from the middle`);
    }
  }
});

test('13.4 control: the same pages without the fix put the letter a pixel or more off under Linux metrics and wildly off with other fonts', { skip }, () => {
  assert.ok(measured, problem);
  for (const dsf of [1.5, 2]) {
    const old = at('linux|old', dsf);
    const underLinuxRounding = worst(old, ([family, font]) => family === 'profile-avatar' && font === 'linux');
    assert.ok(Math.abs(underLinuxRounding.dy) > 0.7, `13.4 at ${dsf}x with Inter under the Linux rounding: ${underLinuxRounding.id} is ${underLinuxRounding.dy}px off`);
    const tall = worst(old, ([family, font]) => family === 'profile-avatar' && font === 'tallDescent');
    assert.ok(Math.abs(tall.dy) > 1.5, `13.4 with a descent-heavy font: ${tall.id} is ${tall.dy}px off`);
  }
});

test('Linux: the fix is no worse than 13.4 for Inter as Mac rounds it, so nothing that was right moves away from the middle', { skip }, () => {
  assert.ok(measured, problem);
  for (const dsf of [1.5, 2]) {
    const before = worst(at('linux|old', dsf), ([family, font]) => font === 'mac' || font === 'inter'), after = worst(at('linux|fixed', dsf), ([family, font]) => font === 'mac' || font === 'inter');
    assert.ok(Math.abs(after.dy) <= Math.abs(before.dy) + 0.15, `${dsf}x: worst with the fix ${after.dy} (${after.id}), without ${before.dy} (${before.id})`);
  }
});

test('Mac and Windows: every chip, in every font and at every scale, is pixel for pixel what it was in 13.4', { skip: skip || !['darwin', 'win32'].includes(process.platform) }, () => {
  assert.ok(measured, problem);
  for (const platform of ['darwin', 'win32']) for (const dsf of SCALES) {
    const fixed = at(`${platform}|fixed`, dsf), old = at(`${platform}|old`, dsf);
    const changed = [...old.keys()].filter(id => fixed.get(id).hash !== old.get(id).hash);
    assert.deepEqual(changed, [], `${platform} at ${dsf}x: chips whose pixels changed`);
  }
});
