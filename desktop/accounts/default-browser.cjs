"use strict";
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
// "Acira Browser", or "Acira Browser QA" in a QA build (its own registration: desktop/build-identity.cjs).
const REGISTERED_APPLICATION = require("../build-identity.cjs").registeredApplication;
const { tm } = require("../tm.cjs");

// Where other browsers install their executables (and the icon lookup built on it) lives in browser-icons.cjs.
const { browserExecutables, createBrowserIcons } = require("../browser-services/browser-icons.cjs");

// Registration metadata only. Never reads or writes protected UserChoice values.
const registryHives = ["HKCU", "HKLM", "HKCR"];
const registryArgs = (hive, key, name) => ["query", hive + "\\" + key, ...(name === undefined ? ["/ve"] : ["/v", name])];
const registryValue = (output) => /REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/.exec(output)?.[1].trim() || null;
function readRegistryString(hive, key, name) {
  if (process.platform !== "win32" || !registryHives.includes(hive)) return null;
  try {
    return registryValue(
      execFileSync("reg.exe", registryArgs(hive, key, name), {
        encoding: "utf8",
        windowsHide: true,
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}
/** The same read without blocking the main process: each `reg.exe` spawn costs ~70ms, which froze every window when
 * these ran synchronously at the first setup step (B's main-process profile, 24 Oct). */
function readRegistryStringAsync(hive, key, name) {
  if (process.platform !== "win32" || !registryHives.includes(hive)) return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile("reg.exe", registryArgs(hive, key, name), { encoding: "utf8", windowsHide: true, timeout: 1500 }, (error, output) =>
      resolve(error ? null : registryValue(output)),
    ),
  );
}
function normalizedExecutable(value, env = process.env) {
  return path.win32
    .normalize(
      value.replace(
        /%([a-zA-Z0-9_]+)%/g,
        (match, name) => env[name] || env[name.toUpperCase()] || match,
      ),
    )
    .replace(/^\\\\\?\\/, "")
    .toLowerCase();
}
function commandMatches(command, executable, env) {
  if (typeof command !== "string" || /[\r\n\0]/.test(command)) return false;
  const match =
    /^"([^"]+)"(.*)$/.exec(command) || /^([^\s"]+)(.*)$/.exec(command);
  return (
    !!match &&
    /%[1L](?:["\s]|$)/i.test(match[2]) &&
    normalizedExecutable(match[1], env) ===
      normalizedExecutable(executable, env)
  );
}
function findWindowsRegistration({
  executable,
  name = REGISTERED_APPLICATION,
  read = readRegistryString,
  env = process.env,
}) {
  if (
    typeof executable !== "string" ||
    !executable ||
    typeof name !== "string" ||
    !name ||
    /[\r\n\0]/.test(name)
  )
    return null;
  for (const hive of ["HKCU", "HKLM"]) {
    const capabilities = read(hive, "Software\\RegisteredApplications", name);
    if (
      typeof capabilities !== "string" ||
      !/^Software\\/i.test(capabilities) ||
      capabilities.length > 600 ||
      /[\r\n\0]/.test(capabilities)
    )
      continue;
    const associations = ["http", "https"].map((protocol) =>
      read(hive, capabilities + "\\URLAssociations", protocol),
    );
    if (
      associations.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_.-]{1,120}$/.test(id),
      )
    )
      continue;
    if (
      associations.every((id) =>
        commandMatches(
          read("HKCR", id + "\\shell\\open\\command"),
          executable,
          env,
        ),
      )
    )
      return { hive, name };
  }
  return null;
}
/** findWindowsRegistration with an async reader: the same checks, with the reads of each hive in parallel. */
async function findWindowsRegistrationAsync({
  executable,
  name = REGISTERED_APPLICATION,
  read = readRegistryStringAsync,
  env = process.env,
}) {
  if (typeof executable !== "string" || !executable || typeof name !== "string" || !name || /[\r\n\0]/.test(name))
    return null;
  const found = await Promise.all(
    ["HKCU", "HKLM"].map(async (hive) => {
      const capabilities = await read(hive, "Software\\RegisteredApplications", name);
      if (
        typeof capabilities !== "string" ||
        !/^Software\\/i.test(capabilities) ||
        capabilities.length > 600 ||
        /[\r\n\0]/.test(capabilities)
      )
        return null;
      const associations = await Promise.all(["http", "https"].map((protocol) => read(hive, capabilities + "\\URLAssociations", protocol)));
      if (associations.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_.-]{1,120}$/.test(id))) return null;
      const commands = await Promise.all(associations.map((id) => read("HKCR", id + "\\shell\\open\\command")));
      return commands.every((command) => commandMatches(command, executable, env)) ? { hive, name } : null;
    }),
  );
  return found[0] || found[1] || null;
}
function createDefaultBrowserService({
  app,
  shell,
  platform = process.platform,
  registeredAppName = REGISTERED_APPLICATION,
  // May return the registration or a promise of it. The default reads the registry asynchronously, so status() never
  // blocks the main process: it answers from the last lookup and refreshes in the background (warmed at creation).
  getRegistration = () =>
    findWindowsRegistrationAsync({
      executable: app.getPath("exe"),
      name: registeredAppName,
    }),
  now = Date.now,
  browserIconLookup,
  windowsBuild = require("../windows-version.cjs").currentBuild({ platform }),
}) {
  let registration = null,
    checkedAt = -Infinity,
    lookup = null;
  const iconLookup = browserIconLookup || createBrowserIcons({ app, platform });
  const accept = (found) => {
    registration =
      found && ["HKCU", "HKLM"].includes(found.hive) && found.name === registeredAppName
        ? { hive: found.hive, name: found.name }
        : null;
    checkedAt = now();
  };
  /** Look the registration up again; resolves when the answer is in (at once for a synchronous getter). */
  function refresh() {
    if (platform !== "win32" || !app.isPackaged) return Promise.resolve();
    if (lookup) return lookup;
    let found;
    try {
      found = getRegistration();
    } catch {
      accept(null);
      return Promise.resolve();
    }
    if (!found || typeof found.then !== "function") {
      accept(found);
      return Promise.resolve();
    }
    lookup = found.then(accept, () => accept(null)).finally(() => (lookup = null));
    return lookup;
  }
  function registered(force = false) {
    if (platform !== "win32" || !app.isPackaged) return null;
    if (force || now() - checkedAt >= 5000) void refresh();
    return registration;
  }
  // Prefetch the registration a little after startup; status() and registered() refresh it on demand anyway.
  setTimeout(() => void refresh(), 4000).unref?.();
  function status() {
    let isDefault = false,
      statusKnown = true;
    if (app.isPackaged)
      try {
        isDefault =
          app.isDefaultProtocolClient("http") &&
          app.isDefaultProtocolClient("https");
      } catch {
        statusKnown = false;
      }
    const installed = registered(),
      supported =
        !!app.isPackaged && (platform !== "win32" || !!installed || isDefault);
    const note = !app.isPackaged
      ? tm("defaultbrowser.noteDevelopmentRun")
      : !supported
        ? tm("defaultbrowser.noteUnregistered")
        : !statusKnown
          ? tm("defaultbrowser.noteUnknown")
          : isDefault
            ? tm("defaultbrowser.noteIsDefault")
            : tm("defaultbrowser.noteChoose");
    return { supported, isDefault, statusKnown, note };
  }
  /** Data URLs of installed browsers' own icons, keyed by browser name; browsers that aren't installed are omitted. The
   * lookup is shared (main hands the same one to Settings' import list), so each browser's file is read once per session. */
  function browserIcons(names) {
    return iconLookup.icons(names).catch(() => ({}));
  }
  async function request() {
    await refresh();
    const current = status();
    if (!current.supported || current.isDefault)
      return { ...current, requested: false };
    if (platform === "win32") {
      const key =
        registration?.hive === "HKLM"
          ? "registeredAppMachine"
          : "registeredAppUser";
      const uri =
        registration && require("../windows-version.cjs").supportsDefaultAppsDeepLink(windowsBuild)
          ? "ms-settings:defaultapps?" +
            key +
            "=" +
            encodeURIComponent(registration.name)
          : "ms-settings:defaultapps";
      await shell.openExternal(uri);
      return { ...status(), requested: true };
    }
    const http = app.setAsDefaultProtocolClient("http"),
      https = app.setAsDefaultProtocolClient("https");
    return { ...status(), requested: http || https };
  }
  /** Setup's import step shows installed browsers' icons; reading them spawns registry queries, so only a first run warms them up early. */
  function warmIcons() {
    if (platform === "win32") setTimeout(() => void browserIcons(), 0);
  }
  return { status, browserIcons, warmIcons, request };
}
module.exports = {
  REGISTERED_APPLICATION,
  browserExecutables,
  readRegistryString,
  commandMatches,
  findWindowsRegistration,
  findWindowsRegistrationAsync,
  readRegistryStringAsync,
  createDefaultBrowserService,
};
