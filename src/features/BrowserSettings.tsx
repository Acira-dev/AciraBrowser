import { NativeNetworkSettings } from "./NativeNetworkSettings";
import { noteSettingsSection } from './metrics/noteUse';
import { holdsCommandKey } from '../ui/commandKeys';
import { useRangeDraft } from "../ui/useRangeDraft";
import "../styles/native-network.css";
import { PageZoomControls } from "../components/PageZoomControls";
import { MenuCustomizer } from "../components/MenuCustomizer";
import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { NewTabSettings } from "./NewTabSettings";
import { NewTabPreview } from "./settings/NewTabPreview";
import { ChoiceCards, MiniBrowser, type MiniLayout } from "./settings/ChoiceCards";
import { ActiveBorderPreview } from "./settings/ActiveBorderPreview";
import { ACTIVE_BORDER_STYLES, normalizeActiveBorder } from "../ui/activeBorder";
import { TabLayoutRow } from "./settings/TabLayoutRow";
import { Segmented } from "../components/Segmented";
import { noelPrefs } from "../season/noelSettings";
import { tabSizeOf, type TabSize } from "../runtime/tabSize";
import { animationSpeedOf } from "../ui/sharedMotion";
import { miniTheme } from "./settings/miniTheme";
import { onSettingsTarget, raiseSettingsIntent, settingsDestination, settingsIntentSection, settingsView, settingsViewKey, takeSettingsTarget } from "../ui/settingsView";
import { toolbarLayout, toolbarLayoutPatch } from "../runtime/toolbarLayout";
import { formatShortcut, isMac } from "../ui/platform";
import { paletteModifierKey } from "../ui/paletteTarget";
import { matchesSystemTheme, systemThemeActions, useSystemTheme } from "../ui/systemTheme";
import { shortcutFor } from "../ui/shortcutKeys";
import { toolbarVisibilityItems } from "../ui/toolbarMenu";
import { resetToolbarItems } from "../ui/toolbarPrefs";
import { effectiveView, seamlessEdgesOf, sidebarHeldOpenIn, windowViews, type WindowView } from "../runtime/windowView";
import { windowViewDetail, windowViewName } from "../ui/windowViewText";
import { MiniView } from "./settings/WindowViewCards";
import { closedBlock, hideToolbarBlock, unavailableViews } from "./settings/layoutAvailability";
import { setTabsLayout, shownView, tabsLayoutOf } from "../ui/sidebarMode";
import { sidebarOn } from "../runtime/shelf";
import { miniRailOn } from "../runtime/miniSidebar";
import { SidebarGroups, SwitchingTabs } from "./settings/panels/sidebar";
import { SeamlessSideRow } from "./settings/SidebarRows";
import type {
  BrowserAction,
  BrowserSnapshot,
  Settings,
} from "../runtime/types";
import {
  GlassFinishPicker,
  AppearanceColorWell,
} from "../components/AppearanceControls";
import { AuraColourPopover } from "../components/AuraColourPopover";
import { OwnGradientChips } from "./settings/OwnGradientChips";
import { GRADIENT_EXTRA, addOwnColour, frameColours, frameMaterialOf, isOwnFinish, ownFinishPatch, removeOwnColour } from "../runtime/ownColours";
import { defaultAppearancePalette, palettePreference } from "../runtime/appearancePalettes";
import { EditorGlyph, type EditorIconName } from "../components/EditorGlyph";
import { AciraGlyph, type AciraGlyphName } from "../components/AciraGlyphs";
import { BrandLogo } from "../components/BrandLogo";
import { ContentTransition } from "../components/ContentTransition";
import { runtime } from "../runtime/client";
import { AppIconRow } from "./settings/AppIconRow";
import { ContentFilterControls, FilterListSettings, ImportPanel, ProfileCleanup, ProtectionGroup } from "./BrowserData";
import { useNewTabPreferences, defaultArtwork } from "../ui/newTabPreferences";
import { appearanceLookChanged, appearanceResetPatch, newTabChanged } from "./settings/changed";
import { SettingsSearch } from "./settings/SettingsSearch";
import {
  Select,
  SettingCrossLink,
  SettingsHomeContext,
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
import { useFeedbackView } from "../runtime/feedback";
import MemorySaverPanel from "./settings/panels/memory-saver";
import RewindPanel from "./settings/panels/rewind";
import { SidePanelSettings } from "./settings/SidePanelSettings";
import { AntiTracking, Passkeys, PhishingLists, PhishingProtection, SafeBrowsing } from "./settings/panels/anti-tracking";
import { ClearData, Cookies, Https, ListUpdates, Overview, Usage } from "./settings/panels/privacy";
import SitePermissionsPanel from "./settings/panels/site-permissions";
import SiteScriptsPanel from "./settings/panels/site-scripts";
import ZapPanel from "./settings/panels/zap";
import { SecuredSettings } from "./workspaces/SecuredSettings";
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
  Layout: "layout",
  Sidebar: "sidebar",
  Profiles: "profile",
  Tabs: "tabs",
  "New tab": "empty",
  Search: "search",
  Privacy: "privacy",
  Protection: "protection",
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

/** Window opacity: the same algorithm as the Appearance popup's slider (ui/useRangeDraft.ts, D145): the handle and the number follow the pointer from local state, one change leaves per painted frame,
 *  the last value is published on release / key up / blur / unmount, and the store's answer arriving during a drag never moves the handle. */
function GlassOpacityControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { value: draft, bind } = useRangeDraft(value, onChange);
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
        {...bind}
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
  const you = ["Profiles", "Appearance", "Layout", "Sidebar", "Tabs", "New tab"], browsing = ["Search", "Privacy", "Protection", "Connection", "Passwords", "Downloads", "Extensions"];
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
  Layout: tr("settingslede.layout"),
  Sidebar: tr("settingslede.sidebar"),
  Profiles: tr("settingslede.profiles"),
  Tabs: tr("settingslede.tabs"),
  Connection: tr("settingslede.connection"),
  "New tab": tr("settingslede.newTab"),
  Search: tr("settingslede.search"),
  Privacy: tr("settingslede.privacy"),
  Protection: tr("settingslede.protection"),
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
      noteSettingsSection(value);
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
  // A switch that moves the toolbar or the tabs (the Tabs cards, the menu's Tabs row, Sidebar + address) makes the window lay out again,
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
  /** 14.1 Your colours: the aura picker's popover, opened from the Finish row's + tile (it becomes the finish) or from the gradient's + (it joins the gradient). */
  const [picking, setPicking] = useState<{ anchor: HTMLElement; target: "finish" | "gradient" } | null>(null);
  const ownInUse = isOwnFinish(s), ownField = frameColours(s), ownGradient = ownField.length > 1;
  const addOwn = (hex: string, target: "finish" | "gradient") => {
    const ownColours = addOwnColour(s.ownColours, hex);
    if (target === "finish") update({ ownColours, ...ownFinishPatch(hex) });
    else update({ ownColours, frameGradient: [...ownField.slice(1), hex.toLowerCase()].slice(-GRADIENT_EXTRA) });
  };
  const removeOwn = (hex: string) => { const { inUse, ...patch } = removeOwnColour(s, hex); update({ ...patch, ...(inUse ? palettePreference(defaultAppearancePalette) : {}) }); };
  /** Where tabs and the address bar live: Along the top, In a sidebar, or Sidebar + address (ui/sidebarMode.ts). The miniatures below follow it. */
  const layoutChoice = tabsLayoutOf(s);
  const tabLayout: MiniLayout = layoutChoice === "top" ? "toolbar" : layoutChoice;
  const animationSpeed = animationSpeedOf(s);
  /** Noël, the opt-in Christmas theme (src/season/noelSettings.ts): what is saved, with the defaults for a value that is missing. */
  const noel = noelPrefs(s);
  const osReducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const profile = state.browserProfiles.find(
    (item) => item.id === tab.browserProfileId,
  )!;
  const windowView = effectiveView(s, state.windowUi);
  /** "Hide the toolbar" has a row only where there is a toolbar to hide that Seamless does not already hide: tabs in a sidebar (not Sidebar + address), in Full, Compact or Focus. */
  const hideToolbarRow = layoutChoice === "sidebar" && windowView !== "seamless";
  /** Why the "Hide the toolbar" switch is off the table here (settings/layoutAvailability.ts), or null when it works. */
  const hideToolbarWhy = hideToolbarBlock(s, state.windowUi);
  /** Sidebar + address in Full holds its sidebar open, so Sidebar › Show sidebar has nothing to switch and is not listed (runtime/windowView.ts). */
  const sidebarClosable = !sidebarHeldOpenIn(s, state.windowUi);
  /** Beta 14: with Mini, a closed sidebar is a rail beside the page, so the rows about the edge that brings a hidden sidebar back are not listed (Seamless keeps them). */
  const miniRail = miniRailOn(s, state.windowUi);
  // Beta 14.4: About › Updates › Insider builds is drawn only for a profile it is offered to; search lists it only then.
  const insiderChannel = useFeedbackView('settings').insider.channel.offered;
  /** The settings, the profile's tabs switch and (when the address bar moves) the morph, in one step, so the card, the strip and the sidebar always agree (Appearance › Layout and Tabs share this). */
  const chooseTabLayout = (layout: MiniLayout) => setTabsLayout(state, dispatch, layout === "toolbar" ? "top" : layout);
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
    s.showZoomIcon === false ||
    s.showBookmarkStar === false ||
    Boolean(s.bookmarksBar) ||
    s.bookmarksOnNewTabOnly === false;
  const appearanceChanged = appearanceLookChanged(s);
  const newTabIsChanged = newTabChanged(newTabPrefs, defaultArtwork);
  const stockSearch = !sharedProvidersConfigured(state) && ['google','duckduckgo','bing'].includes(currentSearchProviders(state).defaultId);
  const context: SettingsContext = useMemo(
    () => ({
      customGlassColors: customColors,
      privateProfile: Boolean(profile?.private),
      desktop: Boolean(runtime.platform),
      systemTheme: desktopTheme.supported,
      touchpadSwipe: !isMac(),
      websiteOpen: Boolean(zoomTarget),
      appearanceChanged,
      toolbarChanged,
      newTabChanged: newTabIsChanged,
      stockSearch,
      verticalTabs: sidebarOn(s),
      hideToolbarRow: hideToolbarRow,
      sidebarClosable,
      miniRail,
      insiderChannel,
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
      s.shelf,
      hideToolbarRow,
      sidebarClosable,
      miniRail,
      desktopTheme.supported,
      insiderChannel,
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
        !holdsCommandKey(event);
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

  /** D178: a pick from Settings search, a link inside Settings or a section in the list keeps the typed word in the box (the list
   *  closed; focusing the box or the down key shows the same results); only a landing from outside Settings starts the box empty. */
  const openEntry = (entry: SettingsEntry, { clearSearch = false } = {}) => {
    if (clearSearch) setQuery("");
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
    if (entry) { openEntry(entry, { clearSearch: true }); return; }
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

  /* 13.2: "Back to browser" (the column's pinned foot) is gone: it often only went back one Settings section, and we chose to remove it. */
  const nav = useRef<HTMLElement>(null);

  const content = (
    <>
      {section === "Appearance" && (
        <>
          <SettingGroup title={tr("settings.themeGroup")}>
            <SettingRow
              id="appearance-mode"
              title={tr("settings.lightOrDark")}
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
              <GlassFinishPicker settings={s} onChange={update} size={20} onAddColour={(anchor) => setPicking({ anchor, target: "finish" })} onRemoveColour={removeOwn} />
            </SettingRow>
            {/* 14.1 Your colours: with one of the person's own colours in use, how the frame wears it (ui/frameField.ts). */}
            {ownInUse && (
              <>
                <SettingRow id="own-frame" title={tr("owncolours.frame")} detail={tr("owncolours.frameDetail")}>
                  <Segmented
                    label={tr("owncolours.frame")}
                    value={ownGradient ? "gradient" : "one"}
                    options={[["one", tr("owncolours.oneColour")], ["gradient", tr("owncolours.gradient")]] as const}
                    onChange={(mode) => {
                      if (mode === "one") return update({ frameGradient: [] });
                      const other = (s.ownColours ?? []).find((hex) => hex.toLowerCase() !== ownField[0]);
                      if (other) update({ frameGradient: [other] });
                      else { const at = document.querySelector<HTMLElement>('[data-setting="own-frame"] .acira-seg'); if (at) setPicking({ anchor: at, target: "gradient" }); }
                    }}
                  />
                </SettingRow>
                {ownGradient && (
                  <SettingRow id="own-gradient" title={tr("owncolours.gradientColours")} detail={tr("owncolours.gradientColoursDetail")}>
                    <OwnGradientChips settings={s} onChange={update} onAdd={(anchor) => setPicking({ anchor, target: "gradient" })} />
                  </SettingRow>
                )}
                <SettingRow id="own-glow" title={tr("owncolours.glow")} detail={tr("owncolours.glowDetail")}>
                  <Switch label={tr("owncolours.glow")} checked={s.frameGlow === true} onChange={(frameGlow) => update({ frameGlow })} />
                </SettingRow>
                <SettingRow id="own-material" title={tr("owncolours.material")} detail={tr("owncolours.materialDetail")}>
                  <Segmented
                    label={tr("owncolours.material")}
                    value={frameMaterialOf(s)}
                    options={[["glass", tr("owncolours.glass")], ["matte", tr("owncolours.matte")], ["glossy", tr("owncolours.glossy")]] as const}
                    onChange={(frameMaterial) => update({ frameMaterial })}
                  />
                </SettingRow>
              </>
            )}
            {picking && (
              <AuraColourPopover
                anchor={picking.anchor}
                preview={picking.target === "finish"}
                initial={picking.target === "finish" && ownInUse ? s.browserTint : undefined}
                onAdd={(hex) => addOwn(hex, picking.target)}
                onClose={() => setPicking(null)}
              />
            )}
            <SettingRow id="website-appearance" title={tr("browsersettings.websiteAppearance")} detail={tr("browsersettings.websiteAppearanceDetail")}>
              <Segmented
                label={tr("browsersettings.websiteAppearance")}
                value={s.websiteAppearance ?? "system"}
                options={[
                  ["system", tr("browsersettings.websiteSystem")],
                  ["light", tr("appearancecontrols.light")],
                  ["dark", tr("appearancecontrols.dark")],
                  ["always-dark", tr("browsersettings.websiteAlwaysDark")],
                ] as const}
                onChange={(websiteAppearance) => update({ websiteAppearance })}
              />
            </SettingRow>
            {/* Beta 14.4: people look for the wallpaper here; its home is New tab › Background. */}
            <SettingCrossLink to="newtab-art" section="New tab" title={tr("ntp.backgroundGroup")} />
          </SettingGroup>
          {/* Beta 14.4: see-through has a home people open: Window opacity and Reduce transparency side by side, open, under the word they type. */}
          <SettingGroup title={tr("settings.transparencyGroup")} id="transparency">
              <SettingRow
                id="glass-opacity"
                title={tr("appearancecontrols.windowOpacity")}
                detail={tr("settings.opacityDetail")}
              >
                <GlassOpacityControl
                  value={s.glassOpacity!}
                  disabled={false}
                  onChange={(glassOpacity) => update({ glassOpacity })}
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
          </SettingGroup>
          <SettingGroup title={tr("settings.sizeMotionGroup")} id="size-and-motion">
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
            <SettingCrossLink to="tab-size" section="Layout" title={tr("settings.tabSize")} />
            <SettingCrossLink to="sidebar-size" section="Sidebar" title={tr("sidebar.sizeTitle")} />
          </SettingGroup>
          <SettingGroup title={tr("settings.lightGlowGroup")}>
            <SettingRow id="site-color" title={tr("browsersettings.siteColor")} detail={tr("browsersettings.siteColorDetail")}>
              <Segmented
                label={tr("browsersettings.siteColor")}
                value={s.siteColor ?? "soft"}
                options={[
                  ["off", tr("browsersettings.siteColorOff")],
                  ["soft", tr("browsersettings.siteColorSoft")],
                  ["rich", tr("browsersettings.siteColorRich")],
                ] as const}
                onChange={(siteColor) => update({ siteColor })}
              />
            </SettingRow>
            {/* Its own switch (reported 19 Nov): it shows what is saved and lights the frame whatever Site color is set to; turning it on changes nothing else. */}
            <SettingRow id="ambient-mode" title={tr("browsersettings.ambientMode")} detail={tr("browsersettings.ambientModeDetail")}>
              <Switch label={tr("browsersettings.ambientMode")} checked={s.ambientMode === true} onChange={(ambientMode) => update({ ambientMode })} />
            </SettingRow>
            <SettingRow id="active-border" title={tr("browsersettings.activeBorder")} detail={tr("browsersettings.activeBorderDetail")} stacked>
              <ChoiceCards
                label={tr("browsersettings.activeBorder")}
                columns={5}
                value={normalizeActiveBorder(s.activeBorder)}
                onChange={(activeBorder) => update({ activeBorder })}
                options={ACTIVE_BORDER_STYLES.map((look) => ({
                  value: look,
                  label: look === "divider-fade" ? tr("browsersettings.activeBorderDividerFade") : look === "lit-edge" ? tr("browsersettings.activeBorderLitEdge") : look === "hairline" ? tr("browsersettings.activeBorderHairline") : look === "inner-light" ? tr("browsersettings.activeBorderInnerLight") : tr("browsersettings.activeBorderPlain"),
                  art: <ActiveBorderPreview look={look} selected={normalizeActiveBorder(s.activeBorder) === look} />,
                }))}
              />
            </SettingRow>
          </SettingGroup>
          {customColors && (
            <SettingGroup title={tr("settings.ownColorsGroup")} fold foldDetail={tr("settings.ownColorsFoldDetail")}>
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
          {/* Noël (22 Nov): opt-in. Snowfall and the hat show their saved choice while the theme is off, greyed, so turning it on brings back what was chosen. */}
          <SettingGroup title={tr("settings.seasonalGroup")}>
            <SettingRow id="noel-on" title={tr("noelsettings.title")} detail={tr("noelsettings.detail")}>
              <Switch label={tr("noelsettings.title")} checked={noel.on} onChange={(noelOn) => update({ noelOn })} />
            </SettingRow>
            <SettingRow id="noel-snow" title={tr("noelsettings.snow")} detail={noel.on ? tr("noelsettings.snowDetail") : tr("settings.reasonNoel")} stacked>
              <fieldset className="st-dim" disabled={!noel.on}>
                <Segmented
                  label={tr("noelsettings.snow")}
                  value={noel.snow}
                  options={[
                    ["sidebar", tr("noelsettings.snowSidebar")],
                    ["window", tr("noelsettings.snowWindow")],
                    ["off", tr("noelsettings.snowOff")],
                  ] as const}
                  onChange={(noelSnow) => update({ noelSnow })}
                />
              </fieldset>
            </SettingRow>
            {/* 24 Nov (the team): it keeps snowing unless the person wants a rest; greyed with the reason while Noël or the snowfall is off */}
            <SettingRow id="noel-keep" title={tr("noelsettings.keep")} detail={!noel.on ? tr("settings.reasonNoel") : noel.snow === 'off' ? tr("noelsettings.reasonSnow") : tr("noelsettings.keepDetail")}>
              <Switch label={tr("noelsettings.keep")} checked={noel.keep} disabled={!noel.on || noel.snow === 'off'} onChange={(noelKeepSnowing) => update({ noelKeepSnowing })} />
            </SettingRow>
            <SettingRow id="noel-hat" title={tr("noelsettings.hat")} detail={noel.on ? tr("noelsettings.hatDetail") : tr("settings.reasonNoel")}>
              <Switch label={tr("noelsettings.hat")} checked={noel.hat} disabled={!noel.on} onChange={(noelHat) => update({ noelHat })} />
            </SettingRow>
            <AppIconRow />
          </SettingGroup>
          {/* Beta 14.4: always listed; with nothing to reset the button is off and the line says so. */}
          <SettingGroup title={tr("browsersettings.reset")}>
            <SettingRow
              id="reset-appearance"
              title={tr("browsersettings.resetAppearance")}
              detail={appearanceChanged ? tr("browsersettings.resetAppearanceDetail") : tr("settings.reasonNothingToReset")}
            >
              <button
                type="button"
                className="st-button"
                disabled={!appearanceChanged}
                onClick={() => update(appearanceResetPatch(s))}
              >
                {tr("browsersettings.reset")}
              </button>
            </SettingRow>
          </SettingGroup>
        </>
      )}
      {/* Beta 14.4: where things are, the same as the Acira menu's Layout rows (View, Tabs); the sidebar has a page of its own next to it. */}
      {section === "Layout" && (
        <>
          <SettingGroup title={tr("settings.tabLayoutGroup")} id="tab-layout">
            <TabLayoutRow layout={tabLayout} onChange={chooseTabLayout} />
            {/* 14.3 Tab size (runtime/tabSize.ts): how tall the tabs are, apart from Interface size; Standard is today's size. */}
            <SettingRow id="tab-size" title={tr("settings.tabSize")} detail={tr("settings.tabSizeDetail")}>
              <Segmented
                label={tr("settings.tabSize")}
                value={tabSizeOf(s)}
                options={[["small", tr("settings.tabSizeSmall")], ["standard", tr("settings.tabSizeStandard")], ["large", tr("settings.tabSizeLarge")]] as const}
                onChange={(tabSize: TabSize) => update({ tabSize })}
              />
            </SettingRow>
            <SettingRow
              id="compact-tab-titles"
              title={tr("browsersettings.showTitlesInCompactTabs")}
              detail={layoutChoice === "top" || layoutChoice === "top-sidebar" ? tr("browsersettings.compactTitlesDetail") : tr("settings.reasonTabsAlongTop")}
            >
              <Switch
                label={tr("browsersettings.showTitlesInCompactTabs")}
                checked={Boolean(s.compactTabTitles)}
                disabled={layoutChoice !== "top" && layoutChoice !== "top-sidebar"}
                onChange={(compactTabTitles) => update({ compactTabTitles })}
              />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title={tr("windowview.title")} id="layout">
            <SettingRow
              id="window-view"
              title={tr("windowview.title")}
              detail={windowViewDetail(shownView(layoutChoice, windowView)) + (shownView(layoutChoice, windowView) === "focus" ? " " + tr("browsersettings.focusShortcutHint", { shortcut: shortcutFor("focus-mode", "Ctrl Shift F") ?? formatShortcut("Ctrl Shift F") }) : shownView(layoutChoice, windowView) === "seamless" ? " " + tr("browsersettings.focusShortcutHint", { shortcut: shortcutFor("seamless-mode", "Ctrl Shift L") ?? formatShortcut("Ctrl Shift L") }) : "")}
              stacked
            >
              <ChoiceCards
                label={tr("windowview.title")}
                value={shownView(layoutChoice, windowView)}
                onChange={(mode: WindowView) => update({ windowView: mode })}
                options={windowViews.map((mode) => ({ value: mode, label: windowViewName(mode), art: <MiniView view={mode} layout={tabLayout} />, disabled: unavailableViews(layoutChoice).includes(mode) }))}
              />
            </SettingRow>
            {unavailableViews(layoutChoice).length > 0 && <SettingNote>{tr("settings.reasonNoTopBar")}</SettingNote>}
            {/* "Hide the toolbar" is always listed: where there is no toolbar of its kind to hide, it is off the table and says why. */}
            <SettingRow id="hide-toolbar" title={tr("windowview.hideToolbar")} detail={hideToolbarWhy ? tr(hideToolbarWhy === "seamless" ? "settings.reasonHideToolbarSeamless" : "settings.reasonHideToolbarLayout") : tr("windowview.hideToolbarDetail")}>
              <Switch label={tr("windowview.hideToolbar")} checked={s.hideToolbar === true} disabled={hideToolbarWhy !== null} onChange={(on) => update({ hideToolbar: on })} />
            </SettingRow>
            {s.sidebarClosed === "mini" && closedBlock(s, state.windowUi) === "seamless" && (
              <SettingCrossLink id="closed-reason" to="sidebar-closed" section="Sidebar" title={tr("sidebar.closedTitle")} detail={tr("settings.reasonMiniView")} />
            )}
            {/* Beta 14.4: both Seamless edge rows are always listed, directly under Window view; outside Seamless they are off and say why. */}
            <SettingRow id="seamless-edge-top" title={tr("windowview.edgeTop")} detail={windowView === "seamless" && tabLayout !== "sidebar-address" ? tr("windowview.edgeTopDetail") : tr(tabLayout === "sidebar-address" ? "settings.reasonSeamlessTopAddress" : "settings.reasonOnlySeamless")}>
              <Switch
                label={tr("windowview.edgeTop")}
                checked={seamlessEdgesOf(s).top}
                disabled={windowView !== "seamless" || tabLayout === "sidebar-address"}
                onChange={(top) => update({ seamlessEdges: { ...seamlessEdgesOf(s), top } })}
              />
            </SettingRow>
            <SeamlessSideRow state={state} dispatch={dispatch} />
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
            <SettingRow id="screenshot-button" title={tr("browsersettings.screenshotButton")}>
              <Select
                label={tr("browsersettings.screenshotButton")}
                value={s.screenshotButton ?? "off"}
                options={[
                  { value: "off", label: tr("browsersettings.screenshotOff") },
                  { value: "sidebar", label: tr("browsersettings.screenshotSidebar") },
                  { value: "top", label: tr("browsersettings.screenshotTop") },
                ]}
                onChange={(value) => update({ screenshotButton: value as "off" | "sidebar" | "top" })}
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
                      showZoomIcon: true,
                      showBookmarkStar: true,
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
          <SettingGroup title={tr("settings.aciraMenuGroup")} id="menu-customize-group" fold foldDetail={tr("settings.menuFoldDetail")}>
            <SettingRow
              id="menu-customize"
              title={tr("menucustomizer.rowTitle")}
              detail={tr("menucustomizer.detail")}
              stacked
            >
              <MenuCustomizer profileId={tab.browserProfileId} reduced={s.reducedMotion} />
            </SettingRow>
          </SettingGroup>
        </>
      )}
      {section === "Sidebar" && <SidebarGroups state={state} dispatch={dispatch} />}
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
                        <bdi className="chip-letter">{p.name[0]}</bdi>
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
                    className="st-input ab-input"
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
        <>
          <SettingGroup title={tr("settings.newTabShowsGroup")}>
            <NewTabPreview profile={profile} />
            <NewTabSettings profile={profile} part="layout" />
          </SettingGroup>
          <SettingGroup title={tr("ntp.backgroundGroup")} id="newtab-background-group">
            <NewTabSettings profile={profile} part="background" />
          </SettingGroup>
        </>
      )}
      {section === "Tabs" && (
        <>
          {/* Beta 14.4: people look for tab size here; its home is Layout. */}
          <SettingGroup title={tr("settings.tabsLayoutLinksGroup")}>
            <SettingCrossLink to="sidebar-only-tabs" section="Layout" title={tr("settings.whereTabsGo")} />
            <SettingCrossLink to="tab-size" section="Layout" title={tr("settings.tabSize")} />
          </SettingGroup>
          <SettingGroup title={tr("onstartup.title")}>
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
            <SettingRow id="load-ahead" title={tr("loadahead.title")} detail={tr("loadahead.detail")}>
              <Select
                label={tr("loadahead.title")}
                value={s.loadAhead === "pinned" || s.loadAhead === "recent" ? s.loadAhead : "off"}
                options={[
                  { value: "off", label: tr("loadahead.optOff") },
                  { value: "pinned", label: tr("loadahead.optPinned") },
                  { value: "recent", label: tr("loadahead.optRecent") },
                ]}
                onChange={(value) => update({ loadAhead: value as "off" | "pinned" | "recent" })}
              />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title={tr("settings.openingClosingGroup")}>
            <SettingRow id="open-tabs-in-front" title={tr("tabsinfront.title")} detail={tr("tabsinfront.detail")}>
              <Switch
                label={tr("tabsinfront.title")}
                checked={Boolean(s.openTabsInFront)}
                onChange={(openTabsInFront) => update({ openTabsInFront })}
              />
            </SettingRow>
            <SettingRow id="close-tab-landing" title={tr("closelanding.title")} detail={tr(s.closeTabLanding === "empty" ? "closelanding.detailEmpty" : "closelanding.detail")}>
              <Select
                label={tr("closelanding.title")}
                value={s.closeTabLanding === "empty" ? "empty" : "previous"}
                options={[
                  { value: "previous", label: tr("closelanding.optPrevious") },
                  { value: "empty", label: tr("closelanding.optEmpty") },
                ]}
                onChange={(value) => update({ closeTabLanding: value as "previous" | "empty" })}
              />
            </SettingRow>
            <SettingRow id="ask-before-closing" title={tr("closeGuard.askTitle")} detail={tr("closeGuard.askDetail")}>
              <Switch
                label={tr("closeGuard.askTitle")}
                checked={s.askBeforeClosing !== false}
                onChange={(askBeforeClosing) => update({ askBeforeClosing })}
              />
            </SettingRow>
            <SettingRow id="command-search-new-tab" title={tr("commandsearchnewtab.title")} detail={tr("commandsearchnewtab.detail", { key: paletteModifierKey(isMac()) })}>
              <Switch
                label={tr("commandsearchnewtab.title")}
                checked={Boolean(s.commandSearchNewTab)}
                onChange={(commandSearchNewTab) => update({ commandSearchNewTab })}
              />
            </SettingRow>
          </SettingGroup>
          <SwitchingTabs>
            {!isMac() && (
              <SettingRow id="touchpad-swipe" title={tr("touchpadswipe.title")} detail={tr("touchpadswipe.detail")}>
                <Switch
                  label={tr("touchpadswipe.title")}
                  checked={Boolean(s.touchpadSwipe)}
                  onChange={(touchpadSwipe) => update({ touchpadSwipe })}
                />
              </SettingRow>
            )}
          </SwitchingTabs>
          <SettingGroup title={tr("settings.previewsGroup")}>
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
          </SettingGroup>
          <SettingGroup title={tr("settings.videosGroup")}>
            <SettingRow id="fullscreen-fills-window" title={tr("fullscreenfill.title")} detail={tr("fullscreenfill.detail")}>
              <Switch
                label={tr("fullscreenfill.title")}
                checked={Boolean(s.fullscreenFillsWindow)}
                onChange={(fullscreenFillsWindow) => update({ fullscreenFillsWindow })}
              />
            </SettingRow>
            <SettingRow id="auto-picture-in-picture" title={tr("autopip.title")} detail={tr("autopip.detail")}>
              <Switch
                label={tr("autopip.title")}
                checked={Boolean(s.autoPictureInPicture)}
                onChange={(autoPictureInPicture) => update({ autoPictureInPicture })}
              />
            </SettingRow>
          </SettingGroup>
          <MemorySaverPanel.Component state={state} dispatch={dispatch} />
          {!profile?.private && <SidePanelSettings state={state} dispatch={dispatch} />}
          <RewindPanel.Component state={state} dispatch={dispatch} />
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
          <SettingCrossLink to="filters-ai" section="Protection" title={tr("browsermenu.aiFreeMode")} />
        </SettingGroup>
      )}
      {/* Beta 14.4: Privacy is your own data; what Acira blocks or guards is on Protection. Each page points at the other first. */}
      {section === "Privacy" && (
        <>
          <SettingCrossLink to="block-ads-trackers" section="Protection" title={tr("settings.protectionPage")} detail={tr("settings.protectionPageLink")} />
          <ClearData disabled={Boolean(profile?.private)} />
          <SitePermissionsPanel.Component state={state} dispatch={dispatch} />
          <ProfileCleanup state={state} />
          <Cookies disabled={Boolean(profile?.private)}>
            <ContentFilterControls state={state} part="banners" />
          </Cookies>
          <SettingGroup title={tr("settings.privateWindowsGroup")}>
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
          
            <SecuredSettings state={state} dispatch={dispatch} disabled={Boolean(profile?.private)} bare />
          </SettingGroup>
          <Usage disabled={Boolean(profile?.private)} dispatch={dispatch} />
        </>
      )}
      {section === "Protection" && (
        <>
          <SettingCrossLink to="clear-browsing-data" section="Privacy" title={tr("settings.privacyPage")} detail={tr("settings.privacyPageLink")} />
          <ProtectionGroup state={state} title={tr("settings.adsTrackersGroup")}>
            <Overview bare />
          </ProtectionGroup>
          <AntiTracking disabled={Boolean(profile?.private)}>
            <NativeNetworkSettings part="gpc" bare>
            <SettingCrossLink to="proxy" section="Connection" title={tr("settings.proxyDnsLink")} />
          </NativeNetworkSettings>
          </AntiTracking>
          <PhishingLists disabled={Boolean(profile?.private)} after={<SafeBrowsing disabled={Boolean(profile?.private)} bare />}>
            <PhishingProtection disabled={Boolean(profile?.private)} bare />
          </PhishingLists>
          <Https disabled={Boolean(profile?.private)} />
          {/* No passkey choice on a Mac: the guard answers there with no setting (passkey-guard-preload.cjs), so the switch did nothing. */}
          {!isMac() && <Passkeys disabled={Boolean(profile?.private)} />}
          <SiteScriptsPanel.Component state={state} dispatch={dispatch} />
          <ContentFilterControls state={state} part="search" fold />
          <ZapPanel.Component state={state} dispatch={dispatch} />
          <FilterListSettings profileId={state.activeBrowserProfileId} privateMode={state.browserProfiles.some((item) => item.id === state.activeBrowserProfileId && item.private)} fold>
            <ListUpdates disabled={Boolean(profile?.private)} bare />
          </FilterListSettings>
        </>
      )}
      {section === "Accessibility" && (
        <SettingGroup title={tr("settings.motionTransparencyGroup")}>
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
          <SettingCrossLink to="reduce-transparency" section="Appearance" title={tr("browsersettings.reduceTransparency")} />
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
        .filter((panel) => panel.section === section && section !== "Profiles" && !panel.placed)
        .map((panel, index) => (
          <panel.Component
            key={`${panel.section}-${index}`}
            state={state}
            dispatch={dispatch}
          />
        ))}
    </>
  );
  const settingHome = (id: string) => findSetting(id)?.section;
  const goToSetting = (id: string) => {
    const entry = findSetting(id);
    if (entry) openEntry(entry);
  };
  return (
    <SettingsViewContext.Provider value={view}>
      <SettingsNavContext.Provider value={goToSetting}>
      <SettingsHomeContext.Provider value={settingHome}>
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
                onClick={() => setSection(label)}
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
              onSelect={(entry) => openEntry(entry)}
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
      </SettingsHomeContext.Provider>
      </SettingsNavContext.Provider>
    </SettingsViewContext.Provider>
  );
}
export { warmMiniBrowser as warmSettingsPaint } from "./settings/ChoiceCards";
