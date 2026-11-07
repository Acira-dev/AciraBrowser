import { NativeNetworkSettings } from "./NativeNetworkSettings";
import "../styles/native-network.css";
import { PageZoomControls } from "../components/PageZoomControls";
import { MenuCustomizer } from "../components/MenuCustomizer";
import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { NewTabSettings } from "./NewTabSettings";
import { NewTabPreview } from "./settings/NewTabPreview";
import { setRailPrefs } from "../ui/railPrefs";
import { ChoiceCards, MiniBrowser, type MiniLayout } from "./settings/ChoiceCards";
import { TabLayoutRow } from "./settings/TabLayoutRow";
import { Segmented } from "../components/Segmented";
import { animationSpeedOf } from "../ui/sharedMotion";
import { miniTheme } from "./settings/miniTheme";
import { onSettingsTarget, raiseSettingsIntent, settingsDestination, settingsIntentSection, settingsView, settingsViewKey, takeSettingsTarget } from "../ui/settingsView";
import { toolbarLayout, toolbarLayoutPatch } from "../runtime/toolbarLayout";
import { formatShortcut } from "../ui/platform";
import { matchesSystemTheme, systemThemeActions, useSystemTheme } from "../ui/systemTheme";
import { shortcutFor } from "../ui/shortcutKeys";
import { toolbarVisibilityItems } from "../ui/toolbarMenu";
import { resetToolbarItems } from "../ui/toolbarPrefs";
import { effectiveView, seamlessEdgesOf, windowViews, type WindowView } from "../runtime/windowView";
import { windowViewDetail, windowViewName } from "../ui/windowViewText";
import { MiniView } from "./settings/WindowViewCards";
import { AddressInSidebarRow, SidebarEdgeRows, SidebarModeRow } from "./settings/SidebarRows";
import { SidebarGroups } from "./settings/panels/sidebar";
import type {
  BrowserAction,
  BrowserSnapshot,
  Settings,
} from "../runtime/types";
import {
  GlassFinishPicker,
  AppearanceColorWell,
} from "../components/AppearanceControls";
import { EditorGlyph, type EditorIconName } from "../components/EditorGlyph";
import { AciraGlyph, type AciraGlyphName } from "../components/AciraGlyphs";
import { BrandLogo } from "../components/BrandLogo";
import { ArrowLeft } from "../components/AppIcons";
import { ContentTransition } from "../components/ContentTransition";
import { runtime } from "../runtime/client";
import {
  palettePreference,
  defaultAppearancePalette,
} from "../runtime/appearancePalettes";
import { ImportPanel, ProfilePrivacy } from "./BrowserData";
import { useNewTabPreferences, defaultArtwork } from "../ui/newTabPreferences";
import { newTabChanged } from "./settings/changed";
import { SettingsSearch } from "./settings/SettingsSearch";
import {
  Select,
  SettingCrossLink,
  SettingGroup,
  SettingNote,
  SettingRow,
  SettingsNavContext,
  Switch,
} from "./settings/controls";
import { revealSetting } from "./settings/jump";
import { SettingsViewContext } from "./settings/draft";
import { DefaultBrowserRow } from "./settings/DefaultBrowserRow";
import {
  findSetting,
  settingsRegistry,
  settingsSections,
  type SettingsContext,
  type SettingsEntry,
} from "./settings/registry";
import { settingsPanels } from "./settings/panels";
import { PhishingProtection } from "./settings/panels/anti-tracking";
import { ProfileScope, scopedSetting } from "./settings/ProfileScope";
import {currentSearchProviders,sharedProvidersConfigured} from '../ui/searchSettings';
import "./browser-settings.css";
import "../styles/neutral-primary.css";
import "./settings/settings.css";

import { t as tr, translateText } from '../i18n';
type Props = {
  state: BrowserSnapshot;
  dispatch: (a: BrowserAction) => void;
  onNavigate?: (url: string) => void;
};

const sectionGlyphs: Record<string, AciraGlyphName> = {
  Appearance: "appearance",
  Profiles: "profile",
  Tabs: "tabs",
  "New tab": "empty",
  Search: "search",
  Privacy: "privacy",
  Accessibility: "accessibility",
  "Import & export": "transfer",
  // Round 2 (A): the sections that fell back to filled icons, drawn in the same stroke family.
  Extensions: "extensions",
  Downloads: "download",
  Passwords: "passwords",
  Shortcuts: "shortcuts",
  "Web apps": "webApps",
  Connection: "connection",
  About: "about",
};
const panelIcons: Record<string, EditorIconName> = {};

function GlassOpacityControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value),
    editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => {
    const finish = () => {
      editing.current = false;
      setDraft(currentValue.current);
    };
    window.addEventListener("blur", finish);
    return () => window.removeEventListener("blur", finish);
  }, []);
  return (
    <label className="st-range">
      <input
        aria-label={tr("appearancecontrols.windowOpacity")}
        type="range"
        min="40"
        max="100"
        step="1"
        value={draft}
        disabled={disabled}
        style={
          { "--fill": `${((draft - 40) / 60) * 100}%` } as React.CSSProperties
        }
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          const next = Number(e.target.value);
          setDraft(next);
          onChange(next);
        }}
        onBlur={() => {
          editing.current = false;
          setDraft(value);
        }}
      />
      <span>{draft}%</span>
    </label>
  );
}

