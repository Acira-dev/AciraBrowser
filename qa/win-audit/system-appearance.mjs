// Simulated OS appearance flip: the page's prefers-color-scheme (CDP emulation) and nativeTheme.shouldUseDarkColors (patched in this process only).
import {launch, sleep} from './lib.mjs';
const app = await launch({name: 'p10', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'system'}});
const read = async tag => { const ui = await app.ui.evaluate(() => ({mm: matchMedia('(prefers-color-scheme: dark)').matches, theme: document.querySelector('.app').dataset.theme, appearance: document.querySelector('.app').dataset.appearance, native: document.documentElement.dataset.nativeAppearance, mat: document.documentElement.dataset.materialAppearance, frame: getComputedStyle(document.querySelector('.app')).getPropertyValue('--frame').trim()})); console.log(tag.padEnd(14), JSON.stringify(ui)); };
const flip = dark => app.main(({nativeTheme}, d) => { Object.defineProperty(nativeTheme, 'shouldUseDarkColors', {get: () => d, configurable: true}); nativeTheme.emit('updated'); }, dark);
try {
  await sleep(800); await read('system/light');
  for (const dark of [true, false, true, false]) { await app.ui.emulateMedia({colorScheme: dark ? 'dark' : 'light'}); await flip(dark); await sleep(1500); await read(dark ? 'OS dark' : 'OS light'); }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); }
