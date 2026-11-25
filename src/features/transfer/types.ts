// The contract between the transfer screens (renderer) and main (desktop/transfer/*): requests, results and the status both sides read.
// Spec: the design notes sections 4, 11.1, 12.1, 12.2. Main fills in the active profile itself; the renderer never sends a profile id or a path.
import type { CollectedUi, IncomingUi } from '../../ui/profileUiPrefs';

/** The rows of the checklist (desktop/transfer/inventory.cjs ROWS). */
export type TransferRow = 'look' | 'spaces' | 'bookmarks' | 'history' | 'settings' | 'privacy' | 'reading' | 'extensions' | 'openTabs' | 'pictures' | 'passwords';
export type TransferInclude = Record<TransferRow, boolean>;
/** What "Everything except open tabs, new tab pictures and passwords" ticks. */
export const DEFAULT_INCLUDE: TransferInclude = { look: true, spaces: true, bookmarks: true, history: true, settings: true, privacy: true, reading: true, extensions: true, openTabs: false, pictures: false, passwords: false };
export type HistoryDays = 0 | 90 | 30;

export type TransferPlatform = 'darwin' | 'win32' | 'linux' | 'unknown';
/** What the other computer says about itself. Never called verified: the number is the proof. */
export interface TransferPeer { label: string; platform: TransferPlatform; appVersion: string; profileName: string }
/** Bytes the receiving computer has taken and verified, so both screens move together. */
export interface TransferProgress { done: number; total: number; fraction: number }

/**
 * Why a transfer ended; each reason is one row of spec 4.6.
 * cancelled: sender | receiver | mismatch | timeout | tamper    expired: expired
 * failed: not_found | in_use | ended | gone | busy | rate_limited | offline | slow | unavailable | silent | damaged | too_large | own_code | bad_code | newer | protocol | internal | invalid
 */
export type TransferReason =
  | 'sender' | 'receiver' | 'mismatch' | 'timeout' | 'tamper' | 'expired'
  | 'not_found' | 'in_use' | 'ended' | 'gone' | 'busy' | 'rate_limited' | 'offline' | 'slow' | 'unavailable' | 'silent' | 'damaged' | 'too_large' | 'own_code' | 'bad_code' | 'newer' | 'protocol' | 'internal' | 'invalid';

export type OutgoingState = 'building' | 'ready' | 'confirming' | 'sending' | 'uploaded' | 'done' | 'cancelled' | 'expired' | 'failed';
export type IncomingState = 'joining' | 'waiting' | 'confirming' | 'receiving' | 'checking' | 'preview' | 'cancelled' | 'expired' | 'failed';
export const ENDED_STATES = ['cancelled', 'expired', 'failed'] as const;

/** What the sender says is coming (the manifest, shown as soon as it opens on the receiving side). */
export interface TransferManifest { profileName: string; platform: TransferPlatform; createdAt: string | number; counts: Record<string, number>; bytes: number }

export interface OutgoingStatus {
  state: OutgoingState;
  /** The five words. Show them only from `ready` on. */
  code?: string[];
  /** ms on THIS computer's clock when the unclaimed code ends. */
  expiresAt?: number;
  /** ms on this computer's clock by which the number must be typed (3 minutes after the other computer joined). */
  approveDeadline?: number;
  peer?: TransferPeer | null;
  progress?: TransferProgress;
  /** Set on cancelled / expired / failed. */
  reason?: TransferReason | null;
  /** The state the session was in when it ended, so the screen can pick the right message. */
  from?: OutgoingState | string;
  /** True when this computer's own Cancel ended it. */
  local?: boolean;
  /** Passwords were ticked but the gate refused: sending went on without them (spec 14.16, "Passwords weren't included."). */
  passwordsRefused?: boolean;
}
export interface IncomingStatus {
  state: IncomingState;
  /** The two digits to show (Western digits); only in `confirming`. */
  number?: number | string | null;
  peer?: TransferPeer | null;
  approveDeadline?: number;
  manifest?: TransferManifest | null;
  progress?: TransferProgress;
  reason?: TransferReason | null;
  from?: IncomingState | string;
  local?: boolean;
}
export interface TransferStatus {
  outgoing: OutgoingStatus | null;
  incoming: IncomingStatus | null;
  /** The screen the sheet should open on, set by `transfer.open` and cleared by the sheet when it has read it (menu, Settings and palette each ask for a side). */
  sheet?: { intent: TransferIntent; at: number } | null;
  /** While `transfer.apply` runs (Bring it over): the steps that are finished, in R6's order, and the one running now. Main sends `transfer-changed` as each completes. Absent otherwise. */
  applying?: TransferApplying | null;
  /** False when the relay is not available (a test profile with no endpoint, or the build has none): code roads show "isn't available right now" and offer the file. */
  relay: boolean;
  /** Main's platform and the interface language of this computer, for the device glyph, the labels and "Switch to Deutsch". */
  platform: TransferPlatform;
}

/** R6's rows, in order: Spaces and tabs, Bookmarks, History, Settings, Site settings, The rest. */
export type TransferApplyStep = 'spaces' | 'bookmarks' | 'history' | 'settings' | 'sites' | 'other';
export interface TransferApplying { done: TransferApplyStep[]; step: TransferApplyStep | null }

