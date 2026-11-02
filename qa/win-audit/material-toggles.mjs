// Glass/material: live toggles of reduced transparency, glass opacity, high contrast; native vibrancy views and the chrome's alpha.
import {launch, sleep, httpFixture, OUT} from './lib.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const app = await launch({name: 'gl', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const probe = async tag => {
  const r = await app.ui.evaluate(() => { const root = document.documentElement, a = document.querySelector('.app'), cs = getComputedStyle(a); return {material: root.dataset.material, desktop: root.dataset.desktopMaterial, nativeApp: root.dataset.nativeAppearance, matApp: root.dataset.materialAppearance, transp: root.dataset.systemTransparency, active: root.dataset.windowActive, appBg: cs.backgroundColor, frame: cs.getPropertyValue('--frame').trim()}; });
  console.log(tag.padEnd(28), JSON.stringify(r));
};
try {
  await sleep(1000); await probe('initial');
  for (const patch of [{reducedTransparency: true}, {reducedTransparency: false}, {glassOpacity: 40}, {glassOpacity: 100}, {glassOpacity: 85}, {reducedTransparency: true}]) {
    await app.act({type: 'settings.update', patch}); await sleep(900); await probe(JSON.stringify(patch));
  }
  // system-follow: flip the app's own nativeTheme source (not the OS) and check the chrome follows
  await app.act({type: 'settings.update', patch: {appearance: 'system'}}); await sleep(800);
  for (const src of ['dark', 'light', 'dark']) { await app.main(({nativeTheme}, s) => { nativeTheme.themeSource = s; }, src); await sleep(1200); const r = await app.ui.evaluate(() => { const a = document.querySelector('.app'); return {theme: a.dataset.theme, appearance: a.dataset.appearance, chrome: a.dataset.chrome, frame: getComputedStyle(a).getPropertyValue('--frame').trim()}; }); console.log('nativeTheme=' + src, JSON.stringify(r)); }
  await app.main(({nativeTheme}) => { nativeTheme.themeSource = 'system'; });
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); }
