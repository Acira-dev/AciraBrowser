"use strict";

// Register app/open-url synchronously before app.ready, as required by Electron
// 44.7's deep-link lifecycle. Only ordinary web addresses enter browser state.
function parseExternalURLs(argv) {
  if (!Array.isArray(argv)) return [];
  const found = [],
    seen = new Set();
  for (const argument of argv) {
    if (
      typeof argument !== "string" ||
      argument.length > 8192 ||
      /[\u0000-\u0020\u007f]/.test(argument) ||
      !/^https?:\/\//i.test(argument)
    )
      continue;
    let parsed;
    try {
      parsed = new URL(argument);
    } catch {
      continue;
    }
    if (
      !parsed.hostname ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > 8192 ||
      seen.has(parsed.href)
    )
      continue;
    seen.add(parsed.href);
    found.push(parsed.href);
  }
  return found;
}

function createExternalLinkIntake({
  app,
  argv = process.argv,
  onActivate = () => {},
  onError = () => {},
  // Launches another part of the app owns (an installed web app's shortcut): their URLs are not links to open.
  ignore = () => false,
  maxQueued = 64,
}) {
  if (!Number.isInteger(maxQueued) || maxQueued < 1 || maxQueued > 64)
    throw new TypeError("Invalid external-link queue limit");
  const pending = [];
  let handler,
    running = null,
    disposed = false;
  const report = (message) => {
    try {
      onError(message);
    } catch {}
  };
  function drain() {
    if (!handler || disposed) return Promise.resolve();
    if (running) return running;
    running = Promise.resolve()
      .then(async () => {
        while (handler && pending.length && !disposed) {
          const url = pending.shift();
          try {
            await handler(url);
          } catch {
            report("An external link could not be opened.");
          }
        }
      })
      .finally(() => {
        running = null;
        if (handler && pending.length && !disposed) void drain();
      });
    return running;
  }
  function enqueue(args) {
    if (disposed) return 0;
    let count = 0;
    for (const url of parseExternalURLs(args)) {
      if (pending.length >= maxQueued) {
        report("Some external links could not be queued.");
        break;
      }
      pending.push(url);
      count++;
    }
    void drain();
    return count;
  }
  function restorePending(args, beforeCommit) {
    const rejected = () => {
      throw Error(
        "Startup links could not be restored into the pending queue.",
      );
    };
    if (
      disposed ||
      handler ||
      running ||
      typeof beforeCommit !== "function" ||
      !Array.isArray(args) ||
      args.length > maxQueued ||
      pending.length + args.length > maxQueued
    )
      return rejected();
    const restored = [];
    try {
      for (const value of args) {
        // One event at a time: equal URLs may be legitimate repeated events.
        const parsed = parseExternalURLs([value]);
        if (parsed.length !== 1 || parsed[0] !== value) return rejected();
        restored.push(parsed[0]);
      }
    } catch {
      return rejected();
    }
    // The native gate consumes its protected file only after full validation.
    // A synchronous consume failure cannot partially modify this one queue.
    try {
      beforeCommit();
    } catch {
      return rejected();
    }
    pending.unshift(...restored);
    return restored.length;
  }
  const secondInstance = (_event, args) => {
    if (ignore(args)) return;
    if (!enqueue(args)) {
      try {
        onActivate();
      } catch {}
    }
  };
  const openURL = (event, url) => {
    if (enqueue([url])) event.preventDefault();
  };
  app.on("second-instance", secondInstance);
  app.on("open-url", openURL);
  if (!ignore(argv)) enqueue(argv);
  return {
    enqueue,
    restorePending,
    bind(fn) {
      if (typeof fn !== "function")
        throw new TypeError("External-link handler required");
      handler = fn;
      return drain();
    },
    flush: drain,
    get pending() {
      return pending.length;
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      handler = undefined;
      app.removeListener("second-instance", secondInstance);
      app.removeListener("open-url", openURL);
    },
  };
}
module.exports = { parseExternalURLs, createExternalLinkIntake };
