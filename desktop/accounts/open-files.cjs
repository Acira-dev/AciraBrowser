"use strict";

// Files macOS hands to the app by name: one dropped on the Dock icon, "Open With", a double-click on an .html file (the HTML
// document type the app's Info.plist declares). Electron raises 'open-file' for them, on a cold start before the app is ready,
// and a file nobody listens for is dropped without a word. They wait here until the browser can take them (bind), the same way
// external links do (external-links.cjs); what may open is decided by the handler, like a file dropped on the window.
const path = require("node:path");

function createOpenFileIntake({ app, onError = () => {}, maxQueued = 16 }) {
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
    },
  };
}
module.exports = { createOpenFileIntake };
