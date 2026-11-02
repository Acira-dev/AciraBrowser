"use strict";
const { tm } = require('../tm.cjs');
const { OnboardingStore } = require("./onboarding.cjs");
const { SetupError, fail, shape, text } = require("./errors.cjs");

// Local setup only. No network/provider/remote identity is accepted.

/** The name a profile made from another browser's profile gets: that profile's own name ("Work"), or the browser's when
 *  the name is a placeholder ("Default", "Person 1", Zen's "Default (release)"); " · Chrome" when that name is already taken here, then a number. */
function importedProfileName(source, existingNames) {
  const taken = new Set([...existingNames].map((name) => String(name).toLowerCase()));
  const browser = String(source?.browser || "Imported").slice(0, 40);
  const own = String(source?.name || "").trim();
  const base = (!own || /^(default( \([^)]*\))?|person \d+|profile \d+|user|your chrome)$/i.test(own) ? browser : own).slice(0, 60);
  if (!taken.has(base.toLowerCase())) return base;
  const marked = `${base} · ${browser}`.slice(0, 78);
  if (!taken.has(marked.toLowerCase())) return marked;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function createSetupService({
  directory,
  defaultBrowser,
  existingInstallation = false,
  now = Date.now,
}) {
  const store = new OnboardingStore({ directory, existingInstallation, now });
  let tail = Promise.resolve();
  const defaults = () =>
    defaultBrowser?.status() || {
      supported: false,
      isDefault: false,
      note: tm("defaultbrowser.noteUnavailable"),
    };
  function localProfiles(context) {
    return (context.getProfiles?.() || [])
      .filter((profile) => !profile.private)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        color: profile.color,
      }));
  }
  function preferences(context) {
    const settings = context.readSettings?.() || {},
      result = {};
    for (const key of [
      "appearance",
      "searchEngine",
      "addressSuggestions",
      "blocking",
    ])
      if (settings[key] !== undefined) result[key] = settings[key];
    return result;
  }
  const status = (context) => ({
    progress: ((progress) => { if (!progress.complete && !progress.skipped && !progress.upgraded) defaultBrowser?.warmIcons?.(); return progress; })(store.status(context.profileId)),
    defaults: defaults(),
    profiles: localProfiles(context),
    preferences: preferences(context),
    profileId: context.profileId,
  });
  const batches = (context) => {
    const undone = new Set(
      store.status(context.profileId).undoneImportBatchIds,
    );
    return context.importer
      .batches()
      .map((batch) => ({ ...batch, undone: undone.has(batch.id) }));
  };
  async function execute(request, context) {
    shape(
      request,
      ["type"],
      ["patch", "direction", "sourceId", "categories", "batchId", "name", "profileId"],
    );
    if (JSON.stringify(request).length > 20000)
      fail("INVALID_REQUEST", "The setup request is too large.");
    text(context?.profileId);
    if (context.privateMode)
      fail("PRIVATE_CONTEXT", "Open a regular browser window to change setup.");
    store.load();
    const exact = (required = []) => shape(request, ["type", ...required]);
    switch (request.type) {
      case "status":
        exact();
        return {};
      case "move":
        exact(["direction"]);
        if (![1, -1].includes(request.direction))
          fail("INVALID_REQUEST", "Invalid setup direction.");
        store.move(context.profileId, request.direction, defaults());
        return {};
      case "skip":
      case "finish":
        exact();
        store.update(context.profileId, {
          complete: true,
          skipped: request.type === "skip",
          step: "finish",
        });
        return {};
      case "restart":
        exact();
        store.update(context.profileId, {
          complete: false,
          skipped: false,
          step: "welcome",
        });
        return {};
      case "preferences": {
        exact(["patch"]);
        if (!context.updateSettings)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Setup preferences are unavailable in this build.",
          );
        const patch = store.preferences(request.patch);
        store.status(context.profileId);
        await context.updateSettings(patch);
        return {};
      }
      case "profiles.create": {
        exact(["name"]);
        if (!context.createProfile)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Create a local profile from the browser Profile menu.",
          );
        const name = text(request.name, 80);
        store.status(context.profileId);
        await context.createProfile(name);
        return { profileCreated: true };
      }
      case "imports.discover":
        exact();
        if (!context.importer)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Browser import is unavailable in this build.",
          );
        return {
          sources: await (context.importer.discoverAsync || context.importer.discover)(),
          batches: batches(context),
        };
      case "imports.preview":
        exact(["sourceId"]);
        if (!context.importer)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Browser import is unavailable in this build.",
          );
        return {
          preview: await context.importer.preview(text(request.sourceId)),
        };
      case "imports.run": {
        // `profileId`: multi-account import sends each chosen source into its own profile.
        shape(request, ["type", "sourceId", "categories"], ["profileId"]);
        if (request.profileId !== undefined && !localProfiles(context).some((profile) => profile.id === request.profileId))
          fail("INVALID_REQUEST", "Choose a local profile to import into.");
        if (!context.importer)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Browser import is unavailable in this build.",
          );
        if (
          !Array.isArray(request.categories) ||
          !request.categories.length ||
          new Set(request.categories).size !== request.categories.length ||
          request.categories.some(
            (kind) =>
              !["bookmarks", "history", "preferences", "extensions", "favorites", "spaces"].includes(
                kind,
              ),
          )
        )
          fail("INVALID_REQUEST", "Select supported import categories.");
        text(request.sourceId);
        store.update(context.profileId, { importInterrupted: true });
        const batch = await context.importer.run(
            request.sourceId,
            request.categories,
            request.profileId === undefined ? undefined : { profileId: request.profileId },
          ),
          previous = store.status(context.profileId);
        store.update(context.profileId, {
          importInterrupted: false,
          importBatchIds: [...new Set([...previous.importBatchIds, batch.id])],
        });
        return { batch, batches: batches(context) };
      }
      case "profiles.fromSource": {
        // A new local profile for one chosen source, named, colored and pictured from it, marked for a short setup.
        exact(["sourceId"]);
        text(request.sourceId);
        const source = context.importer?.sourceInfo?.(request.sourceId);
        if (!source || !context.createImportedProfile)
          fail("INTEGRATION_UNAVAILABLE", "Profiles can't be made from this source.");
        const profileId = await context.createImportedProfile({
          name: importedProfileName(source, localProfiles(context).map((profile) => profile.name)),
          color: /^#[\da-f]{6}$/i.test(source.color || "") ? source.color : undefined,
          picture: typeof source.picture === "string" ? source.picture : undefined,
          email: typeof source.email === "string" ? source.email : undefined,
        });
        store.update(profileId, { pendingSetup: true });
        return { createdProfileId: profileId, profiles: localProfiles(context) };
      }
      case "profile.ready": {
        // The short setup of a profile made from another browser finished or was skipped.
        exact();
        store.update(context.profileId, { pendingSetup: false });
        return status(context);
      }
      case "imports.html": {
        exact();
        if (!context.importer?.importHTML)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Bookmark-file import is unavailable in this build.",
          );
        store.update(context.profileId, { importInterrupted: true });
        const result = await context.importer.importHTML(),
          previous = store.status(context.profileId);
        store.update(context.profileId, {
          importInterrupted: false,
          ...(result.batch
            ? {
                importBatchIds: [
                  ...new Set([...previous.importBatchIds, result.batch.id]),
                ],
              }
            : {}),
        });
        return { ...result, batches: batches(context) };
      }
      case "imports.undo": {
        exact(["batchId"]);
        if (!context.importer)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Browser import is unavailable in this build.",
          );
        const id = text(request.batchId);
        store.status(context.profileId);
        const result = await context.importer.undo(id),
          previous = store.status(context.profileId);
        store.update(context.profileId, {
          undoneImportBatchIds: [
            ...new Set([...previous.undoneImportBatchIds, id]),
          ],
        });
        return { importResult: result, batches: batches(context) };
      }
      case "imports.icons":
        exact();
        return { icons: defaultBrowser?.browserIcons ? await defaultBrowser.browserIcons() : {} };
      case "default.request":
        exact();
        if (!defaultBrowser)
          fail(
            "INTEGRATION_UNAVAILABLE",
            "Default-browser registration is unavailable in this build.",
          );
        store.status(context.profileId);
        return { defaultResult: await defaultBrowser.request() };
      default:
        fail("INVALID_REQUEST", "This setup command is not supported.");
    }
  }
  function command(request, context = {}) {
    const job = async () => {
      try {
        const result = await execute(request, context);
        return { ok: true, ...status(context), ...result };
      } catch (error) {
        const known = error instanceof SetupError;
        return {
          ok: false,
          error: {
            code: known ? error.code : "UNAVAILABLE",
            message: known
              ? error.message
              : tm("setup.thisSetupStepCouldNot"),
          },
        };
      }
    };
    const result = tail.then(job, job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  return { command };
}
module.exports = { createSetupService, importedProfileName };
