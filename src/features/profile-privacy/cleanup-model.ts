import type {
  CleanupCategory,
  ProfileCleanupChoice,
  ProfileCleanupDraft,
  ProfileCleanupStatus,
} from "./cleanup-types";

export const cleanupCategories: readonly CleanupCategory[] = [
  "cookies",
  "storage",
  "history",
  "permissions",
];
export const maxKeepText = 205000;
export type CleanupValidation = {
  choice?: ProfileCleanupChoice;
  categoriesError?: string;
  originsError?: string;
};

export function draftFromChoice(
  choice: ProfileCleanupChoice,
): ProfileCleanupDraft {
  return {
    enabled: choice.enabled,
    categories: [...choice.categories],
    originsText: choice.keepOrigins.join("\n"),
  };
}

export function validateCleanupDraft(
  draft: ProfileCleanupDraft,
): CleanupValidation {
  const categories = cleanupCategories.filter((category) =>
    draft.categories.includes(category),
  );
  const categoriesError =
    draft.enabled && !categories.length
      ? "Choose at least one type of data to clear."
      : undefined;
  const lines = draft.originsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 100)
    return {
      categoriesError,
      originsError: "Use at most 100 site origins, one per line.",
    };
  const origins: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const value = lines[index];
    try {
      if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value))
        throw Error();
      const url = new URL(value);
      if (
        !/^https?:$/.test(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.hostname.includes("*")
      )
        throw Error();
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      return {
        categoriesError,
        originsError: `Line ${index + 1}: enter an HTTP(S) origin such as https://example.com, without a path, query, fragment or sign-in details.`,
      };
    }
  }
  const choice = { enabled: draft.enabled, categories, keepOrigins: origins };
  return categoriesError ? { categoriesError } : { choice };
}

export function sameCleanupChoice(
  a: ProfileCleanupChoice,
  b: ProfileCleanupChoice,
): boolean {
  return (
    a.enabled === b.enabled &&
    cleanupCategories.every(
      (category) =>
        a.categories.includes(category) === b.categories.includes(category),
    ) &&
    a.keepOrigins.length === b.keepOrigins.length &&
    a.keepOrigins.every((origin) => b.keepOrigins.includes(origin))
  );
}

export function draftChanged(
  draft: ProfileCleanupDraft,
  saved: ProfileCleanupChoice,
): boolean {
  return (
    draft.enabled !== saved.enabled ||
    cleanupCategories.some(
      (category) =>
        draft.categories.includes(category) !==
        saved.categories.includes(category),
    ) ||
    draft.originsText !== saved.keepOrigins.join("\n")
  );
}

/** Fail closed on a stale/wrong-profile or malformed transport result. */
export function checkedCleanupStatus(
  value: unknown,
  profileId: string,
): ProfileCleanupStatus {
  if (!value || typeof value !== "object")
    throw Error("Cleanup status is unavailable.");
  const status = value as Partial<ProfileCleanupStatus>,
    choice = status.choice;
  if (status.profileId !== profileId)
    throw Error(
      "The active profile changed. Check this profile's settings again.",
    );
  if (
    !choice ||
    typeof choice.enabled !== "boolean" ||
    !Array.isArray(choice.categories) ||
    choice.categories.length > 4 ||
    new Set(choice.categories).size !== choice.categories.length ||
    choice.categories.some(
      (category) => !cleanupCategories.includes(category),
    ) ||
    !Array.isArray(choice.keepOrigins) ||
    choice.keepOrigins.some((origin) => typeof origin !== "string") ||
    typeof status.pending !== "boolean" ||
    typeof status.running !== "boolean" ||
    typeof status.networkBlocked !== "boolean" ||
    !(status.recoveryError === null || typeof status.recoveryError === "string")
  )
    throw Error("Cleanup status could not be verified.");
  const parsed = validateCleanupDraft(draftFromChoice(choice));
  if (!parsed.choice || !sameCleanupChoice(parsed.choice, choice))
    throw Error("Saved cleanup settings could not be verified.");
  return {
    profileId,
    choice: {
      enabled: choice.enabled,
      categories: [...choice.categories],
      keepOrigins: [...choice.keepOrigins],
    },
    pending: status.pending,
    running: status.running,
    networkBlocked: status.networkBlocked,
    recoveryError: status.recoveryError,
    ...(typeof status.scope === "string" ? { scope: status.scope } : {}),
  };
}

export function isCleanupCancellation(
  value: unknown,
): value is { cancelled: true } {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    "cancelled" in value &&
    value.cancelled === true
  );
}

export function cleanupErrorDetail(error: unknown): string {
  return (
    error instanceof Error
      ? error.message
      : "The native cleanup service did not return a verified result."
  )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 400);
}
