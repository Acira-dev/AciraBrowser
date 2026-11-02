import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  DefaultBrowserStatus,
  ImportBatch,
  ImportCategory,
  ImportSource,
  SetupPreferences,
  SetupProgress,
  SetupRequest,
  SetupResult,
} from "../../services/accounts/setup-types";
import type { BrowserAction, BrowserProfile, Settings } from "../../runtime/types";
import type { ProtectionRow } from "../../runtime/nativeNetwork";
import type { CatalogArtwork } from "../../ui/newTabPreferences";
import { runtime } from "../../runtime/client";
import { BrandIcon } from "../../components/BrandLogo";
import { CheckMark } from "../../components/CheckMark";
import { ArrowUpRight, ChevronDown, ChevronRight, History } from "../../components/AppIcons";
import { Segmented } from "../../components/Segmented";
import { isWindows, isMac } from "../../ui/platform";
import { useConnection } from "../connection/useConnection";
import { VpnList } from "./VpnList";
import { SheetBack } from "./SheetBack";
import { SetupToastHost } from "./setupToast";
import { USAGE_COPY, useMetrics } from "../metrics/useMetrics";
import {UsageOffNotice} from '../metrics/UsageOffNotice';
import {UsageSent} from '../metrics/UsageSent';
import {SettingInfo} from '../../components/SettingInfo';
import { currentLocale, t, useT, type MessageId } from "../../i18n";
import { Shimmer } from "./vapor";
import { BrowserIcon, EngineMark, SourceAvatar } from "./marks";
import {
  PROFILE_NAME_MAX,
  ProfileAvatar,
  profileColors,
  saveProfile,
  setColor as setProfileColor,
  updateDetails,
  type ProfileDetails,
} from "../accounts/profileModel";
import { importCapabilities } from "./import-capabilities";
import { useSheetModal } from "./sheetModal";
import { PasswordsSheet } from "./PasswordsSheet";
import { applyImportedFavorites } from "../../ui/importedFavorites";

/** A step that decides on Continue (the cover) hands its commit to the card's footer here; Skip never calls it. */
export type StepApi = { apply?: () => void };

export type StepContext = {
  stepApi?: React.MutableRefObject<StepApi>;
  act: (request: SetupRequest) => Promise<SetupResult | null>;
  busy: boolean;
  dispatch: (action: BrowserAction) => void;
  /** The Look step's choice: switches the setup's tone at once (one crossfade) and saves the setting. */
  chooseAppearance?: (appearance: Settings["appearance"]) => void;
  settings: Settings;
  profiles: BrowserProfile[];
  profileId: string;
  preferences: SetupPreferences;
  setPreferences: (update: (value: SetupPreferences) => SetupPreferences) => void;
  defaults?: DefaultBrowserStatus;
  sources: ImportSource[] | null;
  batches: ImportBatch[];
  progress: SetupProgress | null;
  artwork: CatalogArtwork;
  reducedMotion: boolean;
  importer: Importer;
};

/* ── Rows: Apple inset-grouped (radius 6, 4% fill, no border, inset separators), one selection signal ── */

/** The one selection signal: a trailing accent check. */
export function Check({ on }: { on?: boolean }) {
  return (
    <CheckMark className="fr-check" data-on={on || undefined} size={16} />
  );
}

function PickRow({
  name,
  multiple,
  checked,
  disabled,
  onChange,
  icon,
  title,
  detail,
  tag,
  children,
}: {
  name: string;
  /** Any number can be chosen (a checkbox with a visible box); otherwise one, marked by the trailing check. */
  multiple?: boolean;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  /** A quiet word before the box ("New profile"): where a chosen row goes. */
  tag?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className="fr-row fr-pick" data-two={detail ? "" : undefined} data-multiple={multiple || undefined}>
      <input className="fr-visually-hidden" type={multiple ? "checkbox" : "radio"} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="fr-ico">{icon}</span>
      <span className="fr-row-text">
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </span>
      {multiple ? (
        <span className="fr-trail">
          {tag && <span className="fr-tag">{tag}</span>}
          <span className="fr-box" aria-hidden="true">
            <CheckMark size={12} />
          </span>
        </span>
      ) : (
        <Check />
      )}
      {children}
    </label>
  );
}

