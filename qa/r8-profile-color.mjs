// Profile circles after the palette fix: toolbar, new tab, sidebar and the profile panel, light/dark, real window pixels.
// node qa/native-slot.mjs r8-profile-color -- node qa/r8-profile-color.mjs --theme=dark|light
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, sleep } from './d-harness.mjs';
const theme = (process.argv.find(a => a.startsWith('--theme=')) || '--theme=dark').slice(8);
const out = path.resolve('qa/artifacts/r8-profile-color'); await fs.mkdir(out, { recursive: true });
const app = await startApp({ root: '.qa-profiles/r8-profile-color' });
try {
  await app.ui.emulateMedia({ colorScheme: theme });
  for (const name of ['Work', 'Studio', 'Family']) await app.act({ type: 'browser.profile.create', name });
  await sleep(600);
  const snap = await app.state();
  console.log(snap.browserProfiles.map(p => `${p.name} ${p.color}`).join(' | '));
  // An old grey profile (hand-edited data) must still draw a palette colour.
  await app.act({ type: 'browser.profile.update', id: snap.browserProfiles[2].id, color: '#62666d' });
  await app.act({ type: 'tab.new' }); await sleep(1500);
  const shot = async name => {
    const b64 = await app.main(async ({ BaseWindow, desktopCapturer, screen }) => {
      const win = BaseWindow.getAllWindows().filter(w => w.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
      const b = win.getBounds(), sf = screen.getDisplayMatching(b).scaleFactor;
      const s = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(b.width * sf), height: Math.round(b.height * sf) } })).find(i => i.id === win.getMediaSourceId());
      return s && !s.thumbnail.isEmpty() ? s.thumbnail.toPNG().toString('base64') : '';
    });
    await fs.writeFile(path.join(out, `${name}-${theme}.png`), b64 ? Buffer.from(b64, 'base64') : await app.ui.screenshot()); console.log('shot', name);
  };
  await shot('newtab');
  const trigger = app.ui.locator('.nt-workspace-profile, [aria-label*="rofile"]').first();
  try { await trigger.click({ timeout: 4000 }); await sleep(1200); await shot('panel'); } catch (e) { console.log('panel skipped', String(e.message).split('\n')[0]); }
} finally { await app.close(); }
