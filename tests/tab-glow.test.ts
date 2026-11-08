// Item 11 (founder-approved 7 Nov 2026): tab rows take 8px corners and a soft glow in the site's colour.
// The colour is the site icon's hue and chroma (ui/siteIconColor.ts: ONE reader and cache, shared with the Favorites ring) drawn at one lightness;
// Settings › Appearance › Site colour (:root[data-site-color]) is Off / Soft (default) / Rich.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { glideColors, glowCss, mixGlow, NO_GLOW, pair, parseGlow } from '../src/ui/glowBlend';
import { GLOW_LIGHTNESS, MAX_CHROMA, MIN_CHROMA, contrastRatio, glowColorFromPixels, glowHex, iconColor, iconKey, iconSourceOf, oklchToRgb, resetIconColors, tabIconSource } from '../src/ui/siteIconColor';

const src = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

/** A size x size RGBA picture from a painter (x, y) -> [r, g, b, a]. */
const picture = (size: number, paint: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(paint(x, y), (y * size + x) * 4);
  return data;
};

/** HSL of a #rrggbb colour: [hue in degrees, saturation 0..1, lightness 0..1]. */
const hsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min), h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('a red icon gives a red glow colour: the icon\'s hue, a visible chroma, one lightness', () => {
  const red = glowColorFromPixels(picture(32, (x, y) => x > 3 && x < 28 && y > 6 && y < 25 ? [255, 0, 51, 255] : [0, 0, 0, 0]));
  assert.ok(red && /^#[\da-f]{6}$/.test(red), 'a colour');
  const [hue, saturation, lightness] = hsl(red!);
  assert.ok(saturation >= 0.4, `saturation ${saturation}`);
  assert.ok(lightness >= 0.35 && lightness <= 0.65, `lightness ${lightness}`);
  assert.ok(hueGap(hue, hsl('#ff0033')[0]) < 14, `hue ${hue}`);
});

test('only hue and chroma are kept: a deep navy and a pale blue of one hue give one glow colour family at one lightness', () => {
  const deep = glowColorFromPixels(picture(32, () => [20, 30, 140, 255])), pale = glowColorFromPixels(picture(32, () => [120, 150, 255, 255]));
  assert.ok(deep && pale);
  assert.ok(hueGap(hsl(deep!)[0], hsl(pale!)[0]) < 14);
  const lights = [deep!, pale!].map(colour => hsl(colour)[2]);
  assert.ok(Math.abs(lights[0] - lights[1]) < 0.08, `lightness ${lights}`);
});

test('a grey, black-and-white, transparent or tiny-coloured icon gives no glow', () => {
  assert.equal(glowColorFromPixels(picture(32, (x, y) => (x + y) % 2 ? [20, 20, 22, 255] : [250, 250, 250, 255])), null, 'black and white (GitHub, Notion)');
  assert.equal(glowColorFromPixels(picture(32, () => [128, 130, 132, 255])), null, 'grey');
  assert.equal(glowColorFromPixels(picture(32, () => [255, 0, 0, 0])), null, 'transparent');
  assert.equal(glowColorFromPixels(new Uint8ClampedArray(0)), null, 'empty');
  assert.equal(glowColorFromPixels(picture(32, (x, y) => (x === 0 && y < 3 ? [255, 120, 0, 255] : (x + y) % 2 ? [10, 10, 10, 255] : [255, 255, 255, 255]))), null, 'a few coloured pixels in a black and white icon');
});

test('the heaviest colour wins in a two-colour icon', () => {
  const colour = glowColorFromPixels(picture(32, (x) => (x < 20 ? [30, 90, 230, 255] : [30, 200, 90, 255])));
  assert.ok(hueGap(hsl(colour!)[0], hsl('#1e5ae6')[0]) < 10, `hue ${hsl(colour!)[0]}`);
});

test('icon keys are short, stable, and carry nothing of the picture or the site', () => {
  const a = 'data:image/png;base64,AAAA' + 'x'.repeat(5000), b = a + 'y';
  assert.equal(iconKey(a), iconKey(a));
  assert.notEqual(iconKey(a), iconKey(b));
  assert.ok(iconKey(a).length < 30 && !iconKey('https://github.com/favicon.ico').includes('github'));
});

test('the colour source is the icon the tab draws, and none where Acira draws its own glyph', () => {
  assert.equal(tabIconSource('https://example.com/', 'data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(tabIconSource('https://example.com/', 'javascript:alert(1)'), '', 'only icon schemes');
  assert.equal(tabIconSource('https://example.com/', undefined), '');
  assert.equal(tabIconSource('acira://settings', 'data:image/png;base64,AAAA'), '', 'Acira pages wear a glyph');
  assert.equal(tabIconSource('acira://new', 'data:image/png;base64,AAAA'), '', 'the New tab wears the logo');
  assert.equal(tabIconSource('https://example.com/', 'data:image/png;base64,AAAA', true), '', 'a failed page wears the alert');
  assert.equal(tabIconSource('https://www.youtube.com/', 'data:image/png;base64,AAAA'), iconSourceOf('https://www.youtube.com/'), 'a bundled icon wins, as in SiteIdentityIcon');
  assert.ok(iconSourceOf('https://www.youtube.com/').includes('youtube'));
});

test('reading an icon never throws and is remembered (no canvas here: unreadable, once)', async () => {
  resetIconColors();
  const icon = 'data:image/png;base64,AAAA';
  assert.equal(iconColor('', icon, false), undefined, 'not read yet');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(iconColor('', icon, false), undefined, 'unreadable without a canvas: no colour, and no second read');
  assert.equal(iconColor('', '', false), null, 'no icon, no colour');
});

test('ink stays readable on the strongest wash: every hue, every chroma, the glow colour at the Rich values over the light and the dark card', () => {
  const css = src('src/styles/tab-glow.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const shares = [...css.matchAll(/--tg-(?:h-)?wash:\s*(\d+)%/g)].map(m => Number(m[1]) / 100), strongest = Math.max(...shares);
  assert.ok(strongest > 0 && strongest <= 0.12, `the strongest wash is ${strongest}`);
  const mix = (top: readonly number[], base: readonly number[], share: number) => base.map((v, i) => v * (1 - share) + top[i] * share);
  const cards = [{ card: [255, 255, 255], ink: [27, 27, 29] }, { card: [36, 37, 41], ink: [244, 244, 245] }];
  let worst = Infinity;
  for (const { card, ink } of cards) for (let h = 0; h < 360; h += 3) for (const c of [MIN_CHROMA, 0.15, MAX_CHROMA]) {
    const glow = oklchToRgb(GLOW_LIGHTNESS, c, h);
    worst = Math.min(worst, contrastRatio(ink, mix(glow, card, strongest)));
  }
  assert.ok(worst >= 4.5, `ink on the strongest wash: ${worst.toFixed(2)}:1`);
  assert.equal(glowHex({ h: 250, c: 0.15 }).length, 7);
});

test('the stylesheet: Off draws nothing, Soft is the default, Rich is stronger; tokens, not numbers, in the rules', () => {
  const css = src('src/styles/tab-glow.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  const glowRules = rules.filter((rule) => /\[data-glow\]/.test(rule.selector) && !/^\.app \./.test(rule.selector));
  assert.ok(glowRules.length >= 6, 'rows, hover, pill, glow layer');
  for (const rule of glowRules) for (const part of rule.selector.split(',')) assert.match(part.trim(), /^:root:not\(\[data-site-color=off\]\) /, `Off must switch this off: ${part.trim()}`);
  assert.ok(!css.includes('[data-site-color=soft]'), 'Soft is the default, not an attribute');
  const soft = rules.find((r) => r.selector === '.app.style-acira' && r.body.includes('--tg-glow'))!.body, rich = rules.find((r) => r.selector === ':root[data-site-color=rich] .app.style-acira')!.body;
  const num = (body: string, name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(body)![1]);
  for (const name of ['--tg-ring', '--tg-glow', '--tg-blur', '--tg-h-ring', '--tg-h-glow', '--tg-h-blur', '--tg-h-wash']) assert.ok(num(rich, name) >= num(soft, name), `${name}: Rich is not weaker than Soft`);
  assert.ok(num(rich, '--tg-glow') > num(soft, '--tg-glow') && num(rich, '--tg-blur') > num(soft, '--tg-blur'));
  assert.match(css, /:root\[data-site-color=rich\] \.app\.style-acira\[data-chrome=dark\]/, 'Rich has its own dark values');
  assert.match(css, /\.app\.style-acira\[data-chrome=dark\] \{/, 'Soft has its own dark values');
  for (const rule of glowRules.filter((r) => r.selector.includes('.tab-strip-container'))) assert.ok(!/(?<!min\()var\(--tg-(h-)?blur\)/.test(rule.body.replace(/min\(var\(--tg-(h-)?blur\), 8px\)/g, '')), 'the top strip caps its glow at 8px (its shell clips)');
  assert.match(css, /--tab-radius: 8px/);
});

test('the corners: sidebar rows and top tabs are 8px, the other sidebar controls keep the control radius', () => {
  const sidebar = src('src/components/sidebar/sidebar.css'), frost = src('src/frost-preview.css');
  assert.match(sidebar, /--sb-row-radius:8px/);
  assert.match(sidebar, /--sb-radius:var\(--radius-control,4px\)/);
  const rule = (css: string, start: string) => css.split('\n').find((line) => line.startsWith(start)) ?? '';
  for (const start of ['.app.style-acira .acira-sidebar :is(.sb-tab,.sb-new-tab,.sb-bookmark,.sb-folder){', '.app.style-acira .acira-sidebar .sb-tab-main{', '.app.style-acira .acira-sidebar .sb-group>.sb-group-header{', '.app.style-acira .acira-sidebar .sb-zone-toggle{', '.app.style-acira .acira-sidebar .sb-bookmarks-empty{', '.app.style-acira .acira-sidebar .sb-jump{'])
    assert.match(rule(sidebar, start), /border-radius:var\(--sb-row-radius\)/, start);
  for (const start of ['.app.style-acira .acira-sidebar .sb-button{', '.app.style-acira .acira-sidebar .sb-custom-done{']) assert.match(rule(sidebar, start), /border-radius:var\(--sb-radius\)/, `${start} keeps the control radius`);
  assert.doesNotMatch(frost.split('\n').filter((line) => /\.browser-tab[ :.\[{,]|\.tab-strip-selection/.test(line) && /border-radius:6px/.test(line)).join('\n'), /border-radius:6px/, 'no 6px tab corner is left in the Acira style');
  for (const line of [25, 36, 536, 635, 649]) assert.match(frost.split('\n')[line - 1], /border-radius:var\(--tab-radius,8px\)/, `frost-preview.css line ${line}`);
});

test('the rows: the colour reaches the sidebar row and the top tab and pill, and never a private, Tor, sleeping, outlined or linked-copy tab', () => {
  const sidebar = src('src/components/sidebar/AciraSidebar.tsx'), strip = src('src/components/BrowserTabsHorizontal.tsx');
  assert.match(sidebar, /useSiteIconColor\(tab\.url,tab\.favicon,!privacy&&!tab\.sleeping&&!tab\.risk&&!copy&&!hidden,!!tab\.error\)/);
  assert.match(sidebar, /'--site':siteColor/); assert.match(sidebar, /data-glow=\{siteColor\?'':undefined\}/);
  assert.match(strip, /useSiteIconColor\(tab\.url,tab\.favicon,!shownPrivacy\(tab\)&&!tab\.sleeping&&!tab\.risk&&!entry\.linked,!!tab\.error\)/);
  assert.match(strip, /\{'--site':siteColor\}/);
  // The pill's colour is the selection motion's, blended on the pill's own spring (see the morph tests below), never a value set at once.
  assert.match(strip, /useSiteIconColor\(shownActive\?\.url\?\?'',shownActive\?\.favicon,!!shownActive&&!shownPrivacy\(shownActive\)&&!shownActive\.sleeping&&!shownActive\.risk/);
  assert.match(strip, /movement,`\$\{widths\.join\(','\)\}:\$\{offsets\.join\(','\)\}`,false,activeTone\)/);
  assert.match(strip, /className="tab-strip-selection" data-glow=\{twin\?undefined:''\}/); assert.match(strip, /'--site':motionOf\.glow/);
  assert.match(src('src/allStyles.ts'), /tab-glow\.css';[\s\S]*tab-ink\.css';/, 'imported before the tab ink, which stays the last stylesheet');
});

test('the icon colour module keeps privacy: a tab\'s colour is remembered by its icon\'s hash alone, never by a site name or address', () => {
  const code = src('src/ui/siteIconColor.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const hook = code.slice(code.indexOf('export function useSiteIconColor'), code.indexOf('export function resetIconColors'));
  assert.match(hook, /iconColor\('', src\)/, 'the tab hook keys by the icon only');
  assert.doesNotMatch(hook, /hostname|\.host\b|new URL|appHost/);
  assert.equal((code.match(/acira-icon-colors/g) || []).length, 1, 'one cache, shared with the Favorites ring');
  assert.doesNotMatch(src('src/ui/siteIconColor.ts').replace(/\/\*[\s\S]*?\*\//g, ''), /acira\.siteIconColor\.v1/, 'the second cache is gone');
});

test('blending: a colour that differs blends, one that is missing fades in or out with its channels kept, and nothing passes through grey', () => {
  const red = parseGlow('#ff0000')!, blue = parseGlow('#0000ff')!;
  assert.deepEqual(mixGlow(red, blue, 0), red); assert.deepEqual(mixGlow(red, blue, 1), blue);
  assert.deepEqual(mixGlow(red, blue, 0.5), [127.5, 0, 127.5, 1]);
  const { from, to } = pair(red, null);
  assert.deepEqual(from, red); assert.deepEqual(to, [255, 0, 0, 0]);
  assert.deepEqual(mixGlow(from, to, 0.5), [255, 0, 0, 0.5], 'a glow leaving fades, still red');
  const arriving = pair(null, blue);
  assert.deepEqual(mixGlow(arriving.from, arriving.to, 0.25), [0, 0, 255, 0.25], 'a glow arriving fades in, already blue');
  assert.deepEqual(pair(null, null), { from: NO_GLOW, to: NO_GLOW });
  assert.deepEqual(mixGlow(NO_GLOW, blue, 0.5), [0, 0, 255, 0.5], 'even a fully empty end takes the other end\'s channels');
  assert.equal(glowCss([255.4, 0, 127.6, 0.5]), 'rgb(255 0 128 / 0.5)');
  assert.equal(parseGlow('red'), null); assert.equal(parseGlow(undefined), null);
});

test('the sidebar card carries the glow on the glide: same animation, same clock, colours from the two rows', () => {
  assert.deepEqual(glideColors('#ff0000', '#0000ff'), ['#ff0000', '#0000ff']);
  assert.deepEqual(glideColors('#FF0000', undefined), ['#ff0000', '#ff000000'], 'glow leaving: the same colour at no strength');
  assert.deepEqual(glideColors('', '#00ff00'), ['#00ff0000', '#00ff00'], 'glow arriving');
  assert.equal(glideColors('', undefined), null, 'no colour on either: a plain card, as before');
  const sidebar = src('src/components/sidebar/AciraSidebar.tsx');
  const call = /glide\.animate\(\[\{transform:`translate[\s\S]*?\}\],\{duration:springMs\(\),easing:SPRING\}\)/.exec(sidebar)?.[0] ?? '';
  assert.ok(call.includes("'--glow-c':tones[0]") && call.includes("'--glow-c':tones[1]"), 'the colour is a keyframe of the card\'s own transform animation');
  assert.match(sidebar, /glideColors\(was\.el\.style\.getPropertyValue\('--site'\),el\.style\.getPropertyValue\('--site'\)\)/);
  assert.match(sidebar, /if\(tones\)glide\.setAttribute\('data-glow',''\)/);
  const css = src('src/styles/tab-glow.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /@property --glow-c \{ syntax: '<color>'; inherits: true; initial-value: transparent; \}/, 'registered, so it interpolates');
  const body = (selector: string) => new RegExp(selector.replace(/[.[\]()]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css)?.[1] ?? '';
  const card = body(':root:not([data-site-color=off]) .app.style-acira .acira-sidebar .sb-glide[data-glow]'), row = body(':root:not([data-site-color=off]) .app.style-acira .acira-sidebar .sb-tab[data-glow][aria-current=true],\n:root:not([data-site-color=off]) .app.style-acira .acira-sidebar .sb-tab[data-glow][aria-current=true]:hover');
  assert.ok(card && row, 'both rules exist');
  const norm = (value: string) => value.replace(/--glow-c/g, '--site').replace(/\s+/g, ' ').trim();
  assert.equal(norm(card), norm(row), 'the card draws exactly what the row draws once it lands: nothing pops at the end of the glide');
});

test('the top pill: the colour is blended by the selection motion on the same transition as its move, and is zero-length when motion is off', () => {
  const hook = src('src/ui/useTabSelectionMotion.ts'), strip = src('src/components/BrowserTabsHorizontal.tsx');
  assert.match(hook, /animate\(x,target\.x,transition\);animate\(width,target\.width,transition\)/, 'the existing spring is untouched');
  assert.match(hook, /ends\.current=pair\(shown,next\);mix\.jump\(0\);animate\(mix,1,transition\)/, 'the colour takes the same transition object, from rest (jump resets the velocity a set would hand the spring)');
  assert.doesNotMatch(hook, /mix\.set\(0\)/);
  assert.match(strip, /const movement=reduced\?\{duration:0\}:\{type:'spring' as const,stiffness:360\*speed\*speed,damping:38\*speed,mass:1\}/, 'None is zero length, Premium and Fast scale the spring');
  assert.match(hook, /return \{selection,glow,/);
});
