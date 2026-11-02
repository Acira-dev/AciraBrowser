export type ImportCategory =
  | "bookmarks"
  | "history"
  | "preferences"
  | "extensions"
  | "favorites"
  | "spaces";
export interface SetupPreferences {
  appearance?: "light" | "dark" | "system";
  searchEngine?: "google" | "duckduckgo" | "bing";
  addressSuggestions?: boolean;
  blocking?: boolean;
}
export type SetupRequest =
  | {
      type:
        | "status"
        | "skip"
        | "finish"
        | "restart"
        | "imports.discover"
        | "imports.html"
        | "imports.icons"
        | "default.request"
        /** Setup's first frame is ready: the first-run window may show (main.cjs holds it until then, R4-01). */
        | "painted";
    }
  | { type: "move"; direction: 1 | -1 }
  | { type: "preferences"; patch: SetupPreferences }
  | { type: "profiles.create"; name: string }
  | { type: "imports.preview"; sourceId: string }
  | { type: "imports.run"; sourceId: string; categories: ImportCategory[]; profileId?: string }
  /** Multi-account import: a new profile named and pictured from one source, marked for a short setup. */
  | { type: "profiles.fromSource"; sourceId: string }
  /** The short setup of such a profile finished or was skipped. */
  | { type: "profile.ready" }
  | { type: "imports.undo"; batchId: string };
/** picture = Google account photo (PNG data URL, <=64px, read-only from the source profile); else a circle in `color` with `initial`. */
export interface ImportSource {
  id: string;
  browser: string;
  name: string;
  available: Record<ImportCategory, boolean>;
  email?: string;
  accountName?: string;
  picture?: string;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  initial?: string;
  avatarIndex?: number;
}
export interface ImportBatch {
  id: string;
  profileId: string;
  browser: string;
  name: string;
  createdAt: number;
  undone?: boolean;
  results: {
    category: string;
    count?: number;
    status: string;
    error?: string;
    /** Spaces: how many pinned tabs became tabs in their groups. */
    tabs?: number;
  }[];
  /** Arc's Favorites, for the UI to add to the sidebar (it owns the sidebar's Favorites). */
  favorites?: { url: string; title: string }[];
}
export interface SetupProgress {
  step: "welcome" | "profile" | "appearance" | "cover" | "search" | "import" | "privacy" | "default" | "finish";
  complete: boolean;
  skipped: boolean;
  upgraded: boolean;
  importBatchIds: string[];
  undoneImportBatchIds?: string[];
  importInterrupted: boolean;
  /** This profile was made from another browser's profile and hasn't had its short setup yet. */
  pendingSetup?: boolean;
}
export interface DefaultBrowserStatus {
  supported: boolean;
  isDefault: boolean;
  statusKnown?: boolean;
  requested?: boolean;
  note: string;
}
export interface SetupResult {
  ok: boolean;
  error?: { code: string; message: string };
  profileId?: string;
  progress?: SetupProgress;
  defaults?: DefaultBrowserStatus;
  defaultResult?: DefaultBrowserStatus;
  profiles?: { id: string; name: string; color: string }[];
  preferences?: SetupPreferences;
  profileCreated?: boolean;
  createdProfileId?: string;
  cancelled?: boolean;
  sources?: ImportSource[];
  /** Installed browsers' own icons as data URLs, keyed by browser name. */
  icons?: Record<string, string>;
  batches?: ImportBatch[];
  batch?: ImportBatch;
  preview?: {
    source: ImportSource;
    bookmarks: number;
    history: number | null;
    /** Arc only: Favorites, Spaces with pinned tabs, and how many pinned tabs in all. */
    favorites?: number;
    spaces?: number;
    pinned?: number;
    extensions: {
      id: string;
      name: string;
      version: string;
      manifestVersion: number;
    }[];
    warnings: string[];
  };
}
export interface SetupClient {
  request(request: SetupRequest): Promise<SetupResult>;
}
