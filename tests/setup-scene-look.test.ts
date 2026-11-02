import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_BLACKS, SCENE_GRAIN } from '../src/features/onboarding/sceneLook';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const renderer = read('src/features/onboarding/prismRenderer.ts');
const onboarding = read('src/features/onboarding/Onboarding.tsx');

test('R4: the setup scene look is two numbers in one file, grain clean and blacks deep by default', () => {
  assert.ok(SCENE_GRAIN >= 0 && SCENE_GRAIN <= 1);
  assert.ok(SCENE_BLACKS >= 0 && SCENE_BLACKS <= 1);
  assert.equal(SCENE_GRAIN, 0, 'the founder removed the grain (set SCENE_GRAIN = 1 for the original)');
  assert.equal(SCENE_BLACKS, 1);
});

test('R4: one switch covers both grains: the shader term and the .fr-grain overlay', () => {
  assert.match(renderer, /const float GRAIN=\$\{SCENE_GRAIN\.toFixed\(3\)\};/);
  assert.match(renderer, /float e=n\*\(tone<\.5\?\.075:\.05\)\*GRAIN;/, 'the original amplitudes are kept, scaled by the switch');
  assert.match(onboarding, /SCENE_GRAIN > 0 && <div className="fr-grain"/);
});

test('R4: a half-level dither stays at every grain setting, so clean dark gradients never band', () => {
  assert.match(renderer, /o=vec4\(soft\+n\*\(\.5\/255\.\),1\.\);/);
});

test('R4: deep blacks only touch the faint haze of the dark scene; the light theme keeps its palette window', () => {
  assert.match(renderer, /light\*=1\.-BLACKS\*\.92\*\(1\.-smoothstep\(0\.,\.3,peak\)\);/);
  // the dark branch only: the light branch (tone >= .5) never goes through the toe
  const dark = renderer.slice(renderer.indexOf('if(tone<.5){\n    // Haze glows'), renderer.indexOf('}else{\n    // Light (the founder'));
  assert.match(dark, /BLACKS/);
  assert.match(renderer, /tone<\.5\?\.6:\.55,tone<\.5\?1\.12:1\.,abs\(k\)/, 'dark has the wider colour window, light keeps .55-1');
  assert.match(renderer, /tone<\.5\?\.375-\.46\*k:\.4-\.42\*k/, 'dark runs on to red, light keeps its hue run');
});
