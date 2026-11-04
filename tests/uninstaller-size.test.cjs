'use strict';
// beta.10: the Windows uninstall windows are the size of the setup window on the same screen, at every scale, on one screen or two.
// Windows is built on another PC and neither the C# helpers nor NSIS run here, so this reads their sources and art (like
// windows-compat.test.cjs). How the setup window gets its size on screen (AcStyleBanner): it is DPI aware for the sign-in scale, picks its
// 100, 150 or 200% scene from that scale, and Windows stretches it by (this screen's scale / sign-in scale).
// - The branded card (AciraRemove.exe, Settings > Apps) is per-monitor aware, so Windows never stretches it, and it took its scale from
//   the sign-in scale alone: after a scale change without signing out, or on a second screen, it opened smaller than the setup window, and
//   at 125% and 175% it was always smaller (exact 1.25 / 1.75 against the setup's 150 / 200% scene). It now measures its screen and
//   applies the setup's rule.
// - The NSIS uninstaller (its English splash and Windows' Yes/No boxes, when it is run directly) was not DPI aware, so Windows stretched its
//   100% splash by the exact scale: smaller than the setup window at 125% and 175%. It is now DPI aware like the setup and picks its
//   100, 150 or 200% picture the same way.
// - The setup's Repair / Update / Open card (AciraChoose.cs, same helper exe), which hands over to the setup card in place, took the exact
//   sign-in scale too (smaller than the setup card at 125% and 175%). It now uses the uninstall card's rule, measured on the primary screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/^﻿/, '');
const NSH = read('packaging', 'acira-installer.nsh');
const REMOVER = read('packaging', 'installer', 'AciraUninstall.cs');
const between = (text, start, end) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const j = text.indexOf(end, i); assert.ok(j > i, end); return text.slice(i, j); };
const bmpSize = (name) => { const b = fs.readFileSync(path.join(root, 'packaging', 'installer', name)); assert.equal(b.toString('latin1', 0, 2), 'BM', name); return [b.readInt32LE(18), b.readInt32LE(22)]; };

/** The lines of the include that one makensis pass compiles (electron-builder passes -DBUILD_UNINSTALLER for the uninstaller pass). */
function compiled({ uninstaller, qa = false }) {
  const out = [], stack = [];
  const known = { BUILD_UNINSTALLER: uninstaller, ACIRA_QA: qa };
  for (const line of NSH.split(/\r?\n/)) {
    const t = line.trim(); let m;
    if ((m = /^!if(n?)def (\w+)$/.exec(t))) { const on = m[2] in known ? known[m[2]] : null; stack.push(on === null ? null : m[1] ? !on : on); continue; }
    if (t === '!else') { const top = stack.pop(); stack.push(top === null ? null : !top); continue; }
    if (t === '!endif') { stack.pop(); continue; }
    if (stack.some((on) => on === false)) continue;
    out.push(t);
  }
  assert.equal(stack.length, 0, 'every !if closes');
  return out;
}

