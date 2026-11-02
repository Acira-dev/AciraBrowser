"use strict";
// Observation plus one deterministic cancelled-Quit barrier. The actual product
// owns every parser, queue, protected handoff, bootstrap, controller and session.
const fs = require("node:fs"),
  path = require("node:path");
const { app, BaseWindow, webContents } = require("electron");
const {
  FLAG,
} = require("../desktop/browser-services/encryption-bootstrap.cjs");
const data = path.resolve(process.env.ACIRA_BROWSER_TEST_DATA || "");
const nonce = process.env.ACIRA_ACCOUNTS_STARTUP_NONCE;
if (
  !nonce ||
  process.env.ACIRA_BROWSER_TEST_HIDDEN !== "1" ||
  !data.startsWith(path.resolve(".qa-profiles/accounts-startup-product-"))
)
  throw Error("Owned hidden startup fixture required");
const owner = process.argv.includes("--accounts-startup-owner=" + nonce);
let barrier = false,
  openEmitted = false,
  quitting = false;
const write = (name, value) =>
  fs.writeFileSync(
    path.join(data, name + ".json"),
    JSON.stringify({ nonce, pid: process.pid, ...value }),
  );
app.on("before-quit", (event) => {
  if (
    owner &&
    !process.argv.includes(FLAG) &&
    fs.existsSync(path.join(data, "startup-links.bin")) &&
    !fs.existsSync(path.join(data, "release.signal"))
  ) {
    event.preventDefault();
    barrier = true;
    write("barrier", {
      windows: BaseWindow.getAllWindows().length,
      contents: webContents.getAllWebContents().length,
      protected: !fs
        .readFileSync(path.join(data, "startup-links.bin"))
        .includes(Buffer.from("http://127.0.0.1")),
    });
  }
});
require("../desktop/main.cjs");
app.on("quit", () => {
  if (owner) write("exit-" + process.pid, { normal: true });
});
const timer = setInterval(() => {
  if (!owner) return;
  if (
    barrier &&
    !openEmitted &&
    fs.existsSync(path.join(data, "open.signal"))
  ) {
    openEmitted = true;
    let prevented = false;
    app.emit(
      "open-url",
      {
        preventDefault() {
          prevented = true;
        },
      },
      process.env.ACIRA_ACCOUNTS_OPEN_URL,
    );
    write("open-event", { prevented });
  }
  if (barrier && fs.existsSync(path.join(data, "release.signal"))) {
    barrier = false;
    app.quit();
  }
  if (!quitting && fs.existsSync(path.join(data, "quit.signal"))) {
    quitting = true;
    app.quit();
  }
  if (app.isReady() && !barrier)
    write("observed", {
      windows: BaseWindow.getAllWindows().length,
      hidden: BaseWindow.getAllWindows().every((window) => !window.isVisible()),
      httpArgCount: process.argv.filter((value) => /^https?:\/\//i.test(value))
        .length,
      handoffRemoved: !fs.existsSync(path.join(data, "startup-links.bin")),
      resumed: process.argv.includes(FLAG),
      runtime: process.versions.electron,
    });
}, 30);
timer.unref();
