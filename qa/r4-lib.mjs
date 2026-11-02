// Round 4 (vpn-proxy) shared QA helpers: native slot, evidence + result rows, a fake-VPN provider boundary, setup navigation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {sleep} from './d-harness.mjs';

export const EVIDENCE = process.env.R4_EVIDENCE || (process.platform === 'win32' ? 'C:/ae/r4/vpn-proxy/evidence' : path.resolve('qa/artifacts/r4/vpn-proxy/evidence'));
await fs.mkdir(EVIDENCE, {recursive: true});

/** One native slot (C:\ae\slot-N.lock, flag wx), released by the returned function. Waits up to 20 minutes. */
export async function takeSlot(name) {
  const root = process.platform === 'win32' ? 'C:/ae' : path.resolve('.qa-profiles/native-slots');
  await fs.mkdir(root, {recursive: true});
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) {
      try { const h = await fs.open(path.join(root, `slot-${n}.lock`), 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return () => fs.rm(path.join(root, `slot-${n}.lock`), {force: true}); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot free');
}

/** Result rows: control | surface | result | evidence. Printed as they come, written to results.json by finish(). */
export function results(file) {
  const rows = [];
  const row = (control, surface, ok, evidence) => { rows.push({control, surface, result: ok ? 'PASS' : 'FAIL', evidence: String(evidence ?? '')}); console.log(ok ? 'PASS' : 'FAIL', `[${surface}]`, control, '-', String(evidence ?? '').slice(0, 260)); };
  const finish = async () => { await fs.writeFile(path.join(EVIDENCE, file), JSON.stringify(rows, null, 2)); return rows.every(r => r.result === 'PASS'); };
  return {rows, row, finish};
}

/** Real pixels of the browser interface (what the person sees), not a synthetic DOM render. */
export async function shot(app, name) {
  const png = await app.main(async ({webContents}) => {
    const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
    const image = await ui.capturePage(); return image.toPNG().toString('base64');
  });
  const file = path.join(EVIDENCE, name + '.png'); await fs.writeFile(file, Buffer.from(png, 'base64')); return file;
}

/** A frame strip of one region: runs `capturePage(rect)` in a burst while `during()` happens (a click), then lays the frames out in
 *  one PNG (rows of 6, 3x enlarged, each labelled with its time in ms). Returns the file and the frame times. */
export async function strip(app, ui, rect, name, during) {
  const burst = app.main(async ({webContents}, rect) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'), frames = [], t0 = Date.now();
    while (frames.length < 24 && Date.now() - t0 < 3500) { const image = await wc.capturePage(rect); frames.push({t: Date.now() - t0, png: image.toPNG().toString('base64')}); }
    return frames;
  }, rect);
  await sleep(120); await during();
  const frames = await burst;
  const sheet = await ui.evaluate(async ({frames, w, h}) => {
    const load = src => new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
    const images = await Promise.all(frames.map(f => load('data:image/png;base64,' + f.png)));
    const scale = 3, cols = 6, rows = Math.ceil(images.length / cols), cw = w * scale, ch = h * scale + 20;
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch; const g = c.getContext('2d');
    g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false; g.font = '14px sans-serif';
    images.forEach((img, i) => { const x = (i % cols) * cw, y = Math.floor(i / cols) * ch; g.drawImage(img, x, y + 20, cw, h * scale); g.fillStyle = '#fff'; g.fillText(frames[i].t + ' ms', x + 6, y + 14); });
    return c.toDataURL('image/png').split(',')[1];
  }, {frames, w: rect.width, h: rect.height});
  const file = path.join(EVIDENCE, name + '.png'); await fs.writeFile(file, Buffer.from(sheet, 'base64'));
  return {file, times: frames.map(f => f.t)};
}

/** Answers Acira's own confirm window ("Use http://… for this profile?") the way a person does: real mouse input on its button.
 *  The window is a separate webContents, found in the main process; the click is `sendInputEvent` mouse down/up at the button's centre
 *  (an off-screen or unfocused window starves Playwright's own click, and the page list does not always show the window).
 *  When no window can host the confirm, the native-box stub (globalThis.__dialogs) answers instead. Bounded; null when nothing asked. */
export async function answerConfirm(app, buttonName, {within = 10000, evidence, baseline: given} = {}) {
  const baseline = given ?? await app.main(() => globalThis.__dialogs.length), end = Date.now() + within;
  while (Date.now() < end) {
    const asked = await app.main(async ({webContents}, name) => {
      const wc = webContents.getAllWebContents().find(w => { try { return !w.isDestroyed() && w.getURL().includes('native-dialog.html'); } catch { return false; } });
      if (!wc) return null;
      // A hidden or closing dialog never answers: give it 700 ms, then treat it as not there yet.
      const info = await Promise.race([new Promise(resolve => setTimeout(() => resolve({x: null, text: ''}), 700)), wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(name)}), r = b && b.getBoundingClientRect(); return {text: document.body.innerText, x: r && r.width ? r.x + r.width / 2 : null, y: r ? r.y + r.height / 2 : null, visible: document.visibilityState}; })()`)]);
      if (info.x == null || !/for this profile/.test(info.text)) return {ready: false};
      return {ready: true, info, wcId: wc.id};
    }, buttonName).then(value => value, () => null);
    if (asked?.ready) {
      if (evidence) await app.main(async ({webContents}, [id, file]) => { const wc = webContents.fromId(id), image = await wc.capturePage(); require('node:fs').writeFileSync(file, image.toPNG()); }, [asked.wcId, evidence]).catch(() => {});
      await app.main(({webContents}, [id, x, y]) => { const wc = webContents.fromId(id); wc.focus(); wc.sendInputEvent({type: 'mouseMove', x, y}); wc.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1}); wc.sendInputEvent({type: 'mouseUp', x, y, button: 'left', clickCount: 1}); }, [asked.wcId, asked.info.x, asked.info.y]);
      return {kind: 'in-app confirm window', text: asked.info.text};
    }
    if (await app.main(() => globalThis.__dialogs.length) > baseline) { const last = await app.main(() => globalThis.__dialogs.at(-1)); return {kind: 'native box (stubbed)', text: last.message + ' ' + (last.detail || '')}; }
    await sleep(120);
  }
  // Nothing asked in time: say what exists, so a missing confirm can be told from a harness miss.
  const diag = await Promise.race([app.main(({webContents, BaseWindow}) => ({
    contents: webContents.getAllWebContents().filter(w => !w.isDestroyed()).map(w => w.getURL().slice(-48)),
    windows: BaseWindow.getAllWindows().map(w => ({id: w.id, visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), bounds: w.getBounds()})),
  })), sleep(3000).then(() => 'main did not answer')]).catch(String);
  console.log('NO CONFIRM FOUND', buttonName, JSON.stringify(diag).slice(0, 900));
  return null;
}

/** Puts a fake VPN provider boundary under the app's Connection controls: Mullvad and IVPN installed (CLI), Proton absent until
 *  "installed". It speaks the providers' real CLI output formats, so the app's own parsers and gates are exercised; no real provider,
 *  tunnel or account is touched. Control it from the test with app.main(() => globalThis.__vpn). */
export async function installFakeVpn(app, vpnModule) {
  await app.main((_electron, moduleFile) => {
    const module = process.getBuiltinModule('module').createRequire(moduleFile)(moduleFile);
    const root = 'C:\\Program Files';
    const fixture = globalThis.__vpn = {
      files: new Set([root + '\\Mullvad VPN\\resources\\mullvad.exe', root + '\\Mullvad VPN\\Mullvad VPN.exe', root + '\\IVPN Client\\cli\\ivpn.exe', root + '\\IVPN Client\\ui\\IVPN Client.exe']),
      states: {mullvad: 'disconnected', ivpn: 'disconnected'}, calls: [], opened: [],
    };
    const service = module.createVpnControl({
      platform: 'win32', env: {ProgramW6432: root},
      files: {
        readdirSync: () => ['4.10.1'], realpathSync: file => file,
        lstatSync: file => { if (!fixture.files.has(file)) throw Error('ENOENT'); return {dev: 1, ino: 1, size: 10, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false}; },
      },
      verify: async () => true,
      run: async (file, args) => {
        if (!fixture.files.has(file) || !/(mullvad|ivpn)\.exe$/.test(file)) throw Error('Unexpected executable ' + file);
        const provider = file.endsWith('mullvad.exe') ? 'mullvad' : 'ivpn';
        fixture.calls.push({provider, args: args.join(' ')});
        if (args[0] === 'connect') fixture.states[provider] = 'connected';
        if (args[0] === 'disconnect') fixture.states[provider] = 'disconnected';
        const state = fixture.states[provider];
        return {ok: true, stdout: provider === 'mullvad' ? JSON.stringify({state}) : `VPN : ${state.toUpperCase()}\nFirewall : Disabled\n`};
      },
      openApp: async file => { fixture.opened.push(file); return ''; },
    });
    module.sharedVpnControl = () => service;
  }, vpnModule);
}

/** Setup: press Continue until the Privacy step's Connection row is on screen (never accepts default-browser or account prompts). */
export async function reachPrivacy(ui, {light = false} = {}) {
  const row = ui.locator('.fr-card-main button.fr-row').filter({has: ui.locator('b').filter({hasText: /^Connection$/})});
  let picked = false;
  for (let step = 0; step < 9 && !await row.count(); step++) {
    // "Choose a look": the first card is Light.
    if (light && !picked && await ui.locator('.fr-look').count()) { await ui.locator('.fr-look').nth(0).click(); picked = true; await sleep(900); }
    await ui.locator('[data-onboarding-next]').filter({visible: true}).first().click(); await sleep(700);
  }
  if (!await row.count()) throw new Error('Privacy step not reached');
  return row;
}
