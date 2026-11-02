"use strict";
// Adapted bounded traversal from imputnet/helium-onboarding (GPL-3.0),
// 64257c5ea5b04c551305120eef5a495046f4e1fa src/lib/onboarding-flow.ts.
// Upstream source and license: src/features/onboarding/upstream.
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { fail, shape, object } = require("./errors.cjs");
const steps = [
  "welcome",
  "import",
  "profile",
  "appearance",
  "cover",
  "search",
  "privacy",
  "default",
  "finish",
];
const validProfiles = (value) =>
  object(value) &&
  Object.values(value).every(
    (profile) =>
      object(profile) &&
      ["importBatchIds", "undoneImportBatchIds"].every(
        (key) =>
          profile[key] === undefined ||
          (Array.isArray(profile[key]) &&
            profile[key].every(
              (id) =>
                typeof id === "string" && id.length > 0 && id.length <= 300,
            )),
      ) &&
      ["complete", "skipped", "upgraded", "importInterrupted", "pendingSetup"].every(
        (key) =>
          profile[key] === undefined || typeof profile[key] === "boolean",
      ),
  );
const validInstallation = (value) =>
  object(value) &&
  steps.includes(value.step) &&
  ["complete", "skipped", "upgraded"].every(
    (key) => typeof value[key] === "boolean",
  ) &&
  (value.updatedAt === undefined || Number.isFinite(value.updatedAt));
function pageIndex(current, direction = 1, shouldSkip = () => false) {
  let next = current + direction;
  while (next >= 0 && next < steps.length && shouldSkip(steps[next]))
    next += direction;
  return Math.max(0, Math.min(next, steps.length - 1));
}
class OnboardingStore {
  constructor({ directory, existingInstallation = false, now = Date.now }) {
    this.file = path.join(directory, "onboarding.json");
    this.existingInstallation = existingInstallation;
    this.now = now;
    this.data = null;
  }
  load() {
    if (this.data) return this.data;
    try {
      const stat = fs.statSync(this.file);
      if (stat.size > 1024 * 1024) throw new Error();
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (value.version === 1 && validProfiles(value.profiles)) {
        const previous = Object.values(value.profiles)[0];
        this.data = {
          version: 2,
          installation: {
            step: steps.includes(previous?.step)
              ? previous.step
              : previous?.step === "account"
                ? "default"
                : "welcome",
            complete: !!previous?.complete,
            skipped: !!previous?.skipped,
            upgraded: !!previous?.upgraded,
          },
          profiles: value.profiles,
        };
      } else {
        if (
          value.version !== 2 ||
          !validInstallation(value.installation) ||
          !validProfiles(value.profiles)
        )
          throw new Error();
        this.data = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        fail(
          "ONBOARDING_UNAVAILABLE",
          "Setup progress could not be opened. Your existing browser data is unchanged.",
        );
      this.data = {
        version: 2,
        installation: {
          step: "welcome",
          complete: this.existingInstallation,
          skipped: false,
          upgraded: this.existingInstallation,
        },
        profiles: {},
      };
    }
    return this.data;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(this.data));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
  }
  status(profileId) {
    const data = this.load();
    if (!Object.hasOwn(data.profiles, profileId)) {
      data.profiles[profileId] = {
        importBatchIds: [],
        undoneImportBatchIds: [],
        importInterrupted: false,
      };
      try {
        this.save();
      } catch (error) {
        delete data.profiles[profileId];
        throw error;
      }
    }
    return structuredClone({
      ...data.installation,
      importBatchIds: data.profiles[profileId].importBatchIds || [],
      undoneImportBatchIds: data.profiles[profileId].undoneImportBatchIds || [],
      importInterrupted: !!data.profiles[profileId].importInterrupted,
      // A profile setup made from another browser's profile: it gets a short setup the first time it is opened.
      pendingSetup: !!data.profiles[profileId].pendingSetup,
    });
  }
  update(profileId, patch) {
    this.status(profileId);
    const previous = structuredClone(this.data);
    for (const [key, value] of Object.entries(patch)) {
      if (
        [
          "importBatchIds",
          "undoneImportBatchIds",
          "importInterrupted",
          "pendingSetup",
        ].includes(key)
      )
        this.data.profiles[profileId][key] = value;
      else this.data.installation[key] = value;
    }
    this.data.installation.updatedAt = this.now();
    try {
      this.save();
    } catch (error) {
      this.data = previous;
      throw error;
    }
    return this.status(profileId);
  }
  move(profileId, direction, defaults) {
    const current = this.status(profileId),
      next = pageIndex(
        steps.indexOf(current.step),
        direction,
        (step) => step === "default" && defaults?.isDefault === true,
      );
    return this.update(profileId, { step: steps[next] });
  }
  preferences(patch) {
    shape(
      patch,
      [],
      ["appearance", "searchEngine", "addressSuggestions", "blocking"],
    );
    for (const [key, value] of Object.entries(patch))
      if (
        !(
          key === "appearance" && ["light", "dark", "system"].includes(value)
        ) &&
        !(
          key === "searchEngine" &&
          ["google", "duckduckgo", "bing"].includes(value)
        ) &&
        !(
          ["addressSuggestions", "blocking"].includes(key) &&
          typeof value === "boolean"
        )
      )
        fail("INVALID_REQUEST", "Choose a supported setup preference.");
    return patch;
  }
}
module.exports = {
  OnboardingStore,
  // Preserve the existing main-process import while sharing one implementation.
  createDefaultBrowserService: require("./default-browser.cjs")
    .createDefaultBrowserService,
  pageIndex,
  steps,
};
