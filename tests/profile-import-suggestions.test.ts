// Settings › Profiles › "Bring in another account" (R5 founder note): which other-browser profiles are offered as a new
// Acira profile. Each source at most once; never one already imported, already an Acira profile's account, or empty.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SUGGESTION_BROWSER_ORDER,
  profileSuggestions,
  suggestionCategories,
  suggestionDetail,
  type SuggestionSource,
} from "../src/features/accounts/importSuggestions";

const all = { bookmarks: true, history: true, preferences: true, extensions: false, favorites: false, spaces: false };
const source = (id: string, browser: string, extra: Partial<SuggestionSource> = {}): SuggestionSource => ({ id, browser, name: id, available: all, ...extra });
const ids = (list: SuggestionSource[]) => list.map((item) => item.id);
const me = [{ email: "sam@example.com" }];

test("suggestions offer every importable source, browsers people move from most first", () => {
  const list = profileSuggestions(
    [source("zen", "Zen"), source("ff", "Firefox"), source("work", "Chrome"), source("arc", "Arc"), source("edge", "Edge"), source("odd", "Vivaldi"), source("home", "Chrome")],
    { profiles: me },
  );
  assert.deepEqual(ids(list), ["work", "home", "edge", "arc", "ff", "zen", "odd"]);
  assert.deepEqual([...SUGGESTION_BROWSER_ORDER].slice(0, 3), ["Chrome", "Edge", "Brave"]);
});

test("a source already imported into any profile is never suggested again", () => {
  const list = profileSuggestions([source("a", "Chrome"), source("b", "Chrome"), source("c", "Edge")], { profiles: me, importedSourceIds: ["b"] });
  assert.deepEqual(ids(list), ["a", "c"]);
});

test("a source this page already turned into a profile is not offered a second time", () => {
  const list = profileSuggestions([source("a", "Chrome"), source("b", "Brave")], { profiles: me, handled: new Set(["a"]) });
  assert.deepEqual(ids(list), ["b"]);
});

test("the same source listed twice shows once", () => {
  const list = profileSuggestions([source("a", "Chrome"), source("a", "Chrome"), source("b", "Edge")], { profiles: me });
  assert.deepEqual(ids(list), ["a", "b"]);
});

test("an account that is already an Acira profile (same email, any case) is not suggested; private profiles don't count", () => {
  const sources = [source("mine", "Chrome", { email: " Sam@Example.com " }), source("work", "Chrome", { email: "sam@studio.example" }), source("tor", "Edge", { email: "hidden@example.com" })];
  const list = profileSuggestions(sources, { profiles: [...me, { email: "hidden@example.com", private: true }] });
  assert.deepEqual(ids(list), ["work", "tor"]);
});

test("a source with nothing Acira can bring in is left out", () => {
  const empty = { bookmarks: false, history: false, preferences: true, extensions: true, favorites: false, spaces: false };
  const arc = { bookmarks: false, history: false, preferences: false, extensions: false, favorites: true, spaces: true };
  const list = profileSuggestions([source("prefs", "Chrome", { available: empty }), source("arc", "Arc", { available: arc })], { profiles: me });
  assert.deepEqual(ids(list), ["arc"]);
});

test("private windows never suggest imports, and a missing or malformed list is empty", () => {
  assert.deepEqual(profileSuggestions([source("a", "Chrome")], { profiles: me, privateWindow: true }), []);
  assert.deepEqual(profileSuggestions(undefined, { profiles: me }), []);
  assert.deepEqual(profileSuggestions(null, { profiles: me }), []);
  assert.deepEqual(ids(profileSuggestions([null as unknown as SuggestionSource, { id: "", browser: "Chrome" } as SuggestionSource, source("ok", "Chrome")], { profiles: me })), ["ok"]);
});

test("each suggestion copies what setup copies, Arc's Favorites and Spaces first", () => {
  assert.deepEqual(suggestionCategories({ available: { bookmarks: true, history: true, favorites: true, spaces: true, preferences: true } }), ["favorites", "spaces", "bookmarks", "history"]);
  assert.deepEqual(suggestionCategories({ available: { bookmarks: true, history: false } }), ["bookmarks"]);
});

test("the line under a suggestion names its browser, and its email only when that adds something", () => {
  assert.equal(suggestionDetail({ browser: "Chrome", name: "Work", email: "sam@studio.example" }), "Chrome · sam@studio.example");
  assert.equal(suggestionDetail({ browser: "Firefox", name: "sam@example.com", email: "Sam@example.com" }), "Firefox");
  assert.equal(suggestionDetail({ browser: "Edge", name: "Personal" }), "Edge");
});
