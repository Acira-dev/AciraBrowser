import test from "node:test";
import assert from "node:assert/strict";
import {
  checkedCleanupStatus,
  draftChanged,
  draftFromChoice,
  isCleanupCancellation,
  sameCleanupChoice,
  validateCleanupDraft,
} from "../src/features/profile-privacy/cleanup-model";
import type { ProfileCleanupStatus } from "../src/features/profile-privacy/cleanup-types";
const status = (): ProfileCleanupStatus => ({
  profileId: "a",
  choice: { enabled: false, categories: [], keepOrigins: [] },
  pending: false,
  running: false,
  networkBlocked: false,
  recoveryError: null,
});
test("off-by-default empty cleanup is valid; enabling requires a category", () => {
  assert.ok(validateCleanupDraft(draftFromChoice(status().choice)).choice);
  assert.match(
    validateCleanupDraft({ enabled: true, categories: [], originsText: "" })
      .categoriesError!,
    /at least one/,
  );
});
test("kept origins canonicalize scheme/host/default port and retain distinct ports", () => {
  const result = validateCleanupDraft({
    enabled: true,
    categories: ["storage", "cookies"],
    originsText:
      "HTTPS://EXAMPLE.COM:443/\nhttps://example.com\nhttp://[::1]:8123/",
  });
  assert.deepEqual(result.choice, {
    enabled: true,
    categories: ["cookies", "storage"],
    keepOrigins: ["https://example.com", "http://[::1]:8123"],
  });
});
test("keep rules reject paths, queries, fragments, sign-in details, nonweb schemes and wildcard hosts", () => {
  for (const origin of [
    "https://example.com/path",
    "https://example.com/?q=1",
    "https://example.com/#x",
    "https://user:secret@example.com",
    "file:///local",
    "javascript:alert(1)",
    "https://*.example.com",
    "https://example.com/a b",
  ])
    assert.match(
      validateCleanupDraft({
        enabled: false,
        categories: [],
        originsText: origin,
      }).originsError!,
      /Line 1/,
    );
});
test("native100-origin and per-origin2048 bounds are preserved", () => {
  const list = Array.from(
    { length: 100 },
    (_, index) => `https://site${index}.example`,
  );
  assert.equal(
    validateCleanupDraft({
      enabled: true,
      categories: ["history"],
      originsText: list.join("\n"),
    }).choice?.keepOrigins.length,
    100,
  );
  assert.match(
    validateCleanupDraft({
      enabled: false,
      categories: [],
      originsText: [...list, "https://extra.example"].join("\n"),
    }).originsError!,
    /100/,
  );
  assert.match(
    validateCleanupDraft({
      enabled: false,
      categories: [],
      originsText: "https://" + "a".repeat(2048),
    }).originsError!,
    /Line 1/,
  );
});
test("saved/draft distinction preserves raw edits and choice equality ignores category/origin ordering", () => {
  const choice = {
    enabled: true,
    categories: ["cookies", "history"] as const,
    keepOrigins: ["https://a.example", "https://b.example"],
  };
  const saved = { ...choice, categories: [...choice.categories] };
  assert.equal(draftChanged(draftFromChoice(saved), saved), false);
  assert.equal(
    draftChanged(
      {
        ...draftFromChoice(saved),
        originsText: "https://a.example\nhttps://b.example\n",
      },
      saved,
    ),
    true,
  );
  assert.equal(
    sameCleanupChoice(saved, {
      ...saved,
      categories: ["history", "cookies"],
      keepOrigins: [...saved.keepOrigins].reverse(),
    }),
    true,
  );
});
test("status accepts pending/blocked recovery without converting it to completion", () => {
  const value = {
    ...status(),
    pending: true,
    networkBlocked: true,
    recoveryError: "Recovery pending",
  };
  assert.deepEqual(checkedCleanupStatus(value, "a"), value);
});
test("wrong-profile, malformed flags and duplicate categories fail closed", () => {
  for (const value of [
    { ...status(), profileId: "b" },
    { ...status(), pending: "true" },
    { ...status(), recoveryError: false },
    {
      ...status(),
      choice: {
        enabled: true,
        categories: ["cookies", "cookies"],
        keepOrigins: [],
      },
    },
  ])
    assert.throws(() => checkedCleanupStatus(value, "a"));
});
test("only exact native cancellation shape is accepted", () => {
  assert.equal(isCleanupCancellation({ cancelled: true }), true);
  for (const value of [
    { cancelled: false },
    { cancelled: true, choice: {} },
    null,
  ])
    assert.equal(isCleanupCancellation(value), false);
});
