import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSE_OMEGA, poseDrift, poseOmega, settle } from '../src/features/onboarding/poseSpring';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('desktop/main.cjs');
const onboarding = read('src/features/onboarding/Onboarding.tsx');
const prism = read('src/features/onboarding/PrismField.tsx');
const css = read('src/features/onboarding/onboarding.css');

/** Runs the spring at a refresh rate; returns the trace of [value, velocity] per frame. */
function run(hz: number, seconds: number, from = 0, goal = 1, v = 0, omega = POSE_OMEGA) {
  const out: [number, number][] = [];
  let x = from;
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    [x, v] = settle(x, v, goal, omega, 1 / hz);
    out.push([x, v]);
  }
  return out;
}

test('R4-12: a step move leaves at once, settles softly with no overshoot and no hard stop', () => {
  const trace = run(60, 2);
  assert.ok(trace[0][1] > 0, 'moving from the first frame');
  assert.ok(trace.every(([x]) => x <= 1 + 1e-9), 'never overshoots (critically damped)');
  const at = (s: number) => trace[Math.round(s * 60) - 1][0];
  assert.ok(at(0.8) > 0.98, `arrives within ~0.8s at Fast (${at(0.8).toFixed(3)})`);
  // The last stretch decays smoothly: velocity falls by a steady ratio per frame (exponential tail), never to zero in a
  // frame, which is what read as "stopping in its tracks".
  const v = trace.map(([, velocity]) => velocity);
  for (let i = 40; i < 110; i++) assert.ok(v[i] > 0 && v[i] < v[i - 1] && v[i] / v[i - 1] > 0.8, `frame ${i}: ${v[i - 1]} -> ${v[i]}`);
});

test('R4-12: the same motion at 60, 75, 144 and 240 Hz (frame-rate independent)', () => {
  const ref = run(240, 1)[239][0];
  for (const hz of [60, 75, 144]) assert.ok(Math.abs(run(hz, 1)[hz - 1][0] - ref) < 1e-9, `${hz} Hz`);
});

test('R4-12: a move started mid-move keeps its velocity (no restart from rest), and Premium is slower', () => {
  const [x, v] = run(60, 0.25)[14];
  const next = settle(x, v, -1, POSE_OMEGA, 1 / 60);
  assert.ok(next[1] > 0, 'still carrying the old velocity on the first frame of the new move');
  assert.ok(poseOmega(1.7) < poseOmega(1), 'Premium stretches the settle');
  // The pose drifts, slowly and slightly, so the light never freezes once it has arrived.
  const a = poseDrift(10), b = poseDrift(10.5);
  assert.ok(a.some((value, i) => value !== b[i]) && a.every((value) => Math.abs(value) < 0.02));
  assert.match(prism, /settle\(now\[key\], velocity\[key\], goals\[key\], poseOmega\(scale\), dt\)/);
  assert.match(prism, /const scale = reducedMotion \? 0 : motionScale\("S"\)/);
  assert.doesNotMatch(prism, /progress \* progress \* \(3 - 2 \* progress\)/);
});

test('R4-02: the frosted card forms with the light move from the click frame, no cut at either end', () => {
  // The scene follows the card's running (compositor) opacity every frame, not the inline value written at the end.
  assert.match(prism, /getComputedStyle\(n\)\.opacity/);
  assert.match(prism, /attributeFilter: \["data-prism-glass", "style", "data-stage"\]/);
  // The card enters while the welcome leaves (no wait), on a spring that reads the speed setting, and has an exit.
  assert.match(onboarding, /<AnimatePresence mode="sync" initial=\{!reducedMotion\}>/);
  assert.match(onboarding, /transition=\{quietMotion \? \{ duration: 0\.12 \} : \{ type: "spring", duration: 0\.55 \* cardScale, bounce: 0 \}\}/);
  assert.match(onboarding, /exit=\{quietMotion \?/);
  assert.match(onboarding, /cardScale = motionScale\("E"\)/);
  assert.match(css, /\.fr-center \{\s*position: absolute;\s*inset: 0;/);
});

test('R4-04: no browser part can be lifted above setup by a view transition (theme pick crossfade)', () => {
  assert.match(css, /:root:is\(\[data-fr-finale\], \[data-fr-prewarm\], \[data-fr-switch\]\) \.app :is\([^)]*\.acira-persistent-toolbar[^)]*\),\s*\.app:has\(> \.setup-dialog\) :is\([^)]*\.acira-tab-row[^)]*\)\s*\{\s*view-transition-name: none !important;/);
});