const navSections = (() => {
  const extra = [
    ...new Set(settingsPanels.map((panel) => panel.section)),
  ].filter((name) => !(settingsSections as readonly string[]).includes(name));
  return [
    ...settingsSections.filter((name) => name !== "About"),
    ...extra,
    "About",
  ];
})();
/** The sidebar reads as three groups: who you are, how you browse, and everything else (About last). */
const navGroups = (() => {
  const you = ["Profiles", "Appearance", "Tabs", "New tab"], browsing = ["Search", "Privacy", "Connection", "Passwords", "Downloads", "Extensions"];
  const take = (names: string[]) => names.filter((name) => navSections.includes(name));
  const placed = new Set([...you, ...browsing]);
  const rest = navSections.filter((name) => !placed.has(name) && name !== "About");
  return [
    { title: "You", items: take(you) },
    { title: tr("browsersettings.browsing"), items: take(browsing) },
    { title: tr("browsersettings.advanced"), items: [...rest, "About"] },
  ].filter((group) => group.items.length);
})();
for (const panel of settingsPanels)
  if (panel.icon && !sectionGlyphs[panel.section])
    panelIcons[panel.section] = panel.icon;

const sectionLede: Record<string, string> = {
  Appearance: tr("settingslede.appearance"),
  Profiles: tr("settingslede.profiles"),
  Tabs: tr("settingslede.tabs"),
  Connection: tr("settingslede.connection"),
  "New tab": tr("settingslede.newTab"),
  Search: tr("settingslede.search"),
  Privacy: tr("settingslede.privacy"),
  Accessibility: tr("settingslede.accessibility"),
  "Import & export": tr("settingslede.importExport"),
  Extensions: tr("settingslede.extensions"),
  Downloads: tr("settingslede.downloads"),
  Shortcuts: tr("settingslede.shortcuts"),
  "Web apps": tr("settingslede.webApps"),
  Languages: tr("settingslede.languages"),
  About: tr("settingslede.about"),
};

const profilePanels = settingsPanels.filter(
  (panel) => panel.section === "Profiles",
);

