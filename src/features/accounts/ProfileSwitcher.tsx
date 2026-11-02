import type { BrowserAction, BrowserSnapshot } from "../../runtime/types";
import { runtime } from "../../runtime/client";
import { Check, ExternalLink, Plus, PrivateWindow, Users } from "../../components/AppIcons";
import { WorkspaceGlyph, workspaceIcon } from "../../components/WorkspaceGlyph";
import { MAX_WORKSPACES, windowWorkspaces } from "../../runtime/workspaces";
import { openWorkspacePopupFromPopup } from "../../ui/workspaceTarget";
import { shownColor, shownName, workspaceKey } from "../workspaces/WorkspaceSwitcher";
import "../../styles/workspaces.css";
import { formatShortcut } from "../../ui/platform";
import { ProfileAvatar } from "./profileModel";
import { useT } from "../../i18n";
import { openSettings } from "../../ui/settingsView";
import "./profile-switcher.css";

/* Row glyphs come from the shared 16px icon family (the same private-window mark as the main menu). */
const PrivateGlyph=()=><PrivateWindow className="acira-menu-icon" size={16}/>;
const ManageGlyph=()=><Users className="acira-menu-icon" size={16}/>;

/** The profile panel, built from A's round 9 panel classes (src/styles/panels.css): identity rows (avatar or photo,
 * name, where it opens), the current one marked only by its trailing accent check; one fade-ended divider; then New
 * private window and Manage profiles. Every row has its three children: icon column, title, trailing item. R4-48 (D1): the
 * profile's Workspaces follow its identity, with one line on what they are, because with one workspace there is no switcher
 * anywhere else: the open one checked with its key, then New workspace…. */
export function ProfileSwitcher({
  state,
  profileId,
  dispatch,
  close,
}: {
  state: BrowserSnapshot;
  profileId: string;
  dispatch: (action: BrowserAction) => void;
  close: () => void;
}) {
  const t = useT();
  const profiles = state.browserProfiles.filter((profile) => !profile.private);
  const privateHere = state.browserProfiles.some((profile) => profile.private && profile.id === profileId);
  const workspaces = privateHere ? [] : windowWorkspaces(state);
  return (
    <div className="pf" role="menu" aria-label={t("profiles.panel")}>
      {privateHere ? (
        <button type="button" role="menuitemradio" aria-checked="true" className="acira-menu-row acira-menu-row-identity" onClick={close}>
          <PrivateGlyph />
          <span className="acira-menu-title">
            {t("profiles.privateWindow")}<span className="acira-menu-sub">{t("profiles.nothingKept")}</span>
          </span>
          <Check className="acira-menu-check" size={16} />
        </button>
      ) : (
        profiles.map((profile) => {
          const current = profile.id === profileId;
          // Another profile switches this window in place, on the page on screen (founder, 30 Oct); the trailing button still
          // opens it in its own window. The two are siblings: a button never holds another.
          return (
            <div key={profile.id} className="pf-profile">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={current}
              title={profile.email || undefined}
              className="acira-menu-row acira-menu-row-identity"
              onClick={() => {
                if (!current) dispatch({ type: "browser.profile.select", id: profile.id, here: true });
                close();
              }}
            >
              <ProfileAvatar
                className="acira-menu-avatar"
                name={profile.name}
                color={profile.color}
                avatar={profile.avatar}
                picture={profile.picture}
                size={20}
              />
              <span className="acira-menu-title">
                {profile.name}
                <span className="acira-menu-sub">{current ? t("profiles.thisWindow") : t("profiles.switchHere")}</span>
              </span>
              {current ? <Check className="acira-menu-check" size={16} /> : <span />}
            </button>
            {!current && (
              <button type="button" role="menuitem" className="pf-own-window" aria-label={t("profiles.openOwnWindow", { name: profile.name })} title={t("profiles.opensOwn")}
                onClick={() => { dispatch({ type: "browser.profile.select", id: profile.id }); close(); }}>
                <ExternalLink size={14} />
              </button>
            )}
            </div>
          );
        })
      )}
      {/* Add profile… sits directly under the list it extends and opens Settings with the add form ready (name focused). */}
      {!privateHere && (
        <button type="button" role="menuitem" className="acira-menu-row" data-profile-add
          onClick={() => { openSettings(state, dispatch, { section: "Profiles", intent: "add-profile" }); close(); }}>
          <Plus className="acira-menu-icon" size={16} />
          <span className="acira-menu-title">{t("profiles.add")}</span>
          <span />
        </button>
      )}
      {/* A private window holds only its own private profile, so there is nothing to open or manage from it. */}
      {workspaces.length > 0 && (
        <>
          <hr className="acira-menu-sep" />
          <div className="ws-menu-head" role="presentation">
            <span className="ws-menu-head-title">{t("workspaces.panel")}</span>
            <span className="acira-menu-sub">{t("workspaces.profileSection")}</span>
          </div>
          {workspaces.map((workspace, index) => {
            const open = workspace.id === state.activeWorkspaceId, color = shownColor(state, workspace), key = workspaceKey(index);
            return (
              <button key={workspace.id} type="button" role="menuitemradio" aria-checked={open} className="acira-menu-row" data-profile-workspace={workspace.id}
                onClick={() => { if (!open) dispatch({ type: "workspace.select", id: workspace.id }); close(); }}>
                <span className="acira-menu-icon ws-menu-glyph" data-colored={color ? "" : undefined} style={color ? ({ "--ws-color": color } as React.CSSProperties) : undefined}>
                  <WorkspaceGlyph icon={workspaceIcon(workspace)} />{color && <i className="sb-ws-rail" aria-hidden="true" />}
                </span>
                <span className="acira-menu-title">{shownName(workspace)}</span>
                <span className="ws-menu-trail">{key && <span className="acira-menu-meta">{key}</span>}<span className="ws-menu-mark">{open && <Check className="acira-menu-check" size={16} />}</span></span>
              </button>
            );
          })}
          {workspaces.length < MAX_WORKSPACES && (
            <button type="button" role="menuitem" className="acira-menu-row" data-profile-workspace-new
              onClick={() => { close(); setTimeout(() => openWorkspacePopupFromPopup(state, "workspace-edit", { mode: "new" }), 0); }}>
              <Plus className="acira-menu-icon" size={16} />
              <span className="acira-menu-title">{t("workspaces.new")}</span>
              <span />
            </button>
          )}
        </>
      )}
      {!privateHere && (
        <>
          <hr className="acira-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="acira-menu-row"
            onClick={() => {
              void runtime.openWindow("private");
              close();
            }}
          >
            <PrivateGlyph />
            <span className="acira-menu-title">{t("profiles.newPrivate")}</span>
            <span className="acira-menu-meta">{formatShortcut("Ctrl Shift N")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="acira-menu-row"
            onClick={() => {
              // The Profiles section, in this profile's Settings tab (a new one only when there isn't one).
              openSettings(state, dispatch, { section: "Profiles" });
              close();
            }}
          >
            <ManageGlyph />
            <span className="acira-menu-title">{t("profiles.manage")}</span>
            <span />
          </button>
        </>
      )}
    </div>
  );
}