test('Look step: one crossfade per theme pick, never aborted by the setting coming back (was a ~50 ms cut)', () => {
  // The returning setting must not start a second view transition while the first is heading to the same tone.
  assert.match(onboarding, /if \(switching\.current\?\.to === next\) \{\s*\/\/[^\n]*\n\s*paint\?\.\(\);\s*return;/);
  assert.match(onboarding, /if \(resolvedTone !== tone && switching\.current\?\.to !== resolvedTone\) switchTone\(resolvedTone\);/);
  // Only the crossfade that set the timing attribute may clear it (an aborted one cleared it under the live one).
  assert.match(onboarding, /if \(switching\.current\?\.id !== id\) return;\s*switching\.current = null;\s*delete root\.dataset\.frSwitch;/);
  // The browser's named parts stay unnamed through it (R4-04).
  assert.match(css, /:root:is\(\[data-fr-finale\], \[data-fr-prewarm\], \[data-fr-switch\]\)/);
});

test('GPU warm-up happens early and at idle, never on the last card or an input frame', () => {
  const finale = read('src/features/onboarding/finale.ts');
  // The frost passes are drawn once, invisibly, at mount (the first card's frost used to compile on the welcome click).
  assert.match(prism, /prism\.draw\(START, \{ \.\.\.now, glass: 0\.002, gx0: 0, gy0: 0, gx1: 0, gy1: 0, gr: 0 \}, field\);/);
  // Effects (card blur, veil, mark glass) on the resting welcome, one per idle slot; captures on the first card once
  // input has been quiet; the last card only fills in what is missing.
  assert.match(finale, /export function prewarmEffects/);
  assert.match(finale, /export function prewarmCapture/);
  assert.match(finale, /idle\(\(\) => next\(i \+ 1\), life \+ 120\)/);
  assert.match(onboarding, /prewarmEffects\(stageRef\.current\);\s*\}, welcomeReady \? 150 : 1500\);/);
  // The real first card is rehearsed invisibly on the welcome at its real size, with opacity, blur and scale on the
  // same layer as the transition, and a still copy of the welcome runs its exit blur; no focus, no frost, no step logic.
  assert.match(onboarding, /<div ref=\{rehearsal\} className="fr-rehearsal" aria-hidden="true" inert data-rehearsal="">\s*<motion\.div\s*className="fr-center"/);
  assert.match(onboarding, /animate=\{\{ opacity: \[0, 1, 0\.6, 1\], filter: \["blur\(8px\)", "blur\(0px\)", "blur\(4px\)", "blur\(0px\)"\], scale: \[0\.97, 1, 0\.98, 1\] \}\}/);
  assert.match(onboarding, /if \(!rehearsal\) title\.current\?\.focus/);
  assert.match(onboarding, /data-prism-glass=\{rehearsal \? undefined : ""\}/);
  assert.match(onboarding, /const Body = rehearsal\s*\? RehearsalBody/);
  assert.match(onboarding, /source\.cloneNode\(true\)/);
  assert.match(css, /\.fr-stage > \.fr-rehearsal \{\s*position: absolute;\s*inset: 0;\s*z-index: 3;\s*opacity: 0\.01;\s*pointer-events: none;/);
  // The cover step's pictures are decoded while the Look step rests.
  assert.match(onboarding, /if \(step !== "appearance" \|\| decoded\.current\.length\) return;/);
  assert.match(onboarding, /void image\.decode\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(onboarding, /stage !== "dialog" \|\| step === "finish"\) return;/);
  assert.match(onboarding, /performance\.now\(\) - input >= 700 \? prewarmCapture\(stageRef\.current\)/);
  assert.match(finale, /prewarmEffects\(stage\);\s*if \(captureWarm\) return;/);
});

