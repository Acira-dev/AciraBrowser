"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createSetupService } = require("../desktop/accounts/setup.cjs");
const {
  OnboardingStore,
  createDefaultBrowserService,
  pageIndex,
  steps,
} = require("../desktop/accounts/onboarding.cjs");
const { fixture } = require("./accounts-helpers.cjs");
const context = { profileId: "local-a", privateMode: false };

test("fresh local setup resumes after restart and skipped setup never replays for a new profile", async (t) => {
  const f = fixture(t);
  let service = createSetupService(f);
  assert.equal(
    (await service.command({ type: "status" }, context)).progress.step,
    "welcome",
  );
  await service.command({ type: "move", direction: 1 }, context);
  service = createSetupService(f);
  assert.equal(
    (await service.command({ type: "status" }, context)).progress.step,
    steps[1],
  );
  await service.command({ type: "skip" }, context);
  service = createSetupService(f);
  assert.equal(
    (await service.command({ type: "status" }, context)).progress.complete,
    true,
  );
  assert.equal(
    (
      await service.command(
        { type: "status" },
        { ...context, profileId: "new-profile" },
      )
    ).progress.complete,
    true,
  );
});
test("existing installations preserve settings/profiles and do not replay setup", async (t) => {
  let changed = 0;
  const service = createSetupService({
    ...fixture(t),
    existingInstallation: true,
  });
  const response = await service.command(
    { type: "status" },
    { ...context, updateSettings: () => changed++ },
  );
  assert.equal(response.progress.complete, true);
  assert.equal(response.progress.upgraded, true);
  assert.equal(changed, 0);
});
test("Helium-derived traversal clamps endpoints and skips already-default browser", () => {
  assert.equal(steps.includes("account"), false);
  assert.equal(pageIndex(0, -1), 0);
  const last = steps.length - 1,
    skipDefault = (step) => step === "default",
    at = steps.indexOf("default");
  assert.equal(pageIndex(last, 1), last);
  assert.equal(pageIndex(at - 1, 1, skipDefault), at + 1);
  assert.equal(pageIndex(at + 1, -1, skipDefault), at - 1);
});
test("setup preferences use only narrow native settings and reflect canonical actual values", async (t) => {
  const settings = {
    appearance: "system",
    searchEngine: "google",
    addressSuggestions: true,
    blocking: true,
  };
  const service = createSetupService(fixture(t)),
    ctx = {
      ...context,
      readSettings: () => settings,
      updateSettings: (value) => Object.assign(settings, value),
    };
  const response = await service.command(
    {
      type: "preferences",
      patch: {
        appearance: "dark",
        searchEngine: "duckduckgo",
        blocking: false,
      },
    },
    ctx,
  );
  assert.equal(response.ok, true);
  assert.deepEqual(response.preferences, { ...settings });
  assert.equal(
    (
      await service.command(
        { type: "preferences", patch: { onboardingComplete: false } },
        ctx,
      )
    ).ok,
    false,
  );
});
test("create local profile delegates canonical native action and returns no cookie/partition identity", async (t) => {
  const profiles = [
    {
      id: "local-a",
      name: "Personal",
      color: "#553344",
      partition: "persist:secret",
      cookies: "sensitive",
    },
  ];
  const service = createSetupService(fixture(t)),
    ctx = {
      ...context,
      getProfiles: () => profiles,
      createProfile: (name) =>
        profiles.push({ id: "local-b", name, color: "#444444" }),
    };
  assert.equal(
    (await service.command({ type: "profiles.create", name: "Work" }, ctx)).ok,
    true,
  );
  const response = await service.command({ type: "status" }, ctx);
  assert.equal(response.profiles.length, 2);
  assert.doesNotMatch(
    JSON.stringify(response),
    /persist:|cookies|sensitive|connected/,
  );
  assert.equal(
    (await service.command({ type: "profiles.create", name: "  " }, ctx)).ok,
    false,
  );
});
test("import delegates capability/results/undo and records interruption without automatic retry", async (t) => {
  const f = fixture(t);
  let imported = 0,
    undone = 0;
  const batch = {
    id: "batch-a",
    results: [
      { category: "bookmarks", status: "imported", count: 2 },
      { category: "extensions", status: "inventory", count: 1 },
    ],
  };
  const importer = {
    discover: () => [{ id: "source-a", available: { bookmarks: true } }],
    batches: () => [],
    preview: () => ({ warnings: ["Close source browser for locked history."] }),
    run: () => {
      imported++;
      return batch;
    },
    undo: () => {
      undone++;
      return { undone: true };
    },
  };
  let service = createSetupService(f),
    ctx = { ...context, importer };
  assert.equal(
    (await service.command({ type: "imports.discover" }, ctx)).sources.length,
    1,
  );
  const response = await service.command(
    {
      type: "imports.run",
      sourceId: "source-a",
      categories: ["bookmarks", "extensions"],
    },
    ctx,
  );
  assert.equal(response.batch.results[1].status, "inventory");
  assert.deepEqual(response.progress.importBatchIds, ["batch-a"]);
  await service.command({ type: "imports.undo", batchId: "batch-a" }, ctx);
  assert.equal(undone, 1);
  importer.run = () => {
    imported++;
    throw Error("interrupted");
  };
  assert.equal(
    (
      await service.command(
        {
          type: "imports.run",
          sourceId: "source-a",
          categories: ["bookmarks"],
        },
        ctx,
      )
    ).ok,
    false,
  );
  service = createSetupService(f);
  assert.equal(
    (await service.command({ type: "status" }, ctx)).progress.importInterrupted,
    true,
  );
  assert.equal(imported, 2);
});
test("setup rejects private/prototype/unexpected/cloud commands and duplicate import categories", async (t) => {
  const service = createSetupService(fixture(t));
  for (const request of [
    null,
    [],
    { type: "status", token: "bad" },
    { type: "auth.requestCode", email: "a@b.test" },
    { type: "sync.run" },
    { type: "account.delete" },
    { type: "move", direction: 2 },
  ])
    assert.equal((await service.command(request, context)).ok, false);
  assert.equal(
    (
      await service.command(
        { type: "status" },
        { ...context, privateMode: true },
      )
    ).error.code,
    "PRIVATE_CONTEXT",
  );
  assert.equal(
    (
      await service.command(
        {
          type: "imports.run",
          sourceId: "a",
          categories: ["bookmarks", "bookmarks"],
        },
        { ...context, importer: {} },
      )
    ).ok,
    false,
  );
});
test("all setup steps work with no account, provider, network or OS key store", async (t) => {
  const service = createSetupService({ directory: fixture(t).directory });
  for (let index = 0; index < 5; index++)
    assert.equal(
      (await service.command({ type: "move", direction: 1 }, context)).ok,
      true,
    );
  const response = await service.command({ type: "finish" }, context);
  assert.equal(response.progress.complete, true);
  assert.doesNotMatch(JSON.stringify(response), /supabase|sync|token|email/i);
});
test("default request opens actual Windows OS settings and never invents confirmation", async () => {
  let opened;
  const service = createDefaultBrowserService({
    app: { isPackaged: true, isDefaultProtocolClient: () => false },
    shell: {
      openExternal: async (value) => {
        opened = value;
      },
    },
    platform: "win32",
    windowsBuild: 19045,
    getRegistration: () => ({ hive: "HKCU", name: "Acira Browser" }),
  });
  const result = await service.request();
  assert.equal(opened, "ms-settings:defaultapps");
  assert.equal(result.requested, true);
  assert.equal(result.isDefault, false);
  const dev = createDefaultBrowserService({
    app: { isPackaged: false },
    shell: {
      openExternal() {
        throw Error();
      },
    },
  });
  assert.equal((await dev.request()).requested, false);
});
test("local import progress is profile-scoped while completion is installation-wide", (t) => {
  const f = fixture(t),
    store = new OnboardingStore(f);
  store.update("a", { importBatchIds: ["batch-a"], complete: true });
  assert.deepEqual(store.status("b").importBatchIds, []);
  assert.equal(store.status("b").complete, true);
});
test("corrupt setup storage never resets existing browser data", (t) => {
  const f = fixture(t),
    store = new OnboardingStore(f);
  store.status("a");
  require("node:fs").writeFileSync(store.file, "broken");
  assert.throws(
    () => new OnboardingStore(f).status("a"),
    (error) => error.code === "ONBOARDING_UNAVAILABLE",
  );
});
test("explicit restart is local, preserves per-profile import evidence and never resets settings", async (t) => {
  let writes = 0;
  const service = createSetupService({
      ...fixture(t),
      existingInstallation: true,
    }),
    ctx = {
      ...context,
      updateSettings() {
        writes++;
      },
    };
  await service.command({ type: "restart" }, ctx);
  const response = await service.command({ type: "status" }, ctx);
  assert.equal(response.progress.complete, false);
  assert.equal(response.progress.step, "welcome");
  assert.equal(writes, 0);
});
test("HTML import has a real native chooser contract, truthful cancellation and persistent undo labels", async (t) => {
  const f = fixture(t),
    batch = {
      id: "html-batch",
      results: [{ category: "bookmarks", status: "imported", count: 1 }],
    };
  let cancel = true,
    runs = 0;
  const importer = {
    discover: () => [],
    batches: () => (runs ? [batch] : []),
    importHTML: async () => {
      if (cancel) return { cancelled: true };
      runs++;
      return { batch };
    },
    undo: async () => ({ undone: true }),
  };
  let service = createSetupService(f);
  const ctx = { ...context, importer };
  let result = await service.command({ type: "imports.html" }, ctx);
  assert.equal(result.cancelled, true);
  assert.equal(result.progress.importInterrupted, false);
  assert.equal(runs, 0);
  cancel = false;
  result = await service.command({ type: "imports.html" }, ctx);
  assert.equal(result.batch.id, batch.id);
  assert.equal(result.batches[0].undone, false);
  await service.command({ type: "imports.undo", batchId: batch.id }, ctx);
  service = createSetupService(f);
  assert.equal(
    (await service.command({ type: "imports.discover" }, ctx)).batches[0]
      .undone,
    true,
  );
  assert.equal(
    (
      await service.command(
        { type: "imports.html", path: "/untrusted/path" },
        ctx,
      )
    ).ok,
    false,
  );
});
