import { useEffect, useRef, useState } from "react";
import { runtime } from "../../runtime/client";
import type { BrowserAction, BrowserSnapshot, ImportSource } from "../../runtime/types";
import { createSetupClient } from "../../services/accounts/setup-client";
import { applyImportedFavorites } from "../../ui/importedFavorites";
import { browserIconFor, browserLetter } from "../import-export/browserIcons";
import { SettingGroup } from "../settings/controls";
import { useT } from "../../i18n";
import { ProfileAvatar, profileColors, selectProfile } from "./profileModel";
import { profileSuggestions, suggestionCategories, suggestionDetail } from "./importSuggestions";

type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };
type Found = { list: ImportSource[]; icons?: Record<string, string> };
type Run = { status: "running" | "done" | "failed"; profileId?: string; message?: string };

const GRAPHITE = "";

/** "Bring in another account": browser profiles found on this computer that no Acira profile came from yet, each one click
 *  from being its own profile. Discovery reads only each browser's profile list (names, emails, pictures), the same as
 *  Settings › Import; bookmarks and history are read only after "Import as new profile". Hidden when nothing is found and
 *  in private windows. The import is setup's multi-account import for one source: `profiles.fromSource` makes the profile
 *  (named, colored and pictured from the source, marked for its short setup), then `imports.run` fills it. */
export function ProfileSuggestions({ state, dispatch }: Props) {
  const t = useT();
  const isPrivate = Boolean(state.browserProfiles.find((profile) => profile.id === state.activeBrowserProfileId)?.private);
  const [found, setFound] = useState<Found | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const client = useRef(createSetupClient(window.acira)).current;
  const profiles = useRef(state.browserProfiles);
  profiles.current = state.browserProfiles;
  useEffect(() => {
    if (isPrivate) return;
    let live = true;
    runtime
      .service({ type: "imports.discover" })
      .then((result) => {
        if (!live) return;
        // The list is settled once per visit, so a row that becomes a profile keeps its place and shows how it went.
        setFound({ list: profileSuggestions(result.sources, { profiles: profiles.current, importedSourceIds: result.imported }), icons: result.icons });
      })
      .catch(() => live && setFound(null));
    return () => {
      live = false;
    };
  }, [isPrivate]);
  if (isPrivate || !found?.list.length) return null;

  const settle = (id: string, run: Run) => setRuns((current) => ({ ...current, [id]: run }));
  const bring = async (source: ImportSource) => {
    if (runs[source.id]?.status === "running") return;
    settle(source.id, { status: "running" });
    let profileId = runs[source.id]?.profileId;
    try {
      if (!profileId) {
        const made = await client.request({ type: "profiles.fromSource", sourceId: source.id });
        profileId = made.createdProfileId;
        if (!made.ok || !profileId) throw new Error(made.error?.message || t("profiles.suggest.failed"));
      }
      for (const category of suggestionCategories(source)) {
        const response = await client.request({ type: "imports.run", sourceId: source.id, categories: [category], profileId });
        const item = response.batch?.results.find((entry) => entry.category === category);
        if (!response.ok || item?.status === "failed") throw new Error(item?.error || response.error?.message || t("profiles.suggest.failed"));
        // The sidebar's Favorites are the UI's to add, as in setup (importedFavorites.ts).
        if (category === "favorites" && response.batch) applyImportedFavorites(response.batch.profileId, response.batch.id, response.batch.favorites);
      }
      settle(source.id, { status: "done", profileId });
    } catch (error) {
      settle(source.id, { status: "failed", profileId, message: error instanceof Error && error.message ? error.message : t("profiles.suggest.failed") });
    }
  };

  return (
    <SettingGroup title={t("profiles.suggest.title")} id="profile-suggestions">
      <p className="pm-suggest-note">{t("profiles.suggest.note")}</p>
      {found.list.map((source) => {
        const run = runs[source.id];
        const icon = browserIconFor(found.icons, source.browser);
        const made = run?.profileId ? state.browserProfiles.find((profile) => profile.id === run.profileId) : undefined;
        const detail =
          run?.status === "running"
            ? t("profiles.suggest.copying", { browser: source.browser })
            : run?.status === "done" && made
              ? t("profiles.suggest.added", { name: made.name })
              : suggestionDetail(source);
        return (
          <div className="st-row st-profile pm-row pm-suggest" key={source.id} data-state={run?.status}>
            <span className="pm-suggest-face">
              <ProfileAvatar
                size={32}
                picture={source.picture}
                name={source.name}
                color={source.color || source.fillColor || GRAPHITE}
                avatar={source.initial ? [...source.initial][0]?.toLocaleUpperCase() : null}
              />
              <span className="pm-suggest-browser" data-letter={icon ? undefined : ""} aria-hidden="true">
                {icon ? <img src={icon} alt="" width={16} height={16} draggable={false} /> : browserLetter(source.browser)}
              </span>
            </span>
            <div className="st-copy">
              <span className="st-title">
                <bdi>{source.name}</bdi>
              </span>
              <p>{detail}</p>
              {run?.status === "failed" && run.message && (
                <p role="alert" className="pm-problem">
                  {run.message}
                </p>
              )}
            </div>
            <div className="st-control pm-control">
              {made && run?.status !== "running" ? (
                <button type="button" className="st-button" onClick={() => selectProfile(dispatch, made.id)}>
                  {t("profiles.open")}
                </button>
              ) : null}
              {run?.status !== "done" && (
                <button
                  type="button"
                  className="st-button"
                  disabled={run?.status === "running"}
                  aria-busy={run?.status === "running" || undefined}
                  aria-label={t("profiles.suggest.importNamed", { name: source.name, browser: source.browser })}
                  onClick={() => void bring(source)}
                >
                  {run?.status === "running" ? t("profiles.suggest.importing") : run?.status === "failed" ? t("profiles.suggest.retry") : t("profiles.suggest.import")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </SettingGroup>
  );
}
