"use strict";

// Files macOS hands to the app by name: one dropped on the Dock icon, "Open With", a double-click on an .html file (the HTML
// document type the app's Info.plist declares). Electron raises 'open-file' for them, on a cold start before the app is ready,
// and a file nobody listens for is dropped without a word. They wait here until the browser can take them (bind), the same way
// external links do (external-links.cjs); what may open is decided by the handler, like a file dropped on the window.
const fs = require("node:fs");
const path = require("node:path");

// What a browser tab can show from a file on this computer (dropped on the window, chosen with Open a file, named by the system). main.cjs openDroppedFile checks again.
const FILE_KINDS = new Set([".pdf",".png",".jpg",".jpeg",".gif",".webp",".avif",".bmp",".svg",".ico",".txt",".md",".csv",".json",".log",".html",".htm",".xhtml",".mp3",".wav",".ogg",".oga",".m4a",".flac",".opus",".mp4",".m4v",".webm",".ogv",".mov"]);

/** The files a command line names. Windows and Linux hand a file to a program by name as an argument ("Open with", a file dropped on the program's icon), as a second start
 * of an Acira that is already running as well as a first. Only absolute paths to files of a kind a tab can show; flags, web addresses and the program's own path are not files. */
function filesFromArgv(args, { exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } } } = {}) {
  if (!Array.isArray(args)) return [];
  const found = [];
  for (const arg of args) {
    if (typeof arg !== "string" || !arg || arg.length > 4096 || arg.startsWith("-") || /[\u0000-\u001f]/.test(arg)) continue;
    if (!path.isAbsolute(arg) || !FILE_KINDS.has(path.extname(arg).toLowerCase()) || found.includes(arg) || !exists(arg)) continue;
    found.push(arg);
  }
  return found;
}

function createOpenFileIntake({ app, onError = () => {}, maxQueued = 16, argv = [], platform = process.platform, exists }) {
  const pending = [];
  let handler,
    running = null,
    disposed = false;
  function drain() {
    if (!handler || disposed) return Promise.resolve();
    if (running) return running;
    running = Promise.resolve()
      .then(async () => {
        while (handler && pending.length && !disposed) {
          const file = pending.shift();
          try {
            await handler(file);
          } catch {
            try {
              onError("A file could not be opened.");
            } catch {}
          }
        }
      })
      .finally(() => {
        running = null;
        if (handler && pending.length && !disposed) void drain();
      });
    return running;
  }
  const openFile = (event, file) => {
    if (typeof file !== "string" || file.length > 4096 || !path.isAbsolute(file)) return;
    event.preventDefault();
    if (pending.length < maxQueued) pending.push(file);
    void drain();
  };
  app.on("open-file", openFile);
  // Windows and Linux: the file comes in the command line, at a first start and as the second start's arguments of an Acira already running (macOS says it with 'open-file').
  const take = (args) => {
    let count = 0;
    for (const file of filesFromArgv(args, exists ? { exists } : undefined)) if (pending.length < maxQueued) { pending.push(file); count++; }
    if (count) void drain();
    return count;
  };
  const secondInstance = (_event, args) => { take(args); };
  if (platform !== "darwin") {
    app.on("second-instance", secondInstance);
    take(argv);
  }
  return {
    bind(fn) {
      if (typeof fn !== "function") throw new TypeError("Open-file handler required");
      handler = fn;
      return drain();
    },
    get pending() {
      return pending.length;
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      handler = undefined;
      app.removeListener("open-file", openFile);
      app.removeListener("second-instance", secondInstance);
    },
  };
}
module.exports = { createOpenFileIntake, filesFromArgv, FILE_KINDS };
