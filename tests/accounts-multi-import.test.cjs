"use strict";
// Setup's multi-account import: each chosen browser profile can become its own Acira profile (named, colored and pictured
// from it, with its data imported into it), marked for a short setup the first time it is opened.
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createSetupService, importedProfileName } = require("../desktop/accounts/setup.cjs");
const { fixture } = require("./accounts-helpers.cjs");

test("a profile made from a source takes its name, or the browser's for a placeholder, and never repeats one", () => {
  assert.equal(importedProfileName({ browser: "Chrome", name: "Work" }, ["Personal"]), "Work");
  assert.equal(importedProfileName({ browser: "Firefox", name: "Default" }, ["Personal"]), "Firefox");
  assert.equal(importedProfileName({ browser: "Edge", name: "Person 1" }, []), "Edge");
  assert.equal(importedProfileName({ browser: "Chrome", name: "Personal" }, ["personal"]), "Personal · Chrome");
  assert.equal(importedProfileName({ browser: "Chrome", name: "Personal" }, ["Personal", "Personal · Chrome"]), "Personal 2");
});

test("profiles.fromSource creates a pictured profile marked for a short setup; imports can target it; profile.ready clears the mark", async (t) => {
  const f = fixture(t);
  const profiles = [{ id: "local-a", name: "Personal", color: "#62666d", partition: "persist:a" }];
  const created = [], runs = [];
  const source = { id: "source-work", browser: "Chrome", name: "Work", email: "work@example.com", color: "#266a98", picture: "data:image/png;base64,AAAA" };
  const importer = {
    discover: () => [source],
    batches: () => [],
    sourceInfo: (id) => (id === source.id ? source : null),
    run: (sourceId, categories, options) => {
      runs.push([sourceId, categories, options]);
      return { id: "batch-" + runs.length, results: [{ category: categories[0], status: "imported", count: 3 }] };
    },
  };
  const context = {
    profileId: "local-a",
    privateMode: false,
    importer,
    getProfiles: () => profiles,
    createImportedProfile: (details) => {
      created.push(details);
      const id = "local-" + (profiles.length + 1);
      profiles.push({ id, name: details.name, color: details.color, partition: "persist:" + id });
      return id;
    },
  };
  const service = createSetupService(f);
  const made = await service.command({ type: "profiles.fromSource", sourceId: "source-work" }, context);
  assert.equal(made.createdProfileId, "local-2");
  assert.deepEqual(created, [{ name: "Work", color: "#266a98", picture: "data:image/png;base64,AAAA", email: "work@example.com" }]);
  const run = await service.command({ type: "imports.run", sourceId: "source-work", categories: ["bookmarks"], profileId: "local-2" }, context);
  assert.equal(run.ok, true);
  assert.deepEqual(runs[0], ["source-work", ["bookmarks"], { profileId: "local-2" }]);
  await service.command({ type: "imports.run", sourceId: "source-work", categories: ["history"] }, context);
  assert.equal(runs[1][2], undefined, "without profileId the import goes to the window's own profile");
  const refused = await service.command({ type: "imports.run", sourceId: "source-work", categories: ["bookmarks"], profileId: "nobody" }, context);
  assert.equal(refused.ok, false);
  // The new profile opens with its short setup pending; the profile that ran setup does not.
  const other = { ...context, profileId: "local-2" };
  assert.equal((await service.command({ type: "status" }, other)).progress.pendingSetup, true);
  assert.equal((await service.command({ type: "status" }, context)).progress.pendingSetup, false);
  await service.command({ type: "profile.ready" }, other);
  assert.equal((await createSetupService(f).command({ type: "status" }, other)).progress.pendingSetup, false, "remembered after a restart");
  assert.equal((await service.command({ type: "profiles.fromSource", sourceId: "missing" }, context)).ok, false);
});
