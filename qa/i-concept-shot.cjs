// Renders a stream-I concept page at a fixed size in Electron and saves PNGs (full + half) for each hash state.
// node_modules/electron/dist/electron.exe qa/i-concept-shot.cjs <concept.html> <outDir> <w>x<h> "<hash>" ["<hash>" …]
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const [file, outDir, size, ...states] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
// I_SCALE=1.5 renders at 150% device scale (Windows 150% display scaling).
if (process.env.I_SCALE) app.commandLine.appendSwitch("force-device-scale-factor", process.env.I_SCALE);
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(outDir, "half"), { recursive: true });
  const win = new BrowserWindow({ width, height, show: false, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false } });
  for (const [index, state] of states.entries()) {
    // A query per state forces a fresh document (a hash-only change would not rerun the page script).
    await win.loadURL("file:///" + path.resolve(file).replace(/\\/g, "/") + "?n=" + index + "#" + state);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const image = await win.webContents.capturePage();
    const name = state.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "welcome";
    fs.writeFileSync(path.join(outDir, name + ".png"), image.toPNG());
    fs.writeFileSync(path.join(outDir, "half", name + ".png"), image.resize({ width: Math.round(width / 2), quality: "best" }).toPNG());
    console.log("shot", name);
  }
  app.quit();
});
