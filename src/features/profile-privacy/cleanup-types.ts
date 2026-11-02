export type CleanupCategory = "cookies" | "storage" | "history" | "permissions";

export interface ProfileCleanupChoice {
  enabled: boolean;
  categories: CleanupCategory[];
  keepOrigins: string[];
}

export interface ProfileCleanupStatus {
  profileId: string;
  choice: ProfileCleanupChoice;
  pending: boolean;
  running: boolean;
  networkBlocked: boolean;
  recoveryError: string | null;
  scope?: string;
}

export type ProfileCleanupSaveResult =
  | ProfileCleanupStatus
  | { cancelled: true };

/** Native routes resolve the current normal profile. No renderer profile selector. */
export interface ProfileCleanupClient {
  status(): Promise<ProfileCleanupStatus>;
  set(choice: ProfileCleanupChoice): Promise<ProfileCleanupSaveResult>;
}

export interface ProfileCleanupDraft {
  enabled: boolean;
  categories: CleanupCategory[];
  originsText: string;
}
