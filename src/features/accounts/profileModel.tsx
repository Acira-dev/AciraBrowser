import type { BrowserAction, BrowserProfile, BrowserSnapshot } from "../../runtime/types";
import { Segmented } from "../../components/Segmented";
import { runtime } from "../../runtime/client";
import { t, useT } from "../../i18n";
import { PROFILE_PALETTE, isGreyProfileColor, profileColorFor } from "../../runtime/profileColors";
import "./profile-manager.css";

/** Profile colors, tuned to sit next to the Acira finishes. The first is the brand burgundy. */
export const profileColors = PROFILE_PALETTE;

export const profileInitial = (name: string, avatar?: string | null) =>
  avatar || ([...name.trim()][0] || "A").toLocaleUpperCase();

/** The profile's photo when it has one, otherwise a monogram whose letter color is chosen for contrast against the
 * profile color. */
export function ProfileAvatar({
  name,
  color,
  avatar,
  picture,
  size = 28,
  className = "",
}: {
  name: string;
  color: string;
  avatar?: string | null;
  picture?: string | null;
  size?: number;
  className?: string;
}) {
  if (picture)
    return (
      <img
        className={`profile-avatar profile-photo ${className}`}
        src={picture}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  // A missing or grey colour never reaches the screen: the profile gets its own palette colour instead.
  const fill = isGreyProfileColor(color) ? profileColorFor(name) : color;
  return (
    <span
      className={`profile-avatar ${className}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: fill,
        color: readableOn(fill),
      }}
    >
      {profileInitial(name, avatar)}
    </span>
  );
}

function readableOn(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#fff";
  const n = parseInt(match[1], 16),
    channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    },
    luminance =
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255);
  return luminance > 0.42 ? "#1d1b20" : "#fff";
}

type Dispatch = (action: BrowserAction) => void;

/** Native profile names are 1–40 characters (stream D's `browser.profile.rename`). */
export const PROFILE_NAME_MAX = 40;

/** Rename and recolor in one native command, which validates both and persists the profile list. */
export function saveProfile(dispatch: Dispatch, id: string, patch: { name: string; color?: string }) {
  dispatch({ type: "browser.profile.rename", id, name: patch.name.slice(0, PROFILE_NAME_MAX), ...(patch.color ? { color: patch.color } : {}) });
}
/** The first profile is made as "Personal" (runtime/core.ts) before the setup knows its language, and remembers that Acira chose that name
 *  (BrowserProfile.defaultName). While nobody has named it, the first setup gives it its language's word for it, silently (the reducer checks
 *  again that it is still the default); when that setup ends the name becomes the person's, so a later language or "Run setup again" never
 *  renames it. Profiles from before this have no default name and are never renamed. */
export const hasDefaultName = (profile?: Pick<BrowserProfile, "name" | "defaultName">) => !!profile?.defaultName && profile.defaultName === profile.name;
export const nameDefaultProfile = (dispatch: Dispatch, id: string, name: string) =>
  dispatch({ type: "browser.profile.rename", id, name: name.slice(0, PROFILE_NAME_MAX), defaultName: true });
export const settleProfileName = (dispatch: Dispatch, id: string) => dispatch({ type: "browser.profile.update", id, defaultName: null });
/** Color only, without renaming. */
export const setColor = (dispatch: Dispatch, id: string, color: string) =>
  dispatch({ type: "browser.profile.update", id, color });
/** A monogram override: one letter or digit, or null to go back to the name's initial. */
export const setAvatar = (dispatch: Dispatch, id: string, avatar: string | null) =>
  dispatch({ type: "browser.profile.update", id, avatar });
export const createProfile = (dispatch: Dispatch, name: string) =>
  dispatch({ type: "browser.profile.create", name: name.slice(0, PROFILE_NAME_MAX) });
export const selectProfile = (dispatch: Dispatch, id: string) => dispatch({ type: "browser.profile.select", id });

/** The segment the setting stands for: profiles as spaces is "In this window"; anything else, also a setting never chosen, is a window for each profile. */
export const openProfilesValue = (settings: Pick<BrowserSnapshot["settings"], "spaces">): "profiles" | "workspaces" => (settings.spaces === "profiles" ? "profiles" : "workspaces");
/** What choosing a segment does: the existing Switch between update, or nothing when it is the choice already in force. */
export const openProfilesAction = (settings: Pick<BrowserSnapshot["settings"], "spaces">, next: "profiles" | "workspaces"): BrowserAction | null =>
  next === openProfilesValue(settings) ? null : { type: "settings.update", patch: { spaces: next } };
/** "Open profiles: In this window · In separate windows": the one place the choice is made, as Settings › Profiles › Switch between
 *  (`settings.spaces`: profiles as spaces, or a window for each profile with workspaces inside it). The existing segmented control,
 *  used by the profile menu, the top of Settings › Profiles and the add-profile form, so it reads the same wherever it is met.
 *  Nothing is stored beyond the setting itself; the windows follow as they do for the Settings row (desktop/main.cjs asks first when a page would lose something). */
export function OpenProfilesControl({ state, dispatch, onChosen }: { state: Pick<BrowserSnapshot, "settings">; dispatch: Dispatch; onChosen?: () => void }) {
  const text = useT();
  return (
    <Segmented
      label={text("profiles.openProfiles")}
      value={openProfilesValue(state.settings)}
      options={[["profiles", text("profiles.inThisWindow")], ["workspaces", text("profiles.inSeparateWindows")]] as const}
      onChange={(next) => {
        const action = openProfilesAction(state.settings, next);
        if (!action) return;
        dispatch(action);
        onChosen?.();
      }}
    />
  );
}

const removalReasons = (): Record<string, string> => ({
  "last-profile": t("profiles.err.lastProfile"),
  busy: t("profiles.err.busy"),
  vetoed: t("profiles.err.vetoed"),
  private: t("profiles.err.private"),
  unknown: t("profiles.err.unknown"),
});
/** Removes a profile and erases its data. Uses the result-returning native call when available, so the person learns
 * why a removal was refused; falls back to the plain command. Resolves to an error sentence, or null on success. */
export async function removeProfile(dispatch: Dispatch, id: string): Promise<string | null> {
  const native = window.acira?.native;
  if (!native) {
    dispatch({ type: "browser.profile.remove", id });
    return null;
  }
  try {
    const result = (await native({ type: "profiles.remove", id })).profiles;
    if (!result || result.ok) return null;
    return removalReasons()[result.reason || ""] || t("profiles.err.removeFailed");
  } catch {
    return t("profiles.err.removeFailed");
  }
}

/** Photo, email and the default profile (stream D, `browser.profile.update`). Each field is optional; null clears it. */
export type ProfileDetails = { picture?: string | null; email?: string | null; default?: boolean };
const actionError = (error: unknown) =>
  String((error as Error)?.message || error || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
/** Applies details natively. Resolves to D's own sentence when a value is refused (wrong image type or size, an email
 * that doesn't look like one), or null on success. */
export async function updateDetails(id: string, details: ProfileDetails): Promise<string | null> {
  try {
    await runtime.dispatch({ type: "browser.profile.update", id, ...details });
    return null;
  } catch (error) {
    return actionError(error) || t("profiles.err.saveFailed");
  }
}
/** What D accepts as a display email (name@host.tld, at most 254 characters). */
export const looksLikeEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
/** A chosen image, square-cropped from its centre and scaled to at most 128px as a JPEG (10–20 KB): pictures travel in
 * every state snapshot, so they stay small. */
export async function photoFromFile(file: File, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height),
    out = Math.min(size, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("profiles.err.imageUnreadable"));
  // A JPEG has no transparency: without a ground a transparent logo comes out on black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, out, out);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}