export type TransferIntent = 'choice' | 'send' | 'receive' | 'file-save' | 'file-open';

export interface TransferSummary {
  profileName: string;
  /** Counts for the checklist: spaces, pinned, groupTabs, favorites, openTabs, bookmarks, history, reading, routines, extensions, webApps, pictures, passwords, shortcuts, sites; plus history90 and history30. */
  counts: Record<string, number>;
  /** Estimated compressed bytes each row adds (no `passwords` entry). */
  sizes: Partial<Record<TransferRow, number>>;
  /** 24 MiB: what a code can carry. */
  limit: number;
  passwordsAvailable: number;
}

/** A line of "Changes to how Acira protects you" (spec 10.1): the renderer words it from `id`, plus any value the line carries. */
export interface SafetyLine { id: string; [detail: string]: unknown }
export interface TransferPreview {
  source: 'file' | 'code';
  from: { name: string; platform: string; version: string; createdAt: string | number };
  included: Partial<Record<TransferRow, boolean>> | string[];
  counts: Record<string, number>;
  safety: SafetyLine[];
  spaces: { add: number; duplicates: number; overflow: number; overflowTabs?: number; [key: string]: unknown };
  /** The receiving profile still looks new (one Space, no pinned tabs, no bookmarks, under 50 history entries). */
  fresh: boolean;
  /** The sender's language when it differs from this computer's, else null. */
  language: string | null;
  changesSpacesMode: boolean;
  notMoved: { lockedSpaces: number; lockedTabs: number };
  defaultTarget: 'current' | 'new';
  notes: string[];
  dropped: string[];
  hasPasswords: boolean;
  /** The profile's key pair, Insider pass, welcome flag and recognition state came with it (no screen of its own: they ride with the Settings row). */
  hasIdentity?: boolean;
}

export interface TransferApplied {
  batchId: string;
  profileId: string;
  createdProfileId?: string | null;
  counts: Record<string, number>;
  needsRestart: boolean;
  ui: IncomingUi['ui'];
  favorites: NonNullable<IncomingUi['favorites']>;
  readingList: NonNullable<IncomingUi['readingList']>;
  extensions: { id: string; name: string; [key: string]: unknown }[];
  webApps: { name: string; startUrl: string; [key: string]: unknown }[];
  language: string | null;
  notMoved: { lockedSpaces: number; lockedTabs: number };
  overflow: unknown;
  /** Per-step results main reports as it goes (R6's ticks arrive as `transfer-changed` events while `apply` runs). */
  results?: unknown;
}

export type TransferRequest =
  | { type: 'transfer.status' }
  /** Ask main to open the sheet on a side (it opens the `transfer` popup in the focused window). */
  | { type: 'transfer.open'; intent: TransferIntent }
  /** The sheet has read `status.sheet` and acted on it: main forgets it (it also forgets it after 15 s). */
  | { type: 'transfer.sheetSeen' }
  | { type: 'transfer.summary'; ui: CollectedUi }
  | { type: 'transfer.words' }
  | { type: 'transfer.send'; include: TransferInclude; historyDays: HistoryDays; ui: CollectedUi }
  | { type: 'transfer.approve'; number: string }
  | { type: 'transfer.deny' }
  | { type: 'transfer.receive'; code: string }
  | { type: 'transfer.preview' }
  | { type: 'transfer.apply'; target: 'current' | 'new'; include?: Partial<TransferInclude>; safety: string[] }
  | { type: 'transfer.applyLook'; batchId: string }
  | { type: 'transfer.applied'; batchId: string }
  | { type: 'transfer.rolledBack' }
  | { type: 'transfer.cancel'; side: 'outgoing' | 'incoming' }
  | { type: 'transfer.saveFile'; include: TransferInclude; historyDays: HistoryDays; ui: CollectedUi; password?: string }
  | { type: 'transfer.openFile'; password?: string };

/** What main answers: `ServiceResult.transfer` holds exactly one of these shapes (all fields optional, as ServiceResult's own are). */
export interface TransferResultBag {
  status?: TransferStatus;
  summary?: TransferSummary;
  words?: string[];
  /** transfer.send */
  code?: string[];
  expiresAt?: number;
  passwordsRefused?: boolean;
  /** transfer.approve */
  ok?: boolean;
  reason?: TransferReason | 'not_ready';
  /** transfer.preview, and transfer.openFile when the file opened */
  preview?: TransferPreview;
  /** transfer.apply */
  applied?: TransferApplied;
  /** transfer.rolledBack */
  batchIds?: string[];
  /** transfer.saveFile */
  saved?: boolean;
  path?: string;
  name?: string;
  locked?: boolean;
  bytes?: number;
  /** The save/open dialog was dismissed. */
  cancelled?: boolean;
  /** transfer.openFile: a locked file wants its password (`wrongPassword` after a try). */
  needsPassword?: boolean;
  wrongPassword?: boolean;
  /** transfer.openFile: an older Acira export or a bookmarks file was imported the old way (the usual import toast with Undo was shown by main). */
  legacy?: 'v1' | 'html';
  /** transfer.open */
  opened?: boolean;
}
