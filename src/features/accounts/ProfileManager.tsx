import { useEffect, useId, useRef, useState } from "react";
import type { MessageId } from "../../i18n";
import type { BrowserAction, BrowserProfile, BrowserSnapshot } from "../../runtime/types";
import { Check, Plus } from "../../components/AppIcons";
import { SettingGroup, Switch } from "../settings/controls";
import { useT } from "../../i18n";
import { ProfileSuggestions } from "./ProfileSuggestions";
import { onSettingsIntent, settingsViewKey, takeSettingsIntent } from "../../ui/settingsView";
import {
  PROFILE_NAME_MAX,
  ProfileAvatar,
  createProfile,
  looksLikeEmail,
  photoFromFile,
  profileColors,
  removeProfile,
  saveProfile,
  selectProfile,
  setAvatar,
  setColor as setProfileColor,
  updateDetails,
  type ProfileDetails,
} from "./profileModel";
import { avatarInitial, initialAllowed, typedInitial } from "./avatarCase";
import { takenName } from "../../ui/nameTaken";

type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };

/** Local profiles in Settings: open, rename, recolor, remove (with a plain consequence line), and add. The current
 * profile is marked once, by its accent check. */
export function ProfileManager({ state, dispatch }: Props) {
  const profiles = state.browserProfiles.filter((profile) => !profile.private);
  const defaultId = state.settings.defaultProfileId;
  const [editing, setEditing] = useState<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const t = useT();
  // The Settings tab this panel is in: the profile menu's "Add profile…" leaves its intent there.
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  return (
    <>
      <SettingGroup title={t("profiles.yourProfiles")}>
        <div ref={heading} tabIndex={-1} className="pm-anchor" />
        {profiles.map((profile, index) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            first={index === 0}
            current={profile.id === state.activeBrowserProfileId}
            isDefault={profile.id === defaultId}
            canRemove={profiles.length > 1}
            otherNames={profiles.filter((other) => other.id !== profile.id).map((other) => other.name)}
            editing={editing === profile.id}
            onEdit={(open) => setEditing(open ? profile.id : null)}
            onRemoved={() => {
              setEditing(null);
              requestAnimationFrame(() => heading.current?.focus());
            }}
            dispatch={dispatch}
          />
        ))}
        <CreateProfile profiles={profiles} dispatch={dispatch} intentKey={tab ? settingsViewKey(tab) : ""} />
      </SettingGroup>
      {/* Other browsers' accounts on this computer, each one click from being its own profile. */}
      <ProfileSuggestions state={state} dispatch={dispatch} />
    </>
  );
}

