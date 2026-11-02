"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  commandMatches,
  findWindowsRegistration,
  findWindowsRegistrationAsync,
  createDefaultBrowserService,
} = require("../desktop/accounts/default-browser.cjs");
const executable =
  "C:\\Users\\Fixture\\Programs\\Acira Browser\\AciraBrowser.exe";
function registry({
  hive = "HKCU",
  wrongExecutable = false,
  missingHTTPS = false,
} = {}) {
  const values = new Map([
    [
      hive + "|Software\\RegisteredApplications|Acira Browser",
      "Software\\Clients\\StartMenuInternet\\AciraBrowser\\Capabilities",
    ],
    [
      hive +
        "|Software\\Clients\\StartMenuInternet\\AciraBrowser\\Capabilities\\URLAssociations|http",
      "AciraBrowserURL",
    ],
    ...(missingHTTPS
      ? []
      : [
          [
            hive +
              "|Software\\Clients\\StartMenuInternet\\AciraBrowser\\Capabilities\\URLAssociations|https",
            "AciraBrowserURL",
          ],
        ]),
    [
      "HKCR|AciraBrowserURL\\shell\\open\\command|",
      '"' +
        (wrongExecutable ? "C:\\Other\\AciraBrowser.exe" : executable) +
        '" "%1"',
    ],
  ]);
  return (scope, key, name) =>
    values.get(scope + "|" + key + "|" + (name || "")) || null;
}
test("registration requires both web schemes and merged launch command matching this executable", () => {
  assert.deepEqual(findWindowsRegistration({ executable, read: registry() }), {
    hive: "HKCU",
    name: "Acira Browser",
  });
  assert.deepEqual(
    findWindowsRegistration({ executable, read: registry({ hive: "HKLM" }) }),
    { hive: "HKLM", name: "Acira Browser" },
  );
  assert.equal(
    findWindowsRegistration({
      executable,
      read: registry({ wrongExecutable: true }),
    }),
    null,
  );
  assert.equal(
    findWindowsRegistration({
      executable,
      read: registry({ missingHTTPS: true }),
    }),
    null,
  );
});
test("command matching rejects unquoted paths with spaces, missing URL input and another Acira project", () => {
  assert.equal(commandMatches('"' + executable + '" "%1"', executable), true);
  assert.equal(commandMatches(executable + ' "%1"', executable), false);
  assert.equal(commandMatches('"' + executable + '"', executable), false);
  assert.equal(
    commandMatches('"C:\\Other\\AciraBrowser.exe" "%1"', executable),
    false,
  );
  assert.equal(
    commandMatches(
      '"%LOCALAPPDATA%\\Programs\\Acira Browser\\AciraBrowser.exe" "%1"',
      executable,
      { LOCALAPPDATA: "C:\\Users\\Fixture" },
    ),
    true,
  );
});
test("portable packaged app remains honest and never opens Settings without registration", async () => {
  let opened = 0;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => false },
    platform: "win32",
    getRegistration: () => null,
    shell: {
      openExternal() {
        opened++;
      },
    },
  });
  assert.equal(service.status().supported, false);
  assert.match(service.status().note, /registration.*not confirmed/);
  assert.equal((await service.request()).requested, false);
  assert.equal(opened, 0);
});
test("installed per-user app targets its actual native chooser and never claims immediate confirmation", async () => {
  let uri;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => false },
    platform: "win32",
    windowsBuild: 22631,
    getRegistration: () => ({ hive: "HKCU", name: "Acira Browser" }),
    shell: {
      async openExternal(value) {
        uri = value;
      },
    },
  });
  const result = await service.request();
  assert.equal(
    uri,
    "ms-settings:defaultapps?registeredAppUser=Acira%20Browser",
  );
  assert.equal(result.requested, true);
  assert.equal(result.isDefault, false);
});
test("machine registration targets machine chooser and real default check remains authoritative", async () => {
  let uri,
    selected = false;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => selected },
    platform: "win32",
    windowsBuild: 22631,
    getRegistration: () => ({ hive: "HKLM", name: "Acira Browser" }),
    shell: {
      async openExternal(value) {
        uri = value;
      },
    },
  });
  await service.request();
  assert.equal(
    uri,
    "ms-settings:defaultapps?registeredAppMachine=Acira%20Browser",
  );
  selected = true;
  assert.equal(service.status().isDefault, true);
  assert.equal((await service.request()).requested, false);
});
test("development builds and unavailable registry status do not require an account or alter OS defaults", async () => {
  const dev = createDefaultBrowserService({
    app: { isPackaged: false },
    platform: "win32",
    getRegistration() {
      throw Error();
    },
    shell: {
      openExternal() {
        throw Error();
      },
    },
  });
  assert.equal((await dev.request()).requested, false);
  const unavailable = createDefaultBrowserService({
    app: {
      isPackaged: true,
      isDefaultProtocolClient() {
        throw Error();
      },
    },
    platform: "win32",
    getRegistration() {
      throw Error();
    },
    shell: {},
  });
  assert.equal(unavailable.status().statusKnown, false);
  assert.equal(unavailable.status().supported, false);
});
test("older Windows builds use the supported generic chooser after registration is proven", async () => {
  let uri;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => false },
    shell: {
      async openExternal(value) {
        uri = value;
      },
    },
    platform: "win32",
    windowsBuild: 19045,
    getRegistration: () => ({ hive: "HKCU", name: "Acira Browser" }),
  });
  assert.equal((await service.request()).requested, true);
  assert.equal(uri, "ms-settings:defaultapps");
});

test("the async registration lookup gives the same answers as the sync one", async () => {
  const asyncRead = (options) => {
    const read = registry(options);
    return async (...args) => read(...args);
  };
  for (const options of [{}, { hive: "HKLM" }, { wrongExecutable: true }, { missingHTTPS: true }])
    assert.deepEqual(
      await findWindowsRegistrationAsync({ executable, read: asyncRead(options) }),
      findWindowsRegistration({ executable, read: registry(options) }),
    );
});
test("status never waits on the registry: it answers from the last lookup, warmed at creation", async () => {
  let resolve;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => false },
    platform: "win32",
    getRegistration: () => new Promise((done) => (resolve = done)),
    shell: { async openExternal() {} },
  });
  assert.equal(service.status().supported, false);
  resolve({ hive: "HKCU", name: "Acira Browser" });
  await new Promise((done) => setImmediate(done));
  assert.equal(service.status().supported, true);
});
