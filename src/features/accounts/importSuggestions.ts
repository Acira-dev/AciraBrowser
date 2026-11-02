/** Settings › Profiles › "Bring in another account": which browser profiles found on this computer are worth offering as a
 *  new Acira profile. Pure, so the rules are tested without the app (tests/profile-import-suggestions.test.ts). */

/** What one suggestion copies, in the order setup copies it: Arc's Favorites and Spaces first, then bookmarks and history. */
export const SUGGESTION_CATEGORIES = ["favorites", "spaces", "bookmarks", "history"] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

/** Browsers people move from most, first; anything else keeps the order discovery found it in, after these. */
export const SUGGESTION_BROWSER_ORDER = ["Chrome", "Edge", "Brave", "Arc", "Firefox", "Zen", "Helium"] as const;

export interface SuggestionSource {
  id: string;
  browser: string;
  name: string;
  email?: string;
  available: Partial<Record<string, boolean | undefined>>;
}

export interface SuggestionContext {
  /** Acira's own profiles. A source whose account email is already one of theirs is already here. */
  profiles: readonly { email?: string | null; private?: boolean }[];
  /** Sources any local profile has imported from (and not undone), from `imports.discover`'s `imported`. */
  importedSourceIds?: readonly string[];
  /** Sources this page already turned into a profile, before discovery knows it. */
  handled?: Iterable<string>;
  /** Private windows never offer imports (their Settings can't create or fill profiles). */
  privateWindow?: boolean;
}

/** The categories a suggestion copies for this source; empty when it has nothing Acira can bring in. */
export function suggestionCategories(source: Pick<SuggestionSource, "available">): SuggestionCategory[] {
  return SUGGESTION_CATEGORIES.filter((category) => source.available?.[category] === true);
}

const normalEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLocaleLowerCase() : "");

const browserRank = (browser: string) => {
  const index = (SUGGESTION_BROWSER_ORDER as readonly string[]).indexOf(browser);
  return index < 0 ? SUGGESTION_BROWSER_ORDER.length : index;
};

/** The suggestions to show, each source at most once: none in a private window; never one already imported (into any
 *  profile), already handled here, already present as an Acira profile's email, or with nothing to copy. */
export function profileSuggestions<T extends SuggestionSource>(sources: readonly T[] | null | undefined, context: SuggestionContext): T[] {
  if (context.privateWindow || !Array.isArray(sources)) return [];
  const skip = new Set<string>([...(context.importedSourceIds || []), ...(context.handled || [])]);
  const emails = new Set(context.profiles.filter((profile) => !profile.private).map((profile) => normalEmail(profile.email)).filter(Boolean));
  const seen = new Set<string>();
  const kept: { source: T; order: number }[] = [];
  sources.forEach((source, order) => {
    if (!source || typeof source.id !== "string" || !source.id || typeof source.browser !== "string") return;
    if (seen.has(source.id) || skip.has(source.id)) return;
    seen.add(source.id);
    const email = normalEmail(source.email);
    if (email && emails.has(email)) return;
    if (!suggestionCategories(source).length) return;
    kept.push({ source, order });
  });
  return kept.sort((a, b) => browserRank(a.source.browser) - browserRank(b.source.browser) || a.order - b.order).map((item) => item.source);
}

/** The line under a suggestion's name: its browser, then its account email when that says something the name doesn't. */
export function suggestionDetail(source: Pick<SuggestionSource, "browser" | "name" | "email">): string {
  const email = typeof source.email === "string" ? source.email.trim() : "";
  return email && email.toLocaleLowerCase() !== source.name.trim().toLocaleLowerCase() ? `${source.browser} · ${email}` : source.browser;
}
