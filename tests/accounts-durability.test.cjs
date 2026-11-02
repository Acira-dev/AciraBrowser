"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture } = require("./accounts-helpers.cjs");
const { OnboardingStore } = require("../desktop/accounts/onboarding.cjs");
const { createSetupService } = require("../desktop/accounts/setup.cjs");

test("failed progress commit rolls back memory and retains the last durable setup step", (t) => {
  const f = fixture(t),
    store = new OnboardingStore(f);
  store.status("local-a");
  const before = fs.readFileSync(store.file, "utf8");
  store.save = () => {
    throw new Error("Synthetic disk-write failure");
  };
  assert.throws(() =>
    store.update("local-a", { complete: true, step: "finish" }),
  );
  assert.equal(store.status("local-a").complete, false);
  assert.equal(store.status("local-a").step, "welcome");
  assert.equal(fs.readFileSync(store.file, "utf8"), before);
});
test("unreadable setup progress is detected before native preference/profile side effects", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, "onboarding.json"), "invalid JSON");
  let writes = 0;
  const service = createSetupService(f),
    context = {
      profileId: "local-a",
      privateMode: false,
      updateSettings: () => {
        writes++;
      },
      createProfile: () => {
        writes++;
      },
    };
  const result = await service.command(
    { type: "preferences", patch: { appearance: "dark" } },
    context,
  );
  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});
test("structured corrupt progress cannot masquerade as completed setup", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.directory, "onboarding.json"),
    JSON.stringify({
      version: 2,
      installation: {
        step: "welcome",
        complete: "false",
        skipped: false,
        upgraded: false,
      },
      profiles: [],
    }),
  );
  const result = await createSetupService(f).command(
    { type: "status" },
    { profileId: "local-a", privateMode: false },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ONBOARDING_UNAVAILABLE");
});
test("failed initial save is retried instead of cached as durable progress", (t) => {
  const store = new OnboardingStore(fixture(t)),
    save = store.save.bind(store);
  store.save = () => {
    throw new Error("Synthetic first-write failure");
  };
  assert.throws(() => store.status("fresh-profile"));
  assert.equal(Object.hasOwn(store.data.profiles, "fresh-profile"), false);
  store.save = save;
  assert.equal(store.status("fresh-profile").complete, false);
  assert.equal(fs.existsSync(store.file), true);
});
test("a committed import remains reviewable when its progress marker cannot be saved", async (t) => {
  const f = fixture(t),
    rows = [],
    filename = path.join(f.directory, "onboarding.json");
  const importer = {
    discover: () => [],
    batches: () => rows,
    run: () => {
      const batch = {
        id: "committed-batch",
        results: [{ category: "bookmarks", status: "imported", count: 1 }],
      };
      rows.push(batch);
      fs.unlinkSync(filename);
      fs.mkdirSync(filename);
      return batch;
    },
  };
  const service = createSetupService(f),
    context = { profileId: "local-a", privateMode: false, importer };
  const result = await service.command(
    {
      type: "imports.run",
      sourceId: "synthetic-source",
      categories: ["bookmarks"],
    },
    context,
  );
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error.message, /data is unchanged/);
  const review = await service.command({ type: "imports.discover" }, context);
  assert.equal(review.ok, true);
  assert.equal(review.progress.importInterrupted, true);
  assert.equal(review.batches[0].id, "committed-batch");
});