// The setup's rule, read from AcStyleBanner: [threshold %, scene %] pairs.
const banner = between(NSH, 'Function AcStyleBanner', 'FunctionEnd');
const SETUP_STEPS = [...banner.matchAll(/\$\{If\} \$2 >= (\d+)\s+StrCpy \$9 (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const setupScene = (dpi) => { const pct = Math.floor(Math.max(96, dpi) * 100 / 96); let scene = 100; for (const [at, to] of SETUP_STEPS) if (pct >= at) scene = to; return scene / 100; };
const [CARD_W, CARD_H] = [560, 340];
/** What the person sees: the setup window's size in screen pixels on a screen of `screen` DPI, signed in at `signIn` DPI. */
const setupOnScreen = (signIn, screen) => { const s = setupScene(signIn) * Math.max(96, screen) / Math.max(96, signIn); return [Math.round(CARD_W * s), Math.round(CARD_H * s)]; };
/** The card's size by its C# rule (CardScale, below), written out in JS. */
const cardOnScreen = (signIn, screen) => { const pct = Math.floor(Math.max(96, signIn) * 100 / 96); const setup = pct >= 175 ? 2 : pct >= 125 ? 1.5 : 1; const s = setup * Math.max(96, screen) / Math.max(96, signIn); return [Math.round(CARD_W * s), Math.round(CARD_H * s)]; };

test('the setup window steps 100 -> 150 at 125% and 150 -> 200 at 175% (the rule both uninstall windows follow)', () => {
  assert.deepEqual(SETUP_STEPS, [[125, 150], [175, 200]]);
  assert.match(NSH, /!define AC_W 560\s+!define AC_H 340/);
  assert.match(banner, /System::Call 'gdi32::GetDeviceCaps\(p r0, i 88\) i \.r1'/, 'from the sign-in scale');
});

test('the uninstall card takes the scale of the screen it opens on, not the scale Windows had at sign-in', () => {
  const form = between(REMOVER, 'public RemoveForm(string dir, string real)', 'Rectangle ScaledRect(');
  assert.match(form, /var at = Native\.Pointer\(\); s = CardScale\(Native\.ScreenDpi\(at\)\);/);
  assert.doesNotMatch(between(form, 'public RemoveForm', 'static double CardScale'), /GetDeviceCaps/, 'the constructor never sizes the card from the sign-in scale alone');
  assert.match(form, /AutoScaleMode = AutoScaleMode\.None;/);
  const dpi = between(REMOVER, 'public static int ScreenDpi(POINT p)', '\n  }\n');
  const monitor = dpi.indexOf('GetDpiForMonitor(MonitorFromPoint(p, 2), 0, out x, out y) == 0'), fallback = dpi.indexOf('GetDeviceCaps(dc, 88)');
  assert.ok(monitor >= 0, 'the effective scale of the screen nearest the pointer');
  assert.ok(fallback > monitor && /if \(dpi <= 0\)/.test(dpi), 'the sign-in scale only when the screen cannot be asked');
  assert.match(dpi, /try \{[^\n]*\} catch \{ \}/, 'a missing shcore.dll falls back instead of failing');
  assert.match(REMOVER, /\[DllImport\("shcore\.dll"\)\] public static extern int GetDpiForMonitor\(IntPtr monitor, int type, out uint x, out uint y\);/);
  assert.match(REMOVER, /\[DllImport\("user32\.dll"\)\] public static extern IntPtr MonitorFromPoint\(POINT p, uint flags\);/);
  // the build compiles C# 5 (csc from the .NET Framework 4): no inline out variables, no ?. or string interpolation in the new code
  assert.doesNotMatch(dpi + between(REMOVER, 'static double CardScale', '\n  }\n') + between(REMOVER, 'public static POINT Pointer()', '\n'), /out (var|uint|int|POINT) |\?\.|\$"/);
});

test('the card\'s size and its place come from one reading of the pointer, so on two screens it never opens on one at the other\'s size', () => {
  const form = between(REMOVER, 'public RemoveForm(string dir, string real)', 'static double CardScale');
  const reads = form.match(/Pointer\(\)|GetCursorPos|MousePosition|Cursor\.Position/g) || [];
  assert.equal(reads.length, 1, 'the constructor reads the pointer once');
  // CenterScreen would read the pointer again when the window is created, after the four 1120 x 680 scenes have loaded
  assert.doesNotMatch(form, /FormStartPosition\.CenterScreen/);
  assert.match(form, /StartPosition = FormStartPosition\.Manual;/);
  const size = form.indexOf('ClientSize = new Size('), place = form.indexOf('var area = Screen.FromPoint(new Point(at.X, at.Y)).WorkingArea;');
  assert.ok(size >= 0 && place > size, 'placed after it is sized, on the screen at that same point');
  assert.match(form, /Location = new Point\(Math\.Max\(area\.X, area\.X \+ \(area\.Width - ClientSize\.Width\) \/ 2\), Math\.Max\(area\.Y, area\.Y \+ \(area\.Height - ClientSize\.Height\) \/ 2\)\);/, 'centred on that screen\'s working area, never off its top-left');
  // Screen.FromPoint and MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST) pick the same screen for the same point
  assert.match(REMOVER, /public static POINT Pointer\(\) \{ POINT p; if \(!GetCursorPos\(out p\)\) \{ p\.X = 0; p\.Y = 0; \} return p; \}/);
  assert.doesNotMatch(between(REMOVER, 'public static int ScreenDpi(POINT p)', '\n  }\n'), /GetCursorPos/, 'the DPI is measured at the point already read');
});

test('the uninstall card is the setup window\'s size on the same screen: one screen at 100-200%, a scale change, a second screen', () => {
  const rule = between(REMOVER, 'static double CardScale(int dpi) {', '\n  }\n');
  assert.match(rule, /int signIn = Math\.Max\(96, Native\.GetDeviceCaps\(dc, 88\)\);/, 'the setup\'s scene comes from the sign-in scale');
  assert.match(rule, /int pct = signIn \* 100 \/ 96; double setup = pct >= 175 \? 2\.0 : pct >= 125 \? 1\.5 : 1\.0;/, 'the setup\'s steps');
  assert.match(rule, /return setup \* Math\.Max\(96, dpi\) \/ signIn;/, 'stretched like the setup by this screen over the sign-in scale');
  // [sign-in %, screen %] -> what the person sees
  const cases = {
    'one screen, 100%': [[100, 100], [560, 340]], 'one screen, 125%': [[125, 125], [840, 510]], 'one screen, 150%': [[150, 150], [840, 510]],
    'one screen, 175%': [[175, 175], [1120, 680]], 'one screen, 200%': [[200, 200], [1120, 680]],
    'signed in at 100%, now 150% (no sign-out)': [[100, 150], [840, 510]], 'laptop 150%, second screen 100%': [[150, 100], [560, 340]],
    'laptop 150%, second screen 125%': [[150, 125], [700, 425]], 'laptop 100%, second screen 175%': [[100, 175], [980, 595]],
  };
  const dpi = (pct) => Math.round(pct * 96 / 100);
  for (const [name, [[signIn, screen], seen]] of Object.entries(cases)) {
    assert.deepEqual(setupOnScreen(dpi(signIn), dpi(screen)), seen, `setup window, ${name}`);
    assert.deepEqual(cardOnScreen(dpi(signIn), dpi(screen)), seen, `uninstall card, ${name}`);
  }
  assert.match(REMOVER, /ClientSize = new Size\(\(int\)Math\.Round\(W \* s\), \(int\)Math\.Round\(H \* s\)\);/);
  assert.deepEqual(/const int W = (\d+), H = (\d+);/.exec(between(REMOVER, 'class RemoveForm : Form', 'readonly string dir')).slice(1).map(Number), [CARD_W, CARD_H]);
  // the scenes are drawn at 2x (scripts/uninstall-art-main.cjs): up to the setup's largest scene (200%) they are only ever scaled down
  for (const scene of ['dark-base5.jpg', 'dark-base9.jpg']) {
    const jpg = fs.readFileSync(path.join(root, 'packaging', 'installer', 'uninstall', scene)); let k = 2, size = null;
    while (k < jpg.length - 9 && !size) { const marker = jpg[k + 1]; if (marker >= 0xc0 && marker <= 0xc2) size = [jpg.readUInt16BE(k + 7), jpg.readUInt16BE(k + 5)]; k += 2 + jpg.readUInt16BE(k + 2); }
    assert.deepEqual(size, [1120, 680], scene);
  }
});

test('the setup\'s Repair / Update / Open card is the size of the setup card it hands over to, on the primary screen where both are centred', () => {
  const CHOOSER = read('packaging', 'installer', 'AciraChoose.cs');
  const ctor = between(CHOOSER, 'ChooseForm(string dir, string version, string answerFile) {', '\n  }\n');
  assert.match(ctor, /s = RemoveForm\.CardScale\(Native\.ScreenDpi\(new Native\.POINT\(\)\)\);/, 'the uninstall card\'s rule, measured on the primary screen');
  assert.doesNotMatch(ctor, /GetDeviceCaps/, 'never the exact sign-in scale');
  assert.ok(ctor.indexOf('RemoveForm.CardScale(') < ctor.indexOf('ACIRA_UNINSTALL_SCALE'), 'the test-only preview scale still overrides it');
  assert.match(REMOVER, /\n  internal static double CardScale\(int dpi\) \{/, 'the rule is reachable from the chooser (both files build into one exe)');
  assert.match(read('scripts', 'build-installer-helper.cjs'), /build\('acira-uninstall\.exe','AciraUninstall\.cs',resources,\['AciraChoose\.cs'\]\);/);
  // (0, 0) is always the primary screen's top-left corner, and ScreenDpi asks the screen nearest the point
  assert.match(between(REMOVER, 'public static int ScreenDpi(POINT p)', '\n  }\n'), /GetDpiForMonitor\(MonitorFromPoint\(p, 2\), 0, out x, out y\)/);
  // both are centred on the primary screen: the chooser with its own size, the setup card (AcStyleBanner) with its own
  const size = ctor.indexOf('ClientSize = new Size((int)Math.Round(W * s), (int)Math.Round(H * s));'), place = ctor.indexOf('Location = new Point((Native.GetSystemMetrics(0) - ClientSize.Width) / 2, (Native.GetSystemMetrics(1) - ClientSize.Height) / 2);');
  assert.ok(size >= 0 && place > size, 'sized, then centred on the primary screen');
  assert.match(banner, /GetSystemMetrics\(i 0\) i \.r0'\s+System::Call 'user32::GetSystemMetrics\(i 1\) i \.r1'\s+IntOp \$0 \$0 - \$3\s+IntOp \$0 \$0 \/ 2/);
  assert.deepEqual(/const int W = (\d+), H = (\d+);/.exec(between(CHOOSER, 'class ChooseForm : Form', 'readonly string dir')).slice(1).map(Number), [CARD_W, CARD_H]);
  // [sign-in %, primary screen %] -> [the setup card on screen, the chooser before (the exact sign-in scale)]
  const before = (signIn) => { const s = Math.max(96, signIn) / 96; return [Math.round(CARD_W * s), Math.round(CARD_H * s)]; };
  const cases = {
    '100%': [[100, 100], [560, 340], [560, 340]], '125%': [[125, 125], [840, 510], [700, 425]], '150%': [[150, 150], [840, 510], [840, 510]],
    '175%': [[175, 175], [1120, 680], [980, 595]], '200%': [[200, 200], [1120, 680], [1120, 680]],
    'signed in at 100%, now 150% (no sign-out)': [[100, 150], [840, 510], [560, 340]], 'signed in at 150%, now 100%': [[150, 100], [560, 340], [840, 510]],
  };
  const dpi = (pct) => Math.round(pct * 96 / 100);
  for (const [name, [[signIn, primary], seen, old]] of Object.entries(cases)) {
    assert.deepEqual(setupOnScreen(dpi(signIn), dpi(primary)), seen, `setup card, ${name}`);
    assert.deepEqual(cardOnScreen(dpi(signIn), dpi(primary)), seen, `Repair / Update / Open card, ${name}`);
    assert.deepEqual(before(dpi(signIn)), old, `before, ${name}`);
  }
  // C# 5 (csc from the .NET Framework 4)
  assert.doesNotMatch(ctor, /out (var|uint|int|POINT) |\?\.|\$"/);
});

test('the uninstall card follows a move to a screen with another scale, and keeps its corners', () => {
  const proc = between(REMOVER, 'protected override void WndProc(ref Message m)', 'base.WndProc(ref m);');
  // lParam points at the RECT Windows suggests (left, top, right, bottom): taken whole, so the card never flips back at the screen edge
  assert.match(proc, /if \(m\.Msg == 0x02E0\) \{ IntPtr r = m\.LParam; int l = Marshal\.ReadInt32\(r, 0\), t = Marshal\.ReadInt32\(r, 4\); Bounds = new Rectangle\(l, t, Marshal\.ReadInt32\(r, 8\) - l, Marshal\.ReadInt32\(r, 12\) - t\);/, 'WM_DPICHANGED: the place and size Windows suggests');
  assert.ok(proc.indexOf('0x02E0') < proc.indexOf('0x84'), 'before the drag handling');
  // Windows suggests the current size times new DPI / old DPI; the card's rule is proportional to the screen's DPI, so that is the rule's size
  for (const signIn of [96, 120, 144, 168, 192]) for (const from of [96, 120, 144, 168, 192]) for (const to of [96, 120, 144, 168, 192]) {
    const [w, h] = cardOnScreen(signIn, from), suggested = [Math.round(w * to / from), Math.round(h * to / from)], rule = cardOnScreen(signIn, to);
    assert.ok(Math.abs(suggested[0] - rule[0]) <= 1 && Math.abs(suggested[1] - rule[1]) <= 1, `signed in at ${signIn}, ${from} -> ${to} DPI: Windows ${suggested}, rule ${rule}`);
  }
  const resize = REMOVER.split('\n').find((line) => line.includes('ClientSizeChanged +='));
  assert.match(resize, /double ns = ClientSize\.Width \/ \(double\)W;/, 'the layout scale follows the real size');
  assert.match(resize, /if \(IsHandleCreated\) Round\(\);/, 'Windows 10 corners (a window region) are cut again at the new size');
});

test('the NSIS uninstaller is DPI aware like the setup and shows the splash at the setup window\'s size; Windows draws its message boxes', () => {
  const manifest = read('packaging', 'installer', 'acira-helper.manifest');
  assert.match(manifest, /<dpiAware [^>]*>true\/pm<\/dpiAware>/);
  assert.match(manifest, /<dpiAwareness [^>]*>PerMonitorV2, PerMonitor<\/dpiAwareness>/);
  assert.match(manifest, /requestedExecutionLevel level="asInvoker"/);
  assert.match(read('scripts', 'build-installer-helper.cjs'), /'\/win32manifest:'\+path\.join\(dir,'acira-helper\.manifest'\)/);
  // electron-builder compiles the include twice; the uninstaller is written by the -DBUILD_UNINSTALLER pass, with that pass's manifest
  for (const qa of [false, true]) for (const uninstaller of [false, true]) {
    const lines = compiled({ uninstaller, qa });
    assert.equal(lines.filter((line) => /^ManifestDPIAware/i.test(line)).join(), 'ManifestDPIAware true', `${uninstaller ? 'uninstaller' : 'setup'}${qa ? ' (QA)' : ''}: DPI aware for the sign-in scale, like the setup`);
    assert.equal(lines.filter((line) => /SetProcessDPIAware|SetProcessDpiAwareness|SetThreadDpiAwarenessContext|ManifestDPIAwareness/i.test(line)).length, 0, 'nothing else changes how Windows scales it');
  }
  // the splash picks its picture with the setup's steps, from the same sign-in scale
  const init = between(NSH, '!macro customUnInit', '!macroend');
  assert.match(init, /System::Call 'gdi32::GetDeviceCaps\(p R6, i 88\) i \.R5'/);
  assert.match(init, /\$\{If\} \$R5 < 96\s+StrCpy \$R5 96\s+\$\{EndIf\}\s+IntOp \$R5 \$R5 \* 100\s+IntOp \$R5 \$R5 \/ 96/);
  const picks = [...init.matchAll(/\$\{(?:Else)?If\} \$R5 >= (\d+)\s+File "\/oname=\$PLUGINSDIR\\ac-un-dark\.bmp" "\$\{BUILD_RESOURCES_DIR\}\\installer\\uninstall-dark-(\d+)\.bmp"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(picks.sort((a, b) => a[0] - b[0]), SETUP_STEPS, 'the same steps as AcStyleBanner');
  assert.match(init, /\$\{Else\}\s+File "\/oname=\$PLUGINSDIR\\ac-un-dark\.bmp" "\$\{BUILD_RESOURCES_DIR\}\\installer\\uninstall-dark-100\.bmp"/);
  assert.match(init, /Push \$R5\s+Push \$R6[\s\S]*Pop \$R6\s+Pop \$R5/, 'registers kept');
  assert.deepEqual(bmpSize('uninstall-dark-100.bmp'), [560, 340]);
  assert.deepEqual(bmpSize('uninstall-dark-150.bmp'), [840, 510]);
  assert.deepEqual(bmpSize('uninstall-dark-200.bmp'), [1120, 680]);
  // the 150 and 200% pictures are the 100% picture (no new art): the 200% one averaged back down 2 x 2 is the 100% one
  const pixels = (name) => { const b = fs.readFileSync(path.join(root, 'packaging', 'installer', name)); const w = b.readInt32LE(18), h = b.readInt32LE(22), row = Math.ceil(w * 3 / 4) * 4; return { w, h, at: (x, y, c) => b[b.readUInt32LE(10) + y * row + x * 3 + c] }; };
  const one = pixels('uninstall-dark-100.bmp'), two = pixels('uninstall-dark-200.bmp'); let sum = 0, n = 0;
  for (let y = 0; y < one.h; y += 3) for (let x = 0; x < one.w; x += 3) for (let c = 0; c < 3; c++) {
    const down = (two.at(2 * x, 2 * y, c) + two.at(2 * x + 1, 2 * y, c) + two.at(2 * x, 2 * y + 1, c) + two.at(2 * x + 1, 2 * y + 1, c)) / 4;
    sum += Math.abs(down - one.at(x, y, c)); n++;
  }
  assert.ok(sum / n < 3, `same picture (mean difference ${(sum / n).toFixed(2)} of 255)`);
  // the data question and the stock "Are you sure" are Windows' own message boxes: nothing in the uninstaller resizes a window
  const un = compiled({ uninstaller: true }).join('\n');
  assert.doesNotMatch(between(un, '!macro customUnInit', '!macroend') + between(un, '!macro customUnInstall', '!macroend'), /SetWindowPos|MoveWindow|WM_SETFONT|0x0030/);
});

test('uninstalling still opens the branded card; the NSIS uninstaller keeps its splash and data question when run directly', () => {
  const install = between(NSH, '!macro customInstall', '!macroend');
  assert.ok(install.includes('File "/oname=$INSTDIR\\AciraRemove.exe" "${BUILD_RESOURCES_DIR}\\installer\\acira-uninstall.exe"'));
  assert.ok(install.includes('WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString \'"$INSTDIR\\AciraRemove.exe" /currentuser\''));
  assert.doesNotMatch(install, /WriteRegStr[^\n]*QuietUninstallString/, 'the quiet (updater) path stays the real uninstaller');
  const init = between(NSH, '!macro customUnInit', '!macroend');
  assert.match(init, /\$\{GetOptions\} \$R0 "\/S" \$R1\s+\$\{If\} \$\{Errors\}/, 'the splash only when not silent');
  assert.match(init, /advsplash::show 1600 200 300 -1 "\$PLUGINSDIR\\\$R2"/);
  const uninstall = between(NSH, '!macro customUnInstall', '!macroend');
  assert.match(uninstall, /Call un\.AcUsageUninstalled[\s\S]*MessageBox MB_YESNO/, 'the usage message first, then the data question');
  const config = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.include, 'packaging/acira-installer.nsh');
});
