// Animation speed has three choices: Premium, Fast and None. None is the old "Off": the same Reduce motion switch (`reducedMotion`), only relabelled (founder,
// 6 Nov 2026), so there is no new stored value and no second setting. Every language carries the new word, and the Settings control still writes the one switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const locales = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN'];
const catalog = (code: string) => JSON.parse(read(`src/i18n/${code}.json`)) as Record<string, string>;
const oldOff = ['Off', 'Aus', 'Désactivées', 'Desactivada', 'Disattivate', 'Desativada', 'オフ', '끔', 'Выкл.', 'Kapalı', '关闭', 'متوقفة', 'बंद'];

test('every language names the third choice "None" (not Off) and says so in the system sentence too', () => {
  assert.equal(catalog('en')['browsersettings.animationOff'], 'None');
  assert.equal(catalog('en')['browsersettings.animationSystemOff'], 'None while Windows asks to reduce motion.');
  const labels = new Set<string>();
  for (const code of locales) {
    const c = catalog(code), label = c['browsersettings.animationOff'], system = c['browsersettings.animationSystemOff'];
    assert.ok(label && system, `${code} has both strings`);
    assert.ok(!oldOff.includes(label), `${code} still says ${label}`);
    assert.ok(!/(^|\W)(Off|Aus|Désactivée?s?|Desactivada|Disattivate|Desativada)(\W|$)/.test(system), `${code}: ${system}`);
    assert.ok(system.includes('Windows'), `${code}: the OS name stays for the Mac rewrite (src/i18n/platform.ts)`);
    labels.add(label);
  }
  assert.ok(labels.size >= 12, 'each language has its own word');
  // The other two stay Premium and Fast.
  assert.equal(catalog('en')['browsersettings.animationPremium'], 'Premium');
  assert.equal(catalog('en')['browsersettings.animationFast'], 'Fast');
});

test('Settings: Premium, Fast and None in one control, and None is the Reduce motion switch', () => {
  const settings = read('src/features/BrowserSettings.tsx');
  assert.match(settings, /\["premium", tr\("browsersettings\.animationPremium"\)\],\s*\["fast", tr\("browsersettings\.animationFast"\)\],\s*\["off", tr\("browsersettings\.animationOff"\)\]/);
  assert.match(settings, /onChange=\{\(speed\) => update\(speed === "off" \? \{ reducedMotion: true \} : \{ reducedMotion: false, animationSpeed: speed \}\)\}/);
  // No second setting: the stored speed is still only premium or fast (validation), and Accessibility keeps its one Reduce motion switch.
  assert.match(read('desktop/validation.cjs'), /oneOf\(patch\.animationSpeed,\['premium','fast'\],'Animation speed'\)/);
  assert.match(read('src/runtime/types.ts'), /animationSpeed\?:'premium'\|'fast'/);
  assert.equal((settings.match(/id="reduce-motion"/g) || []).length, 1);
  assert.equal((settings.match(/id="animation-speed"/g) || []).length, 1);
  assert.match(read('src/ui/sharedMotion.ts'), /if \(settings\?\.reducedMotion\) return 'off';/);
});

test('the edge waits follow the speed: main reports it, reduced motion or the OS preference is None', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /speed:\(\)=>state\.settings\.reducedMotion\|\|layout\.reducedMotion\?'off':state\.settings\.animationSpeed==='fast'\?'fast':'premium'/);
  assert.match(read('desktop/edge-reveal.cjs'), /speed: item\.speed\?\.\(\) \|\| 'premium'/);
});

// None means none (founder, 6 Nov): what Off used to fade in over 90 to 100ms (menus and popups, toasts, tooltips, the Seamless bar) is a cut now, and Premium and Fast keep
// every one of their durations.
test('None: popups, toasts and tooltips appear and go at once; Premium and Fast durations are untouched', () => {
  const sheet = read('src/components/SheetPopupSurface.tsx');
  assert.match(sheet, /const quickOpenMs=110,reducedOpenMs=0,closeMs=130;/);
  const toast = read('src/components/transient/Toast.tsx');
  const motion = toast.slice(toast.indexOf('export function toastMotion'), toast.indexOf('export function toastLeaveMs'));
  assert.match(motion, /enter: instant \? \{ spring: false, transition: \{ duration: 0 \} \}/);
  assert.match(motion, /exit: instant \? \{ spring: false, transition: \{ duration: 0 \} \}/);
  assert.match(motion, /move: instant \? \{ duration: 0, easing: 'linear' \}/);
  assert.match(motion, /type: 'spring' as const, duration: enterSpec\.duration, bounce: enterSpec\.bounce/, 'the Premium and Fast spring is as before');
  const css = read('src/styles/transient.css');
  const reduced = css.split('\n').filter(line => /reduced-motion/.test(line));
  assert.ok(reduced.length >= 4);
  assert.match(css, /\.t-tip \{ --tip-from: translate\(-50%, -50%\); animation-duration: 0ms; \}/);
  assert.match(css, /\.app\[data-reduced-motion='true'\] ~ \.t-tip,\n:root:root:root body:has\(\.app\[data-reduced-motion='true'\]\) \.t-tip \{ --tip-from: translate\(-50%, -50%\); animation-duration: 0ms; \}/);
  assert.match(css, /\.app\[data-reduced-motion='true'\] :is\(\.t-place, \.t-slot \.t-toast > \*\) \{\n  transition-duration: 0ms;\n\}/);
  assert.match(css, /\.app\[data-reduced-motion='true'\] \.t-solo > \.t-toast \{\n  animation-duration: 0ms;\n\}/);
  assert.ok(!/(animation|transition)-duration: 100ms/.test(css), 'no 100ms reduced-motion fade is left');
  assert.match(css, /animation: t-tip-in calc\(140ms \* min\(var\(--motion-scale, 1\), 1\.3\)\)/, 'the tooltip keeps its Premium and Fast length');
});

test('None: the Seamless bar is a cut, with no fade rule or attribute left', () => {
  assert.ok(!/edgeFade|data-edge-fade/.test(read('src/ui/chromeEdge.ts') + read('src/styles/seamless.css')));
  assert.ok(!/__noFade/.test(read('src/ui/chromeEdge.ts')), 'the rig hook is not in the product');
});