test('R4-01 + R4-52: on a first run the main window waits for setup, a splash with no chrome shows at once', () => {
  // main holds the main window while setup is due, until setup says "painted" (or 3.5 s).
  assert.match(main, /if\(setupHold!=='clear'\)return;mainShown=true;/);
  assert.match(main, /if\(pending\)\{setTimeout\(setupPainted,3500\);preshowForSetup\(\);\}/);
  // Behind the splash's look, the main window is already shown at opacity 0 (mouse ignored, not in the taskbar) so it
  // renders and setup can report a frame that is really drawn; the swap restores it, then closes the splash.
  assert.match(main, /mainWindow\.setOpacity\(0\);mainWindow\.setIgnoreMouseEvents\(true\);mainWindow\.setSkipTaskbar\(true\);mainWindow\.showInactive\(\);setupPreshown=true;/);
  assert.match(main, /if\(setupPreshown\)\{setupPreshown=false;mainWindow\.setIgnoreMouseEvents\(false\);mainWindow\.setSkipTaskbar\(false\);mainWindow\.setOpacity\(1\);\}mainWindow\.show\(\);closeSplash\(\);/);
  assert.match(main, /request\.type==='painted'&&Object\.keys\(request\)\.length===1\)\{setupPainted\(\);return \{ok:true\};\}/);
  // R4-52: meanwhile a first run shows its own splash window at once (a separate window: no browser chrome can leak):
  // the welcome scene's dark base and the mark, focusable so it has a taskbar button. The main window's show closes it
  // in the same tick.
  // Shown once secure startup is ready, so a profile's first start (which quits at once to commit its key) never blinks.
  assert.match(main, /if\(setupDue\)\{setupSplash=\{bounds,saved\};return;\}/);
  assert.match(main, /const secureStartup=await startupGate\.prepare\(\);startupTrace\.mark\('secure-startup'\);if\(secureStartup\.ready\)showSetupSplash\(\);/);
  assert.match(main, /splash=splashWindow\(\{\.\.\.bounds,[^}]*\.\.\.chrome,backgroundColor:SETUP_BASE,focusable:true,skipTaskbar:false/);
  // Both splashes are BrowserWindows shown on 'ready-to-show', with a still, script-free page in the window's colour: a
  // plain BaseWindow reached the screen before its first GPU frame, as Windows' blank grey for 0.6-0.9 s.
  assert.match(main, /function splashWindow\(options,body,maximize\)\{const window=new BrowserWindow\(\{\.\.\.options,show:false,paintWhenInitiallyHidden:true,webPreferences:\{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false/);
  assert.match(main, /window\.once\('ready-to-show',\(\)=>\{if\(splash!==window\|\|window\.isDestroyed\(\)\)return;if\(maximize\)window\.maximize\(\);[^]*?window\.show\(\);startupTrace\.mark\('splash-shown'\);\}\);/);
  assert.match(main, /background:\$\{options\.backgroundColor\}/);
  assert.match(main, /splash=splashWindow\(\{\.\.\.bounds,minWidth:900,minHeight:600,title:tm\("browsersettings\.acira"\),\.\.\.startupChrome,backgroundColor:'#000000'/);
  assert.doesNotMatch(main, /splash=new BaseWindow|splash\.maximize\(\)|splash\.show\(\)/);
  assert.match(main, /chrome\.titleBarOverlay=\{\.\.\.chrome\.titleBarOverlay,color:SETUP_BASE,symbolColor:'#ededef'\}/);
  assert.match(main, /const SETUP_BASE='#030509'/);
  assert.match(main, /mainWindow\.show\(\);closeSplash\(\);/);
  // Setup sends it once its scene has painted (two frames, or a short timer when a hidden window runs no frames).
  assert.match(onboarding, /client\.request\(\{ type: "painted" \}\)/);
  assert.match(onboarding, /requestAnimationFrame\(\(\) => requestAnimationFrame\(send\)\);\s*setTimeout\(send, 50\);/);
});
