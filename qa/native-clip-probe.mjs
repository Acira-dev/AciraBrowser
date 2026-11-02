// Does a parent View with setBorderRadius clip a WebContentsView child on this Electron (R7 page corners)? The page can only have one
// radius for all four corners (WebContentsView.setBorderRadius); a clipping container whose bounds run past the corners that must
// stay square would give per-corner shapes. This puts a solid green page in a WebContentsView inside such a View, in the test
// window of an isolated Acira, and reads the real composited pixels (desktopCapturer window source, this window only):
//   A. the child alone with setBorderRadius(24)                      -> corners must be cut (control)
//   B. the child (no radius) inside a parent View with radius 24     -> are the corners cut?
//   C. as B, parent view also with a background colour               -> does a coloured parent change it?
//   D. B with the child's own radius 24 and the parent's 0           -> control for the child path
// Prints one line per case: how many px of the green are missing at the top-left corner's first row (0 = square, ~20 = rounded 24).
//   node qa/native-clip-probe.mjs
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

await withSlot('native-clip-probe', async () => {
  const app = await startApp({root: `.qa-profiles/native-clip-${Date.now()}`});
  try {
    const display = await app.main(({screen}) => { const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay(); const d = all.find(x => x.id !== primary.id) || primary; return {x: d.workArea.x, y: d.workArea.y, scale: d.scaleFactor}; });
    const bounds = {x: display.x + 60, y: display.y + 40, width: 1200, height: 800};
    await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
    await sleep(1200);
    const result = await app.main(async ({BaseWindow, View, WebContentsView, desktopCapturer, screen}) => {
      const w = BaseWindow.getAllWindows()[0], sf = screen.getDisplayMatching(w.getBounds()).scaleFactor, sleep = ms => new Promise(r => setTimeout(r, ms));
      const html = 'data:text/html,<body style="margin:0;background:%2300ff00"></body>';
      const make = async (box, setup) => {
        const parent = new View(), child = new WebContentsView({webPreferences: {sandbox: true}});
        await child.webContents.loadURL(html);
        setup({parent, child, box});
        parent.addChildView(child); w.contentView.addChildView(parent);
        return {parent, child};
      };
      const cases = {};
      const at = {A: {x: 100, y: 300}, B: {x: 450, y: 300}, C: {x: 800, y: 300}, D: {x: 100, y: 600}};
      const R = 24, W = 240, H = 160;
      const built = [];
      built.push(['A', await make(at.A, ({parent, child}) => { parent.setBounds({x: at.A.x, y: at.A.y, width: W, height: H}); child.setBounds({x: 0, y: 0, width: W, height: H}); child.setBorderRadius(R); })]);
      built.push(['B', await make(at.B, ({parent, child}) => { parent.setBounds({x: at.B.x, y: at.B.y, width: W, height: H}); parent.setBorderRadius(R); child.setBounds({x: 0, y: 0, width: W, height: H}); })]);
      built.push(['C', await make(at.C, ({parent, child}) => { parent.setBounds({x: at.C.x, y: at.C.y, width: W, height: H}); parent.setBorderRadius(R); parent.setBackgroundColor('#ff0000'); child.setBounds({x: 0, y: 0, width: W, height: H}); })]);
      built.push(['D', await make(at.D, ({parent, child}) => { parent.setBounds({x: at.D.x, y: at.D.y, width: W, height: H}); child.setBounds({x: 0, y: 0, width: W, height: H}); child.setBorderRadius(R); })]);
      await sleep(1500);
      const b = w.getBounds(), sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * sf), height: Math.round(b.height * sf)}});
      const mine = sources.find(x => x.id === w.getMediaSourceId());
      if (!mine || mine.thumbnail.isEmpty()) return {error: 'no capture'};
      const img = mine.thumbnail, size = img.getSize(), bmp = img.toBitmap(), k = size.width / b.width;
      const green = (x, y) => { const i = (y * size.width + x) * 4; return bmp[i + 1] > 200 && bmp[i + 2] < 80 && bmp[i] < 80; };
      for (const [name] of built) {
        const o = at[name], x0 = Math.round(o.x * k), y0 = Math.round(o.y * k);
        // first green pixel on the first row, on the row 3px down, and the centre check
        const first = row => { let n = 0; while (n < 200 && !green(x0 + n, y0 + row)) n++; return n; };
        cases[name] = {firstRow: first(0), row3: first(3), row12: first(12), centre: green(x0 + Math.round(W * k / 2), y0 + Math.round(H * k / 2))};
      }
      for (const [, {parent}] of built) w.contentView.removeChildView(parent);
      return {scale: sf, cases};
    });
    console.log('[native-clip-probe]', JSON.stringify(result));
    console.log('A control (child radius 24): the corner is cut when firstRow is well above 0.');
    console.log('B parent radius 24 and a square child: the corner is cut only if the parent clips its child.');
  } finally { try { await app.close(); } catch {} }
});
