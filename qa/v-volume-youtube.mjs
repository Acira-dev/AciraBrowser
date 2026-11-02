// The sidebar media card's volume slider on a real YouTube video (no sign-in, isolated profile). The page's own <video> volume is what
// is checked. Opens the slider with a synthetic click, drags it to 30% and reads every <video>/<audio> element's volume in every frame of
// the tab (expect 0.3), then drags to 0 and checks the tab is muted.
// Silence: --mute-audio can't be used (with it Chromium never reports the tab audible, so the card, which only shows for a tab that
// plays sound, never appears: R5-05 sweep). Instead the run requires the PC's default speakers to be muted already, checks that before
// and after (read-only; it never changes the system volume) and refuses to start otherwise.
// Timing: on a fresh profile YouTube's player (and its <video>) can take 25-30 s to appear, so the run waits for the element first, then
// starts it from the page with a user-gesture script (and the consent wall, if any, is answered "Reject all").
// The window is placed outside every display (never on someone's screen), synthetic input only.
//   node qa/v-volume-youtube.mjs [url]     one native slot, evidence under V_EVIDENCE (default C:/ae/r5/sweep/volume-youtube)
import './live-google-gate.mjs'; import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {startApp, sleep, poll} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const URL_ = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const EVIDENCE = process.env.V_EVIDENCE || 'C:/ae/r5/sweep/volume-youtube';
await fs.mkdir(EVIDENCE, {recursive: true});
process.env.D_VISIBLE = '1';
const rows = [];
const check = (ok, label, detail = '') => { rows.push({ok: !!ok, label, detail: String(detail)}); console.log(ok ? 'PASS' : 'FAIL', label, detail ? '- ' + String(detail).slice(0, 300) : ''); };
// Read-only: is the default playback device muted (Core Audio IAudioEndpointVolume::GetMute)?
const speakersMuted = () => {
  const ps = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume { int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10(); int f11(); int f12(); int GetMute(out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int f1(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class SpeakerMute { public static bool Read() { var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); var g = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref g, 23, IntPtr.Zero, out o)); bool m; Marshal.ThrowExceptionForHR(((IAudioEndpointVolume)o).GetMute(out m)); return m; } }
'@
[SpeakerMute]::Read()`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {encoding: 'utf8', timeout: 30000});
  return /^True\s*$/m.test(r.stdout || '');
};
if (!speakersMuted()) { console.log('FAIL the default speakers are not muted: this run plays a real video with sound, so it only runs while they are muted'); process.exit(2); }
check(true, 'default speakers are muted before the run (read only)');
const slot = await takeSlot('v-volume-youtube');
let h;
try {
  h = await startApp({root: `.qa-profiles/vyt-${Date.now()}`, args: ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']});
  const {ui} = h;
  await h.main(({BaseWindow, screen}) => { const minX = Math.min(...screen.getAllDisplays().map(d => d.bounds.x)); const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: minX - 1300, y: 60, width: 1100, height: 720}); w.showInactive(); });
  try { await ui.getByRole('button', {name: 'Done', exact: true}).click({timeout: 2500}); } catch {}
  await h.act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, verticalTabs: true}});
  await h.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}});
  const before = (await h.state()).tabs.length;
  await h.act({type: 'tab.new', url: URL_});
  const tabId = await poll(async () => { const s = await h.state(); return s.tabs.length === before + 1 ? s.tabs.find(t => /youtube\.com/.test(t.url))?.id : null; }, Boolean, 'youtube tab', 20000);
  const inTab = (code, gesture = false) => h.main(async ({webContents}, {code, gesture}) => {
    const wc = webContents.getAllWebContents().find(w => /youtube\.com/.test(w.getURL())); if (!wc) return null;
    const out = []; for (const f of wc.mainFrame.framesInSubtree) { try { out.push({url: f.url.slice(0, 80), value: await f.executeJavaScript(code, gesture)}); } catch (e) { out.push({url: f.url.slice(0, 80), error: e.message}); } }
    return out;
  }, {code, gesture});
  const media = () => inTab("[...document.querySelectorAll('video,audio')].map(e => ({tag: e.tagName.toLowerCase(), volume: e.volume, muted: e.muted, paused: e.paused, src: (e.currentSrc || '').slice(0, 40)}))");
  // Consent wall (EU): the most private choice, "Reject all", if it shows; then wait for the player's <video> (slow on a fresh profile).
  const REJECT = "(() => { const b = [...document.querySelectorAll('button')].find(b => /reject all/i.test(b.textContent || b.getAttribute('aria-label') || '')); if (b) { b.click(); return 'rejected'; } return 'none'; })()";
  const hasVideo = async () => (await inTab("Boolean(document.querySelector('video'))"))?.some(f => f.value === true);
  let consentDone = false;
  const videoAt = Date.now();
  await poll(async () => {
    if (!consentDone && JSON.stringify(await inTab(REJECT, true)).includes('rejected')) { consentDone = true; check(true, 'consent wall answered Reject all'); }
    return hasVideo();
  }, Boolean, 'player <video> element', 75000);
  check(true, 'the player <video> element is there', `${Math.round((Date.now() - videoAt) / 1000)} s after the first check`);
  // Start it from the page with a user gesture (autoplay may be held back); repeat while the tab is not yet reported playing.
  const PLAY = "(async () => { const v = document.querySelector('video'); if (!v) return 'no video'; if (!v.paused) return 'already playing'; try { await v.play(); return 'played'; } catch (e) { return 'play failed: ' + e.name; } })()";
  let lastPlay = 0;
  const playing = await poll(async () => {
    if (Date.now() - lastPlay > 5000) { lastPlay = Date.now(); await inTab(PLAY, true); }
    return (await h.state()).tabs.find(t => t.id === tabId)?.media;
  }, v => v === 'playing', 'media playing', 40000).catch(e => e.message);
  check(playing === 'playing', 'YouTube video plays (tab media state)', playing);
  await poll(() => ui.evaluate(id => Boolean(document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)), tabId), Boolean, 'media card', 10000);
  check(true, 'sidebar media card appears for the YouTube tab');
  const shot = async name => { const file = path.join(EVIDENCE, name + '.png'); await ui.screenshot({path: file}); return file; };
  await shot('1-card');
  const centre = sel => ui.evaluate(({id, sel}) => { const r = document.querySelector(`.sb-media-row[data-media-tab="${id}"] ${sel}`).getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, width: r.width}; }, {id: tabId, sel});
  const isOpen = () => ui.evaluate(id => document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)?.hasAttribute('data-volume'), tabId);
  const sliderNow = () => ui.evaluate(id => Number(document.querySelector(`.sb-media-row[data-media-tab="${id}"] [role=slider]`)?.getAttribute('aria-valuenow')), tabId);
  const railAt = async fraction => { const r = await centre('.sb-media-vol-rail'); return {x: r.left + 6 + (r.width - 12) * fraction, y: r.y}; };
  // The slider opens with a morph (the rail grows): measure only once its box has stopped changing, or the drag lands short (R5-05: 27 for 30).
  const settled = async () => { let last = ''; for (let i = 0; i < 40; i++) { const r = await centre('.sb-media-vol-rail'); const now = r.left.toFixed(1) + ' ' + r.width.toFixed(1); if (now === last) return; last = now; await sleep(80); } };
  const tabMuted = async () => ({snapshot: !!(await h.state()).tabs.find(t => t.id === tabId)?.muted, native: await h.main(({webContents}) => webContents.getAllWebContents().find(w => /youtube\.com/.test(w.getURL()))?.isAudioMuted())});
  check(true, 'media before', JSON.stringify(await media()));
  const s = await centre('.sb-media-speaker'); await ui.mouse.click(s.x, s.y);
  await poll(isOpen, Boolean, 'slider open', 3000); await settled(); check(true, 'slider opens from a synthetic click on the speaker');
  let p = await railAt(.6); await ui.mouse.move(p.x, p.y); await ui.mouse.down();
  p = await railAt(.3); await ui.mouse.move(p.x, p.y, {steps: 6}); await sleep(500);
  const at30 = await sliderNow(), m30 = await media();
  const vols = m30.flatMap(f => (f.value || []).map(e => e.volume));
  check(Math.abs(at30 - 30) <= 1, 'slider reads 30', at30);
  check(vols.length > 0 && vols.every(v => Math.abs(v - at30 / 100) < 0.006), 'every <video>/<audio> in every frame follows (expect 0.3)', JSON.stringify(m30));
  await shot('2-slider-30');
  await ui.mouse.up(); await sleep(1500);
  const later = (await media()).flatMap(f => (f.value || []).map(e => e.volume));
  check(later.length > 0 && later.every(v => Math.abs(v - at30 / 100) < 0.006), 'volume stays at 0.3 after release (YouTube does not reset it)', JSON.stringify(later));
  if (!(await isOpen())) { const s2 = await centre('.sb-media-speaker'); await ui.mouse.click(s2.x, s2.y); await poll(isOpen, Boolean, 'slider open again', 3000); await settled(); }
  p = await railAt(.3); await ui.mouse.move(p.x, p.y); await ui.mouse.down();
  p = await railAt(-0.2); await ui.mouse.move(p.x, p.y, {steps: 5}); await sleep(500);
  const m0 = await tabMuted(), at0 = await sliderNow();
  check(at0 === 0 && m0.snapshot && m0.native, 'dragging to 0 mutes the tab', `slider ${at0}, muted ${JSON.stringify(m0)}, media ${JSON.stringify(await media())}`);
  await shot('3-slider-0-muted');
  await ui.mouse.up();
} catch (error) {
  check(false, 'run', error.stack || error.message);
} finally {
  try { await h?.close(); } catch {}
  try { h?.app.process().kill(); } catch {}
  await releaseSlot(slot);
}
check(speakersMuted(), 'default speakers still muted after the run (read only)');
await fs.writeFile(path.join(EVIDENCE, 'results.json'), JSON.stringify(rows, null, 2));
const failed = rows.filter(r => !r.ok).length;
console.log(failed ? `FAIL ${failed} of ${rows.length}` : `PASS ${rows.length} checks`);
process.exit(failed ? 1 : 0);