export function BrowserSettings({ state, dispatch }: Props) {
  const desktopTheme = useSystemTheme();
  const tab = state.tabs.find((tab) => tab.id === state.activeTabId)!,
    view = settingsView(settingsViewKey(tab));
  const [section, publishSection] = useState(view.section),
    [name, publishName] = useState(view.name),
    [query, publishQuery] = useState(view.query),
    [jump, setJump] = useState<{ entry: SettingsEntry; serial: number } | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    main = useRef<HTMLElement>(null);
  const setSection = (value: string) => {
      view.section = value;
      view.scrollTop = 0;
      publishSection(value);
      if (main.current) main.current.scrollTop = 0;
    },
    setName = (value: string) => {
      view.name = value;
      publishName(value);
    },
    setQuery = (value: string) => {
      view.query = value;
      publishQuery(value);
    };
  /** Until when a layout change is settling (see below); the scroll is not kept while it does. */
  const layoutSettles = useRef(0), scrollTrail = useRef<[number, number][]>([]);
  useLayoutEffect(() => {
    const node = main.current;
    if (!node) return;
    node.scrollTop = view.scrollTop;
    // The position is kept as it changes, not only when this page goes away (an element that has moved reports 0 by then).
    let restoring = true;
    const settled = requestAnimationFrame(() => { restoring = false; });
    // Heard on the document (a scroll does not bubble, but it can be captured): the page's box may be replaced while this view stays.
    const remember = (event: Event) => { const box = main.current; if (!restoring && event.target === box && box && performance.now() >= layoutSettles.current) { view.scrollTop = box.scrollTop; scrollTrail.current = [...scrollTrail.current.slice(-7), [performance.now(), box.scrollTop]]; } };
    document.addEventListener('scroll', remember, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(settled);
      document.removeEventListener('scroll', remember, { capture: true });
      if (node.isConnected && performance.now() >= layoutSettles.current) view.scrollTop = node.scrollTop;
    };
  }, [view]);
  // A switch that moves the toolbar or the tabs (Sidebar mode, Address bar in the sidebar, the Tabs cards) makes the window lay out again,
  // and the page's box changes size for a moment: the browser pulls the scroll in, and nothing puts it back. For a moment after such a
  // change the kept position is not overwritten, and it is put back each time the page's size changes and once more when the moment ends.
  const layoutKey = `${state.settings.verticalTabs}|${state.settings.addressInSidebar}`, layoutSeen = useRef(layoutKey);
  useLayoutEffect(() => {
    if (layoutSeen.current === layoutKey) return;
    layoutSeen.current = layoutKey;
    // The browser's pull can come before this runs, so the position to keep is the last one that stood for a moment.
    const node = main.current, keep = scrollTrail.current.filter(([at]) => at < performance.now() - 300).at(-1)?.[1] ?? view.scrollTop;
    if (!node || !keep) return;
    layoutSettles.current = performance.now() + 1600;
    const put = () => { if (node.isConnected && node.scrollTop !== keep && node.scrollHeight - node.clientHeight >= keep) node.scrollTop = keep; view.scrollTop = keep; };
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(put) : null;
    watch?.observe(node);
    for (const child of Array.from(node.children)) watch?.observe(child);
    const timer = window.setTimeout(() => { put(); watch?.disconnect(); layoutSettles.current = 0; }, 1600);
    return () => { window.clearTimeout(timer); watch?.disconnect(); };
  }, [layoutKey]);
  const s = {
      ...state.settings,
      reducedTransparency:
        state.userReducedTransparency ?? state.settings.reducedTransparency,
    },
    update = (patch: Partial<Settings>) =>
      dispatch({ type: "settings.update", patch });
  const tabLayout = s.verticalTabs ? "sidebar" : "toolbar";
  const animationSpeed = animationSpeedOf(s);
  const osReducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const profile = state.browserProfiles.find(
    (item) => item.id === tab.browserProfileId,
  )!;
  const windowView = effectiveView(s, state.windowUi);
  /** Both stores in one step, so the card, the strip and the sidebar always agree (Appearance › Layout and Tabs share this). */
  const chooseTabLayout = (layout: MiniLayout) => {
    update({ verticalTabs: layout === "sidebar" });
    setRailPrefs({ tabs: layout === "sidebar" }, tab.browserProfileId, profile?.private);
  };
  const toolbarItems = toolbarVisibilityItems(s, tab).filter(
    (item) => item.id !== "toolbarLayout" && item.id !== "bookmarksBar",
  );
  const [selectedZoomTab, setSelectedZoomTab] = useState(view.zoomTargetTabId);
  const zoomTabs = state.tabs.filter(
    (item) =>
      item.contentKind === "web" &&
      item.browserProfileId === tab.browserProfileId,
  );
  const zoomTarget =
    zoomTabs.find(
      (item) => item.id === (selectedZoomTab || state.windowUi.zoomTargetTabId),
    ) || zoomTabs.at(-1);
  const customColors = typeof s.glassOpacity === "number";
  const [newTabPrefs] = useNewTabPreferences(profile?.id, profile?.private);
  const toolbarChanged =
    s.showHome === false ||
    s.showTabOverview === false ||
    Boolean(s.bookmarksBar) ||
    s.bookmarksOnNewTabOnly === false;
  const defaultLook = palettePreference(defaultAppearancePalette) as Record<
    string,
    unknown
  >;
  const appearanceChanged =
    Object.entries(defaultLook).some(
      ([key, value]) =>
        (s as unknown as Record<string, unknown>)[key] !== value,
    ) ||
    s.interfaceScale !== 100 ||
    Boolean(s.systemTheme) ||
    Boolean(s.reducedMotion) ||
    s.animationSpeed === "fast" ||
    Boolean(s.reducedTransparency) ||
    (customColors &&
      (s.glassOpacity !== 64 ||
        Boolean(s.surfaceColor) ||
        Boolean(s.sidebarColor) ||
        Boolean(s.toolbarColor) ||
        Boolean(s.tabColor)));
  const newTabIsChanged = newTabChanged(newTabPrefs, defaultArtwork);
  const stockSearch = !sharedProvidersConfigured(state) && ['google','duckduckgo','bing'].includes(currentSearchProviders(state).defaultId);
  const context: SettingsContext = useMemo(
    () => ({
      customGlassColors: customColors,
      privateProfile: Boolean(profile?.private),
      desktop: Boolean(runtime.platform),
      systemTheme: desktopTheme.supported,
      websiteOpen: Boolean(zoomTarget),
      appearanceChanged,
      toolbarChanged,
      newTabChanged: newTabIsChanged,
      stockSearch,
      verticalTabs: Boolean(s.verticalTabs),
    }),
    [
      customColors,
      profile?.private,
      Boolean(zoomTarget),
      appearanceChanged,
      toolbarChanged,
      newTabIsChanged,
      stockSearch,
      s.verticalTabs,
      desktopTheme.supported,
    ],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(
        target &&
          (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)),
      );
      const slash =
        event.key === "/" &&
        !editing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey;
      const find =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f";
      if (!slash && !find) return;
      event.preventDefault();
      window.dispatchEvent(new Event("acira:settings-focus-search"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const firstSection = useRef(true);
  useLayoutEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      return;
    }
    if (main.current) main.current.scrollTop = 0;
    view.scrollTop = 0;
  }, [section]);

  useEffect(() => {
    if (!jump || !main.current) return;
    let live = true;
    void revealSetting(main.current, jump.entry, s.reducedMotion).then(
      (found) => {
        if (live)
          setNotice(
            found
              ? `${jump.entry.title}. ${translateText(jump.entry.section)}.`
              : tr("browsersettings.settingUnavailable", { title: jump.entry.title }),
          );
      },
    );
    return () => {
      live = false;
    };
  }, [jump]);

  const openEntry = (entry: SettingsEntry) => {
    setQuery("");
    setSection(entry.section);
    setJump((previous) => ({ entry, serial: (previous?.serial ?? 0) + 1 }));
  };

  /** Landing from elsewhere ("Manage profiles", "Change it in Settings"): open the section, or the control with the arrival
   *  highlight. Only the visible Settings tab takes the target, whichever renderer asked for it. */
  const arrive = useRef<() => void>(() => {});
  arrive.current = () => {
    const node = main.current;
    if (!node || !node.offsetParent) return;
    const target = takeSettingsTarget(settingsDestination(tab.id, state.windowId));
    if (!target) return;
    const entry = target.setting ? findSetting(target.setting) : undefined;
    if (entry) { openEntry(entry); return; }
    if (target.section && settingsRegistry.some((item) => item.section === target.section)) {
      setQuery("");
      setSection(target.section);
    }
    // An intent (the profile menu's "Add profile…") lands in its own section, then the control that does it takes it.
    if (target.intent) {
      setQuery("");
      setSection(settingsIntentSection[target.intent]);
      raiseSettingsIntent(settingsViewKey(tab), target.intent);
    }
  };
  useEffect(() => {
    arrive.current();
    const stop = onSettingsTarget(() => arrive.current(), settingsDestination(tab.id, state.windowId));
    const node = main.current;
    const watch = node && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => arrive.current()) : null;
    if (node) watch?.observe(node);
    return () => { stop(); watch?.disconnect(); };
  }, [tab.id, state.windowId]);

  const nav = useRef<HTMLElement>(null),
    [navScrolls, setNavScrolls] = useState(false);
  /** In a short window or at a large interface size the rows scroll inside the column; Back to browser stays pinned below them. */
  useLayoutEffect(() => {
    const node = nav.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setNavScrolls(node.scrollHeight > node.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  const content = (
    <>
      {section === "Appearance" && (
        <>
          <SettingGroup title={tr("settings.layoutGroup")} id="layout">
            <TabLayoutRow layout={tabLayout} onChange={chooseTabLayout} columns={4} />
            <SidebarModeRow state={state} dispatch={dispatch} />
            <AddressInSidebarRow state={state} dispatch={dispatch} />
            <SettingRow
              id="window-view"
              title={tr("windowview.title")}
              detail={windowViewDetail(windowView) + (windowView === "focus" ? " " + tr("browsersettings.focusShortcutHint", { shortcut: shortcutFor("focus-mode", "Ctrl Shift F") ?? formatShortcut("Ctrl Shift F") }) : windowView === "seamless" ? " " + tr("browsersettings.focusShortcutHint", { shortcut: shortcutFor("seamless-mode", "Ctrl Shift L") ?? formatShortcut("Ctrl Shift L") }) : "")}
              stacked
            >
              <ChoiceCards
                label={tr("windowview.title")}
                value={windowView}
                onChange={(mode: WindowView) => update({ windowView: mode })}
                options={windowViews.map((mode) => ({ value: mode, label: windowViewName(mode), art: <MiniView view={mode} layout={tabLayout} /> }))}
              />
            </SettingRow>
            {windowView !== "seamless" && <SidebarEdgeRows state={state} dispatch={dispatch} />}
            {windowView === "seamless" && !(tabLayout === "sidebar" && s.addressInSidebar) && (
              <SettingRow id="seamless-edge-top" title={tr("windowview.edgeTop")}>
                <Switch
                  label={tr("windowview.edgeTop")}
                  checked={seamlessEdgesOf(s).top}
                  onChange={(top) => update({ seamlessEdges: { ...seamlessEdgesOf(s), top } })}
                />
              </SettingRow>
            )}
            {windowView === "seamless" && <SidebarEdgeRows state={state} dispatch={dispatch} />}
          </SettingGroup>
          <SettingGroup title={tr("settings.themeGroup")}>
            <SettingRow
              id="appearance-mode"
              title={tr("app.appearance")}
              detail={tr("core.lightDarkOrFollowYour")}
              stacked
            >
              <ChoiceCards
                label={tr("app.appearance")}
                value={s.appearance}
                onChange={(appearance) => scopedSetting(state, dispatch, "appearance", appearance, () => update({ appearance }))}
                options={[
                  { value: "light", label: tr("appearancecontrols.light"), theme: miniTheme(s, false), art: <MiniBrowser layout={tabLayout} /> },
                  { value: "dark", label: tr("appearancecontrols.dark"), theme: miniTheme(s, true), art: <MiniBrowser layout={tabLayout} /> },
                  { value: "system", label: tr("appearancecontrols.auto"), art: <MiniBrowser layout={tabLayout} halves={[miniTheme(s, false), miniTheme(s, true)]} /> },
                ]}
              />
            </SettingRow>
            <ProfileScope state={state} dispatch={dispatch} setting="appearance" id="appearance-scope" />
            {desktopTheme.supported && (
              <SettingRow
                id="match-system-theme"
                title={tr("systemtheme.title")}
                detail={tr("systemtheme.detail")}
              >
                <Switch
                  label={tr("systemtheme.title")}
                  checked={matchesSystemTheme(s)}
                  onChange={(on) => systemThemeActions(state, on).forEach(dispatch)}
                />
              </SettingRow>
            )}
            <SettingRow
              id="glass-finish"
              title={tr("appearancecontrols.finish")}
              detail={tr("browsersettings.finishDetail")}
              stacked
            >
              <GlassFinishPicker settings={s} onChange={update} size={20} />
            </SettingRow>
          </SettingGroup>
          {customColors && (
            <SettingGroup title={tr("browsersettings.colors")} fold foldDetail={tr("core.colorsTheWindowFrameTabs")}>
              <SettingRow
                id="glass-opacity"
                title={tr("appearancecontrols.windowOpacity")}
                detail={tr("browsersettings.opacityDetail")}
              >
                <GlassOpacityControl
                  value={s.glassOpacity!}
                  disabled={false}
                  onChange={(glassOpacity) => update({ glassOpacity })}
                />
              </SettingRow>
              {(
                [
                  ["surfaceColor", tr("core.pages"), "surface-color"],
                  ["sidebarColor", tr("browsersettings.sidebarAndFrame"), "sidebar-color"],
                  ["toolbarColor", tr("browsersettings.toolbar"), "toolbar-color"],
                  ["tabColor", tr("acirasidebar.tabs"), "tab-color"],
                ] as const
              ).map(([key, label, anchor]) => (
                <SettingRow
                  key={key}
                  id={anchor}
                  title={label}
                  detail={
                    s[key] ? tr("browsersettings.customColor") : tr("browsersettings.followsFinish")
                  }
                >
                  <AppearanceColorWell
                    label={label}
                    value={s[key] || s.browserTint}
                    onChange={(value) => update({ [key]: value })}
                  />
                  <button
                    type="button"
                    className="st-button"
                    aria-label={tr("browsersettings.resetTolowercaseColor", { toLowerCase: label.toLowerCase() })}
                    disabled={!s[key]}
                    onClick={() => update({ [key]: undefined })}
                  >
                    {tr("browsersettings.reset")}
                  </button>
                </SettingRow>
              ))}
            </SettingGroup>
          )}
          <SettingGroup title={tr("ntp.backgroundGroup")} id="newtab-background-group">
            <NewTabPreview profile={profile} />
            <NewTabSettings profile={profile} part="background" />
            <SettingCrossLink to="newtab-shortcut-editor" section="New tab" title={tr("ntp.layoutGroup")} />
          </SettingGroup>
          <SettingGroup title={tr("settings.interfaceGroup")}>
            <SettingRow
              id="interface-size"
              title={tr("browsersettings.interfaceSize")}
              detail={tr("browsersettings.interfaceSizeDetail")}
            >
              <Select
                label={tr("browsersettings.interfaceSize")}
                value={s.interfaceScale}
                options={[80, 90, 100, 110, 125, 150].map((n) => ({
                  value: n,
                  label: `${n}%`,
                }))}
                onChange={(interfaceScale) => update({ interfaceScale })}
              />
            </SettingRow>
            <SettingRow
              id="animation-speed"
              title={tr("browsersettings.animationSpeed")}
              detail={
                animationSpeed === "off"
                  ? osReducedMotion
                    ? tr("browsersettings.animationSystemOff")
                    : tr("browsersettings.animationOffDetail")
                  : animationSpeed === "fast"
                    ? tr("browsersettings.animationFastDetail")
                    : tr("browsersettings.animationPremiumDetail")
              }
            >
              <Segmented
                label={tr("browsersettings.animationSpeed")}
                value={animationSpeed}
                options={[
                  ["premium", tr("browsersettings.animationPremium")],
                  ["fast", tr("browsersettings.animationFast")],
                  ["off", tr("browsersettings.animationOff")],
                ] as const}
                onChange={(speed) => update(speed === "off" ? { reducedMotion: true } : { reducedMotion: false, animationSpeed: speed })}
              />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title={tr("browsersettings.toolbar")}>
            {toolbarItems.map((item) => (
              <SettingRow
                key={item.id}
                id={`toolbar-${item.id}`}
                title={item.label}
              >
                <Switch
                  label={item.label}
                  checked={item.checked}
                  onChange={() => dispatch(item.action)}
                />
              </SettingRow>
            ))}
            <SettingRow id="bookmarks-bar" title={tr("browsersettings.bookmarksBar")}>
              <Select
                label={tr("browsersettings.bookmarksBar")}
                value={
                  !s.bookmarksBar
                    ? "never"
                    : s.bookmarksOnNewTabOnly
                      ? "start"
                      : "always"
                }
                options={[
                  { value: "start", label: tr("browsersettings.onNewTabs") },
                  { value: "always", label: tr("browsersettings.always") },
                  { value: "never", label: tr("browsersettings.never") },
                ]}
                onChange={(value) =>
                  update(
                    value === "never"
                      ? { bookmarksBar: false }
                      : {
                          bookmarksBar: true,
                          bookmarksOnNewTabOnly: value === "start",
                        },
                  )
                }
              />
            </SettingRow>
            <SettingRow
              id="toolbar-customize"
              title={tr("app.customizeToolbar")}
              detail={tr("browsersettings.customizeToolbarDetail")}
            >
              <button
                type="button"
                className="st-button"
                onClick={() =>
                  void runtime.browserCommand({
                    type: "ui",
                    tabId: state.activeTabId,
                    action: "open",
                    kind: "customize-toolbar",
                  })
                }
              >
                {tr("browsersettings.customize")}
              </button>
            </SettingRow>
            {toolbarChanged && (
              <SettingRow
                id="toolbar-reset"
                title={tr("browsersettings.resetToolbarControls")}
                detail={tr("browsersettings.resetToolbarDetail")}
              >
                <button
                  type="button"
                  className="st-button"
                  onClick={() => {
                    resetToolbarItems(tab.browserProfileId);
                    update({
                      showHome: true,
                      showTabOverview: true,
                      bookmarksBar: false,
                      bookmarksOnNewTabOnly: true,
                    });
                  }}
                >
                  {tr("browsersettings.reset")}
                </button>
              </SettingRow>
            )}
          </SettingGroup>
          <SettingGroup title={tr("menucustomizer.title")} id="menu-customize-group" fold foldDetail={tr("settings.menuFoldDetail")}>
            <SettingRow
              id="menu-customize"
              title={tr("menucustomizer.rowTitle")}
              detail={tr("menucustomizer.detail")}
              stacked
            >
              <MenuCustomizer profileId={tab.browserProfileId} reduced={s.reducedMotion} />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title={tr("app.pageZoom")} fold foldDetail={tr("core.makeOneWebsiteLargerOr")}>
            <SettingRow
              id="page-zoom-site"
              title={tr("browsersettings.website")}
              detail={tr("browsersettings.websiteZoomDetail")}
            >
              {zoomTarget ? (
                <Select
                  label={tr("browsersettings.websiteToZoom")}
                  value={zoomTarget.id}
                  options={zoomTabs.map((item) => ({
                    value: item.id,
                    label: item.title || item.url,
                  }))}
                  onChange={(id) => {
                    view.zoomTargetTabId = id;
                    setSelectedZoomTab(id);
                  }}
                />
              ) : (
                <span className="st-muted">
                  {tr("browsersettings.openAWebsiteToChange")}
                </span>
              )}
            </SettingRow>
            {zoomTarget && (
              <SettingRow
                id="page-zoom"
                title={tr("app.pageZoom")}
                detail={new URL(zoomTarget.url).origin}
              >
                <PageZoomControls tab={zoomTarget} />
              </SettingRow>
            )}
          </SettingGroup>
          {appearanceChanged && (
            <SettingGroup>
              <SettingRow
                id="reset-appearance"
                title={tr("browsersettings.resetAppearance")}
                detail={tr("browsersettings.resetAppearanceDetail")}
              >
                <button
                  type="button"
                  className="st-button"
                  onClick={() =>
                    update({
                      ...palettePreference(defaultAppearancePalette),
                      interfaceScale: 100,
                      ...(s.systemTheme ? { systemTheme: false } : {}),
                      reducedMotion: false,
                      animationSpeed: "premium",
                      reducedTransparency: false,
                      ...(customColors
                        ? {
                            glassOpacity: 64,
                            surfaceColor: undefined,
                            sidebarColor: undefined,
                            toolbarColor: undefined,
                            tabColor: undefined,
                          }
                        : {}),
                    })
                  }
                >
                  {tr("browsersettings.reset")}
                </button>
              </SettingRow>
            </SettingGroup>
          )}
        </>
      )}
      {section === "Profiles" && (
        <>
          {profilePanels.length > 0 ? (
            profilePanels.map((panel, index) => (
              <panel.Component
                key={`profiles-${index}`}
                state={state}
                dispatch={dispatch}
              />
            ))
          ) : (
            <>
              <SettingGroup>
                {state.browserProfiles
                  .filter((p) => !p.private)
                  .map((p, index) => (
                    <div
                      className="st-row st-profile"
                      key={p.id}
                      data-setting={index === 0 ? "profile-list" : undefined}
                    >
                      <span
                        className="st-avatar"
                        style={{ background: p.color }}
                        aria-hidden="true"
                      >
                        {p.name[0]}
                      </span>
                      <div className="st-copy">
                        <span className="st-title">{p.name}</span>
                        <p>
                          {tr("browsersettings.separateSignInsBookmarksHistory")}
                        </p>
                      </div>
                      <div className="st-control">
                        {p.id === state.activeBrowserProfileId ? (
                          <span className="st-muted">{tr("browsersettings.current")}</span>
                        ) : (
                          <button
                            type="button"
                            className="st-button"
                            onClick={() =>
                              dispatch({
                                type: "browser.profile.select",
                                id: p.id,
                              })
                            }
                          >
                            {tr("app.open")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </SettingGroup>
              <SettingGroup title={tr("browsersettings.addAProfile")}>
                <form
                  className="st-row st-form"
                  data-setting="profile-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim()) {
                      dispatch({ type: "browser.profile.create", name });
                      setName("");
                    }
                  }}
                >
                  <input
                    className="st-input"
                    aria-label={tr("browsersettings.newProfileName")}
                    placeholder={tr("browsersettings.workOrPersonal")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                  <button
                    type="submit"
                    className="st-button primary"
                    disabled={!name.trim()}
                  >
                    {tr("browsersettings.createProfile")}
                  </button>
                </form>
              </SettingGroup>
            </>
          )}
        </>
      )}
      {section === "New tab" && (
        <SettingGroup>
          <NewTabPreview profile={profile} />
          <SettingCrossLink to="newtab-art-style" section="Appearance" title={tr("ntp.backgroundGroup")} />
          <NewTabSettings profile={profile} part="layout" />
        </SettingGroup>
      )}
      {section === "Tabs" && (
        <>
          <SettingGroup>
            <TabLayoutRow layout={tabLayout} onChange={chooseTabLayout} />
            <SettingCrossLink to="window-view" section="Appearance" title={tr("windowview.title")} />
          </SettingGroup>
          <SidebarGroups state={state} dispatch={dispatch} />
          <SettingGroup>
            <SettingRow
              id="compact-tab-titles"
              title={tr("browsersettings.showTitlesInCompactTabs")}
              detail={tr("browsersettings.compactTitlesDetail")}
            >
              <Switch
                label={tr("browsersettings.showTitlesInCompactTabs")}
                checked={Boolean(s.compactTabTitles)}
                onChange={(compactTabTitles) => update({ compactTabTitles })}
              />
            </SettingRow>
            <SettingRow
              id="tab-viewer-density"
              title={tr("browsersettings.allOpenTabsView")}
              detail={(s.tabViewerDensity ?? "comfortable") === "compact" ? tr("browsersettings.compactViewDetail") : tr("browsersettings.comfortableViewDetail")}
            >
              <Select
                label={tr("browsersettings.allOpenTabsView")}
                value={s.tabViewerDensity ?? "comfortable"}
                options={[
                  { value: "comfortable", label: tr("browsersettings.comfortable") },
                  { value: "compact", label: tr("browsersettings.compact") },
                ]}
                onChange={(value) => update({ tabViewerDensity: value as "comfortable" | "compact" })}
              />
            </SettingRow>
            <SettingRow id="tab-hover-card" title={tr("tabhovercard.title")} detail={tr("tabhovercard.detail")}>
              <Select
                label={tr("tabhovercard.title")}
                value={s.tabHoverCard ?? "preview"}
                options={[
                  { value: "preview", label: tr("tabhovercard.optPreview") },
                  { value: "name", label: tr("tabhovercard.optName") },
                  { value: "off", label: tr("tabhovercard.optOff") },
                ]}
                onChange={(value) => update({ tabHoverCard: value as "preview" | "name" | "off" })}
              />
            </SettingRow>
            <SettingRow id="link-preview" title={tr("linkpreview.title")} detail={tr("linkpreview.detail")}>
              <Switch
                label={tr("linkpreview.title")}
                checked={s.linkPreview !== false}
                onChange={(linkPreview) => update({ linkPreview })}
              />
            </SettingRow>
            <SettingRow id="open-tabs-in-front" title={tr("tabsinfront.title")} detail={tr("tabsinfront.detail")}>
              <Switch
                label={tr("tabsinfront.title")}
                checked={Boolean(s.openTabsInFront)}
                onChange={(openTabsInFront) => update({ openTabsInFront })}
              />
            </SettingRow>
            <SettingRow id="ask-before-closing" title={tr("closeGuard.askTitle")} detail={tr("closeGuard.askDetail")}>
              <Switch
                label={tr("closeGuard.askTitle")}
                checked={s.askBeforeClosing !== false}
                onChange={(askBeforeClosing) => update({ askBeforeClosing })}
              />
            </SettingRow>
            <SettingRow
              id="on-startup"
              title={tr("onstartup.title")}
              detail={s.onStartup === "newtab" ? tr("onstartup.detailNewTab") : tr("onstartup.detailContinue")}
            >
              <Select
                label={tr("onstartup.title")}
                value={s.onStartup === "newtab" ? "newtab" : "continue"}
                options={[
                  { value: "continue", label: tr("onstartup.optContinue") },
                  { value: "newtab", label: tr("onstartup.optNewTab") },
                ]}
                onChange={(value) => update({ onStartup: value as "continue" | "newtab" })}
              />
            </SettingRow>
          </SettingGroup>
        </>
      )}
      {section === "Search" && (
        <SettingGroup>
          {stockSearch && (
            <>
            <SettingRow id="search-engine" title={tr("browsersettings.addressBarSearchEngine")}>
              <Select
                label={tr("browsersettings.searchEngine")}
                value={s.searchEngine}
                options={[
                  { value: "google", label: tr("browsersettings.google") },
                  { value: "duckduckgo", label: "DuckDuckGo" }, // i18n-ignore product name
                  { value: "bing", label: tr("browsersettings.bing") },
                ]}
                onChange={(searchEngine) =>
                  scopedSetting(state, dispatch, "searchProviderId", searchEngine, () => update({
                    searchEngine: searchEngine as Settings["searchEngine"],
                    ...(s.searchProviders
                      ? {
                          searchProviders: {
                            ...s.searchProviders,
                            defaultId: searchEngine,
                          },
                        }
                      : {}),
                  }))
                }
              />
            </SettingRow>
            <ProfileScope state={state} dispatch={dispatch} setting="searchProviderId" id="search-scope" />
            </>
          )}
          <SettingRow
            id="address-suggestions"
            title={tr("browsersettings.localAddressSuggestions")}
            detail={tr("browsersettings.addressSuggestionsDetail")}
          >
            <Switch
              label={tr("browsersettings.localAddressSuggestions")}
              checked={Boolean(s.addressSuggestions)}
              onChange={(addressSuggestions) => update({ addressSuggestions })}
            />
          </SettingRow>
          <SettingCrossLink to="filters-ai" section="Privacy" title={tr("browsermenu.aiFreeMode")} />
        </SettingGroup>
      )}
      {section === "Privacy" && (
        <>
          {/* R4-07: phishing and malware protection is the first thing on this page, its own named and searchable row. */}
          <PhishingProtection disabled={Boolean(profile?.private)} />
          <ProfilePrivacy state={state} />
          <NativeNetworkSettings part="gpc">
            <SettingCrossLink to="proxy" section="Connection" title={tr("settings.proxyDnsLink")} />
          </NativeNetworkSettings>
          <SettingGroup title={tr("browsersettings.privateBrowsing")}>
            <SettingRow
              id="incognito"
              title={tr("browsersettings.privateWindow")}
              detail={tr("browsersettings.privateWindowDetail")}
            >
              <button
                type="button"
                className="st-button"
                onClick={() => runtime.openWindow("private")}
              >
                {tr("browsersettings.openWindow")}
              </button>
            </SettingRow>
            <SettingCrossLink to="rewind-enabled" section="Tabs" title={tr("browsermenu.rewind")} />
          </SettingGroup>
        </>
      )}
      {section === "Accessibility" && (
        <SettingGroup>
          <SettingRow
            id="reduce-motion"
            title={tr("browsersettings.reduceMotion")}
            detail={tr("browsersettings.reduceMotionDetail")}
          >
            <Switch
              label={tr("browsersettings.reduceMotion")}
              checked={Boolean(s.reducedMotion)}
              onChange={(reducedMotion) => update({ reducedMotion })}
            />
          </SettingRow>
          <SettingRow
            id="reduce-transparency"
            title={tr("browsersettings.reduceTransparency")}
            detail={
              state.systemReducedTransparency
                ? tr("browsersettings.systemOpaqueDetail")
                : tr("browsersettings.reduceTransparencyDetail")
            }
          >
            <Switch
              label={tr("browsersettings.reduceTransparency")}
              checked={Boolean(s.reducedTransparency)}
              onChange={(reducedTransparency) =>
                update({ reducedTransparency })
              }
            />
          </SettingRow>
          <SettingCrossLink to="animation-speed" section="Appearance" title={tr("browsersettings.animationSpeed")} />
        </SettingGroup>
      )}
      {section === "Import & export" && (
        <ImportPanel key={state.activeBrowserProfileId} state={state} />
      )}
      {/* R6: About leads its page (the version and the setup), then the update, the known limits and the extras. */}
      {section === "About" && (
        <SettingGroup>
          <div className="st-about" data-setting="about-version">
            <BrandLogo />
            <p>{tr("browsersettings.acira")}</p>
            <p className="st-muted">
              {tr("browsersettings.aCalmBrowserBuiltWith")}
            </p>
          </div>
          <DefaultBrowserRow />
          <SettingRow
            id="browser-setup"
            title={tr("browsersettings.runSetupAgain")}
            detail={tr("browsersettings.runSetupAgainDetail")}
          >
            <button
              type="button"
              className="st-button"
              onClick={() =>
                window.dispatchEvent(new Event("acira:restart-setup"))
              }
            >
              {tr("browsersettings.runSetupAgain")}
            </button>
          </SettingRow>
        </SettingGroup>
      )}
      {settingsPanels
        .filter((panel) => panel.section === section && section !== "Profiles")
        .map((panel, index) => (
          <panel.Component
            key={`${panel.section}-${index}`}
            state={state}
            dispatch={dispatch}
          />
        ))}
    </>
  );
  const goToSetting = (id: string) => {
    const entry = findSetting(id);
    if (entry) openEntry(entry);
  };
  return (
    <SettingsViewContext.Provider value={view}>
      <SettingsNavContext.Provider value={goToSetting}>
      <div className="browser-settings settings-acira">
        <aside className="bs-sidebar">
          <div className="bs-brand">
            <BrandLogo mark />
            <span>{tr("browsermenu.settings")}</span>
          </div>
          <nav ref={nav} aria-label={tr("browsersettings.settingsSections")}>
            {navGroups.flatMap(({ title, items }) => [
              <div key={"group-" + title} className="bs-nav-label" role="presentation">{translateText(title)}</div>,
              ...items.map((label) => (
              <button
                key={label}
                className={section === label ? "selected" : ""}
                aria-current={section === label ? "page" : undefined}
                aria-label={translateText(label)}
                onClick={() => {
                  setSection(label);
                  setQuery("");
                }}
              >
                <span className="bs-nav-icon" aria-hidden="true">
                  {sectionGlyphs[label] ? (
                    <AciraGlyph name={sectionGlyphs[label]} size={16} />
                  ) : (
                    <EditorGlyph name={panelIcons[label] ?? "tabs"} />
                  )}
                </span>
                <span>{translateText(label)}</span>
              </button>
              )),
            ])}
          </nav>
          <div className="bs-sidebar-foot" data-raised={navScrolls || undefined}>
            <button
              type="button"
              className="bs-back"
              aria-label={tr("browsersettings.backToBrowser")}
              onClick={() => {
                const tab = state.tabs.find((t) => t.id === state.activeTabId);
                if (tab && tab.historyIndex > 0)
                  void runtime.browserCommand({ type: "back", tabId: tab.id });
                else if (tab) dispatch({ type: "tab.close", id: tab.id });
              }}
            >
              <ArrowLeft size={15} />
              {/* A span like the nav labels: the narrow rail hides `.bs-back > span` (settings.css, frost-preview.css). As a bare text
                  node it wrapped into the 52px rail as "Zurüc / zum / Brows" between 541 and 620px (200% page zoom, a narrow pane). */}
              <span>{tr("browsersettings.backToBrowser")}</span>
            </button>
          </div>
        </aside>
        <main
          ref={main}
          className="bs-main"
          onScroll={(e) => {
            view.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          <header className="st-toolbar">
            <SettingsSearch
              query={query}
              onQuery={setQuery}
              context={context}
              onSelect={openEntry}
            />
          </header>
          <div className="st-sr-only" role="status" aria-live="polite">
            {notice}
          </div>
          <ContentTransition
            reduced={s.reducedMotion}
            scene={section}
            className="bs-page"
          >
            <h1 data-form-item>{translateText(section)}</h1>
            {sectionLede[section] && (
              <p className="st-lede" data-form-item>{sectionLede[section]}</p>
            )}
            {content}
          </ContentTransition>
        </main>
      </div>
      </SettingsNavContext.Provider>
    </SettingsViewContext.Provider>
  );
}
export { warmMiniBrowser as warmSettingsPaint } from "./settings/ChoiceCards";