function Swatches({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const name = useId();
  const t = useT();
  return (
    <fieldset className="pm-swatches">
      <legend>{label}</legend>
      {profileColors.map((item) => (
        <label key={item.value} className="pm-swatch" title={t(`profiles.color.${item.name.toLowerCase()}` as MessageId)}>
          <input type="radio" name={name} checked={value.toLowerCase() === item.value.toLowerCase()} onChange={() => onChange(item.value)} />
          <span style={{ background: item.value }} aria-hidden="true" />
          <span className="pm-hidden">{t(`profiles.color.${item.name.toLowerCase()}` as MessageId)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ProfileRow({
  profile,
  first,
  current,
  isDefault,
  canRemove,
  otherNames,
  editing,
  onEdit,
  onRemoved,
  dispatch,
}: {
  profile: BrowserProfile;
  first: boolean;
  current: boolean;
  isDefault: boolean;
  canRemove: boolean;
  /** The other local profiles' names: a rename to one of them is refused (two "Work" profiles read the same in every menu). */
  otherNames: string[];
  editing: boolean;
  onEdit: (open: boolean) => void;
  onRemoved: () => void;
  dispatch: Props["dispatch"];
}) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [initial, setInitial] = useState(profile.avatar || "");
  const [email, setEmail] = useState(profile.email || "");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState("");
  const t = useT();
  const input = useRef<HTMLInputElement>(null),
    photo = useRef<HTMLInputElement>(null),
    editButton = useRef<HTMLButtonElement>(null),
    keep = useRef<HTMLButtonElement>(null);
  const editor = useId(),
    warning = useId();
  useEffect(() => {
    if (!editing) return;
    setName(profile.name);
    setColor(profile.color);
    setInitial(profile.avatar || "");
    setEmail(profile.email || "");
    setConfirming(false);
    setProblem("");
    requestAnimationFrame(() => input.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (confirming) requestAnimationFrame(() => keep.current?.focus());
  }, [confirming]);
  const close = () => {
    onEdit(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const avatarChanged = (initial || null) !== (profile.avatar || null);
  const emailChanged = email.trim() !== (profile.email || "");
  const dirty = name.trim() !== profile.name || color.toLowerCase() !== profile.color.toLowerCase() || avatarChanged || emailChanged;
  const initialValid = initialAllowed(initial);
  const emailValid = !email.trim() || looksLikeEmail(email.trim());
  // A name longer than the form allows (an imported profile can arrive with one) is fine while it is left as it is: only a changed name has to fit.
  // A profile already sharing its name with another (made before names were checked) keeps it while it is left as it is.
  const taken = name.trim() !== profile.name ? takenName(name, otherNames) : undefined;
  const nameValid = name.trim().length > 0 && (name.trim().length <= PROFILE_NAME_MAX || name.trim() === profile.name);
  const valid = nameValid && initialValid && emailValid;
  const detail = [profile.email, current && t("profiles.thisWindow"), isDefault && t("profiles.default")].filter(Boolean).join(" · ");
  // Photo and default apply at once (each has its own control); D's refusal sentence is shown when a value is refused.
  const apply = async (details: ProfileDetails) => {
    setProblem("");
    const refused = await updateDetails(profile.id, details);
    if (refused) setProblem(refused);
    return !refused;
  };
  return (
    <div className="pm-item" data-editing={editing || undefined}>
      <div className="st-row st-profile pm-row" data-setting={first ? "profile-list" : undefined}>
        <ProfileAvatar
          size={32}
          picture={profile.picture}
          name={editing ? name || profile.name : profile.name}
          color={editing ? color : profile.color}
          avatar={editing ? initial || null : profile.avatar}
        />
        <div className="st-copy">
          <span className="st-title">{profile.name}</span>
          {detail && <p>{detail}</p>}
        </div>
        <div className="st-control pm-control">
          {current ? (
            <Check className="pm-current" size={16} aria-label={t("profiles.current")} />
          ) : (
            <button type="button" className="st-button" onClick={() => selectProfile(dispatch, profile.id)}>
              {t("profiles.open")}
            </button>
          )}
          <button
            ref={editButton}
            type="button"
            className="st-button pm-quiet"
            aria-expanded={editing}
            aria-controls={editor}
            data-setting={first ? "profile-edit" : undefined}
            onClick={() => (editing ? close() : onEdit(true))}
          >
            {editing ? t("profiles.done") : t("profiles.edit")}
          </button>
        </div>
      </div>
      {editing && (
        <form
          id={editor}
          className="pm-editor"
          aria-label={t("profiles.editNamed", { name: profile.name })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (confirming) setConfirming(false);
              else close();
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!dirty || !valid || taken) return;
            if (name.trim() !== profile.name) saveProfile(dispatch, profile.id, { name: name.trim(), color });
            else if (color.toLowerCase() !== profile.color.toLowerCase()) setProfileColor(dispatch, profile.id, color);
            if (avatarChanged) setAvatar(dispatch, profile.id, initial ? avatarInitial(initial) : null);
            if (emailChanged && !(await apply({ email: email.trim() || null }))) return;
            close();
          }}
        >
          <div className="pm-editor-head">
            <div className="pm-photo-col">
              <ProfileAvatar size={56} picture={profile.picture} name={name || profile.name} color={color} avatar={initial || null} />
              <button type="button" className="acira-button acira-button-quiet pm-photo-button" onClick={() => photo.current?.click()}>
                {profile.picture ? t("profiles.changePhoto") : t("profiles.addPhoto")}
              </button>
              {profile.picture && (
                <button type="button" className="acira-button acira-button-quiet pm-photo-button" onClick={() => void apply({ picture: null })}>
                  {t("profiles.removePhoto")}
                </button>
              )}
              <input
                ref={photo}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    await apply({ picture: await photoFromFile(file) });
                  } catch {
                    setProblem(t("profiles.imageUnusable"));
                  }
                }}
              />
            </div>
            <div className="pm-fields">
              <label className="pm-field">
                <span>{t("profiles.name")}</span>
                <input
                  ref={input}
                  className="st-input"
                  value={name}
                  maxLength={PROFILE_NAME_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={taken ? true : undefined}
                  aria-describedby={taken ? `${editor}-name` : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                {taken && <small id={`${editor}-name`} className="pm-problem pm-name-taken" role="alert">{t("profiles.nameTaken", { name: taken })}</small>}
              </label>
              <label className="pm-field pm-initial">
                <span>{t("profiles.initial")}</span>
                <input
                  className="st-input"
                  value={initial}
                  maxLength={16}
                  placeholder={[...name.trim()][0]?.toLocaleUpperCase() || "A"}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${editor}-initial`}
                  onChange={(event) => setInitial(typedInitial(event.target.value))}
                />
                <small id={`${editor}-initial`}>{initialValid ? t("profiles.initialHint") : t("profiles.initialInvalid")}</small>
              </label>
              <label className="pm-field">
                <span>{t("profiles.email")}</span>
                <input
                  className="st-input"
                  type="email"
                  value={email}
                  placeholder={t("profiles.optional")}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${editor}-email`}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <small id={`${editor}-email`}>
                  {emailValid ? t("profiles.emailHint") : t("profiles.emailInvalid")}
                </small>
              </label>
            </div>
          </div>
          <Swatches label={t("profiles.color")} value={color} onChange={setColor} />
          <div className="pm-default">
            <div className="pm-default-copy">
              <span>{t("profiles.defaultProfile")}</span>
              <small>{t("profiles.defaultHint")}</small>
            </div>
            <Switch checked={isDefault} label={t("profiles.defaultProfile")} onChange={(on) => void apply({ default: on })} />
          </div>
          <div className="pm-actions">
            <button type="submit" className="st-button primary" disabled={!dirty || !valid || Boolean(taken)}>
              {t("profiles.save")}
            </button>
            <button type="button" className="st-button pm-quiet" onClick={close}>
              {t("profiles.cancel")}
            </button>
            {canRemove && !confirming && (
              <button
                type="button"
                className="acira-button acira-button-quiet acira-button-danger pm-remove"
                data-setting={first ? "profile-remove" : undefined}
                aria-expanded={confirming}
                aria-controls={warning}
                onClick={() => setConfirming(true)}
              >
                {t("profiles.removeEllipsis")}
              </button>
            )}
          </div>
          {problem && !confirming && (
            <p role="alert" className="pm-problem pm-editor-problem">
              {problem}
            </p>
          )}
          {confirming && (
            <div id={warning} className="pm-confirm" role="alertdialog" aria-labelledby={`${warning}-title`} aria-describedby={`${warning}-body`}>
              <p id={`${warning}-title`} className="pm-confirm-title">
                {t("profiles.removeQuestion", { name: profile.name })}
              </p>
              <p id={`${warning}-body`}>{current ? t("profiles.removeBodyCurrent") : t("profiles.removeBody")}</p>
              <div className="pm-actions">
                <button ref={keep} type="button" className="st-button" onClick={() => setConfirming(false)}>
                  {t("profiles.keep")}
                </button>
                <button
                  type="button"
                  className="st-button primary acira-button-danger acira-button-primary"
                  disabled={removing}
                  onClick={async () => {
                    setRemoving(true);
                    setProblem("");
                    const failure = await removeProfile(dispatch, profile.id);
                    setRemoving(false);
                    if (failure) setProblem(failure);
                    else onRemoved();
                  }}
                >
                  {removing ? t("profiles.removing") : t("profiles.removeNamed", { name: profile.name })}
                </button>
              </div>
              {problem && (
                <p role="alert" className="pm-problem">
                  {problem}
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/** "New profile" as the group's last row; it opens in place to a name and a color. */
function CreateProfile({ profiles, dispatch, intentKey }: { profiles: BrowserProfile[]; dispatch: Props["dispatch"]; intentKey: string }) {
  const t = useT();
  const used = new Set(profiles.map((profile) => profile.color.toLowerCase()));
  const suggested = (profileColors.find((item) => !used.has(item.value.toLowerCase())) || profileColors[0]).value;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const pending = useRef<{ name: string; color: string; before: Set<string> } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const chosen = color ?? suggested;
  // Native create takes a name; the color is applied to the new profile as soon as it appears.
  useEffect(() => {
    const wait = pending.current;
    if (!wait) return;
    const created = profiles.find((profile) => !wait.before.has(profile.id) && profile.name === wait.name);
    if (!created) return;
    pending.current = null;
    if (created.color.toLowerCase() !== wait.color.toLowerCase()) setProfileColor(dispatch, created.id, wait.color);
  }, [profiles, dispatch]);
  // Opened from outside ("Add profile…" in the profile menu): the form opens in place and the name field takes focus,
  // whether this panel was already showing or mounts a moment after the section switch.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!intentKey) return;
    const take = () => {
      if (!takeSettingsIntent(intentKey, "add-profile")) return;
      setOpen(true);
      setAsked((count) => count + 1);
    };
    take();
    return onSettingsIntent(take);
  }, [intentKey]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open, asked]);
  const taken = takenName(name, profiles.map((profile) => profile.name));
  const takenHint = useId();
  const valid = name.trim().length > 0 && name.trim().length <= PROFILE_NAME_MAX && !taken;
  const dismiss = () => {
    setOpen(false);
    setName("");
    setColor(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  if (!open)
    return (
      <button ref={opener} type="button" className="st-row pm-row pm-add" data-setting="profile-create" onClick={() => setOpen(true)}>
        <span className="pm-add-icon" aria-hidden="true">
          <Plus size={16} />
        </span>
        <span className="st-title">{t("profiles.new")}</span>
      </button>
    );
  // The form keeps the list's grid: its avatar sits in the rows' avatar column (same 32px), and the name, colors and
  // buttons all start on the rows' text column (profile-manager.css, --pm-avatar / --pm-gap).
  return (
    <form
      className="pm-create"
      data-setting="profile-create"
      aria-label={t("profiles.new")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        pending.current = { name: name.trim(), color: chosen, before: new Set(profiles.map((profile) => profile.id)) };
        createProfile(dispatch, name.trim());
        dismiss();
      }}
    >
      <span className="pm-create-face" data-empty={name.trim() ? undefined : ""}>
        {name.trim() ? (
          <ProfileAvatar name={name} color={chosen} size={32} />
        ) : (
          <span className="profile-avatar pm-create-blank" style={{ background: chosen }} aria-hidden="true" />
        )}
      </span>
      <div className="pm-create-body">
        <label className="pm-field">
          <span>{t("profiles.name")}</span>
          <input
            ref={input}
            className="st-input"
            placeholder={t("profiles.namePlaceholder")}
            value={name}
            maxLength={PROFILE_NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={taken ? true : undefined}
            aria-describedby={taken ? takenHint : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {taken && <small id={takenHint} className="pm-problem pm-name-taken" role="alert">{t("profiles.nameTaken", { name: taken })}</small>}
        </label>
        <Swatches label={t("profiles.color")} value={chosen} onChange={setColor} />
        <div className="pm-actions">
          <button type="submit" className="st-button primary" disabled={!valid}>
            {t("profiles.create")}
          </button>
          <button type="button" className="st-button pm-quiet" onClick={dismiss}>
            {t("profiles.cancel")}
          </button>
        </div>
      </div>
    </form>
  );
}