function ToggleRow({
  title,
  detail,
  info,
  checked,
  disabled,
  onChange,
  icon,
  link,
}: {
  title: string;
  detail: string;
  info?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  /** On a step whose other rows carry icons, the toggle takes one too, so every row shares one text edge. */
  icon?: React.ReactNode;
  /** A small text link after the detail ("What’s sent"). It sits outside the switch's label, so it never flips it. */
  link?: { label: string; onClick: () => void };
}) {
  const id = useId();
  if (link || info)
    return (
      <div className={icon ? "fr-row" : "fr-row fr-noicon"} data-two="">
        {icon && <span className="fr-ico">{icon}</span>}
        <span className="fr-row-text">
          <span className="fr-row-heading">
            <label htmlFor={id}><b>{title}</b></label>
            {info && <SettingInfo text={info}/>}
          </span>
          <small>
            <label htmlFor={id}>{detail}</label>{" "}
            {link && <button type="button" className="fr-link fr-inline-link" onClick={link.onClick}>
              {link.label}
            </button>}
          </small>
        </span>
        <input id={id} type="checkbox" role="switch" className="fr-toggle" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      </div>
    );
  return (
    <label className={icon ? "fr-row" : "fr-row fr-noicon"} data-two="">
      {icon && <span className="fr-ico">{icon}</span>}
      <span className="fr-row-text">
        <b>{title}</b>{info && <SettingInfo text={info}/>}
        <small>{detail}</small>
      </span>
      <input type="checkbox" role="switch" className="fr-toggle" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/* ── Import ──────────────────────────────────────────────────────────────── */

type Preview = NonNullable<SetupResult["preview"]>;
/** One chosen source's import, shown on its row. */
export type SourceRun = {
  total: number;
  done: number;
  current?: ImportCategory;
  counts: Partial<Record<ImportCategory, number>>;
  failed?: string;
  finished: boolean;
  batchIds: string[];
  /** The profile it went into: unset for the profile being set up, else the one made for it. */
  profileId?: string;
};
export type ImportRun = {
  /** "file" for a bookmarks file, "sources" for browser profiles. */
  sourceId: string;
  counts: Partial<Record<ImportCategory, number>>;
  failed?: string;
  finished: boolean;
  /** Native import batches this run made, for the "Imported … · Undo" toast after setup. */
  batchIds: string[];
  /** Where it came from, as the toast names it ("Chrome", "Chrome and Arc", "a bookmarks file"). */
  from: string;
  /** Profiles made for the second and later chosen sources (Undo removes them while they are still untouched). */
  profileIds: string[];
  rows: Record<string, SourceRun>;
};
export type Importer = ReturnType<typeof useImporter>;

/** What an import category is called, as a label ("Bookmarks") and inside a sentence ("Importing bookmarks…"). */
const shortLabel = (category: ImportCategory) => t(`setup.kind.${category}` as MessageId);
const lowerLabel = (category: ImportCategory) => t(`setup.kindLower.${category}` as MessageId);
const countLine = (counts: SourceRun["counts"]) =>
  [
    counts.spaces !== undefined ? t("setup.count.spaces", { count: counts.spaces }) : "",
    counts.favorites !== undefined ? t("setup.count.favorites", { count: counts.favorites }) : "",
    counts.bookmarks !== undefined ? t("setup.count.bookmarks", { count: counts.bookmarks }) : "",
    counts.history !== undefined ? t("setup.count.historyItems", { count: counts.history }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
/** "A, B and C" in the interface language. */
export const listOf = (items: string[]) => {
  try {
    return new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
};
/** A source profile's own name, unless it is a browser's placeholder ("Default", "Person 1", Zen's "Default (release)"). */
const ownName = (source: ImportSource) => (/^(default( \([^)]*\))?|person \d+|profile \d+|user|your chrome)$/i.test(source.name.trim()) ? "" : source.name.trim());

/** Import lives with the card, not the step: the footer's Import runs it and the card moves on once it lands. Any number
 *  of found profiles can be chosen. The first one (in list order) fills the profile being set up; each other one becomes
 *  its own profile, named and pictured from its source, with a short setup the first time it is opened. */
export function useImporter({
  act,
  dispatch,
  sources,
  active,
  profile,
}: {
  act: StepContext["act"];
  dispatch: StepContext["dispatch"];
  sources: ImportSource[] | null;
  active: boolean;
  /** The profile being set up: the first chosen source fills its empty photo and email, and its default name. */
  profile?: { id: string; name: string; picture?: string; email?: string };
}) {
  // null until the person chooses: the first profile found starts chosen.
  const [chosenIds, setChosenIds] = useState<string[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [run, setRun] = useState<ImportRun | null>(null);
  const [notice, setNotice] = useState("");
  const [icons, setIcons] = useState<Record<string, string>>({});
  // A failed search for other browsers ends "Looking for other browsers…" with a retry instead of spinning forever.
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const asked = useRef(false),
    previewed = useRef(new Set<string>());
  const ids = chosenIds ?? (sources?.[0] ? [sources[0].id] : []);
  const selected = (sources || []).filter((item) => ids.includes(item.id));
  const running = !!run && !run.finished;
  const discover = () => {
    setDiscoveryFailed(false);
    void act({ type: "imports.discover" }).then((response) => !response?.sources && setDiscoveryFailed(true));
  };
  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    discover();
    void act({ type: "imports.icons" }).then((response) => response?.icons && setIcons(response.icons));
  }, [act, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // A chosen row says what it holds before anything is copied (one preview per source, asked once).
  useEffect(() => {
    if (!active) return;
    const next = selected.find((item) => !previewed.current.has(item.id));
    if (!next) return;
    previewed.current.add(next.id);
    void act({ type: "imports.preview", sourceId: next.id }).then((response) => response?.preview && setPreviews((value) => ({ ...value, [next.id]: response.preview! })));
  }, [act, active, selected.map((item) => item.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (item: ImportSource) => {
    if (running) return;
    setChosenIds((value) => {
      const base = value ?? (sources?.[0] ? [sources[0].id] : []);
      return base.includes(item.id) ? base.filter((id) => id !== item.id) : [...base, item.id];
    });
  };
  const chooseAll = (on: boolean) => !running && setChosenIds(on ? (sources || []).map((item) => item.id) : []);
  // One category per native run, so each row's bar reflects work that actually finished rather than a timer. A source
  // that already imported is passed over when Import is pressed again after a failure.
  const start = async () => {
    if (!selected.length || running) return false;
    const next: ImportRun = {
      sourceId: "sources",
      counts: {},
      finished: false,
      batchIds: [...(run?.sourceId === "sources" ? run.batchIds : [])],
      from: listOf([...new Set(selected.map((item) => item.browser))]),
      profileIds: [...(run?.profileIds || [])],
      rows: { ...(run?.rows || {}) },
    };
    const publish = () => setRun({ ...next, rows: { ...next.rows } });
    setNotice("");
    let failed = "";
    for (const [index, source] of selected.entries()) {
      const before = next.rows[source.id];
      if (before?.finished && !before.failed) {
        for (const [key, value] of Object.entries(before.counts)) next.counts[key as ImportCategory] = (next.counts[key as ImportCategory] || 0) + (value || 0);
        continue;
      }
      // Arc's Favorites and Spaces first (what Arc people miss most), then bookmarks and history.
      const categories = (["favorites", "spaces", "bookmarks", "history"] as const).filter((kind) => importCapabilities(source).includes(kind));
      if (!categories.length) continue;
      const row: SourceRun = { total: categories.length, done: 0, counts: {}, finished: false, batchIds: [], profileId: before?.profileId };
      next.rows[source.id] = row;
      publish();
      if (index > 0 && !row.profileId) {
        const made = await act({ type: "profiles.fromSource", sourceId: source.id });
        if (!made?.createdProfileId) {
          row.failed = t("setup.import.profileFailed");
          row.finished = true;
          failed ||= row.failed;
          publish();
          continue;
        }
        row.profileId = made.createdProfileId;
        next.profileIds.push(made.createdProfileId);
      }
      for (const category of categories) {
        row.current = category;
        publish();
        const response = await act({ type: "imports.run", sourceId: source.id, categories: [category], ...(row.profileId ? { profileId: row.profileId } : {}) });
        const item = response?.batch?.results.find((entry) => entry.category === category);
        if (!response || item?.status === "failed") {
          row.failed = item?.error || t("setup.import.copyFailed", { what: lowerLabel(category) });
          break;
        }
        if (item?.status === "imported") row.counts[category] = item.count || 0;
        // The sidebar's Favorites are the UI's to add; Undo takes the same ones away (importedFavorites.ts).
        if (category === "favorites" && response.batch) row.counts.favorites = applyImportedFavorites(response.batch.profileId, response.batch.id, response.batch.favorites);
        if (response.batch?.id) {
          row.batchIds.push(response.batch.id);
          next.batchIds.push(response.batch.id);
        }
        row.done++;
      }
      row.current = undefined;
      row.finished = true;
      for (const [key, value] of Object.entries(row.counts)) next.counts[key as ImportCategory] = (next.counts[key as ImportCategory] || 0) + (value || 0);
      if (row.failed) failed ||= row.failed;
      else if (index === 0) adopt(source);
      publish();
    }
    next.finished = true;
    next.failed = failed || undefined;
    publish();
    return !failed;
  };
  // The first source's own photo, email and name, onto the profile being set up, only where it still has none (never
  // overwrites a choice: the name only while it is the default "Personal").
  const adopt = (source: ImportSource) => {
    if (!profile) return;
    const details: ProfileDetails = {};
    if (source.picture && !profile.picture) details.picture = source.picture;
    if (source.email && !profile.email) details.email = source.email;
    if (Object.keys(details).length) void updateDetails(profile.id, details);
    const name = ownName(source);
    if (name && profile.name === "Personal" && name !== profile.name) saveProfile(dispatch, profile.id, { name }); // i18n-ignore: the stored default name
  };
  const fromFile = async () => {
    const response = await act({ type: "imports.html" });
    if (response?.batch) {
      const count = response.batch.results.reduce((sum, item) => sum + (item.status === "imported" && item.category === "bookmarks" ? item.count || 0 : 0), 0); // an Acira profile file also brings history
      setRun({ sourceId: "file", counts: { bookmarks: count }, finished: true, batchIds: [response.batch.id], from: t("setup.fromFile"), profileIds: [], rows: {} });
      setNotice(t("setup.import.fileDone", { count }));
    } else if (response?.cancelled) setNotice(t("setup.import.fileNone"));
  };
  const imported =
    !!run?.finished &&
    !run.failed &&
    (run.sourceId === "file" || (selected.length > 0 && selected.every((item) => run.rows[item.id]?.finished && !run.rows[item.id].failed)));
  return {
    sources,
    selected,
    isChosen: (item: ImportSource) => ids.includes(item.id),
    toggle,
    chooseAll,
    previews,
    run,
    running,
    imported,
    start,
    fromFile,
    notice,
    icons,
    discoveryFailed: discoveryFailed && sources === null,
    discover,
  };
}

/** Every profile found, in one list that scrolls inside the card (no pages). Arrow keys move between rows, Space chooses;
 *  the list's edges fade only while more is hidden past them. */
export function ImportStep({ importer, busy, progress, reducedMotion }: StepContext) {
  useT();
  const { sources, run, previews, icons, selected } = importer;
  const [passwordsOpen, setPasswordsOpen] = useState(false);
  const fromBrowsers = [...new Set(selected.map((item) => item.browser))];
  const list = useRef<HTMLFieldSetElement>(null);
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  const measure = () => {
    const node = list.current;
    if (!node) return;
    const top = node.scrollTop > 1,
      bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setEdges((value) => (value.top === top && value.bottom === bottom ? value : { top, bottom }));
  };
  // Four rows tall, measured, so the list follows the rows' own style (K owns it) instead of assuming a height.
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > .fr-row") || [])];
    setHeight(rows.length > 4 ? rows.slice(0, 4).reduce((sum, row) => sum + row.offsetHeight, 0) : undefined);
    measure();
  }, [sources?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = (event: React.KeyboardEvent<HTMLFieldSetElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const inputs = [...event.currentTarget.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    const at = inputs.indexOf(document.activeElement as HTMLInputElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? inputs.length - 1 : Math.max(0, Math.min(inputs.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    inputs[next].focus({ preventScroll: true });
    inputs[next].closest(".fr-row")?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  };
  const detail = (item: ImportSource) => {
    const row = run?.sourceId === "sources" ? run.rows[item.id] : undefined;
    if (row) {
      if (row.failed) return row.failed;
      if (!row.finished) return row.current ? t("setup.import.importingKind", { what: lowerLabel(row.current) }) : t("setup.import.making");
      return t("setup.import.done", { what: countLine(row.counts) || t("setup.import.nothingNew") });
    }
    const who = item.email || (item.accountName && item.accountName !== item.name ? item.accountName : "");
    const preview = previews[item.id];
    const holds = preview
      ? [
          preview.spaces ? t("setup.count.spaces", { count: preview.spaces }) : "",
          preview.favorites ? t("setup.count.favorites", { count: preview.favorites }) : "",
          // Arc's bookmarks are its pinned tabs, already counted with their Spaces.
          !preview.spaces && typeof preview.bookmarks === "number" ? t("setup.count.bookmarks", { count: preview.bookmarks }) : "",
          typeof preview.history === "number" ? shortLabel("history") : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : importCapabilities(item)
          .filter((kind) => kind === "spaces" || kind === "favorites" || kind === "bookmarks" || kind === "history")
          .map((kind) => shortLabel(kind))
          .join(" · ");
    // The account and what it holds: when the line is too long (a long address, a wider language), the address gives way
    // and the counts stay whole.
    return who && holds ? (
      <span className="fr-detail-split">
        <span className="fr-detail-who">{who}</span>
        <span className="fr-detail-holds">{" · " + holds}</span>
      </span>
    ) : (
      who || holds
    );
  };
  const all = !!sources?.length && selected.length === sources.length;
  return (
    <div className="fr-import">
      <div className="fr-glabel">
        <span>{t("setup.import.found")}</span>
        {sources && sources.length > 1 && (
          <button className="fr-glabel-more" type="button" disabled={importer.running} onClick={() => importer.chooseAll(!all)}>
            {all ? t("setup.import.chooseNone") : t("setup.import.chooseAll")}
          </button>
        )}
      </div>
      <fieldset
        ref={list}
        className="fr-group fr-import-list"
        style={height ? { maxHeight: height } : undefined}
        data-fade-top={edges.top || undefined}
        data-fade-bottom={edges.bottom || undefined}
        onScroll={measure}
        onKeyDown={keys}
      >
        <legend className="fr-visually-hidden">{t("setup.import.legend")}</legend>
        {importer.discoveryFailed ? (
          <div className="fr-row fr-noicon" data-two="">
            <span className="fr-row-text">
              <b>{t("setup.import.unreadable")}</b>
              <small>{t("setup.import.unreadableHint")}</small>
            </span>
            <button className="fr-btn fr-btn-secondary" type="button" disabled={busy} onClick={importer.discover}>
              {t("setup.tryAgain")}
            </button>
          </div>
        ) : sources === null ? (
          <div className="fr-row fr-noicon" role="status">
            <Shimmer reduced={reducedMotion}>{t("setup.import.looking")}</Shimmer>
          </div>
        ) : !sources.length ? (
          <div className="fr-row fr-noicon">
            <span className="fr-row-text">
              <b>{t("setup.import.none")}</b>
            </span>
          </div>
        ) : (
          sources.map((item) => {
            const on = importer.isChosen(item);
            const row = run?.sourceId === "sources" ? run.rows[item.id] : undefined;
            const place = !on ? "" : selected[0]?.id === item.id ? t("setup.import.thisProfile") : t("setup.import.newProfile");
            return (
              <PickRow
                key={item.id}
                name="fr-source"
                multiple
                checked={on}
                disabled={importer.running}
                onChange={() => importer.toggle(item)}
                icon={
                  <>
                    <SourceAvatar source={item} size={20} />
                    <span className="fr-badge">
                      <BrowserIcon name={item.browser} icon={icons[item.browser]} size={12} />
                    </span>
                  </>
                }
                title={`${item.browser} · ${item.name}`}
                detail={detail(item)}
                tag={place}
              >
                {row && (
                  <i
                    className="fr-bar"
                    aria-hidden="true"
                    style={{ transform: `scaleX(${row.finished ? 1 : Math.max(0.06, (row.done + 0.5) / row.total)})` }}
                  />
                )}
              </PickRow>
            );
          })
        )}
      </fieldset>
      <p className="fr-note" role={importer.notice ? "status" : undefined}>
        {importer.notice || (progress?.importInterrupted ? t("setup.import.interrupted") + " " : "")}
        {!importer.notice && <FileLink disabled={busy || importer.running} onClick={() => void importer.fromFile()} />}
      </p>
      {/* Said plainly, here, because it was a surprise: a browser's sign-ins stay in that browser. */}
      <p className="fr-note fr-note-signins">
        <SignInsNote browser={fromBrowsers.length ? listOf(fromBrowsers) : t("setup.import.otherBrowser")} disabled={busy || importer.running} onPasswords={() => setPasswordsOpen(true)} />
      </p>
      {passwordsOpen && <PasswordsSheet from={fromBrowsers[0]} reducedMotion={reducedMotion} onClose={() => setPasswordsOpen(false)} />}
    </div>
  );
}

/** "Sign-ins stay in Chrome. … Bring your passwords": the sentence has a {link} slot, like the bookmarks-file one. */
function SignInsNote({ browser, disabled, onPasswords }: { browser: string; disabled: boolean; onPasswords: () => void }) {
  const [before, after = ""] = t("setup.import.signins", { browser }).split("{link}");
  return (
    <>
      {before}
      <button className="fr-link" type="button" disabled={disabled} onClick={onPasswords}>
        {t("setup.import.passwordsLink")}
      </button>
      {after}
    </>
  );
}

/** "Or use a bookmarks file.": the sentence comes from the catalog with a {link} slot, so each language places the link
 * where its grammar wants it. */
function FileLink({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const [before, after = ""] = t("setup.import.orFile").split("{link}");
  return (
    <>
      {before}
      <button className="fr-link fr-inline-link fr-inline-link-end" type="button" disabled={disabled} onClick={onClick}>
        {t("setup.import.fileLink")}
      </button>
      {after}
    </>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────── */

/** A profile color's name in the interface language. */
const colorName = (name: string) => t(`profileColor.${name.toLowerCase()}` as MessageId);

export function ProfileStep({ profiles, profileId, dispatch }: StepContext) {
  useT();
  const profile = profiles.find((item) => item.id === profileId);
  const [name, setName] = useState(profile?.name || "");
  const [color, setColor] = useState(profile?.color || profileColors[0].value);
  const saved = useRef({ name: profile?.name || "", color: profile?.color || "" });
  // Changes are saved as they settle (blur, Enter, a color pick), so Continue never has to wait on them.
  const commit = (next: { name?: string; color?: string }) => {
    if (!profile) return;
    // A cleared name keeps the profile's current one (the field shows it as its placeholder), so a colour picked meanwhile is still saved.
    const value = { name: (next.name ?? name).trim() || saved.current.name, color: next.color ?? color };
    if (!value.name || (value.name === saved.current.name && value.color === saved.current.color)) return;
    const renamed = value.name !== saved.current.name;
    saved.current = value;
    if (renamed) saveProfile(dispatch, profile.id, value);
    else setProfileColor(dispatch, profile.id, value.color);
  };
  // Unmount must save the latest draft; the mount-time closure would rename and
  // recolor the profile back to its initial values after blur already saved it.
  const commitOnExit = useRef(() => {});
  commitOnExit.current = () => commit({});
  useEffect(() => () => commitOnExit.current(), []);
  return (
    <div className="fr-profile" style={{ "--fr-profile-color": color } as React.CSSProperties}>
      <ProfileAvatar name={name || "P"} color={color} avatar={profile?.avatar} picture={profile?.picture} size={72} className="fr-profile-avatar" />
      <input
        className="fr-field"
        aria-label={t("setup.profile.nameLabel")}
        value={name}
        maxLength={PROFILE_NAME_MAX}
        autoComplete="off"
        spellCheck={false}
        placeholder={t("setup.personal")}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => commit({})}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit({});
        }}
      />
      <fieldset className="fr-swatches">
        <legend className="fr-visually-hidden">{t("setup.profile.colorLegend")}</legend>
        {profileColors.map((item) => (
          <label key={item.value} className="fr-swatch" title={colorName(item.name)}>
            <input
              type="radio"
              name="fr-profile-color"
              aria-label={colorName(item.name)}
              checked={color.toLowerCase() === item.value.toLowerCase()}
              onChange={() => {
                setColor(item.value);
                commit({ color: item.value });
              }}
            />
            <span style={{ background: item.value }} aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <p className="fr-note fr-profile-note">{t("setup.profile.colorNote")}</p>
    </div>
  );
}

/* ── Look ────────────────────────────────────────────────────────────────── */

const modes = [
  { value: "light", label: "setup.mode.light" },
  { value: "dark", label: "setup.mode.dark" },
  { value: "system", label: "setup.mode.auto" },
] as const;

/** A thin-line miniature of the Acira window at its real proportions, drawn on the thumbnail's own 136×86 pixel grid
 * with 1px lines: the tab strip (the active tab joins the toolbar) with the window's caption buttons, the toolbar with
 * back, forward, the address field and the profile, then a new tab page with its search field and four favorites. */
function Mini({ dark }: { dark: boolean }) {
  return (
    <svg className="fr-mini" data-dark={dark || undefined} viewBox="0 0 136 86" width="136" height="86">
      <rect className="m-frame" width="136" height="86" />
      <path className="m-bar" d="M6 14V7a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v7Z" />
      <rect className="m-line" x="10.5" y="7.5" width="4" height="4" rx="1.5" />
      <rect className="m-ink" x="18" y="9" width="20" height="1" />
      <rect className="m-line2" x="52.5" y="7.5" width="4" height="4" rx="1.5" />
      <rect className="m-ink2" x="60" y="9" width="16" height="1" />
      <rect className="m-ink2" x="105" y="8.5" width="5" height="1" />
      <rect className="m-line2" x="115.5" y="6.5" width="4" height="4" />
      <path className="m-line2" d="M125 6.5l4 4m0-4l-4 4" />
      <rect className="m-bar" y="14" width="136" height="12" />
      <path className="m-line" d="M11 17.5 8.5 20l2.5 2.5" />
      <path className="m-line2" d="M16 17.5l2.5 2.5-2.5 2.5" />
      <rect className="m-field" x="24.5" y="16.5" width="88" height="7" rx="3.5" />
      <rect className="m-ink" x="29" y="19.5" width="28" height="1" />
      <circle className="m-line2" cx="124" cy="20" r="3" />
      <rect className="m-rule" y="26" width="136" height="1" />
      <rect className="m-page" y="27" width="136" height="59" />
      <rect className="m-field" x="38.5" y="40.5" width="59" height="9" rx="4.5" />
      <circle className="m-line" cx="43.5" cy="44.5" r="2" />
      <path className="m-line" d="M45.5 46.5l1 1" />
      <rect className="m-ink2" x="48" y="44.5" width="22" height="1" />
      <rect className="m-line2" x="48.5" y="57.5" width="7" height="7" rx="2" />
      <rect className="m-line2" x="59.5" y="57.5" width="7" height="7" rx="2" />
      <rect className="m-line2" x="70.5" y="57.5" width="7" height="7" rx="2" />
      <rect className="m-line2" x="81.5" y="57.5" width="7" height="7" rx="2" />
    </svg>
  );
}

/** Setup asks only for light, dark or automatic; finish and layout come right after, live, in "Make it yours". */
export function AppearanceStep({ settings, dispatch, chooseAppearance }: StepContext) {
  useT();
  return (
    <>
      <fieldset className="fr-looks">
        <legend className="fr-visually-hidden">{t("setup.summary.appearance")}</legend>
        {modes.map((mode) => (
          <label key={mode.value} className="fr-look">
            <input
              type="radio"
              name="fr-appearance"
              checked={settings.appearance === mode.value}
              onChange={() =>
                chooseAppearance ? chooseAppearance(mode.value) : dispatch({ type: "settings.update", patch: { appearance: mode.value } })
              }
            />
            <span className="fr-thumb" data-auto={mode.value === "system" || undefined} aria-hidden="true">
              <Mini dark={mode.value === "dark"} />
              {mode.value === "system" && <Mini dark />}
            </span>
            {t(mode.label)}
          </label>
        ))}
      </fieldset>
      <p className="fr-note fr-look-note">{t("setup.look.note")}</p>
    </>
  );
}

/* ── Search ──────────────────────────────────────────────────────────────── */

const engines = [
  { value: "google", name: "Google", line: "setup.engine.google" }, // i18n-ignore: product name
  { value: "duckduckgo", name: "DuckDuckGo", line: "setup.engine.duckduckgo" }, // i18n-ignore: product name
  { value: "bing", name: "Bing", line: "setup.engine.bing" }, // i18n-ignore: product name
] as const;

export function SearchStep({ settings, dispatch }: StepContext) {
  useT();
  return (
    <>
      <fieldset className="fr-group">
        <legend className="fr-visually-hidden">{t("setup.search.legend")}</legend>
        {engines.map((engine) => (
          <PickRow
            key={engine.value}
            name="fr-engine"
            checked={settings.searchEngine === engine.value}
            onChange={() => dispatch({ type: "settings.update", patch: { searchEngine: engine.value } })}
            icon={<EngineMark engine={engine.value} size={16} />}
            title={engine.name}
            detail={t(engine.line)}
          />
        ))}
      </fieldset>
      <div className="fr-group">
        <ToggleRow
          icon={<History size={16} />}
          title={t("setup.suggest.title")}
          detail={t("setup.suggest.detail")}
          checked={settings.addressSuggestions}
          onChange={(value) => dispatch({ type: "settings.update", patch: { addressSuggestions: value } })}
        />
      </div>
    </>
  );
}

/* ── Privacy ─────────────────────────────────────────────────────────────── */

/** Local app/adapter detection is a discovery hint. Only the provider status in the VPN panel attests to a tunnel. */
function vpnFound(detected: { name: string; how: string }[]) {
  const names = listOf(detected.map((item) => item.name));
  return { names, row: t("vpn.control.detected", { names }) };
}

/** Phishing and malware warnings read "On" unless the protection service says they are off or unavailable, and "Getting ready…" while the first lists are still downloading (nothing is checked yet). */
type PhishingState = "on" | "off" | "preparing";
const phishingState = (rows?: ProtectionRow[]): PhishingState => {
  const state = rows?.find((row) => row.id === "phishing-malware")?.state ?? "";
  return state === "preparing" ? "preparing" : ["off", "unavailable"].includes(state) ? "off" : "on";
};

/** What this running copy really does, read-only, for the Ready summary: the same services as Settings › Privacy. */
export function useProtectionFacts() {
  const [facts, setFacts] = useState<{ phishing?: PhishingState; aiFree?: boolean }>({});
  useEffect(() => {
    let live = true;
    runtime
      .service({ type: "protection.status" })
      .then((response) => live && setFacts((now) => ({ ...now, phishing: phishingState(response.protection?.rows) })))
      .catch(() => {});
    runtime
      .service({ type: "filters.profile-status" })
      .then((response) => live && setFacts((now) => ({ ...now, aiFree: !!response.filters?.aiContent })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return facts;
}

export function PrivacyStep({ preferences, setPreferences, act, busy }: StepContext) {
  useT();
  const blocking = preferences.blocking ?? true;
  const [rows, setRows] = useState<ProtectionRow[]>();
  // The facts come from what this running copy really does (the same service as Settings › Privacy).
  useEffect(() => {
    let live = true;
    runtime
      .service({ type: "protection.status" })
      .then((response) => live && setRows(response.protection?.rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const toggle = (value: boolean) => {
    setPreferences((current) => ({ ...current, blocking: value }));
    void act({ type: "preferences", patch: { blocking: value } }).then((response) => {
      if (!response) setPreferences((current) => ({ ...current, blocking: !value }));
    });
  };
  // Two facts in plain words (C12): the lede already says third-party cookies are blocked, filter lists were jargon,
  // and there is no sync to report. Any more rows would push the last one under the fixed card's footer.
  // AI-free mode is the profile's filter choice `aiContent` (J's filters service, off by default); it is the same
  // choice as Settings › Privacy, so it is read and written there, not through the setup preferences.
  const [aiFree, setAiFree] = useState<boolean>();
  useEffect(() => {
    let live = true;
    runtime
      .service({ type: "filters.profile-status" })
      .then((response) => live && setAiFree(!!response.filters?.aiContent))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const toggleAiFree = (value: boolean) => {
    setAiFree(value);
    runtime
      .service({ type: "filters.profile-set", patch: { aiContent: value } })
      .then((response) => setAiFree(!!response.filters?.aiContent))
      .catch(() => setAiFree(!value));
  };
  // Phishing and malware warnings: the profile's `phishingLists` choice, the one Settings › Privacy & security edits.
  const [phishing, setPhishing] = useState<boolean>();
  useEffect(() => {
    let live = true;
    runtime
      .service({ type: "antitracking.status" })
      .then((response) => live && setPhishing(response.antiTracking?.settings.phishingLists !== false))
      .catch(() => live && setPhishing(true));
    return () => {
      live = false;
    };
  }, []);
  const togglePhishing = (value: boolean) => {
    setPhishing(value);
    runtime
      .service({ type: "antitracking.set", patch: { phishingLists: value } })
      .then((response) => {
        setPhishing(response.antiTracking?.settings.phishingLists !== false);
        return runtime.service({ type: "protection.status" });
      })
      .then((response) => setRows(response.protection?.rows))
      .catch(() => setPhishing(!value));
  };
  // Connection (J's useConnection, the same hook as Settings › Privacy): "Use my VPN app" needs nothing and makes no
  // service call; a proxy is set up in a sheet over the card and only applied from there.
  const connection = useConnection();
  const [sheet, setSheet] = useState(false);
  const applied = connection.status?.choice?.mode === "fixed_servers" ? connection.status.choice.server : null;
  const detected = connection.detected;
  // Only this new-setup surface initializes an unset choice. Saved choices, including opt-outs, are preserved atomically.
  const usage = useMetrics({newSetup: true});
  const [payload, setPayload] = useState(false);
  return (
    <div className="fr-privacy-controls">
      <div className="fr-group">
        <ToggleRow
          title={t("setup.block.title")}
          info={t('help.blocking')}
          detail={blocking ? t("setup.block.on") : t("setup.block.off")}
          checked={blocking}
          disabled={busy}
          onChange={toggle}
        />
        <ToggleRow
          title={t("setup.aiFree.title")}
          info={t('help.aiFree')}
          detail={aiFree ? t("setup.aiFree.on") : t("setup.aiFree.off")}
          checked={!!aiFree}
          disabled={busy || aiFree === undefined}
          onChange={toggleAiFree}
        />
        {/* The whole row opens the Connection sheet; its value is quiet and ends on a chevron, like a Settings row. */}
        <button
          className="fr-row fr-noicon fr-pick fr-more"
          data-two=""
          type="button"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => setSheet(true)}
        >
          <span className="fr-row-text">
            <b>{t("setup.connection.title")}</b>
            <small>
              {applied
                ? t("setup.connection.proxyLine", { address: `${applied.host}:${applied.port}` })
                : detected.length
                  ? vpnFound(detected).row
                  : t("setup.connection.default")}
            </small>
          </span>
          <span className="fr-val fr-more-val">
            {applied ? t("setup.connection.valueProxy") : detected.length ? t("setup.connection.valueVpn") : t("setup.connection.valueDefault")}
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        </button>
        {/* A real switch, on by default (R4-07): the same choice as Settings › Privacy & security (`antitracking` phishingLists), read and written through the same service. */}
        <ToggleRow
          title={t("privacy.phishingProtection")}
          info={t("setup.phishing.info")}
          detail={phishing === false ? t("setup.phishing.detailOff") : phishingState(rows) === "preparing" ? t("setup.gettingReady") : t("setup.phishing.detailOn")}
          checked={phishing !== false}
          disabled={busy || phishing === undefined}
          onChange={togglePhishing}
        />
      </div>
      {sheet && <ConnectionSheet connection={connection} onClose={() => setSheet(false)} />}
      {/* Setup's status pop-up lives here, not in the sheet: "Added" outlives the sheet it was raised from. */}
      <SetupToastHost />
      {/* Protections and data sharing are two groups, so what keeps you safe never reads as something you hand over. */}
      <div className="fr-group">
        {/* The visible default and explanation are part of new setup; an existing choice always wins. */}
        <ToggleRow
          title={t("setup.usage.title")}
          detail={usage.problem || t('usage.setupExplanation')}
          info={t('setup.usage.info')}
          checked={usage.enabled}
          disabled={busy || !usage.ready || usage.busy}
          onChange={(value) => void usage.set(value)}
          link={{ label: t("setup.usage.link"), onClick: () => setPayload(true) }}
        />
      </div>
      {payload && <UsageSheet usage={usage} onClose={() => setPayload(false)} />}
      {usage.offNotice && <UsageOffNotice onClose={usage.dismissOffNotice}/>}
    </div>
  );
}

/** "What’s sent": J's plain ask, the exact message (the same object the sender serialises; a placeholder id while off)
 * and how the id is forgotten. Read-only: the switch stays on the row. Escape, Enter or Done closes it. */
function UsageSheet({ usage, onClose }: { usage: ReturnType<typeof useMetrics>; onClose: () => void }) {
  const [card, setCard] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => setCard(anchor.current?.closest<HTMLElement>(".fr-card") ?? null), []);
  useSheetModal(card);
  useLayoutEffect(() => {
    if (!card) return;
    const surface = sheet.current;
    surface?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement, target = opener.current;
      if (active !== document.body && active && !surface?.contains(active)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
      });
    };
  }, [card]);
  // Like the Connection sheet, it owns Escape and Enter while open, ahead of setup's own keys (skip, continue).
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      // This read-only sheet has one action. Keep both Tab directions on Done.
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        sheet.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.stopImmediatePropagation();
      if (event.key === "Enter" && (event.target as HTMLElement | null)?.closest?.("button")) return;
      event.preventDefault();
      closed.current();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);
  const node = (
    <div ref={sheet} className="fr-sheet" role="dialog" aria-modal="true" aria-labelledby="fr-usage-title">
      <SheetBack onClick={onClose} />
      <div className="fr-sheet-main fr-sheet-usage">
        <h2 id="fr-usage-title" className="fr-sheet-title">
          {USAGE_COPY.title}
        </h2>
        <p className="fr-sheet-line">{USAGE_COPY.ask}</p>
        {usage.status && <UsageSent status={usage.status} />}
        <pre className="fr-group fr-sheet-code" aria-label={t("setup.usage.codeLabel")}>
          {usage.payloadText}
        </pre>
        <p className="fr-note fr-sheet-note">{USAGE_COPY.detail}</p>
      </div>
      <footer className="fr-foot">
        <div className="fr-foot-start" />
        <span />
        <div className="fr-foot-end">
          <button className="fr-btn fr-btn-primary" type="button" autoFocus onClick={onClose}>
            {t("app.close")}
          </button>
        </div>
      </footer>
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {card && createPortal(node, card)}
    </>
  );
}

/** The proxy sheet: covers the card (its own Cancel and Apply sit on the footer grid), offers J's two choices and, for a
 * proxy, its type, address and a test that talks only to the proxy. Apply goes through Acira's native confirm; the sheet
 * closes once it is applied. Cancel puts back what was there. */
function ConnectionSheet({ connection: c, onClose }: { connection: ReturnType<typeof useConnection>; onClose: () => void }) {
  const [card, setCard] = useState<HTMLElement | null>(null);
  const sheetRoot=useRef<HTMLDivElement>(null),opener=useRef(document.activeElement as HTMLElement|null),retryPending=useRef(false);
  const focusSheet=()=>{const node=sheetRoot.current;if(!node)return;const first=node.querySelector<HTMLElement>('input,[role="radio"][aria-checked="true"],button:not(:disabled)');(first||node).focus({preventScroll:true});};
  useLayoutEffect(()=>{if(!card)return;focusSheet();return()=>{const target=opener.current;requestAnimationFrame(()=>{if(target?.isConnected)target.focus({preventScroll:true})});};},[card]);
  useEffect(()=>{if(retryPending.current&&c.ready&&!c.loading){retryPending.current=false;focusSheet();}},[c.ready,c.loading]);
  const anchor = useRef<HTMLSpanElement>(null);
  const before = useRef({ mode: c.mode, scheme: c.scheme, host: c.host, port: c.port });
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => setCard(anchor.current?.closest<HTMLElement>(".fr-card") ?? null), []);
  useSheetModal(card);
  // The sheet closes on a new result that changed something (J's doneKind: "unchanged" when the confirm was declined).
  // It arms once the result clears, which every apply does first, so a second identical result closes it too.
  const armed = useRef(false);
  useEffect(() => {
    if (!c.doneKind) armed.current = true;
    else if (armed.current && c.doneKind !== "unchanged") closed.current();
  }, [c.doneKind]);
  const cancel = () => {
    const saved=c.status?.choice;
    // A read/retry may finish after the sheet opened. Cancel restores the
    // confirmed native choice rather than the empty, still-loading draft.
    const was=saved?.mode==='fixed_servers'?{mode:'proxy' as const,scheme:saved.server.scheme,host:saved.server.host,port:String(saved.server.port)}:saved?{mode:'vpn' as const,scheme:'http' as const,host:'',port:''}:before.current;
    c.setMode(was.mode);
    c.setScheme(was.scheme);
    c.setHost(was.host);
    c.setPort(was.port);
    onClose();
  };
  const canApply = c.ready && c.valid && !c.busy;
  // Choosing "Use my VPN app" while no proxy is saved changes nothing, so there is nothing to apply: the sheet only says Done.
  const hasProxy = c.status?.choice?.mode === "fixed_servers";
  const nothingToApply = c.mode === "vpn" && !hasProxy;
  // While the sheet is open it owns Escape (cancel) and Enter (apply), wherever focus is (a button that disables itself
  // drops focus to the page): caught at the window before setup's own keys, which would skip setup or continue. Enter on
  // a focused button still presses that button.
  const latest = useRef({ cancel, canApply, apply: c.apply, nothingToApply });
  latest.current = { cancel, canApply, apply: c.apply, nothingToApply };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if(event.key==="Tab"){
        const node=sheetRoot.current;if(!node)return;
        const controls=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex]')].filter(item=>item.tabIndex>=0&&item.getClientRects().length>0);
        const first=controls[0],last=controls[controls.length-1];
        if(!first){event.preventDefault();node.focus();return;}
        if(!node.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        latest.current.cancel();
      } else if (event.key === "Enter" && !event.isComposing) {
        event.stopImmediatePropagation();
        if ((event.target as HTMLElement | null)?.closest?.("button")) return;
        event.preventDefault();
        if (latest.current.nothingToApply) latest.current.cancel();
        else if (latest.current.canApply) void latest.current.apply();
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);
  const proxy = c.mode === "proxy";
  const node = (
    <div className="fr-sheet" ref={sheetRoot} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fr-sheet-title">
      <SheetBack onClick={cancel} />
      <div className="fr-sheet-main">
        <h2 id="fr-sheet-title" className="fr-sheet-title">
          {t("setup.connection.title")}
        </h2>
        <p className="fr-sheet-line">{t("setup.connection.intro")}</p>
        <Segmented
          label={t("setup.connection.title")}
          value={c.mode}
          options={[["vpn", t("setup.connection.useVpn")], ["proxy", t("setup.connection.useProxy")]] as const}
          onChange={c.setMode}
        />
        {!proxy && <VpnList openSite={c.openProvider} detected={c.detected} />}
        {proxy && (
          <div className="fr-group fr-sheet-group">
            <div className="fr-row fr-noicon">
              <span className="fr-row-text">
                <b>{t("setup.proxy.type")}</b>
              </span>
              <Segmented
                label={t("setup.proxy.typeLabel")}
                value={c.scheme}
                options={[["http", t("setup.proxy.http")], ["socks5", "SOCKS5"]] as const}
                onChange={c.setScheme}
              />
            </div>
            <div className="fr-row fr-noicon">
              <span className="fr-row-text">
                <b>{t("setup.proxy.address")}</b>
              </span>
              <span className="fr-sheet-address">
                <input
                  className="fr-sheet-input"
                  aria-label={t("setup.proxy.host")}
                  placeholder="proxy.example.com"
                  spellCheck={false}
                  autoFocus
                  value={c.host}
                  onChange={(event) => c.setHost(event.target.value)}
                />
                <input
                  className="fr-sheet-input fr-sheet-port"
                  aria-label={t("setup.proxy.port")}
                  inputMode="numeric"
                  placeholder="8080"
                  value={c.port}
                  onChange={(event) => c.setPort(event.target.value)}
                />
              </span>
            </div>
            <div className="fr-row fr-noicon" data-two="">
              <span className="fr-row-text">
                <b>{t("setup.proxy.test")}</b>
                <small role="status">
                  {c.test ? t(c.test.ok ? "setup.proxy.works" : "setup.proxy.problem", { message: c.test.message }) : t("setup.proxy.testHint")}
                </small>
              </span>
              <button className="fr-btn fr-btn-text" type="button" disabled={c.busy || !c.valid} onClick={() => void c.runTest()}>
                {t("setup.proxy.testButton")}
              </button>
            </div>
          </div>
        )}
        {c.loading&&<p className="fr-note" role="status">{t("local.loadingConnection")}</p>}
        {!c.ready&&c.problem&&<button type="button" className="fr-btn fr-btn-text" aria-disabled={c.loading} onClick={()=>{if(!c.loading){retryPending.current=true;c.reload();}}}>{c.loading?t('cleanup.checking'):t('setup.tryAgain')}</button>}
        {/* The VPN list explains its own scope. Proxy help and connection errors stay with the proxy controls. */}
        <div className="fr-disclose" data-open={c.problem || proxy || undefined}>
          <div className="fr-disclose-in">
            <p className="fr-note fr-sheet-note" role={c.problem ? "alert" : undefined}>
              {c.problem || (isWindows()?t("setup.proxy.tor"):"Applies only to this Acira profile.")}
            </p>
          </div>
        </div>
      </div>
      <footer className="fr-foot">
        <div className="fr-foot-start">
          {/* Back returns to the Privacy step and drops anything not yet applied (the same as Esc and the arrow above). */}
          <button className="fr-btn fr-btn-text" type="button" onClick={cancel}>
            {t("setup.back")}
          </button>
        </div>
        <span />
        <div className="fr-foot-end">
          {nothingToApply ? (
            <button className="fr-btn fr-btn-primary" type="button" onClick={cancel}>
              {t("setup.done")}
            </button>
          ) : (
            <button className="fr-btn fr-btn-primary" type="button" disabled={!canApply} onClick={() => void c.apply()}>
              {c.busy ? t("setup.applying") : t("setup.apply")}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {card && createPortal(node, card)}
    </>
  );
}

/* ── Default browser ─────────────────────────────────────────────────────── */

export function DefaultStep({ defaults, act, busy }: StepContext) {
  useT();
  const isDefault = !!defaults?.isDefault;
  const detail = isDefault
    ? t("setup.default.detailIs")
    : defaults?.requested
      ? (isMac() ? t("setup.default.detailRequested.mac") : t("setup.default.detailRequested"))
      : defaults && !defaults.supported
        ? defaults.note
        : t("setup.default.detailWill");
  return (
    <div className="fr-group">
      <div className="fr-row" data-two="" role="status">
        <span className="fr-ico">
          <BrandIcon size={16} />
        </span>
        <span className="fr-row-text">
          <b>{isDefault ? t("setup.default.isDefault") : t("setup.summary.defaultBrowser")}</b>
          <small>{detail}</small>
        </span>
        {isDefault ? (
          <Check on />
        ) : defaults?.requested ? (
          <button className="fr-btn fr-btn-secondary" type="button" disabled={busy} onClick={() => void act({ type: "status" })}>
            {t("setup.default.checkAgain")}
          </button>
        ) : (
          <button className="fr-btn fr-btn-secondary" type="button" disabled={busy || !defaults?.supported} onClick={() => void act({ type: "default.request" })}>
            {t("setup.default.set")}
          </button>
        )}
      </div>
    </div>
  );
}
