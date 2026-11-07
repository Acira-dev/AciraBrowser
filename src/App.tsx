import { useSystemTheme, withSystemAccent } from './ui/systemTheme';
import {WorkspaceCoverPicker} from './components/WorkspaceCoverPicker';
import { flushSync } from 'react-dom';
import { AddressMore } from './components/AddressMore';
import { glideMotion } from './ui/addressGlide';
import { clampSidebarWidth } from './ui/sidebarLayout';
import { addressBlockShown, addressFocusPlan, addressInSidebarWanted, addressStripHeight, revealedFieldBox, sidebarModeChrome, sidebarModeHeader } from './ui/addressInSidebar';
import './styles/address-in-sidebar.css';
import './styles/sidebar-mode-morph.css';
import { UpdatePill } from './features/updates/UpdatePill';
import { UpdatePopover } from './features/updates/UpdatePopover';
import { WhatsNewPopover } from './features/updates/WhatsNewPopover';
import { updatePanelPhase } from './ui/updatePhase';
import { paneIsAlone, selectStripTab, toggleSolo } from './ui/splitPaneSelect';
import { shownPrivacy } from './ui/tabPrivacy';
import { tabShowsLoading } from './ui/tabLoading';
import { LockedWorkspace } from './features/workspaces/LockedWorkspace';
import { ProfileSwitcher } from './features/accounts/ProfileSwitcher';
import { useMenuFormHost } from './ui/useMenuFormHost';
import { addressRequestIsCurrent } from './ui/addressFocusClaim';
import { VpnPanel } from './features/connection/VpnPanel';
import { TorChip, TorCircuitGlyph, TorSecurityGlyph } from './features/tor/TorChip';import { TorPopover } from './features/tor/TorPopover';import { TorSitePanel } from './features/tor/TorSitePanel';import { TorOnionChip } from './features/tor/TorOnion';import { TorOnionAuth } from './features/tor/TorOnionAuth';import { isTorSite, isTorWindow, runTorCircuit, torCircuitShortcut } from './features/tor/torClient'; // N · private windows with Tor
import {ProfileCleanupRecovery} from './features/ProfileCleanupRecovery';
import {WebsiteAuthDialog} from './features/WebsiteAuthDialog';
import {websiteAuthClient} from './ui/websiteAuthClient';
import {BookOpen,Info,Workflow,LockKeyhole,MessageSquare} from './components/AppIcons';
import {SiteReport,reportable} from './features/SiteReport';
import {ReaderPane} from './components/ReaderPane';
import {useReader} from './ui/useReader';
import {useLinkDrop} from './ui/useLinkDrop';
import {usePageFocusOnPick} from './ui/pageFocus';
import {useLayoutRepair,useShownTabsSwitch} from './ui/layoutSync';import {useT,currentLocale,t as tr,type MessageId} from './i18n';
import {BrowserExtensionActions} from './components/BrowserExtensionActions';
import {useExtensionToolbar} from './ui/useExtensionToolbar';
import {ArtworkToast} from './components/ArtworkToast';
import {RatingCard,RatingLayer} from './features/metrics/RatingCard';
import {RATING_EDGE,RATING_SHADOW_ROOM,ratingCardSize} from './features/metrics/ratingMoment';
import {RATING_HIDE_EVENT,ratingOnScreen,useRatingOnScreen} from './features/metrics/ratingStore';
import {notePopupOpened} from './features/metrics/noteUse';
import {BookmarksBar} from './components/BookmarksBar';
import {Onboarding,BrowserSettings,BrowserHistory,RewindPage,RoutinesPage,preloadScreens} from './ui/lazyScreens';
import {createSetupClient} from './services/accounts/setup-client';
import './styles/setup-integration.css';
import './styles/general-toast.css';
import { ToastAction, toastActionKey, toastDuration } from './features/rewind/ToastAction';
import { RecentlyClosed } from './features/rewind/RecentlyClosed';
import { SPLIT_GAP, SPLIT_MIN_PANE, SplitHandles, paneArea, splitGridStyle } from './features/split/SplitView';
import { minimumSize } from './runtime/splitLayout';
import { StatusPill, TOAST_SHADOW_ROOM, ToastCard, ToastStack, toastLeaveMs, toastSlotSize, type StatusIcon, type ToastRowModel } from './components/transient/Toast';
import { TooltipHost } from './components/transient/Tooltip';
import { useWindowFullscreen } from './ui/windowFullscreen';
import { FullscreenLights } from './ui/FullscreenLights';
import { dismissible, otherSpaceToasts, pushToast, spentToasts, toastHostRefused, toastKeysSaying, rememberDismissed, toastRoom, toastSpentAtLoad, toastStackHeight, type QueuedToast } from './ui/toastQueue';
import { createToastTimers, type ToastTimers } from './ui/toastTimers';
import { CommandPalette } from './components/CommandPalette';
import { CheckMark, CrossMark } from './components/CheckMark';
import { setSplitDropContext,takeDropPoint,useSplitPicker } from './ui/splitDrop';import { SplitMorphLayer,type SplitMorphRun } from './components/SplitMorphLayer';import { dropOrigin,homeRect,morphIntent,planMorph,shouldMorph,type MorphRect,type PaneBox } from './ui/splitMorph';import { motionScale } from './ui/splitMotion';import { CARRIED_SIZE } from './ui/useTabDragSurface';
import { SplitPicker,type SplitPickerPane } from './components/SplitPicker';import { SplitPaneZone } from './components/SplitPaneZone';import { SplitPaneDragLayer,SplitRibbon } from './components/SplitRibbon';import { paneDragPicker,usePaneDrag } from './ui/paneDrag';
import { prewarmColorScheme, settleThemeTransitions, themeKey } from './ui/themeSwitch';
import { installSiteAsApp } from './ui/webApps';
import {CertificateIndicator} from './components/CertificateNotice';
import {ZoomFeedback} from './components/PageZoomControls';
import {NavigationError} from './components/NavigationError';
import {nextPageZoom} from './ui/pageZoom';
import {installPageMagnify} from './ui/pageMagnify';
import {installPageZoomGlide,shownZoom,usePageZoomHolds} from './ui/pageZoomGlide';
import {toolbarLayout} from './runtime/toolbarLayout';
import { useSiteIcons } from './ui/siteIcons';import { setChipIconLookup } from './ui/chipIcon';
import { TabViewerDensityToggle } from './components/TabViewerDensity';
import {openSettings,retainSettingsViews} from './ui/settingsView';
import {NavigationProgress} from './components/NavigationProgress';
import {Downloads} from './features/Downloads';
import {DownloadsPanel} from './features/DownloadsPanel';
import {DownloadsGlyph} from './components/DownloadsGlyph';
import {profileDownloads} from './ui/downloadActivity';
import {DotMatrix} from './components/DotMatrix';
import {TabSoundMeter} from './components/TabSound';
import {tabSound} from './ui/tabSound';
import {SiteControls} from './features/BrowserData';
import {ShieldsSummary} from './features/ShieldsSummary';
import {ProtectionIcon} from './components/ProtectionIcon';
import {bookmarkControl,openTorBookmark} from './ui/bookmarkControl';
import { AnimatePresence,MotionConfig,motion,useIsPresent } from 'motion/react';
import { Fragment as ReactFragment,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode } from 'react';
import { AddressField } from './components/AddressField';
import { AddressSuggestions,addressSuggestionsHeight } from './components/AddressSuggestions';
import { AciraSymbol } from './components/AciraSymbol';
import { AppearancePanel } from './components/AppearanceControls';
import { PenLine,Trash2,Bookmark,Minimize2,Play,Pause,ArrowDownToLine,ClipboardCheck,Code2,ExternalLink,Eye,PanelTop,Maximize2,PrivateWindow,RefreshCw,Mic,Minus,Monitor,Video,FileText,LayoutGrid,ArrowLeft,ArrowRight,Check,ChevronDown,ChevronRight,Columns2,Copy,Download,Globe2,History,Home,Pin,Plus,RotateCw,Link2,Search,Settings2,SlidersHorizontal,Star,Contrast,Volume2,Undo2,Unplug,VolumeX,X } from './components/AppIcons';
import { BrandLogo } from './components/BrandLogo';
import { BrowserMenu,MoreToolsMenu,SubmenuBack,submenuKinds,menuTools,type BrowserMenuIcon } from './components/BrowserMenu';
import { useMenuLayout } from './ui/menuPrefs';
import { BookmarkMenu } from './components/sidebar/BookmarkMenu';
import { sectionActions } from './components/sidebar/SectionActions';
import { SIDEBAR_MODE_PEEK_MS, setSidebarMode, sidebarModeOn, sidebarModePeekEvent } from './ui/sidebarMode';
import { installSidebarMorph, onSidebarMorphEnd, sidebarMorphPin, sidebarMorphPinned, sidebarMorphRunning, sidebarMorphSend } from './ui/sidebarMorph';
import { sidebarWindowId } from './ui/sidebarSections';
import { SplitHeaderMenu } from './components/sidebar/SplitHeaderMenu';
import { FavoriteEditor } from './components/sidebar/FavoriteEditor';
import { WorkspaceChip, shownName as workspaceShownName } from './features/workspaces/WorkspaceSwitcher';import { MAX_WORKSPACES, profilesAsSpaces, windowWorkspaces, workspaceIdOf } from './runtime/workspaces';
import { WorkspaceMenu } from './features/workspaces/WorkspaceMenu';
import { NewSpace, WorkspaceEditor } from './features/workspaces/WorkspaceEditor';
import { WorkspaceSwitchFeedback } from './features/workspaces/WorkspaceHud';
import { openWorkspacePopupFromPopup, peekWorkspaceTarget } from './ui/workspaceTarget';
import { openSidebarCustomize } from './ui/sidebarSections';
import { windowCaptionColors } from './ui/windowCaption';
import { BrowserTabs } from './components/BrowserTabs';
import { CompactTabs } from './components/CompactTabs';
import { ExtensionManager } from './components/ExtensionManager';
import { MorphSlot } from './components/MorphSlot';
import { PopupSurface } from './components/PopupSurface';
import { ScrollRegion } from './components/ScrollRegion';
import { SiteIdentityIcon } from './components/SiteIdentityIcon';
import { Spinner } from './components/Spinner';
import { TabGroupControls,requestInlineRename } from './components/TabGroupControls';
import { TabTitle,requestTabRename } from './components/TabTitleEditor';
import { tabDisplayTitle } from './runtime/tabTitle';
import { setTabHoverCardMode,useTabHoverCard } from './ui/tabHoverCard';
import { TabResults } from './components/TabResults';
import { ExtensionsIcon,ToolbarIcon } from './components/ToolbarIcon';
import { ProfileAvatar } from './features/accounts/profileModel';
import { useToolbarOverflow } from './ui/toolbarOverflow';
import { settleAnchor } from './ui/settleAnchor';
/** » for the toolbar's overflow (P09): the two chevrons on the 16px glyph grid, stroked at the set's weight. */
const OverflowGlyph = ({ size = 16 }: { size?: number }) => <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.75 4.25 7.5 8l-3.75 3.75M8.5 4.25 12.25 8 8.5 11.75"/></svg>;
import { WorkspaceIcon } from './components/WorkspaceIcon';
import { ToolbarCustomizer } from './components/ToolbarCustomizer';
import { toolbarItemLabels,useToolbarItems,type ToolbarItemId } from './ui/toolbarPrefs';
import { AiFreeButton } from './components/AiFreeButton';
import './styles/sidebar-overlay.css';
import { consumeLegacyAutoHide,rememberSeamlessTip,seamlessTipSeen } from './ui/chromePrefs';import { bindEdgeTab,setEdgeStills,currentEdge,dismissEdge,installChromeEdge,pinEdge,sendEdgeFlags,setEdgeAsks,setEdgeHeaderHeight,edgePageSpring,noteSeamlessEntry,seamlessEntrySpring,useChromeEdge,useChromePress,setEdgeFloatable,isEdgeFloating,refreshEdgeFloat } from './ui/chromeEdge';import { effectiveView,migrateAutoHide,toggleView,windowViews,type WindowView } from './runtime/windowView';import { MenuChoice } from './components/MenuChoice';import { SeamlessRow } from './components/AppIcons';import { windowViewName } from './ui/windowViewText';
import { BookmarkEditor } from './features/BookmarkEditor';
import { ProtectedMediaNotice } from './features/ProtectedMediaNotice';
import { GlassWorkspace } from './features/FrostWorkspace';
import { AciraSidebar,sidebarControl } from './components/sidebar/AciraSidebar';import { setSidebarPeek,sidebarOnFrame,useSidebarPeek } from './ui/layoutMode';
import { TabSwitcher } from './components/sidebar/TabSwitcher';
import { bookmarksOnTab,bookmarksTogglePatch,sidebarPatch,workspaceIsOpen,workspacePreferenceKey } from './runtime/browserChrome';
import { newestActiveTabId,runtime,useBrowser } from './runtime/client';
import { carriesAddressDraft } from './ui/addressFocusClaim';
import { resolveNavigation, searchFor } from './runtime/navigation';
import { setToastActive } from './ui/toastActive';
import { siteIdentity } from './runtime/sites';
import { groupForTab } from './runtime/tabGroups';
import type { BrowserAction,BrowserLayout,BrowserSnapshot,BrowserStyle,InternalPage,TabSession, PageMenuItem, ToastAction as ToastActionData, SiteReportSubject } from './runtime/types';
import './styles/toolbar-controls.css';import './styles/seamless.css';import './styles/view-morph.css';
import { addressCompletion,addressSuggestionAction,nextAddressSuggestion,opensSuggestionsOnFocus,rankAddressSuggestions,type AddressSuggestion } from './ui/addressSuggestions';
import { runAddressRow,useAddressCommands } from './ui/addressRows';
import { browserGeometry } from './ui/browserGeometry';
import { designTokens } from './ui/designSystem';
import { activatePopupTriggerAt,nextOverlayId,overlayOutlivesTabChange,overlayOutlivesLayoutChange,overlayPointerDismiss,sameOverlayId,takesTypedText } from './ui/interactionPolicy';
import { browserTransition } from './ui/motion';
import { createNavigationRepeat,tabCursorIndex } from './ui/navigationRepeat';
import { bookmarkMenuEvent,copyText,type BookmarkMenuRequest } from './ui/pageActions';
import { formatShortcut, isMac, isTorSupported } from './ui/platform';
import { settledBox } from './ui/settledBox';
import { clipOf, visibleAnchor } from './ui/visibleAnchor';
import { groupEditorPlacement, menuDenseFor, popupContentHeight, popupEstimateMeasured, popupFollowsTrigger, popupGeometry, popupNaturalHeight, type PopupGeometry } from './ui/popup';
import { keyboardInput } from './ui/inputModality';
import { LocalMenuToggle, MenuToggle } from './components/MenuToggle';
import { TorGlyph } from './features/tor/TorChip';
import { createPopupTransition,popupExitMilliseconds } from './ui/popupTransition';
import { animationSpeedOf,classScale,motionPaceOf,motionScaleOf,publishMotionSpeed,useExitHold,useListMotion,frequentSpeed,sendWhenLayoutSwitchReady } from './ui/sharedMotion';
import { installDotClick } from './ui/dotClick';
import { useRailPrefs } from './ui/railPrefs';
import { controlTitle } from './ui/shortcutHints';
import { menuShortcut, shortcutFor, useShortcutKeys } from './ui/shortcutKeys';
import { focusSidebarControl,useSidebarFocus } from './ui/sidebarFocus';
import { studyFinish,themeTokens,withFrameTint,frameTintFor,type WindowFinish } from './ui/theme';
/** A private or Tor window paints its whole chrome in its own finish (theme.ts windowFinishes). */
const windowFinish=(state:BrowserSnapshot):WindowFinish|undefined=>{const profile=state.browserProfiles.find(item=>item.id===state.activeBrowserProfileId);return profile?.tor?'tor':profile?.private?'private':undefined;};
// A private or Tor window keeps its own finish everywhere, the toolbar included (no toolbar colour there).
const windowSettings=(state:BrowserSnapshot,settings:BrowserSnapshot['settings'])=>{const finish=windowFinish(state);return finish?{...settings,windowFinish:finish,toolbarColor:undefined}:settings;};
import { toolbarVisibilityItems } from './ui/toolbarMenu';
import { openWorkspacePage } from './ui/workspaceView';
import { appPageOf, backReturnsToOpener } from './runtime/appPages';
import { useNewTabReveal } from './ui/useNewTabReveal';import { useCompactChrome } from './ui/useCompactChrome';import { publishOpenPopup } from './ui/openPopup';import { tuckSidebarStep } from './ui/viewSidebar';
const noEngage = (): void => undefined;
import { chromeMode, chromeRow, compactRowHeight } from './ui/chromeRow';
type PageRect = { x: number; y: number; width: number; height: number };
const samePageRef = (a?: PageRect | null, b?: PageRect | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const slidesOnSidebarCurve = (layout: { pageMotion?: string; pageSpring?: unknown; pageImmediate?: boolean } | null | undefined): boolean => !!layout && layout.pageMotion === 'slide' && !layout.pageSpring && !layout.pageImmediate;
type Dispatch = (action: BrowserAction) => void;
// Keep the tab surfaces unchanged while giving the expanded strip a small top inset.
// Design bible §5.1: chrome as thin as possible — 32px tab strip + 36px toolbar; Compact is one 32px row, Focus 36px.
const windowViewGlyph: Record<WindowView, BrowserMenuIcon> = { full: PanelTop, compact: Minimize2, focus: Maximize2, seamless: SeamlessRow };
const tabStripTopInset = 0, standardToolbarTop = designTokens.geometry.tabRow, standardHeaderHeight = designTokens.geometry.tabRow + designTokens.geometry.toolbar;
const baseNavItems = [['home', 'Workspace', Home], ['history', 'History', History], ['settings', 'Settings', Settings2]] as const;
function Logo({ small = false }: {
    small?: boolean;
}) { return <BrandLogo mark={small}/>; }
function SiteIcon({ url, size = 16, favicon, privacy, error }: {
    url: string;
    size?: number;
    favicon?: string;
    privacy?: 'private' | 'tor';
    error?: boolean;
}) { return <SiteIdentityIcon url={url} favicon={favicon} size={size} privacy={privacy} error={error}/>; }
function IconButton({ children, label, onClick, active, disabled = false, className = '', popup = false, toolbarItem, expanded }: {
    children: ReactNode;
    label: string;
    onClick?: (event: import('react').MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    className?: string;
    popup?: boolean;
    toolbarItem?: ToolbarItemId | 'home';
    expanded?: boolean;
}) { return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} title={controlTitle(label)} aria-label={label} data-toolbar-item={toolbarItem} data-layout-toggle={className.includes('compact-view-toggle') || undefined} data-popup-trigger={popup || undefined} aria-pressed={expanded === undefined ? active : undefined} aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : 'menu'} onClick={onClick} disabled={disabled}>{children}</button>; }
function useLayout() { const [layout, setLayout] = useState<BrowserLayout>({ views: [], visible: true }); useEffect(() => { void runtime.getBrowserLayout().then(setLayout); return runtime.subscribeLayout(setLayout); }, []); return layout; }
function useSystemPreference(query: string) { const [systemPreference, setEnabled] = useState(() => matchMedia(query).matches); useEffect(() => { const media = matchMedia(query), change = () => setEnabled(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [query]); return systemPreference; }
export default function App() { const { state: storedState, dispatch } = useBrowser(); useShortcutKeys(); const osMotion = useSystemPreference('(prefers-reduced-motion: reduce)'), osTransparency = useSystemPreference('(prefers-reduced-transparency: reduce)'), highContrast = useSystemPreference('(prefers-contrast: more)'), systemTheme = useSystemTheme(); const state = { ...storedState,windowUi: effectiveView(storedState.settings, storedState.windowUi) === 'seamless' && (storedState.windowUi.workspaceOpen || storedState.windowUi.webWorkspaceOpen) ? { ...storedState.windowUi, workspaceOpen: false, webWorkspaceOpen: false } : storedState.windowUi,systemReducedTransparency:osTransparency||highContrast,userReducedTransparency:storedState.settings.reducedTransparency, settings: withSystemAccent({ ...storedState.settings, reducedMotion: storedState.settings.reducedMotion || osMotion, reducedTransparency: storedState.settings.reducedTransparency || osTransparency || highContrast }, systemTheme) }; const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches); useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); const listener = () => setSystemDark(m.matches); m.addEventListener('change', listener); return () => m.removeEventListener('change', listener); }, []); const dark = state.settings.appearance === 'dark' || state.settings.appearance === 'system' && systemDark; const colors = themeTokens(windowSettings(state, withFrameTint(state)), dark, highContrast), paintedTheme = useRef(''), theme = themeKey(colors as Record<string, string>); useLayoutEffect(() => { if (paintedTheme.current && paintedTheme.current !== theme && !document.documentElement.hasAttribute('data-theme-settle')) settleThemeTransitions(); paintedTheme.current = theme; }, [theme]); const view = new URLSearchParams(location.search).get('view'); useEffect(() => view ? undefined : prewarmColorScheme(), []); const [authVisible,setAuthVisible]=useState(false); const motionScaleValue=motionScaleOf(state.settings), motionSpeedValue=animationSpeedOf(state.settings); useLayoutEffect(() => { publishMotionSpeed(motionSpeedValue); }, [motionSpeedValue]); return <MotionConfig reducedMotion={state.settings.reducedMotion ? 'always' : 'user'} transition={{ type: 'spring', stiffness: 420, damping: 38 }}><div data-toolbar-color={state.settings.toolbarColor && !windowFinish(state) ? '' : undefined} data-sidebar-color={state.settings.sidebarColor ? '' : undefined} data-window-finish={windowFinish(state)} className={`app style-${state.settings.style} ${state.settings.reducedTransparency ? 'opaque-glass' : ''} ${view === 'overlay' ? 'native-layer' : ''}`} data-reduced-motion={state.settings.reducedMotion} data-motion-speed={animationSpeedOf(state.settings)} data-theme={colors['--surface-tone']} data-appearance={colors['--surface-tone']} data-chrome={(colors as Record<string, string>)['--chrome-tone']} data-finish={colors['--finish']} style={{ ...colors, '--motion-scale': motionScaleValue, '--motion-s': motionScaleValue, '--motion-e': classScale(motionSpeedValue, 'E'), '--motion-l': classScale(motionSpeedValue, 'L'), '--motion-pace': motionPaceOf(motionSpeedValue), '--mac-caption-space':`${86/(state.settings.interfaceScale/100||1)}px`, '--mac-caption-top':`${32/(state.settings.interfaceScale/100||1)}px`, '--navigation-width': state.settings.verticalTabs && workspaceIsOpen(state.windowUi, state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0]) ? `var(--sidebar-width,${state.settings.sidebarWidth||240}px)` : `var(--sidebar-rail,${designTokens.geometry.rail}px)` } as CSSProperties}>{view === 'overlay' ? <NativeOverlay state={state} dispatch={dispatch} dark={dark}/> : <MainBrowser state={state} dispatch={dispatch} dark={dark} authVisible={authVisible}/>}{view!=='overlay'&&<WebsiteAuthDialog client={websiteAuthClient} onVisibilityChange={setAuthVisible}/>}{view!=='overlay'&&<ProtectedMediaNotice state={state} dispatch={dispatch}/>}{view!=='overlay'&&<RatingCard state={state} privateWindow={Boolean(state.tabs.find(tab=>tab.id===state.activeTabId)?.privacy)}/>}{view!=='overlay'&&<ArtworkToast profileId={state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId||state.activeBrowserProfileId} privateMode={state.browserProfiles.some(profile=>profile.id===(state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId||state.activeBrowserProfileId)&&profile.private)}/>}{view!=='overlay'&&<FullscreenLights tabId={state.activeTabId}/>}</div></MotionConfig>; }
const setupClient=createSetupClient(window.acira);
function MainBrowser({state,dispatch,dark,authVisible}:{state:BrowserSnapshot;dispatch:Dispatch;dark:boolean;authVisible:boolean}){
 useEffect(()=>{preloadScreens();},[]);
 useEffect(()=>installDotClick(),[]);
 useEffect(()=>installChromeEdge(),[]);
 useEffect(()=>installSidebarMorph(),[]);
 const isPrivate=!!state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId)?.private,[setupVisible,setSetupVisible]=useState(Boolean(window.acira?.setup)&&!isPrivate),[setupReady,setSetupReady]=useState(false),setupRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{let alive=true;if(!window.acira?.setup||isPrivate){setSetupVisible(false);setSetupReady(true);return;}void setupClient.request({type:'status'}).then(result=>{if(alive){setSetupVisible(result.ok&&(result.progress?.complete===false||result.progress?.pendingSetup===true));setSetupReady(true);}}).catch(()=>{if(alive){setSetupVisible(false);setSetupReady(true);}});return()=>{alive=false;};},[isPrivate]);
 useEffect(()=>{const restart=()=>{if(isPrivate)return;void setupClient.request({type:'restart'}).then(result=>{if(result.ok){setSetupReady(true);setSetupVisible(true);}});};window.addEventListener('acira:restart-setup',restart);return()=>window.removeEventListener('acira:restart-setup',restart);},[isPrivate]);
 /* Focus goes to the setup dialog itself (announced by its label), not its first button: a script focus before any input draws a focus ring in Chromium, so "Skip setup" opened ringed, and Enter would have skipped setup instead of beginning it. Tab reaches the first control, with its ring. */
 useEffect(()=>{if(setupVisible&&setupReady)setupRef.current?.focus({preventScroll:true});},[setupVisible,setupReady]);
 /* When the hidden first-run window is shown, Windows activation moves focus into the page by tab traversal (no script, no key): Chromium puts it on the first control, Skip setup, with a keyboard ring. Until the person has pressed a key or the pointer, that one unprompted move (within the first seconds) goes back to the dialog. A real Tab arrives with its keydown first, so it keeps its ring. */
 useEffect(()=>{const dialog=setupRef.current;if(!setupVisible||!setupReady||!dialog)return;let input=false;const mark=()=>{input=true;};const until=performance.now()+6000;const stop=()=>{window.removeEventListener('keydown',mark,true);window.removeEventListener('pointerdown',mark,true);dialog.removeEventListener('focusin',back);};const back=(event:FocusEvent)=>{if(event.target===dialog)return;if(!input&&performance.now()<until&&(event.target as HTMLElement).matches?.(':focus-visible'))dialog.focus({preventScroll:true});stop();};window.addEventListener('keydown',mark,true);window.addEventListener('pointerdown',mark,true);dialog.addEventListener('focusin',back);return stop;},[setupVisible,setupReady]);
 return <>{!setupVisible&&!authVisible&&<AciraSidebar state={state} dispatch={dispatch}/>}<Browser state={state} dispatch={dispatch} dark={dark} setupVisible={setupVisible||authVisible}/>{setupVisible&&<div className="setup-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr("app.setUpAcira")} ref={setupRef}>{setupReady?<Onboarding client={setupClient} profileId={state.activeBrowserProfileId} onDone={()=>{setSetupVisible(false);requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.address-bar input')?.focus());}}/>:<p role="status">{tr("app.openingAcira")}</p>}</div>}</>;
}
/** Main's toasts, newest last and at most three on screen (bible §4 Transient surfaces): 4s, 8s with an action, notices
 * 12s, errors until dismissed, each on its own timer (toastTimers.ts). Hovering the stack or focusing into it spreads it
 * and pauses every timer; so does a hidden window; each resumes with the time it had left (never less than the 1.5s
 * grace). Each toast's × (its glyph on hover) dismisses that toast alone. A spent Undo (its tabs are back) leaves at
 * once. Status toasts ("AI-free mode on") go to their own lane: one pill, 1.5s, replaced by the next. */
/** A toast action in the current language. Its label's parameters ("Open in {name}") stay here: the toast layer over a website takes
 *  the shown label only (main checks every row it hosts). */
const shownAction = ({ labelParams, ...action }: ToastActionData, translate: ReturnType<typeof useT>): ToastActionData => ({ ...action, label: translate(action.labelId as MessageId, labelParams) });
function useToasts(rawToast: BrowserSnapshot['toast'], closedTabs: BrowserSnapshot['closedTabs'], space: string) {
    const translate = useT(), language = currentLocale();
    // A toast the reducer wrote as a catalog message (and an action label with an id) is shown in the current language.
    const toast = useMemo(() => !rawToast ? rawToast : { ...rawToast, ...(rawToast.i18n ? { text: translate(rawToast.i18n.id as MessageId, rawToast.i18n.params) } : {}), ...(rawToast.action?.labelId ? { action: shownAction(rawToast.action, translate) } : {}) }, [rawToast, language]);
    const [list, setList] = useState<QueuedToast[]>([]), current = useRef(list);
    const [status, setStatus] = useState<{ key: number; text: string; icon?: StatusIcon } | null>(null), statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [boundsStatus, setBoundsStatus] = useState<string | undefined>(undefined);
    const [expanded, setExpanded] = useState(false), [boundsExpanded, setBoundsExpanded] = useState(false), collapse = useRef<ReturnType<typeof setTimeout>>(undefined);
    const timerRef = useRef<ToastTimers>(undefined);
    const timers = timerRef.current ??= createToastTimers(key => setList(rows => rows.filter(row => row.key !== key)));
    current.current = list;
    const dismiss = (...keys: number[]) => { if (!keys.length) return; rememberDismissed(current.current.filter(row => keys.includes(row.key)).map(row => row.id)); for (const key of keys) timers.clear(key); setList(rows => rows.filter(row => !keys.includes(row.key))); };
    const arm = (key: number, ms: number) => timers.arm(key, ms);
    // Profiles as spaces: another profile on screen takes the last space's toasts with it, and so does turning it off (`space` is the
    // profile on screen, '' with workspaces, where nothing changes). This runs before the newest toast is added, so a toast that came
    // with the switch stays.
    useEffect(() => { const gone = otherSpaceToasts(current.current, space); if (!gone.length) return; dismiss(...gone); current.current = current.current.filter(row => !gone.includes(row.key)); }, [space]);
    const loaded = useRef(true);
    useEffect(() => {
        const onLoad = loaded.current; loaded.current = false;
        if (!toast || (onLoad && toastSpentAtLoad(toast, toastDuration(toast)))) return;
        // Over a website the overlay keeps the pill's room until its 140ms exit has finished, so the fade is never clipped.
        if (toast.tone === 'status') { clearTimeout(statusTimer.current); setStatus({ key: toast.id, text: toast.text, ...(toast.icon ? { icon: toast.icon } : {}) }); setBoundsStatus(toast.text); statusTimer.current = setTimeout(() => { setStatus(null); statusTimer.current = setTimeout(() => setBoundsStatus(undefined), toastLeaveMs()); }, 1500); return; }
        const next = pushToast(current.current, toast, space);
        for (const key of next.dropped) timers.clear(key);
        setList(next.list);
        // One shown again after a reload keeps only the time it had left.
        if (toast.tone === 'error') timers.clear(next.key); else arm(next.key, onLoad ? Math.min(toastDuration(toast), toastDuration(toast) - (Date.now() - toast.id)) : toastDuration(toast));
    }, [toast?.id]);
    useEffect(() => dismiss(...spentToasts(current.current, closedTabs)), [closedTabs]);
    useEffect(() => { const visibility = () => timers.visibility(); document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility); }, []);
    useEffect(() => () => { timers.dispose(); clearTimeout(statusTimer.current); clearTimeout(collapse.current); }, []);
    // The room a host reserves: it grows with the list at once, and shrinks only after the leaving toast's exit has played,
    // so no toast is ever cut off by the overlay around it (R3-41, R3-66).
    const [boundsToasts, setBoundsToasts] = useState<QueuedToast[]>([]), shrink = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => {
        clearTimeout(shrink.current);
        if (list.length >= boundsToasts.length) { setBoundsToasts(list); return; }
        shrink.current = setTimeout(() => setBoundsToasts(list), toastLeaveMs());
    }, [list]);
    useEffect(() => () => clearTimeout(shrink.current), []);
    // A single toast never spreads (nothing behind it); the overlay keeps its spread bounds until the stack has settled.
    useEffect(() => { if (list.length < 2) { setExpanded(false); setBoundsExpanded(false); } }, [list.length]);
    const hold = (value: boolean) => {
        timers.hold(value);
        clearTimeout(collapse.current);
        if (value && current.current.length > 1) { setBoundsExpanded(true); setExpanded(true); }
        else if (!value) { setExpanded(false); collapse.current = setTimeout(() => setBoundsExpanded(false), 260); }
    };
    // Dismissing the last toast from its × removes the stack under a still pointer (over a website, the whole overlay view),
    // so no release ever arrives: an empty stack lets go, or the next toast would wait on a hold nobody holds.
    useEffect(() => { if (!list.length && timers.held()) hold(false); }, [list.length]);
    // Errors stay until dismissed (bible §4); the overlay names the toast its × or Undo belongs to (no id: every error).
    // The room grows with the list in the same render (the state below only delays the shrink): reading the state alone left the first
    // render of a new toast with no room, and the host was sent a 0×0 toast layout that main rejects.
    // Main took the overlay down and refuses its id (see toastHostRefused): nothing of the stack is on screen any more.
    const release = () => {
        for (const row of current.current) timers.clear(row.key);
        clearTimeout(shrink.current); clearTimeout(collapse.current); clearTimeout(statusTimer.current);
        setList([]); setBoundsToasts([]); setExpanded(false); setBoundsExpanded(false); setStatus(null); setBoundsStatus(undefined);
    };
    return { toasts: list, boundsToasts: toastRoom(list, boundsToasts), status, boundsStatus, expanded, boundsExpanded, hold, release, dismiss, dismissErrors: () => dismiss(...current.current.filter(row => dismissible(row.tone)).map(row => row.key)), dismissId: (id: number) => dismiss(...current.current.filter(row => row.id === id).map(row => row.key)) };
}
/** Over a website the page's native view covers the UI layer, so the toast is shown on the native overlay layer instead. */
const toastInChrome = (state: BrowserSnapshot) => { const active = state.tabs.find(t => t.id === state.activeTabId); return Boolean(window.acira) && active?.contentKind === 'web' && !active.error; };
/** The button a popup was opened from, when several controls (toolbar and sidebar) open the same popup. */
const popupTriggers = new Map<string, HTMLElement>();
/** A group's chip in the tab strip, and its header row in the sidebar (R3-48: the sidebar has no chip, so a menu opened there must not fall back to the toolbar button). */
const visibleNode = (item: HTMLElement) => !item.closest('[inert]') && item.getClientRects().length > 0;
const stripGroupChip = (groupId?: string) => Array.from(document.querySelectorAll<HTMLElement>('.tab-group-badge')).find(item => item.dataset.groupId === groupId && visibleNode(item));
const groupIdOf = (state: BrowserSnapshot, tabId: string) => { const member = state.tabs.find(item => item.id === tabId); return member ? groupForTab(state, member)?.id : undefined; };
const sidebarGroupHeader = (groupId?: string) => Array.from(document.querySelectorAll<HTMLElement>('.sb-group-header[data-group-header]')).find(item => item.dataset.groupHeader === groupId && visibleNode(item));
/** R7: the box a group's popup (its menu, its editor) hangs from: the chip, header or member tab where it settles, cut to the
 * part the strip shows (visibleAnchor), or the strip's ‹/› control on the side it scrolled out of view. Never the hidden part. */
const groupAnchorBox = (node: HTMLElement): import('./runtime/types').Rectangle => {
    const box = node.matches('.tab-group-badge,.sb-group-header') ? settledBox(node) : node.getBoundingClientRect();
    const strip = node.closest<HTMLElement>('.tab-strip-container,.acira-compact-tabs');
    const control = (side: 'previous' | 'next') => { const item = strip?.querySelector<HTMLElement>(`:scope>.standard-tabs-scroll.${side},:scope>.acira-compact-scroll.${side}`); return item && item.getAttribute('aria-hidden') !== 'true' && visibleNode(item) ? item.getBoundingClientRect() : null; };
    return visibleAnchor(box, clipOf(node, { width: innerWidth, height: innerHeight }, item => getComputedStyle(item as HTMLElement)), { before: control('previous'), after: control('next') }).rect;
};
/** The tab overview button (compact, narrow): what stands for the strip once it has no room to show a single tab. */
const tabsOverviewButton = () => Array.from(document.querySelectorAll<HTMLElement>('.toolbar-tab-overview')).find(visibleNode);
/** R6: a new group's chip or header exists only once the snapshot that holds the group has rendered. Resolves with it as soon
 * as it is in the page: at once when it already is, else on the first frame that has it (bounded: 30 frames or 0.5 s, also
 * when frames are throttled). Its menu then opens at once at the group's settled box (settledBox), not where the group's
 * motion has it now, and not (no chip or header yet) at the toolbar's menu button on the other side of the window. */
const groupNodeFor = (groupId: string) => new Promise<HTMLElement | undefined>(resolve => {
    const find = () => stripGroupChip(groupId) || sidebarGroupHeader(groupId), now = find();
    if (now) { resolve(now); return; }
    let frames = 0, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(find()); };
    const timer = setTimeout(finish, 500);
    const step = () => { if (done) return; if (find() || ++frames > 30) finish(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
});
function popupAnchor(kind: string, state: BrowserSnapshot, contextId?: string, targetMode?: string) {
    const selectors: Record<string, string> = {'workspace-cover':'[aria-label="Change workspace cover"]',protection:'[data-protection-trigger],.toolbar-menu-control,[aria-label="Acira menu"]',tor:'.tor-chip',update:'.update-pill',zoom:'.address-zoom-indicator', 'bookmark-edit':'.address-star', tabs: '.toolbar-tab-overview,[aria-label="All open tabs"],[aria-label="All open tabs (Alt+T)"],[aria-label="Open tab switcher"],[aria-label="Tab search"]', menu: '.toolbar-menu-control,[aria-label="Acira menu"]', profile: '.toolbar-optional-profile,.toolbar-overflow-profile,.sb-foot-profile,.toolbar-overflow,.toolbar-menu-control', appearance: '[data-toolbar-item="appearance"],[aria-label="Appearance"],.toolbar-menu-control,[aria-label="Acira menu"]', suggestions: '.address-bar', security: '.address-security,[aria-label="Page information"]', palette: '.address-bar', find: '.toolbar-menu-control,[aria-label="Acira menu"]', split: '.toolbar-menu-control,[aria-label="Acira menu"]', downloads: '.toolbar-menu-control,[aria-label="Acira menu"]', bookmarks: '[data-toolbar-item="bookmarks"],[aria-label="All bookmarks"]', extensions: '[data-toolbar-item="extensions"],[aria-label="Extensions"]', 'workspace-menu': '[data-workspace-title],[data-workspace-chip]', 'workspace-context': '[data-workspace-title],[data-workspace-chip],[data-workspace-switcher]', 'workspace-edit': '[data-workspace-new],[data-workspace-title],[data-workspace-chip],.sb-foot-profile,.toolbar-optional-profile,.toolbar-overflow-profile' };
    const recorded = popupTriggers.get(kind);
    const candidates = [...(kind === 'profile' ? document.querySelectorAll<HTMLElement>('.toolbar-optional-profile,.toolbar-overflow-profile') : []), ...document.querySelectorAll<HTMLElement>(selectors[kind] || '.toolbar-menu-control,[aria-label="Acira menu"]'), ...(kind === 'suggestions' || kind === 'security' || kind === 'bookmark-edit' ? [] : document.querySelectorAll<HTMLElement>('.sb-addr-pill'))];/* address bar in the sidebar: a button behind a closed pill is anchored at the pill */
    let node = recorded?.isConnected && recorded.getClientRects().length && !recorded.closest('[inert]') ? recorded : candidates.find(n => !n.closest('[inert]') && n.getClientRects().length);
    // A group's editor opens from its chip, also when it was created from a tab's menu (no recorded trigger). Without a chip or
    // header yet it opens at the member tab, never at the toolbar's menu button on the other side of the window (R6).
    if (kind === 'group-context' && contextId) {
        const member = state.tabs.find(item => item.id === contextId), group = member && groupForTab(state, member);
        // R7: a compact row too narrow for one tab hides the whole strip (inert): the tab overview button stands for it.
        node = stripGroupChip(group?.id) || sidebarGroupHeader(group?.id) || Array.from(document.querySelectorAll<HTMLElement>('.browser-tab[data-tab-id],.sb-tab[data-tab-id],.acira-compact-tab[data-tab-id]')).find(item => item.dataset.tabId === contextId && visibleNode(item)) || tabsOverviewButton() || node;
    }
    // A workspace's editor opens from that workspace's own icon in the sidebar when it was asked for from its menu.
    if (kind === 'workspace-edit') {
        const target = peekWorkspaceTarget();
        if (target && 'workspaceId' in target)
            node = Array.from(document.querySelectorAll<HTMLElement>('[data-ws]')).find(item => item.dataset.ws === target.workspaceId && !item.closest('[inert]') && item.getClientRects().length) || node;
    }
    // A bookmark's editor opens from its item on the bookmarks bar when it was asked for there (its menu's Edit…).
    if (kind === 'bookmark-edit' && contextId)
        node = Array.from(document.querySelectorAll<HTMLElement>('.bookmarks-bar>[data-bookmark-id]')).find(item => item.dataset.bookmarkId === contextId && !item.closest('[inert]') && item.getClientRects().length) || node;
    if (kind === 'tab-context' && contextId) {
        // A linked tab (a group tab also drawn in a loose split) has two chips: the menu opens at the one that is in view of its strip, never at
        // one scrolled out of it (the compact strip scrolls too, and its chips are found here as well).
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.browser-tab,.acira-compact-tab')).filter(item => item.dataset.tabId === contextId && visibleNode(item) && !item.closest('.tab-drag-preview'));
        const inView = (item: HTMLElement) => { const clip = item.closest<HTMLElement>('.tab-strip-viewport,.acira-compact-tabs-viewport'); if (!clip) return true; const a = item.getBoundingClientRect(), b = clip.getBoundingClientRect(); return Math.min(a.right, b.right) - Math.max(a.left, b.left) >= Math.min(a.width, 24); };
        node = rows.find(inView) || rows[0] || node;
    }
    // Sidebar mode with the sidebar away draws no toolbar: a popup that would hang from one of its buttons (or from none: the zoom level before its indicator exists) hangs from where the field
    // stands once the sidebar is out, so every one opens in the same place, as it does with the sidebar showing (ui/addressInSidebar.ts revealedFieldBox).
    if (document.querySelector('.browser-shell[data-sbmode="bare"]') && (!node || node.closest('.browser-shell[data-sbmode="bare"]'))) return revealedFieldBox(clampSidebarWidth(state.settings.sidebarWidth));
    // A group's chip or header may still be moving into place (FLIP): its menu goes where it ends up (R6).
    const rect = node && kind === 'group-context' && node.matches('.tab-group-badge,.sb-group-header,.browser-tab,.sb-tab,.acira-compact-tab') ? groupAnchorBox(node) : node?.getBoundingClientRect();
    if (rect && node) {
        const toolbar = node.closest('.acira-persistent-toolbar'), shell = node.closest<HTMLElement>('.browser-shell');
        if (toolbar) {
            const transform = getComputedStyle(toolbar).transform, currentY = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
            return { x: rect.x, y: rect.y - currentY + ((targetMode || shell?.dataset.layout) === 'standard' && !document.querySelector('.browser-root.side-tabs') ? standardToolbarTop : 0), width: rect.width, height: rect.height };
        }
    }
    return rect && rect.width && rect.height ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height } : { x: innerWidth - 60, y: 48, width: 36, height: 36 };
}
function Browser({ state, dispatch, dark,setupVisible=false }: {
    state: BrowserSnapshot;
    dispatch: Dispatch;
    dark: boolean;
    setupVisible?:boolean;
}) {
    const tab = state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0], s = state.settings, style = s.style;
    const profileFrameTint = frameTintFor(state), currentWindowFinish = windowFinish(state);
    const storedRail=useRailPrefs(tab.browserProfileId,state.browserProfiles.find(profile=>profile.id===tab.browserProfileId)?.private);
    useLayoutRepair(s.verticalTabs,storedRail.tabs,tab.browserProfileId,!!state.browserProfiles.find(profile=>profile.id===tab.browserProfileId)?.private);
    const railPrefs={tabs:useShownTabsSwitch(s.verticalTabs,storedRail.tabs,tab.browserProfileId)};
    const extensionTarget=useExtensionToolbar(tab);
    const toolbarItems=useToolbarItems(tab.browserProfileId);
    useToolbarOverflow(toolbarItems.filter(item => item.visible && item.id !== 'aifree').map(item => ({ id: item.id, label: item.id === 'focus' ? (effectiveView(state.settings, state.windowUi) === 'focus' ? tr("app.exitFocusMode") : tr("app.enterFocusMode")) : item.id === 'profile' ? tr("app.switchProfile") : toolbarItemLabels[item.id] })));
    // Toasts sit bottom-centre of the content area: in the page area for Acira pages, on the native overlay over websites.
    // With profiles as spaces a toast belongs to the space on screen; with workspaces ('') to the window.
    const toastSpace = profilesAsSpaces(state) ? state.activeBrowserProfileId : '';
    const toastState = useToasts(state.toast, state.closedTabs, toastSpace), toasts = toastState.toasts, toastOverChrome = toastInChrome(state);
    useEffect(() => { setToastActive(toasts.length > 0); return () => setToastActive(false); }, [toasts.length]);
    // One live region that is always mounted announces each new toast once (a region inserted together with its text
    // is often not read, and toasts over websites are drawn in the overlay view). Dismissing one never re-reads the rest.
    const [toastAnnouncement, setToastAnnouncement] = useState(''), announcedToast = useRef(0);
    useEffect(() => { const newest = toasts.reduce<QueuedToast | undefined>((latest, row) => !latest || row.key > latest.key ? row : latest, undefined); if (newest && newest.key > announcedToast.current) {
        announcedToast.current = newest.key;
        setToastAnnouncement(newest.text);
    } }, [toasts]);
    useEffect(() => { if (toastState.status) setToastAnnouncement(toastState.status.text); }, [toastState.status?.key]);
    // Profiles as spaces: the last space's toasts leave with it, and so does their line here (a toast that came with the switch is said next).
    useEffect(() => setToastAnnouncement(''), [toastSpace]);
    // One native host carries the whole stack: it keeps its generation while any toast is up, so rows come and go in place.
    const toastOverlayId = useRef<number | undefined>(undefined);
    // A page/link right-click menu (bible §4: same material and motion as every menu); main keeps the actions.
    const pageMenu = useRef<PageMenuItem[]>([]);
    // How the open popup was summoned travels with it (bible §4 One motion): opened from the keyboard it appears at once;
    // a centred panel opened from a button grows from that button.
    const popupInput = useRef<'keyboard' | undefined>(undefined);
    // "New Tor identity" (menu row, Ctrl+Shift+U) opens the Tor panel already asking; the intent travels in the popup's context.
    const popupIntent = useRef<'identity' | 'report' | undefined>(undefined);
    const popupMotion = <T extends object>(geometry: PopupGeometry, anchor: { x: number; y: number; width: number; height: number } | undefined, context: T) => { const centred = geometry.origin.x === .5 && geometry.origin.y === .5, b = geometry.bounds, clamp01 = (v: number) => Math.min(1, Math.max(0, v)); return { ...context, ...(anchor && !popupInput.current ? { trigger: { ...anchor } } : {}), ...(popupInput.current ? { input: 'keyboard' as const } : {}), ...(centred && anchor && !popupInput.current ? { from: { x: clamp01((anchor.x + anchor.width / 2 - b.x) / b.width), y: clamp01((anchor.y + anchor.height / 2 - b.y) / b.height) } } : {}) }; };
    if (!toasts.length && !toastState.status && !toastState.boundsStatus && !toastState.boundsToasts.length) toastOverlayId.current = undefined; else if (toastOverlayId.current === undefined) toastOverlayId.current = nextOverlayId();
    const toastOverWebsite = useRef(false); toastOverWebsite.current = toastOverChrome;
    useEffect(() => runtime.subscribeBrowser(event => { if (event.type === 'overlay-dismissed' && toastHostRefused(toastOverWebsite.current, toastOverlayId.current, event.id)) { toastOverlayId.current = undefined; toastState.release(); } }), []);
    // R4-61: the feature-rating card over a website rides the same transient layer, bottom-right, when no popup or toast holds it.
    // A click in the page closes that overlay: the card then hides quietly and is not carried back for its exit.
    const rating = useRatingOnScreen(), ratingOverlayId = useRef<number | undefined>(undefined), [ratingHidden, setRatingHidden] = useState<string | null>(null);
    if (!rating) ratingOverlayId.current = undefined; else if (ratingOverlayId.current === undefined) ratingOverlayId.current = nextOverlayId();
    useEffect(() => { if (!rating) setRatingHidden(null); }, [rating]);
    useEffect(() => runtime.subscribeBrowser(event => { if (event.type === 'overlay-dismissed' && event.id !== undefined && event.id === ratingOverlayId.current) { setRatingHidden(ratingOnScreen()?.feature ?? null); window.dispatchEvent(new Event(RATING_HIDE_EVENT)); } }), []);
    const toastModel = (row: QueuedToast): ToastRowModel => ({ key: row.key, text: row.text, ...(row.tone ? { tone: row.tone } : {}), ...(row.action ? { actionLabel: row.action.label, actionKey: toastActionKey(row.action) } : {}), dismissible: dismissible(row.tone) });
    const toastModels = toasts.map(toastModel);
    const renderToast = (model: ToastRowModel) => { const row = toasts.find(item => item.key === model.key); return <ToastCard row={model} action={row && <ToastAction action={row.action} dispatch={dispatch} onDone={() => toastState.dismiss(row.key)}/>} onDismiss={() => row && toastState.dismiss(row.key)}/>; };
    const {reader,close:closeReader}=useReader(tab);
    useLinkDrop(dispatch, tab.id);
    usePageFocusOnPick(tab.id);
    const workspaceOpen = workspaceIsOpen(state.windowUi, tab), setWorkspaceOpen = (value: boolean | ((previous: boolean) => boolean)) => dispatch({ type: 'ui.update', patch: sidebarPatch(typeof value === 'function' ? value(workspaceOpen) : value) }), view = effectiveView(s, state.windowUi), seamless = view === 'seamless', addrWanted = addressInSidebarWanted(s.addressInSidebar, railPrefs.tabs), sbChrome = sidebarModeChrome(addrWanted, seamless), focusMode = view === 'focus', setFocusMode = (value: boolean) => dispatch({ type: 'ui.update', patch: { focusMode: value } }), setWindowView = (mode: WindowView) => dispatch({ type: 'ui.update', patch: { view: toggleView(s, state.windowUi, mode) } });
    // Selecting a website from the workspace is an explicit choice to keep using it.
    const dispatchWorkspace: Dispatch = action => { if (action.type === 'tab.select') {
        const target = state.tabs.find(item => item.id === action.id);
        if (target && workspacePreferenceKey(target) === 'webWorkspaceOpen')
            dispatch({ type: 'ui.update', patch: { webWorkspaceOpen: true } });
    } dispatch(action); };
    const sidebarPeeking = useSidebarPeek() && !workspaceOpen;
    const [overlay, publishOverlay] = useState<string | null>(null), [contextId, setContextId] = useState(''), [address, setAddress] = useState(tab.url === 'acira://new' ? '' : tab.url), [addressFocused, setAddressFocused] = useState(false), [autoSuspended, setAutoSuspended] = useState(false), [reveal, setReveal] = useState(false), [size, setSize] = useState({ width: innerWidth, height: innerHeight }), [findOpen, setFindOpen] = useState(false), [find, setFind] = useState(''), [matches, setMatches] = useState(''), [dragTarget, setDragTarget] = useState<'split' | null>(null);
    // Unloaded and restored tabs show the icon kept on this computer from the last visit, not a generic globe.
    const storedIcon = useSiteIcons(state);
    // Chips made outside React (a dragged tab or pane) find the tab's favicon and stored icon here, so a loading tab's chip is never blank (ui/chipIcon.ts).
    setChipIconLookup({ tab: id => state.tabs.find(item => item.id === id), stored: storedIcon });
    const popupTransition = useRef<ReturnType<typeof createPopupTransition> | null>(null);
    if (!popupTransition.current)
        popupTransition.current = createPopupTransition(publishOverlay);
    const overlayId = useRef<number | undefined>(undefined), popupLockedTop = useRef<number | undefined>(undefined), popupParent = useRef<'menu' | undefined>(undefined), popupLevel = useRef<'back' | undefined>(undefined);
    // A popup's id leaves with its kind, never before: dropping the id first left one commit that still held the kind (the layout effect
    // then published a popup with no id, which main takes for a new popup, and its layout echo undid the close) and made the overlay
    // renderer ask for the backdrop of a popup main had already retired. Main refuses every layout of an id it has dismissed, so an
    // id that is kept until the state follows is harmless; releaseOverlayId() drops it at once only when no kind is left to publish.
    const releaseOverlayId = () => { if (openRef.current === null) overlayId.current = undefined; };
    const setOverlay = (kind: string | null) => { if (kind === null) {
        // Without a popup there is nothing to close: an id-less close is "whatever overlay is up" to main, which took down a showing
        // toast on every tab change and marked its id dismissed, so the toast (and every later one until the list emptied) never showed again.
        if (overlayId.current !== undefined) runtime.closeOverlay(overlayId.current);
        releaseOverlayId();
        popupLockedTop.current = undefined;
    } popupTransition.current!.set(kind); };
    useEffect(() => () => popupTransition.current?.dispose(), []);
    const addressRef = useRef<HTMLInputElement>(null), pageRef = useRef<HTMLElement>(null), paneRefs = useRef(new Map<string, HTMLElement>()), openRef = useRef(overlay);
    openRef.current = overlay;
    useLayoutEffect(() => { if (overlay === null) overlayId.current = undefined; }, [overlay]);
    const escapeRef = useRef(() => { }), findInPageRef = useRef(() => { });
    escapeRef.current = () => {
        // Native Escape is routed through this callback rather than the DOM.
        const popover = document.querySelector<HTMLElement>('[popover]:popover-open');
        if (popover) { popover.hidePopover(); return; }
        if (popupTransition.current?.hasOpen()) {
            setOverlay(null);
            return;
        }
        // G: Escape lets go of a peeking sidebar; the pinned sidebar is the tab list and only its toggle closes it.
        if (sidebarPeeking) {
            setSidebarPeek(false);
            return;
        }
        if (findOpen) {
            setFindOpen(false);
            return;
        }
        if (reveal || addressFocused || keyTop) {
            // As in Chrome, Esc in the address field first undoes what was typed; with nothing typed it also stops a loading page.
            const shown = tab.url === 'acira://new' ? '' : tab.url, edited = addressFocused && address !== shown;
            setAddress(shown);
            setReveal(false);
            setKeyTop(false);
            setShellFocus(false);
            addressRef.current?.blur();
            if (tab.contentKind === 'web' && tab.loading && !edited)
                void runtime.browserCommand({ type: 'stop', tabId: tab.id });
            if (tab.contentKind === 'web')
                void runtime.browserCommand({ type: 'focus', tabId: tab.id });
            return;
        }
        // R3-68: Esc sends a toolbar the pointer revealed back, too.
        if (seamless && edge.top) {
            dismissEdge('top');
            return;
        }
        if (tab.loading)
            void runtime.browserCommand({ type: 'stop', tabId: tab.id });
    };
    const popupAnchorRef = useRef<{
        kind: string;
        style: BrowserStyle;
        bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        /** A new group's menu in the sidebar opens beside the group's header (groupEditorPlacement): the header's box when opened. */
        beside?: import('./runtime/types').Rectangle;
    } | null>(null), popupHeightRef = useRef<Record<string, number>>({}), openPopupHeight = useRef<{ id?: number; height: number } | undefined>(undefined);
    const [suggestionIndex, setSuggestionIndex] = useState(0), [addressAnchor, setAddressAnchor] = useState<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>(null);
    const [addressEditTab, setAddressEditTab] = useState<string | null>(null), addressLocation = useRef({ id: tab.id, url: tab.url }), addressTakenFor = useRef<string | null>(null), addressCarried = useRef<string | null>(null);
    const addressCommands = useAddressCommands(profilesAsSpaces(state));
    const suggestions = rankAddressSuggestions(address, state, 8, { commands: addressCommands }), activeSuggestionIndex = Math.min(suggestionIndex, suggestions.length - 1);
    const suggestionContext = useRef({ query: address.slice(0, 4096), tabId: tab.id, overlay, count: suggestions.length });
    suggestionContext.current = { query: address.slice(0, 4096), tabId: tab.id, overlay, count: suggestions.length }; useEffect(() => { publishOpenPopup(overlay); }, [overlay]);
    useEffect(() => runtime.subscribeBrowser(event => { if (event.type !== 'address-highlight')
        return; const current = suggestionContext.current; if (current.overlay === 'suggestions' && event.tabId === current.tabId && event.query === current.query && event.index >= -1 && event.index < current.count)
        setSuggestionIndex(event.index); }), []);
    const [popupMeasure, setPopupMeasure] = useState<{
        kind: string;
        style: BrowserStyle;
        height: number;
    } | null>(null);
    useLayoutEffect(() => { const previous = addressLocation.current; addressLocation.current = { id: tab.id, url: tab.url }; if (previous.id === tab.id && previous.url === tab.url)
        return; const draft = carriesAddressDraft({ takenFor: addressTakenFor.current, tabId: tab.id, previousTabId: previous.id, editedTab: addressEditTab, focused: document.activeElement === addressRef.current }); if (previous.id !== tab.id) addressTakenFor.current = null; if (draft) { addressCarried.current = tab.id; setAddressEditTab(tab.id); } else if (previous.id !== tab.id) {
        addressRef.current?.blur();
        setAddressFocused(false);
        setAddressEditTab(null);
        setAddress(tab.url === 'acira://new' ? '' : tab.url);
    } const editingSameTab = previous.id === tab.id && addressEditTab === tab.id && addressFocused; if (!overlayOutlivesTabChange(openRef.current, editingSameTab)) {
        setOverlay(null);
        popupAnchorRef.current = null;
    } }, [tab.id, tab.url, addressEditTab, addressFocused]);
    useLayoutEffect(() => { if (!['group-preview', 'group-context', 'split-context', 'tab-context'].includes(overlay || ''))
        return; const owner = state.tabs.find(item => item.id === contextId); if (!owner || overlay === 'group-preview' && !groupForTab(state, owner)?.collapsed)
        setOverlay(null); }, [overlay, contextId, state.tabs, state.tabGroups]);
    useEffect(()=>retainSettingsViews(state.tabs),[state.tabs]);
    const dragging = dragTarget !== null;
    const splitPair = state.windowUi.split && state.windowUi.split.tabIds.includes(tab.id) ? state.windowUi.split : null;
    const visibleTabs = splitPair ? splitPair.tabIds.map(id => state.tabs.find(item => item.id === id)!).filter(Boolean) : [tab], split = visibleTabs.find(item => item.id !== tab.id), native = Boolean(window.acira), management = tab.contentKind === 'internal' && tab.url !== 'acira://new' && (true);
    // A tab dragged onto the page brings up the Snap-style picker (ui/splitDrop.ts). Stills of the panes on screen, taken
    // when the tab first reaches the page, keep the website sharp while the native views step aside for pointer capture.
    const splitPicker = useSplitPicker(), paneDrag = usePaneDrag();
    const [splitStills, setSplitStills] = useState<Record<string, string>>({});
    // R3-26: split changes never cut. When the panes on screen change, the native pages step aside in the same commit and stills
    // of the pages glide from their old boxes to their new ones (ui/splitMorph.ts, SplitMorphLayer); a dropped tab flies in.
    const paneIds = visibleTabs.map(item => item.id), paneKey = `${paneIds.join(',')}|${splitPair ? `${splitPair.layout}:${splitPair.cols.join(',')}:${splitPair.rows.join(',')}:${splitPair.colRows?.map(set => set.join(',')).join(';') ?? ''}` : ''}`;
    const lastPane = useRef({ key: paneKey, ids: paneIds, layout: splitPair?.layout }), paneBoxes = useRef<PaneBox[]>([]), stillCache = useRef(new Map<string, string>()), liveBoxes = useRef(new Map<string, MorphRect>()), morphCount = useRef(0), [morphRun, setMorphRun] = useState<(SplitMorphRun & { done?: boolean }) | null>(null), [, bumpMorph] = useState(0);
    // R4-29: the same panes in another layout (a rearrangement from the pane picker, Ctrl+Shift+1-6) glide too.
    /** The page's corner radius (the native views get it; split panes shape their ribbon and card to match it, --pane-radius). */
    // In fullscreen Seamless the page is the whole screen: no frame, so no corners either (seamless.css takes the margin and the radius off the card).
    const windowFullscreen = useWindowFullscreen();
    const pageCardRadius = () => style === 'acira' ? (seamless && windowFullscreen ? 0 : sbChrome && windowFullscreen ? 0 : sidebarOnFrame(state, edge, false) || seamless || sbChrome ? designTokens.geometry.pageRadius : 0) : designTokens.geometry.pageRadius;
    // R5: a pane drag that ends on a zone already shows the result in its frames (they hold it while the pages are laid out under them): no morph on top.
    const morphWanted = (before: readonly string[], layoutChanged = false) => native && !s.reducedMotion && motionScale() > 0 && paneDrag?.phase !== 'drop' && shouldMorph(before, paneIds, layoutChanged);
    const morphPending = lastPane.current.key !== paneKey && morphWanted(lastPane.current.ids, lastPane.current.layout !== splitPair?.layout);
    // A pane ribbon being dragged also steps the native pages aside, but only once their stills are in (no blank flash under the zones) — or after a short
    // wait when a still never comes (a page that can't be captured must not keep the zones hidden under it for the whole drag).
    const paneDragging = Boolean(paneDrag), [paneDragAside, setPaneDragAside] = useState(false);
    useEffect(() => { if (!paneDragging) { setPaneDragAside(false); return; } const timer = setTimeout(() => setPaneDragAside(true), 220); return () => clearTimeout(timer); }, [paneDragging]);
    const splitPreview = Boolean(splitPicker) || morphPending || Boolean(morphRun && !morphRun.done) || (paneDragging && (paneDragAside || visibleTabs.every(item => item.contentKind !== 'web' || Boolean(item.error) || Boolean(splitStills[item.id]))));
    setSplitDropContext({ visible: splitPair ? splitPair.tabIds : [], activeId: tab.id, tabIds: state.tabs.map(item => item.id), layout: splitPair?.layout, onEnterPage: ids => { setSplitStills({}); for (const id of ids) {
        const item = state.tabs.find(entry => entry.id === id);
        if (item?.contentKind === 'web' && !item.error)
            void (runtime.browserCommand({ type: 'snapshot', tabId: id }) as Promise<unknown>).then(still => { if (typeof still === 'string')
                { stillCache.current.set(id, still); setSplitStills(current => ({ ...current, [id]: still })); } }, () => {});
    } } });
    const canvasWidth = () => pageRef.current?.closest('.browser-root')?.getBoundingClientRect().width ?? size.width;
    const setSplitId = (id: string | null) => { setOverlay(null); if (!id) {
        dispatch({ type: 'split.close' });
        return;
    } if (canvasWidth() - 16 < 846) {
        dispatch({ type: 'toast', text: tr("app.widenTheWindowToUse"), tone: 'info' });
        return;
    } dispatch({ type: 'split.open', tabIds: [tab.id, id] }); };
    /** Where each visible pane's page sits in the page area while the picker is up (under its label in a split). */
    const pickerPanes = (): SplitPickerPane[] => { if (!splitPicker)
        return []; const outer = pageRef.current?.getBoundingClientRect(); return visibleTabs.map(item => { const node = paneRefs.current.get(item.id), r = node?.getBoundingClientRect(), label = node?.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0; return { tabId: item.id, still: splitStills[item.id], rect: r && outer ? { x: r.left - outer.left, y: r.top - outer.top + label, width: r.width, height: r.height - label } : null }; }); };
    useEffect(() => { const dismissOutside = (event: PointerEvent) => { const target = event.target; if (!(target instanceof Element))
        return; if (overlayPointerDismiss({ popup: Boolean(target.closest('.popup-surface')), trigger: Boolean(target.closest('[data-popup-trigger]')), address: Boolean(target.closest('.address-bar')), suggestions: openRef.current === 'suggestions' }) && popupTransition.current?.hasOpen())
        setOverlay(null); }; document.addEventListener('pointerdown', dismissOutside, true); return () => document.removeEventListener('pointerdown', dismissOutside, true); }, []);
    useEffect(() => { setAutoSuspended(false); }, [tab.id]);
    // R4-14: Compact rests in its one row; a new tab, Ctrl+Tab or Ctrl+L shows the full chrome for a moment, and menus, drags,
    // the address field and the pointer over the chrome hold it (state machine: ui/compactChrome.ts, docs/launch/COMPACT_MODE_UX.md).
    // R4-25: Compact applies on every page (Settings, History ... too), so choosing it in Settings changes the window at once.
    const compactView = view === 'compact', compactEligible = !autoSuspended;
    // R4-25: with tabs in the sidebar, Compact and Focus tuck the sidebar behind the row's sidebar button (ui/viewSidebar.ts).
    const tuckedSidebar = useRef<{ view: WindowView; reopen: boolean }>({ view, reopen: false });
    useEffect(() => {
        const step = tuckSidebarStep({ before: tuckedSidebar.current.view, after: view, sidebarTabs: railPrefs.tabs && !addrWanted, open: workspaceOpen, reopen: tuckedSidebar.current.reopen });
        tuckedSidebar.current = { view, reopen: step.reopen };
        if (step.open !== undefined) setWorkspaceOpen(step.open);
    }, [view]);
    const chromeBottomRef = useRef(designTokens.geometry.toolbar + designTokens.geometry.tabRow);
    const compactChrome = useCompactChrome({ enabled: compactView && compactEligible && !sbChrome, tabIds: state.tabs.map(item => item.id), tabId: tab.id, tabUrl: tab.url, popupOpen: overlay !== null && !['page-context', 'find', 'zoom', 'toast', 'suggestions'].includes(overlay), dragging, addressFocused, chromeBottom: chromeBottomRef });
    const compact = compactView && compactEligible && !compactChrome.expanded;
    const mode = chromeMode({ focus: focusMode, toolbar: compact ? 'compact' : 'visible', engaged: compact, reveal: false });
    const effectiveMode = sbChrome || (reveal && !compactView) ? 'standard' : mode;
    // R3-65: what the row holds in this mode (chromeRow.ts; tests/chrome-row.test.ts pins every combination).
    const parts = chromeRow(effectiveMode, railPrefs.tabs, designTokens.geometry.toolbar, designTokens.geometry.tabRow);
    // Address bar in the sidebar (ui/addressInSidebar.ts): with the setting on and tabs in the sidebar, the toolbar's address field,
    // Back, Reload, Forward and the sidebar button sit at the top of the sidebar and the other buttons behind a pill under the field.
    const edge = useChromeEdge(), [keySide, setKeySide] = useState(false), sidebarModePeek = useRef(0);
    const askSide = addrWanted && seamless && (addressFocused || reveal || keySide);
    const addrBlock = addressBlockShown({ wanted: addrWanted, sidebarOpen: workspaceOpen, edgeSide: edge.side, asked: askSide }), sbHeader = sidebarModeHeader(sbChrome, addrBlock);
    const addrRoot = useRef<HTMLDivElement>(null);
    useSidebarFocus(workspaceOpen, effectiveMode);
    const { holdAutomatic, releaseAutomatic } = useNewTabReveal({ tabs: state.tabs, tab, focusMode, compactMode: false, compactEnabled: false, enabled: true, busy: dragging, reveal, addressRef, addressEditPending: addressEditTab === tab.id, autoSuspended, setReveal, setFocusMode, setEngagedTab: noEngage, overlayKind: overlay });
    const compactToggleRef = useRef(() => { });
    compactToggleRef.current = () => {if(!overlayOutlivesLayoutChange(openRef.current))setOverlay(null);holdAutomatic();setReveal(false);setWindowView('focus');};
    const seamlessToggleRef = useRef(() => { });
    seamlessToggleRef.current = () => { if(!overlayOutlivesLayoutChange(openRef.current))setOverlay(null); setReveal(false); setWindowView('seamless'); };
    const showRail = workspaceOpen;
    const sidebarSpace = 0;
    useLayoutEffect(() => { if (overlay === 'suggestions' && !s.addressSuggestions)
        setOverlay(null); }, [effectiveMode, overlay, s.addressSuggestions]);
    // The suggestions hang from the address field. A layout change while they are open (tabs Top or Sidebar, the sidebar, the
    // window view) moves the field over a few frames: the new row arrives by a transform and the side-tabs class follows, so the
    // field read at the commit was where it was leaving (36px high and off to the side with tabs moved to Top). Read it again
    // once it has stopped moving, as the Acira menu does.
    useLayoutEffect(() => { if (overlay !== 'suggestions')
        return; const read = () => popupAnchor('suggestions', state, undefined, effectiveMode), keep = (anchor: ReturnType<typeof popupAnchor>) => setAddressAnchor(old => old && ['x', 'y', 'width', 'height'].every(key => old[key as keyof typeof old] === anchor[key as keyof typeof anchor]) ? old : anchor);
        keep(read());
        return settleAnchor(read, keep); }, [overlay, effectiveMode, size.width, style, s.showHome, s.verticalTabs, workspaceOpen, addrBlock]);
    // The Acira menu (and More tools from it) stays open through a layout change: its own Tabs switch, the sidebar toggle. It keeps
    // hanging from its button, which the new layout puts elsewhere, instead of staying over the toolbar row where the button was.
    // The new row settles over a few frames (it is moved by a transform), so the button is read once it has stopped moving.
    const [menuAnchorMoved, setMenuAnchorMoved] = useState(0);
    useLayoutEffect(() => { const kind = openRef.current; if (kind !== 'menu' && kind !== 'more-tools') return;
        let frame = 0, steady = 0, seen = '', count = 0;
        const settle = () => { const held = popupAnchorRef.current, recorded = popupTriggers.get(kind), node = recorded?.isConnected ? recorded : document.querySelector<HTMLElement>('.toolbar-menu-control');
            if (openRef.current !== kind || held?.kind !== kind || !node || !node.getClientRects().length || node.closest('.browser-shell[data-sbmode="bare"]')) return;
            const box = node.getBoundingClientRect(), now = { x: box.x, y: box.y, width: box.width, height: box.height }, key = (['x', 'y', 'width', 'height'] as const).map(side => Math.round(now[side])).join();
            steady = key === seen ? steady + 1 : 0; seen = key;
            if (steady >= 3 || ++count > 90) { if ((['x', 'y', 'width', 'height'] as const).some(side => Math.abs(now[side] - held.bounds[side]) > 0.5)) { popupAnchorRef.current = { ...held, bounds: now }; setMenuAnchorMoved(moved => moved + 1); } return; }
            frame = requestAnimationFrame(settle); };
        frame = requestAnimationFrame(settle);
        return () => cancelAnimationFrame(frame); }, [s.verticalTabs, workspaceOpen, effectiveMode]);
    // The block is laid over the top of the sidebar: the toolbar is in the header, which starts where the sidebar ends.
    useLayoutEffect(() => { const root = addrRoot.current; if (!root) return; if (!addrBlock) { root.style.removeProperty('--addr-left'); root.style.removeProperty('--addr-w'); return; }
        let frames = 0, frame = 0; const place = () => { if (!sidebarMorphRunning()) root.style.setProperty('--addr-left', -root.getBoundingClientRect().x + 'px'); root.style.setProperty('--addr-w', clampSidebarWidth(s.sidebarWidth) + 'px'); if (++frames < 45) frame = requestAnimationFrame(place); };
        place(); return () => cancelAnimationFrame(frame); }, [addrBlock, s.sidebarWidth, workspaceOpen, edge.side, view, size.width]);
    const bookmarkVisible = bookmarksOnTab(s, tab) && parts.bookmarksBar, bookmarkHold = useExitHold(bookmarkVisible, 300);
    // R3-70: a toolbar button that appears or goes away (Home, Tab overview) slides its neighbours instead of cutting them; a layout switch only re-records places.
    const toolbarShape = [parts.tabOverview, s.showHome, s.showTabOverview].join(), toolbarRebase = [effectiveMode, railPrefs.tabs, s.verticalTabs, s.toolbarLayout].join(), toolbarRef = useRef<HTMLDivElement>(null), navigationRef = useRef<HTMLDivElement>(null);
    useListMotion(toolbarRef, toolbarShape, { frequent: true, rebase: toolbarRebase }); useListMotion(navigationRef, toolbarShape, { frequent: true, rebase: toolbarRebase });
    // Tabs listed in the open sidebar replace the strip; the toolbar becomes the top row, beside the window controls.
    const sideTabs = railPrefs.tabs && effectiveMode === 'standard';
    const toolbarTop = sideTabs ? 0 : standardToolbarTop;
    // With the block in the sidebar the strip above the page is 6 px on the Mac and the toolbar's height elsewhere (the window buttons).
    const addrStrip = sbChrome ? windowFullscreen ? 0 : addressStripHeight(document.documentElement.dataset.platform || 'darwin', designTokens.geometry.toolbar) : undefined;
    const bookmarkTop = addrStrip ?? parts.height;
    const fullHeaderHeight = bookmarkTop + (bookmarkVisible ? 36 : 0);
    chromeBottomRef.current = fullHeaderHeight;
    // R3-68 Seamless: with nothing on screen but the page, the toolbar shows when the pointer rests on the top edge (main watches the
    // pointer: desktop/edge-reveal.cjs, `chrome-edge`) and for whatever a key asks for (Ctrl+L, a new tab, F10). Menus, drags and
    // focus in the chrome keep it open; none of them can open it.
    const pressing = useChromePress(), [shellFocus, setShellFocus] = useState(false), [keyTop, setKeyTop] = useState(false);
    bindEdgeTab(tab.id, !!state.windowUi.split?.tabIds?.includes(tab.id));
    setEdgeStills(id => stillCache.current.get(id));
    const askTop = seamless && !addrWanted && (addressFocused || reveal || keyTop);
    const keepOverlay = overlay !== null && !['page-context', 'find', 'zoom', 'toast', 'suggestions'].includes(overlay);
    const topBarHidden = seamless && !edge.top && !askTop;
    // A private or Tor window keeps a 2px line in its colour along the top, so the mode is never invisible.
    const seamlessLine = tab.privacy === 'tor' || isTorWindow(state) ? 'tor' : tab.privacy === 'private' || state.browserProfiles.some(profile => profile.private && profile.id === tab.browserProfileId) ? 'private' : undefined;
    const headerHeight = topBarHidden ? (seamlessLine ? 2 : 0) : fullHeaderHeight;
    setEdgeAsks(askTop, askSide);
    setEdgeHeaderHeight(fullHeaderHeight);
    // What keeps a showing edge open (menus from the chrome, a press that may become a drag, focus in the chrome) and what asks
    // for one, to main's controller.
    useEffect(() => { sendEdgeFlags({ top: seamless && (keepOverlay || pressing || setupVisible || shellFocus), side: keepOverlay || pressing || (askSide && addressFocused) }, { top: askTop, side: askSide }); }, [seamless, keepOverlay, pressing, setupVisible, shellFocus, askTop, askSide, addressFocused]);
    // A reveal that nothing took up (the address never got focus) lets go; Seamless asks for the toolbar only while it is used.
    useEffect(() => { if (!seamless || addressFocused || shellFocus || !(reveal || keyTop)) return; const timer = setTimeout(() => { setReveal(false); setKeyTop(false); }, Math.max(400, sidebarModePeek.current - performance.now())); return () => clearTimeout(timer); }, [seamless, addressFocused, shellFocus, reveal, keyTop]);
    useEffect(() => { if (!seamless) { setKeyTop(false); setKeySide(false); setShellFocus(false); } }, [seamless]);
    useEffect(() => { if (!seamless || addressFocused || !(reveal || keySide)) return; const timer = setTimeout(() => setKeySide(false), Math.max(400, sidebarModePeek.current - performance.now())); return () => clearTimeout(timer); }, [seamless, addressFocused, reveal, keySide]);
    // Sidebar mode switched in Seamless: nothing is on screen to change, so the edge it now lives at shows for a moment (the sidebar with the address block, or the toolbar when it was turned off).
    useEffect(() => { if (!seamless) return; const show = () => { sidebarModePeek.current = performance.now() + SIDEBAR_MODE_PEEK_MS; setKeySide(true); setKeyTop(true); }; window.addEventListener(sidebarModePeekEvent, show); return () => window.removeEventListener(sidebarModePeekEvent, show); }, [seamless]);
    // Seamless's first use: one plain line, once per profile; and "Hide until needed" becomes Seamless, once, with a notice (UF-008).
    useEffect(() => {
        if (!window.acira) return;
        let alive = true;
        void runtime.getSnapshot().then(snapshot => {
            if (!alive) return;
            const { patch, notify } = migrateAutoHide(snapshot.settings, consumeLegacyAutoHide());
            if (patch) dispatch({ type: 'settings.update', patch });
            if (notify) { rememberSeamlessTip(tab.browserProfileId); dispatch({ type: 'toast', text: tr('windowview.migrated', { shortcut: shortcutFor('workspace', 'Ctrl Shift E') || formatShortcut('Ctrl Shift E') }), tone: 'info' }); }
        }, () => undefined);
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        if (!seamless || seamlessTipSeen(tab.browserProfileId)) return;
        rememberSeamlessTip(tab.browserProfileId);
        dispatch({ type: 'toast', text: tr('windowview.firstRun', { shortcut: shortcutFor('seamless-mode', 'Ctrl Shift L') || formatShortcut('Ctrl Shift L') }), tone: 'info' });
    }, [seamless]);
    // The tip says Seamless is on: leaving Seamless takes it down, or it kept saying so for up to 12 s in the view just entered.
    useEffect(() => {
        if (seamless) return;
        toastState.dismiss(...toastKeysSaying(toastState.toasts, tr('windowview.firstRun', { shortcut: shortcutFor('seamless-mode', 'Ctrl Shift L') || formatShortcut('Ctrl Shift L') })));
    }, [seamless]);
    // The old page click ends a keyboard reveal and lets a pinned edge go.
    const [toolbarAnnouncement, setToolbarAnnouncement] = useState('');
    useEffect(() => { if (!seamless) return; setToolbarAnnouncement(edge.top ? tr('windowview.shown') : edge.side ? tr('windowview.sidebarShown') : ''); }, [seamless, edge.top, edge.side]);
    useEffect(() => { if (addressCarried.current === tab.id) { addressCarried.current = null; return; } if (addressEditTab !== tab.id || !addressFocused)
        setAddress(tab.url === 'acira://new' ? '' : tab.url); }, [tab.url, tab.id, addressEditTab, addressFocused]);
    useEffect(() => { let width=innerWidth,height=innerHeight;const resize = () => { const next={width:innerWidth,height:innerHeight};if(next.width===width&&next.height===height)return;/* A real window resize closes anchored popups; a 1px jitter from a fractional zoom (1100px at 150% is 733.3 CSS px) when a popup opens is not one (P0: at 150% no popup stayed open). */const moved=Math.abs(next.width-width)>2||Math.abs(next.height-height)>2;width=next.width;height=next.height;if (moved && openRef.current && openRef.current !== 'tabs')setOverlay(null);setSize(next); }; window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [style]);
    const navigate = (input: string, tabId = tab.id) => { const target = resolveNavigation(input, ...searchFor(s, state.tabs.find(item => item.id === tabId)?.privacy), state.websiteLanguage); if (target.error) {
        dispatch({ type: 'toast', text: target.error, tone: 'error' });
        return;
    } setAddressEditTab(null); releaseAutomatic(); compactChrome.send({ type: 'commit' }); dispatch({ type: 'tab.navigate', url: target.url, tabId }); setOverlay(null); setReveal(false); if (target.contentKind === 'web')
        void runtime.browserCommand({ type: 'focus', tabId }); };
    const open = (kind: string, id?: string, anchor?: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, input?: 'keyboard', beside?: import('./runtime/types').Rectangle) => { const previousKind = openRef.current;
        // A toolbar-overflow row disappears as its destination opens. Keep the
        // stable » button as that destination's trigger instead of falling back
        // to a different control (for profiles, the sidebar footer).
        const overflowTrigger = previousKind === 'toolbar-overflow' ? popupTriggers.get(previousKind) : undefined;
        popupTriggers.delete(kind);
        if (overflowTrigger?.isConnected && visibleNode(overflowTrigger)) popupTriggers.set(kind, overflowTrigger); const intent = kind === 'tor' && id === 'identity' ? 'identity' as const : (kind === 'security' || kind === 'menu') && id === 'report' ? 'report' as const : undefined; popupIntent.current = intent; if (intent) id = undefined; if (['assistant', 'context', 'accounts'].includes(kind))
        return; const bounds = anchor || popupAnchor(kind, state, id, effectiveMode); if (openRef.current === kind && !id && !intent && kind !== 'suggestions') {
        setOverlay(null);
        return;
    } popupTransition.current!.request(kind, () => { popupInput.current = input || (keyboardInput() ? 'keyboard' : undefined); overlayId.current = nextOverlayId(); popupLockedTop.current = undefined; /* R3-42: a submenu opened from the menu has a way back; the menu reopened from one slides in from the left */ popupParent.current = previousKind === 'menu' && submenuKinds.includes(kind) ? 'menu' : undefined; popupLevel.current = kind === 'menu' && previousKind && submenuKinds.includes(previousKind) ? 'back' : undefined; popupAnchorRef.current = { kind, style, bounds, ...(beside ? { beside } : {}) }; setContextId(id || ''); }, !!id || !!intent || kind === 'suggestions'); };
    /** R6: the menu a new group opens with (Move to tab group › New tab group). It is asked for right after the group is
     * created, often before this window has rendered it, and the ui event's listener holds an older render's state: read the
     * group from a fresh snapshot and open on the first frame its chip or header is in the page, at the box it settles into
     * (beside a sidebar header), while it is still moving there: no waiting for the motion to end. */
    const latestOpen = useRef(open);
    latestOpen.current = open;
    const openGroupMenu = useRef(async (tabId: string, input?: 'keyboard') => {
        const next = await runtime.getSnapshot().catch(() => null), member = next?.tabs.find(item => item.id === tabId), group = next && member ? groupForTab(next, member) : undefined;
        const found = group ? await groupNodeFor(group.id) : undefined;
        // One frame on: the strip's reveal-scroll starts in the frame after the group renders and publishes its goal there.
        if (found?.matches('.tab-group-badge')) await new Promise(resolve => { const timer = setTimeout(resolve, 34); requestAnimationFrame(() => { clearTimeout(timer); resolve(undefined); }); });
        const node = found?.isConnected ? found : group ? stripGroupChip(group.id) || sidebarGroupHeader(group.id) : undefined, rect = node ? groupAnchorBox(node) : undefined;
        latestOpen.current('group-context', tabId, rect, input, rect && node?.matches('.sb-group-header') ? rect : undefined);
    });
    const previousZoom=useRef({id:tab.id,url:tab.url,zoom:tab.zoom});
    const zoomOpen=useRef(open);zoomOpen.current=open;
    useEffect(()=>installPageMagnify(),[]);
    usePageZoomHolds();
    useEffect(()=>installPageZoomGlide(),[]);
    useEffect(()=>{const old=previousZoom.current;previousZoom.current={id:tab.id,url:tab.url,zoom:tab.zoom};if(old.id===tab.id&&old.url===tab.url&&old.zoom!==tab.zoom&&(!openRef.current||openRef.current==='zoom')){if(openRef.current!=='zoom')zoomOpen.current('zoom',tab.id);}},[tab.id,tab.url,tab.zoom]);
    const bookmarkMenu = useRef(open);
    bookmarkMenu.current = open;
    useEffect(() => { const request = (event: Event) => { const { url, anchor } = (event as CustomEvent<BookmarkMenuRequest>).detail; bookmarkMenu.current('bookmark-context', url, anchor); }; window.addEventListener(bookmarkMenuEvent, request); return () => window.removeEventListener(bookmarkMenuEvent, request); }, []);
    const previewHeld = useRef(false), previewClose = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(previewClose.current), []);
    // The tab hover card (R3 zen-extras): the main process draws it; this only reports which tab the pointer is on.
    useTabHoverCard(true, state.activeTabId); useEffect(() => setTabHoverCardMode(s.tabHoverCard), [s.tabHoverCard]);
    const previewGroup = (id: string, anchor: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, visible: boolean, force = false) => { clearTimeout(previewClose.current); if (force) {
        previewHeld.current = false;
        if (openRef.current === 'group-preview')
            setOverlay(null);
        return;
    } if (visible) {
        if (openRef.current && openRef.current !== 'group-preview')
            return;
        previewHeld.current = false;
        open('group-preview', id, anchor);
    }
    else if (!previewHeld.current)
        previewClose.current = setTimeout(() => { if (openRef.current === 'group-preview')
            setOverlay(null); }, 100); };
    // With nothing typed, nothing is preselected: Enter on an empty field must not open a suggestion.
    const showSuggestions = (empty = false) => { if (empty ? s.addressSuggestions : opensSuggestionsOnFocus({ enabled: s.addressSuggestions, draftTabId: addressEditTab, tabId: tab.id, draft: address })) {
        setSuggestionIndex(addressRef.current?.value.trim() ? 0 : -1);
        open('suggestions');
    } };
    const chooseSuggestion = (item: AddressSuggestion, switchToTab = false) => { if (runAddressRow(item, dispatch)) { setOverlay(null); addressRef.current?.blur(); return; } const action = addressSuggestionAction(item, switchToTab, tab.id); if (action.type === 'tab.select') {
        dispatch(action);
        setOverlay(null);
        setReveal(false);
    }
    else
        navigate(item.url); addressRef.current?.blur(); };
    const suggestionKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey)
            return false;
        if (event.key === 'Escape' && overlay === 'suggestions') {
            setOverlay(null);
            return true;
        }
        if (!s.addressSuggestions)
            return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (overlay !== 'suggestions')
                showSuggestions(true);
            setSuggestionIndex(index => nextAddressSuggestion(overlay === 'suggestions' ? index : -1, event.key as 'ArrowUp' | 'ArrowDown', suggestions.length));
            return true;
        }
        if (overlay !== 'suggestions')
            return false;
        const selected = suggestions[activeSuggestionIndex];
        if (event.key === 'Delete' && event.shiftKey && selected?.historyId) {
            dispatch({ type: 'history.remove', id: selected.historyId });
            return true;
        }
        if (event.key === 'Enter' && selected) {
            chooseSuggestion(selected, event.shiftKey && selected.kind === 'tab');
            return true;
        }
        if (event.key === 'Tab' && !event.shiftKey && selected) {
            const completed = addressCompletion(address, selected);
            if (completed && completed !== address) {
                const from = address.length;
                setAddressEditTab(tab.id);
                setAddress(completed);
                setSuggestionIndex(0);
                requestAnimationFrame(() => addressRef.current?.setSelectionRange(from, completed.length));
                return true;
            }
            setOverlay(null);
        }
        return false;
    };
    // Ctrl+F: websites get the find bar; Acira pages (Settings, History, Downloads, Bookmarks) focus their own search,
    // as Chrome does on its settings pages. The old in-chrome bar searched nothing there and ignored Esc.
    const findInPage = () => { if (tab.contentKind === 'web' && native) {
        open('find');
        return;
    } const field = pageRef.current?.querySelector<HTMLInputElement>('input[type=search], input[aria-label^="Search"], input[placeholder^="Search"], input[placeholder^="Find"]'); if (field) {
        field.focus();
        field.select();
    }
    else if (!native)
        setFindOpen(true); };
    // Listeners subscribed once per tab id call through this, so a new tab that became a website still gets the find bar.
    findInPageRef.current = findInPage;
    const addressEditTime = useRef<{tabId:string;at:number}|null>(null);
    const focusAddressRef = useRef((requestedAt?:number) => {});
    const focusAddress = (requestedAt?:number) => {
        if (!addressRequestIsCurrent(requestedAt,addressEditTime.current,tab.id)) return;
        // Address bar in the sidebar: focus the field where it is, open a closed sidebar first, or (Seamless) ask for the sidebar's edge.
        if (addrWanted) {
            const plan = addressFocusPlan({ wanted: addrWanted, seamless, sidebarOpen: workspaceOpen, edgeSide: edge.side });
            const focusNow = () => { addressTakenFor.current = newestActiveTabId() ?? tab.id; addressRef.current?.focus(); addressRef.current?.select(); showSuggestions(); };
            compactChrome.send({ type: 'address-key' });
            if (plan === 'reveal-edge') flushSync(() => setKeySide(true));
            if (plan === 'open-sidebar') setWorkspaceOpen(true);
            if (plan === 'focus' || plan === 'reveal-edge') { focusNow(); return; }
            // The sidebar opens in the layout step that follows: focus the field once it is on screen.
            let frames = 0; const wait = () => { const input = addressRef.current; if (input && input.getClientRects().length && !input.closest('[inert]') && getComputedStyle(input).visibility !== 'hidden') focusNow(); else if (++frames < 40) requestAnimationFrame(wait); }; requestAnimationFrame(wait);
            return;
        }
        const needsReveal = topBarHidden;
        const revealAddress = () => {
            if (seamless) setKeyTop(true);
        };
        // Commit a hidden toolbar's reveal before focusing its field. Selecting on a later frame can
        // overwrite the first characters typed after Ctrl+L, including during the setup handoff.
        compactChrome.send({ type: 'address-key' });
        if (needsReveal) flushSync(revealAddress);
        else revealAddress();
        addressTakenFor.current = newestActiveTabId() ?? tab.id;
        addressRef.current?.focus(); addressRef.current?.select(); showSuggestions();
    };
    focusAddressRef.current = focusAddress;
    const navigation = (type: 'back' | 'forward' | 'reload' | 'stop') => { if (tab.contentKind === 'web' && window.acira)
        void runtime.browserCommand({ type, tabId: tab.id });
    else if (type === 'back' || type === 'forward')
        dispatch({ type: 'tab.history', direction: type === 'back' ? -1 : 1 });
    else if (type === 'reload')
        dispatch({ type: 'tab.navigate', url: tab.url }); };
    useEffect(() => runtime.subscribeLayout(next => {
        if (next.overlay?.kind === 'tabs' && next.overlay.id !== undefined && next.overlay.id === overlayId.current)
            popupLockedTop.current = next.overlay.bounds.y;
        if (next.overlay?.contentHeight) {
            popupHeightRef.current[`${style}:${next.overlay.kind}`] = next.overlay.contentHeight; openPopupHeight.current = { id: next.overlay.id, height: next.overlay.contentHeight };
            const current = liveLayout.current;
            if (current && sameOverlayId(current.overlay, next.overlay))
                liveLayout.current = { ...current, overlay: next.overlay };
        }
    }), [style]);
    useEffect(() => runtime.subscribeBrowser(event => { if (event.type === 'overlay-dismissed' && event.id === overlayId.current) {
        popupTransition.current?.set(null);
        releaseOverlayId();
        popupLockedTop.current = undefined;
        popupAnchorRef.current = null;
    } if (event.type === 'page-interaction' && event.tabId === tab.id) {
        setKeyTop(false);
        if (currentEdge().pinned.side) pinEdge('side', false);
        if (currentEdge().pinned.top) pinEdge('top', false);
        addressRef.current?.blur();
        setAddressFocused(false);
        setReveal(false);
        compactChrome.send({ type: 'page' });
    } if (event.type === 'ui') {
        if (event.action === 'page-context' && event.anchor && event.items?.length) {
            pageMenu.current = event.items;
            open('page-context', event.targetTabId || tab.id, event.anchor);
            return;
        }
        if (event.action === 'popup-trigger' && event.anchor) {
            if (!activatePopupTriggerAt(event.anchor))
                setOverlay(null);
            return;
        }
        if (event.action === 'address-commit') {
            compactChrome.send({ type: 'commit' });
            setAddressEditTab(null);
            setReveal(false);
            addressRef.current?.blur();
        }
        if (event.action === 'open' && event.kind) {
            if (event.kind === 'bookmark-edit') {
                // Native Ctrl+D saves first. Read the authoritative record and current URL before opening its editor.
                void runtime.getSnapshot().then(next => { const current=next.tabs.find(item=>item.id===next.activeTabId); if(current&&bookmarkControl(next,current).saved)open('bookmark-edit',current.url,event.anchor); }).catch(()=>{});
            } else if (event.kind === 'group-context' && !event.anchor && event.targetTabId) void openGroupMenu.current(event.targetTabId, event.input);
            else open(event.kind, event.targetTabId, event.anchor, event.input);
        }
        if (event.action === 'rename-group') {
            setOverlay(null);
            void runtime.getSnapshot().then(next => { const member = next.tabs.find(item => item.id === event.targetTabId); const group = member && groupForTab(next, member); if (group)
                requestAnimationFrame(() => requestInlineRename(group.id)); });
        }
        if (event.action === 'customize-sidebar') {
            setOverlay(null);
            requestAnimationFrame(() => openSidebarCustomize());
        }
        if (event.action === 'rename-tab') {
            setOverlay(null);
            requestAnimationFrame(() => { if (event.targetTabId) requestTabRename(event.targetTabId); });
        }
        if (event.action === 'preview-hold') {
            previewHeld.current = true;
            clearTimeout(previewClose.current);
        }
        if (event.action === 'toast-hold' || event.action === 'toast-release') {
            toastState.hold(event.action === 'toast-hold');
            return;
        }
        if (event.action === 'toast-dismiss') {
            // The overlay's Undo names its own row, which goes at once; its × still clears every error.
            if (typeof event.toastId === 'number') toastState.dismissId(event.toastId); else toastState.dismissErrors();
            return;
        }
        if (event.action === 'preview-dismiss') {
            previewHeld.current = false;
            previewClose.current = setTimeout(() => { if (openRef.current === 'group-preview')
                setOverlay(null); }, 100);
        }
        if (event.action === 'split') {
            setSplitId(event.targetTabId || null);
            setOverlay(null);
        }
        if (event.action === 'find')
            findInPageRef.current();
        if (event.action === 'focus-mode')
            compactToggleRef.current();
        if (event.action === 'seamless-mode')
            seamlessToggleRef.current();
    } if (event.type === 'shortcut') { if(event.tabId&&event.tabId!==tab.id)return;
        if (event.command === 'reveal')
            setOverlay(null);
        if (event.command === 'address')
            focusAddressRef.current(event.requestedAt);
        if (event.command === 'find')
            findInPageRef.current();
        ;
        // Alt+Shift+T or F10 (Chrome's keys): the first toolbar control takes focus, so the toolbar is reachable from the keyboard.
        if (event.command === 'toolbar') {
            if (seamless) flushSync(() => setKeyTop(true));
            document.querySelector<HTMLElement>('.browser-toolbar:not([inert]) :is(button,input):not(:disabled)')?.focus();
        }
        if (event.command === 'palette')
            open('palette');
        if (event.command === 'escape')
            escapeRef.current();
    } if (event.type === 'find-result' && event.tabId === tab.id)
        setMatches(`${event.activeMatchOrdinal}/${event.matches}`); }), [tab.id, native, style, s.searchEngine, s.reducedMotion, focusMode, compact, management, addressFocused, autoSuspended, workspaceOpen, split?.id, size.width, sidebarSpace, seamless, topBarHidden, effectiveMode]);
    useEffect(() => { const listener = (e: KeyboardEvent) => { if (setupVisible || e.defaultPrevented || e.isComposing)
        return; const mod = window.acira?.platform === 'darwin' ? e.metaKey : e.ctrlKey || e.metaKey, key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
        // Main owns native bindings, including removed/rebound defaults. Escape and
        // macOS Option+T are deliberately delegated back to chrome there.
        if (native && key !== 'escape' && !(window.acira?.platform === 'darwin' && e.altKey && !mod && key === 't')) return;
        if (e.altKey && !mod && key === 't' && !(window.acira?.platform === 'darwin' && takesTypedText(e.target))) {
        e.preventDefault();
        if (!e.repeat)
            open('tabs');
        return;
    } if (mod && !e.altKey && e.shiftKey && key === 'e') {
        e.preventDefault();
        if (!e.repeat) {
            setOverlay(null);
            setWorkspaceOpen(value => !value);
        }
        return;
    } if (mod && e.shiftKey && key === 'a') {
        e.preventDefault();
        if (!e.repeat)
            open('tabs');
        return;
    } if (mod && e.shiftKey && key === 'f') {
        if (!management && !addressFocused) {
            e.preventDefault();
            compactToggleRef.current();
        }
        return;
    } if (key === 'escape') {
        e.preventDefault();
        escapeRef.current();
        return;
    } if (!mod)
        return; let handled = true; if (key === 't') {
        setOverlay(null);
        dispatch({ type: e.shiftKey ? 'tab.restore' : 'tab.new' });
    }
    else if (key === 'w')
        dispatch({ type: 'tab.close', id: tab.id });
    else if (key === 'l' || key === 'e' || key === 'k' && !e.shiftKey)
        focusAddress();
    else if (key === 'k' && e.shiftKey)
        open('palette');
    else if (key === 'f')
        findInPageRef.current();
    else if (key === 'b' && e.shiftKey)
        dispatch({ type: 'settings.update', patch: bookmarksTogglePatch(s, tab) });
    else if (key === 'd') {
        const bookmark = bookmarkControl(state, tab);
        if (bookmark.available) { if (!bookmark.saved) dispatch({ type: 'bookmark.toggle', url: tab.url }); open('bookmark-edit', tab.url); }
    }
    else if (key === ',')
        openWorkspacePage('settings', state, dispatch);
    // Ctrl+Tab belongs to main (desktop/shortcuts.cjs: recent-tab switcher or strip order); it is not prevented there,
    // so cycling here as well would switch twice.
    else if (['+', '=', '-', '0'].includes(key)) {
        const zoom = key === '0' ? 100 : nextPageZoom(tab.zoom||100,key==='-'?-1:1);
        void runtime.browserCommand({type:'zoom',tabId:tab.id,zoom});
    }
    else
        handled = false; if (handled)
        e.preventDefault(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [setupVisible,tab.id, state.tabs, state.bookmarkNodes, s.zoom, s.bookmarksBar, s.bookmarksOnNewTabOnly, style, native, s.searchEngine, s.reducedMotion, 1, focusMode, management, addressFocused, workspaceOpen, autoSuspended, seamless, topBarHidden, effectiveMode]);
    useEffect(() => { if (!findOpen) {
        if (tab.contentKind === 'web')
            void runtime.browserCommand({ type: 'stop-find', tabId: tab.id });
        return;
    } if (tab.contentKind === 'web')
        void runtime.browserCommand({ type: 'find', tabId: tab.id, text: find });
    else {
        const text = paneRefs.current.get(tab.id)?.innerText.toLowerCase() || '';
        setMatches(find ? `${text.split(find.toLowerCase()).length - 1} matches` : '');
    } }, [find, findOpen, tab.id]);
    // The find bar is a popup. Closing it (Esc, its ×, or main taking it down on a blur, a resize or a click in the page) clears the page's
    // highlight, as in every other browser: only the old in-window bar ever sent stop-find, so the match stayed lit on the page, and on the
    // tab's next page, until another find.
    const findTab = useRef<string | null>(null);
    useEffect(() => {
        if (overlay === 'find') { findTab.current = tab.contentKind === 'web' ? tab.id : null; return; }
        const id = findTab.current;
        if (id === null) return;
        findTab.current = null;
        void runtime.browserCommand({ type: 'stop-find', tabId: id });
    }, [overlay]);
    useLayoutEffect(() => { if (split && splitPair && size.width - sidebarSpace - 16 < minimumSize(splitPair.layout, SPLIT_GAP, SPLIT_MIN_PANE).width) {
        dispatch({ type: 'split.close' });
        dispatch({ type: 'toast', text: tr("app.splitViewClosedToKeep"), tone: 'info' });
    } }, [size.width, sidebarSpace, Boolean(split)]);
    const wasSeamless = useRef(seamless);
    useLayoutEffect(() => { if (seamless && !wasSeamless.current) noteSeamlessEntry(); wasSeamless.current = seamless; }, [seamless]);
    const liveLayout = useRef<BrowserLayout | null>(null), lastPageBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null), unsentSlide = useRef<{ page: { x: number; y: number; width: number; height: number }; fields: Partial<BrowserLayout> } | null>(null), sentShape = useRef({ shape: '', look: '' });
    const edgeFloatRef = useRef({ side: false, top: false }), edgeRestRef = useRef<{ page: { x: number; y: number; width: number; height: number }; views: Map<string, { x: number; y: number; width: number; height: number }> } | null>(null);
    // R4-54: every page kind floats: a website or a split (native views under a hole), or a page the interface draws itself.
    // All views share the connected frame. A closed sidebar overlays the page; only explicitly docking it changes the viewport.
    setEdgeFloatable(!setupVisible && (seamless || s.verticalTabs && !workspaceOpen), visibleTabs.length > 1 ? visibleTabs.some(item => item.contentKind === 'web' && !item.error && reader?.tabId !== item.id) : tab.contentKind === 'web' && !tab.error && reader?.tabId !== tab.id, true);
    // Outside Seamless the float is the sidebar's peek only: the Seamless toolbar's float lingers until its hide has played, and counted here it held the page at the card's rest
    // rect (y=6, x=6) over the docked toolbar row for that time (with reduced motion, the first sends of the switch).
    const sideFloating = () => isEdgeFloating() && (seamless || edge.side);
    edgeFloatRef.current = { side: (seamless && edge.side && !edge.pinned.side) || sideFloating(), top: seamless && !topBarHidden && !edge.pinned.top };
    const physicalLayout = (target: BrowserLayout): BrowserLayout => {
        // While Sidebar mode's morph plays the window is between two layouts: any other send (a popup settling, a toast) repeats the page placement the morph's own send carried, so main finds nothing to retarget.
        const pinned = sidebarMorphSend() ? null : sidebarMorphPinned();
        if (pinned && pinned.views.length === target.views.length && target.views.every(view => pinned.views.some(held => held.tabId === view.tabId))) return { ...target, views: pinned.views, pageBounds: pinned.pageBounds, pageImmediate: pinned.pageImmediate, pageMotion: pinned.pageMotion, pageSpring: pinned.pageSpring, pageEdgeLag: pinned.pageEdgeLag, pageHold: pinned.pageHold };
        const outer = pageRef.current?.getBoundingClientRect();
        if (!outer?.width || !outer.height)
            return target;
        // Keep the shared frame's cut-out aligned when Compact expands its toolbar or its theme changes.
        refreshEdgeFloat();
        const rect = (r: DOMRect, topOffset = 0) => ({ x: Math.round(r.left), y: Math.round(r.top + topOffset), width: Math.max(0, Math.round(r.right) - Math.round(r.left)), height: Math.max(0, Math.round(r.bottom) - Math.round(r.top + topOffset)) });
        let views = target.views.flatMap(item => { const node = paneRefs.current.get(item.tabId); if (!node)
            return []; const r = node.getBoundingClientRect(), label = node.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0; return [{ ...item, bounds: rect(r, label) }]; });
        let page = rect(outer);
        // R4-24 Seamless: an edge the pointer (or a key) reveals moves the page aside but never resizes it, so the page does not
        // reflow or repaint blank mid-reveal (measured at 150%: 400ms of blank page after the old resize). Its right (or bottom)
        // part slides past the window edge while the sidebar (or toolbar) shows; a pinned sidebar resizes it as before.
        const float = edgeFloatRef.current;
        if (!float.side && !float.top)
            edgeRestRef.current = { page, views: new Map(views.map(view => [view.tabId, view.bounds])) };
        else if (edgeRestRef.current) {
            const rest = edgeRestRef.current, keep = (r: { width: number; height: number }, now: typeof page) => ({ ...now, width: float.side ? Math.max(now.width, r.width) : now.width, height: float.top ? Math.max(now.height, r.height) : now.height });
            // Floating (Tier A): the page stays exactly where it was, the sidebar draws over it.
            const floatSide = sideFloating() || (seamless && float.top && !edge.pinned.top);
            page = floatSide ? { ...rest.page } : keep(rest.page, page);
            // A page first shown while floating takes the whole page's rest place only when it is the whole page: a split with one
            // website (beside a new tab) has one view too, and that pane must keep its own place (its picture stood stretched otherwise).
            // A tab's rest place counts only while the page is laid out as it was at rest: a site that was a split's pane and is now
            // the whole page (or the reverse) took its old pane's size (founder, 30 Oct: YouTube stood small in a corner).
            const sameSet = views.length === rest.views.size && views.every(view => rest.views.has(view.tabId));
            views = views.map(view => { const r = sameSet ? rest.views.get(view.tabId) : undefined; return r ? { ...view, bounds: floatSide ? { ...r } : keep(r, view.bounds) } : !seamless && floatSide && views.length === 1 && !split ? { ...view, bounds: { ...rest.page } } : view; });
        }
        // The sidebar opening or closing moves the card's left edge and keeps its right edge (or, floating, its size): main glides that (G).
        const was = lastPageBounds.current; lastPageBounds.current = page;
        const sameWidth = !!was && Math.abs(page.width - was.width) <= 1, sameHeight = !!was && Math.abs(page.height - was.height) <= 1;
        const slide = !!was && !s.reducedMotion && Math.abs(page.x - was.x) >= 40 && (Math.abs(page.x + page.width - was.x - was.width) <= 8 || sameWidth) && Math.abs(page.y - was.y) <= 40;
        // The toolbar showing or hiding moves the page's top edge and keeps its bottom (or its size): the same glide, on the edge reveal's own spring.
        // Entering Seamless is that glide too, on the hide spring (a sidebar leaving with it keeps the sidebar's own curve).
        const spring = edgePageSpring(), entering = spring ? null : seamless ? seamlessEntrySpring() : null, drop = !!was && !!(spring || entering) && !s.reducedMotion && Math.abs(page.y - was.y) >= 2 && (Math.abs(page.y + page.height - was.y - was.height) <= 8 || sameHeight) && Math.abs(page.x - was.x) <= 8;
        // A layout the switch's gate has not sent yet (sendWhenLayoutSwitchReady keeps the latest only) is superseded by the next one for the same page rectangle (a popup closing under the
        // switch re-renders it): that one finds the page already at its new place and would say "immediate", and the page jumped there instead of gliding. It carries the slide on.
        const moving = (slide || drop) && document.documentElement.dataset.pageLive === undefined;
        let fields: Partial<BrowserLayout> = moving ? { pageImmediate: false, pageMotion: 'slide' as const, ...(spring ? { pageSpring: spring } : entering && !slide ? { pageSpring: entering } : {}) } : { pageImmediate: true };
        // Sidebar mode's morph: the page card changes size and place on the morph's own spring and lag, and keeps its layout held (main glides it once).
        const morph = sidebarMorphSend();
        if (morph && !s.reducedMotion) fields = { pageImmediate: false, pageMotion: 'slide' as const, pageSpring: morph.spring, pageEdgeLag: morph.lag, pageHold: true };
        if (moving || (morph && !s.reducedMotion)) unsentSlide.current = { page, fields }; else if (unsentSlide.current && samePageRef(unsentSlide.current.page, page)) fields = unsentSlide.current.fields; else unsentSlide.current = null;
        const placed = { ...target, views, pageBounds: page, ...fields };
        if (morph) sidebarMorphPin(placed);
        return placed;
    };
    useLayoutEffect(() => { const node = pageRef.current; if (!node)
        return; let frame = 0; const flush = () => { if (liveLayout.current)
        if (liveLayout.current) { const physical = physicalLayout(liveLayout.current); sendWhenLayoutSwitchReady(() => { if (samePageRef(unsentSlide.current?.page, physical.pageBounds)) unsentSlide.current = null; runtime.setBrowserLayout(physical); }, slidesOnSidebarCurve(physical)); } performance.mark('acira-layout-sent'); }, send = () => { if (sidebarMorphRunning()) return; cancelAnimationFrame(frame); refreshEdgeFloat(); /* the pinned page follows a layout shift in the frame it happens in, not the next one */ if (document.documentElement.dataset.pageLive !== undefined) flush(); else frame = requestAnimationFrame(flush); }; const observer = new ResizeObserver(send), stopMorph = onSidebarMorphEnd(send); observer.observe(node); for (const id of visibleTabs.map(item => item.id)) {
        const pane = paneRefs.current.get(id);
        if (pane)
            observer.observe(pane);
    } return () => { observer.disconnect(); stopMorph(); cancelAnimationFrame(frame); }; }, [visibleTabs.map(item => item.id).join('|')]);
    const presentation = useRef({ tabId: tab.id, management }), presentationChanged = presentation.current.tabId !== tab.id || presentation.current.management !== management;
    useLayoutEffect(() => { presentation.current = { tabId: tab.id, management }; });
    const immediateLayout = s.reducedMotion || dragging || presentationChanged;
    const modeAnchor = useRef(effectiveMode);
    useLayoutEffect(() => { if (modeAnchor.current !== effectiveMode) {
        modeAnchor.current = effectiveMode;
        if (openRef.current && !overlayOutlivesLayoutChange(openRef.current))
            setOverlay(null);
    } }, [effectiveMode]);
    useEffect(() => { if (findOpen) {
        setFindOpen(false);
        if (tab.contentKind === 'web')
            open('find');
    } }, [tab.id, tab.url, tab.contentKind]);
    const measurePaneBoxes = (): PaneBox[] => { const outer = pageRef.current?.getBoundingClientRect(); if (!outer) return []; return visibleTabs.flatMap(item => { const node = paneRefs.current.get(item.id); if (!node) return []; const r = node.getBoundingClientRect(), label = node.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0; return [{ tabId: item.id, x: r.left - outer.left, y: r.top - outer.top + label, width: r.width, height: Math.max(0, r.height - label) }]; }); };
    // The panes changed (before paint): plan each page's flight from the settled boxes of the last layout and start it. An interrupted
    // morph continues from where its boxes are now.
    useLayoutEffect(() => {
        const before = lastPane.current, changed = before.key !== paneKey; lastPane.current = { key: paneKey, ids: paneIds, layout: splitPair?.layout };
        if (!changed) return;
        const wanted = morphWanted(before.ids, before.layout !== splitPair?.layout), next = wanted ? measurePaneBoxes() : [];
        if (!wanted || !next.length) { if (wanted) bumpMorph(n => n + 1); return; }
        const start = morphRun && !morphRun.done ? paneBoxes.current.map(box => ({ ...box, ...(liveBoxes.current.get(box.tabId) ?? {}) })) : paneBoxes.current, point = takeDropPoint(), outer = pageRef.current?.getBoundingClientRect(), arriving = paneIds.find(id => !before.ids.includes(id));
        // Unsplit and Close pane: a page that leaves flies back into its own tab (strip, compact strip or sidebar row) instead of greying out in place.
        const homes: Record<string, MorphRect> = {};
        if (outer) for (const id of before.ids) if (!paneIds.includes(id)) { const r = document.querySelector<HTMLElement>(`:is(.browser-tab,.acira-compact-tab,.sb-tab)[data-tab-id="${CSS.escape(id)}"]`)?.getBoundingClientRect(); if (r?.width && r.height) homes[id] = homeRect({ x: r.left - outer.left, y: r.top - outer.top, width: r.width, height: r.height }, outer); }
        const items = planMorph(start, next, point && outer && arriving ? { tabId: arriving, rect: dropOrigin({ x: point.x - outer.left, y: point.y - outer.top }, CARRIED_SIZE, CARRIED_SIZE) } : undefined, homes);
        const stills: Record<string, string> = {}; for (const id of [...before.ids, ...paneIds]) { const url = splitStills[id] ?? stillCache.current.get(id); if (url) stills[id] = url; }
        liveBoxes.current.clear(); setMorphRun({ key: ++morphCount.current, items, intent: morphIntent(before.ids, paneIds), scale: motionScale(), stills });
    }, [paneKey]);
    // The last settled boxes (the next morph's start) and, in a split, fresh stills of its pages a moment after it settles.
    useEffect(() => {
        if (morphRun && !morphRun.done) return;
        const frame = requestAnimationFrame(() => { paneBoxes.current = measurePaneBoxes(); });
        const timer = native && splitPair ? setTimeout(() => { for (const item of visibleTabs) if (item.contentKind === 'web' && !item.error) void (runtime.browserCommand({ type: 'snapshot', tabId: item.id }) as Promise<unknown>).then(still => { if (typeof still === 'string') stillCache.current.set(item.id, still); }, () => {}); }, 700) : undefined;
        return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
    }, [paneKey, morphRun?.key, morphRun?.done, size.width, size.height, sidebarSpace, workspaceOpen, headerHeight, effectiveMode]);
    useLayoutEffect(() => {
        const geometry = browserGeometry({ width: size.width, height: size.height, headerHeight, style, focus: effectiveMode === 'focus', sidebarWidth: sidebarSpace, split: !!split, splitRatio: splitPair?.layout === 'columns' ? splitPair.cols[0] : .5, splitGap: SPLIT_GAP, cardInset: style === 'acira' && sidebarOnFrame(state, edge, false) ? 6 : 0 });
        // Persisted pair order stays stable when focus moves between the panes.
        const views = splitPreview ? [] : visibleTabs.flatMap((item, index) => item.contentKind === 'web' && !item.error && reader?.tabId!==item.id ? [{ tabId: item.id, bounds: geometry.views[index] ?? geometry.views[0] }] : []);
        const pageBox = geometry.page;
        let popup: BrowserLayout['overlay'];
        // The id is cleared (tab change, dismissal) before the kind leaves state: that commit must not publish a popup nobody can close.
        if (native && overlay && overlayId.current !== undefined) {
            const followsTrigger = popupFollowsTrigger(overlay, overlay === 'group-context' && !!stripGroupChip(groupIdOf(state, contextId)));
            let anchor = overlay === 'suggestions' ? (addressAnchor || popupAnchor('suggestions', state, undefined, effectiveMode)) : followsTrigger ? popupAnchor(overlay, state, contextId, effectiveMode) : popupAnchorRef.current?.kind === overlay && popupAnchorRef.current.style === style ? popupAnchorRef.current.bounds : popupAnchor(overlay, state, contextId);
            const placePopup = (source: typeof anchor, align?: 'start' | 'end') => popupGeometry(overlay, state, size, source, overlay === 'suggestions' ? addressSuggestionsHeight(suggestions.length) : overlay === 'page-context' ? 12 + pageMenu.current.reduce((sum, item) => sum + (item.type === 'separator' ? 9 : 30), 0) : openPopupHeight.current?.id !== undefined && openPopupHeight.current.id === overlayId.current ? openPopupHeight.current.height : popupEstimateMeasured(overlay, state) ? undefined : popupHeightRef.current[`${style}:${overlay}`], { lockedTop: popupLockedTop.current, minTop: headerHeight + 8, target: state.tabs.find(tab => tab.id === contextId), parent: popupParent.current, page: pageBox, align });
            let geometry = placePopup(anchor);
            // R6: a new group's menu sits beside its sidebar header, where the header settles now, sized by what the menu holds.
            const beside = overlay === 'group-context' && !followsTrigger && popupAnchorRef.current?.kind === overlay ? popupAnchorRef.current.beside : undefined;
            if (beside) {
                const header = sidebarGroupHeader(groupIdOf(state, contextId)), placed = groupEditorPlacement(header ? groupAnchorBox(header) : beside, 'sidebar', size, geometry.contentHeight, geometry.bounds.width);
                anchor = placed.anchor;
                geometry = placePopup(anchor, placed.align);
            }
            if (overlay === 'tabs' && popupLockedTop.current === undefined)
                popupLockedTop.current = geometry.bounds.y;
            popup = { id: overlayId.current!, kind: overlay, tabId: overlay === 'page-context' ? contextId || tab.id : tab.id, context: popupMotion(geometry, anchor, overlay === 'suggestions' ? { query: address.slice(0, 4096), index: activeSuggestionIndex } : overlay === 'page-context' ? { items: pageMenu.current } : overlay === 'bookmark-context' || overlay === 'bookmark-edit' ? (contextId.startsWith('node:') ? { node: contextId.slice(5) } : { url: contextId }) : overlay === 'toolbar-overflow' ? { node: contextId || 'none' } : { tabId: contextId, lockedTop: popupLockedTop.current, ...((overlay === 'tor' || overlay === 'security' || overlay === 'menu') && popupIntent.current ? { intent: popupIntent.current } : {}), ...(popupParent.current ? { parent: popupParent.current } : {}), ...(popupLevel.current ? { level: popupLevel.current } : {}) }), ...geometry };
        }
        if (native && !popup && (toasts.length || toastState.status || toastState.boundsStatus || toastState.boundsToasts.length) && toastOverChrome && !setupVisible && toastOverlayId.current) {
            // The host keeps the room of every toast that is still leaving until its exit has played (R3-41/R3-66): the overlay
            // never shrinks around a card that is on its way out.
            const slot = toastSlotSize(toastState.boundsToasts.map(toastModel), toastState.boundsStatus, toastState.boundsExpanded), width = slot.width, height = slot.height, page = geometry.page;
            const bounds = { x: Math.round(page.x + (page.width - width) / 2), y: Math.round(page.y + page.height - 20 - height), width, height };
            // Anchored to a point just below the card, so the native host treats it as rising from the content's bottom edge.
            popup = { id: toastOverlayId.current, kind: 'toast', tabId: tab.id, bounds, context: { toasts: toasts.map(({ id, text, action, tone }) => ({ id, text, action, ...(tone ? { tone } : {}) })), expanded: toastState.expanded, ...(toastState.status ? { status: toastState.status } : {}) }, anchor: { x: bounds.x + Math.round(width / 2), y: bounds.y + height + TOAST_SHADOW_ROOM, width: 1, height: 1 }, origin: { x: .5, y: 1 }, contentHeight: height };
        }
        if (native && !popup && rating && rating.feature !== ratingHidden && toastOverChrome && !setupVisible && ratingOverlayId.current) {
            // The host keeps the asking card's room through the thanks and the exit (the card sits at its bottom), so it never resizes.
            const card = ratingCardSize(rating.feature), page = geometry.page;
            const bounds = { x: Math.round(page.x + page.width - RATING_EDGE - card.width), y: Math.round(page.y + page.height - RATING_EDGE - card.height), width: card.width, height: card.height };
            popup = { id: ratingOverlayId.current, kind: 'toast', tabId: tab.id, bounds, context: { rating: { feature: rating.feature, phase: rating.phase, leaving: rating.leaving } }, anchor: { x: bounds.x + Math.round(card.width / 2), y: bounds.y + card.height + RATING_SHADOW_ROOM, width: 1, height: 1 }, origin: { x: 1, y: 1 }, contentHeight: card.height };
        }
        const colors = themeTokens(windowSettings(state, withFrameTint(state)), dark), finish = studyFinish(windowSettings(state, withFrameTint(state)), dark);
        // With the sidebar open the caption buttons sit on the sidebar's frame, so they take its colour (G, Round 2).
        const sidebarFrame = style === 'acira' && sidebarOnFrame(state, edge, false) && /^\d+ \d+ \d+$/.test(finish['--sidebar-rgb'] || '');
        // A toolbar colour of its own (A's frame.css) puts the band, and so the caption, in that colour instead.
        const toolbarOwn = !!state.settings.toolbarColor && !windowFinish(state) && /^\d+ \d+ \d+$/.test((colors as Record<string, string>)['--toolbar-rgb'] || '');
        const layout: BrowserLayout = { views, pageBounds: geometry.page, pageRadius: pageCardRadius(), visible: !setupVisible, ...(dragging ? { pageDragging: true } : {}), viewport: size, overlay: setupVisible || overlay === 'workspace-cover' ? undefined : popup, style, appearance: colors['--surface-tone'] as 'dark' | 'light', reducedTransparency: s.reducedTransparency, reducedMotion: s.reducedMotion, motionSpeed: motionScaleOf(s) > 0 ? 1 / motionScaleOf(s) : 1, ...windowCaptionColors(finish, colors as Record<string, string>, { standardTop: effectiveMode === 'standard' && !sideTabs, sidebarFrame, toolbarOwn }), materialTint: (colors as Record<string, string>)['--native-material-tint'] || (colors as Record<string, string>)['--overlay'], ...(typeof s.glassOpacity==='number'?{materialOpacity:s.glassOpacity/100}:{}), captionHeight: effectiveMode !== 'standard' ? compactRowHeight : sideTabs ? designTokens.geometry.toolbar : standardToolbarTop, ...(topBarHidden ? { captionHidden: true, captionFloat: true } : {}), edge: { topHeight: fullHeaderHeight, sideWidth: s.sidebarWidth || 240 } };
        liveLayout.current = layout;
        // A theme or finish switch changes colours, not geometry: its measured send waits for the next frame, where the read
        // shares the frame's one style and layout pass instead of forcing both inside the switch's commit (F04, A).
        const look = [dark, s.browserTint, s.accentColor, s.colorPreset, s.glassOpacity, s.surfaceColor, s.sidebarColor, s.tabColor, s.reducedTransparency].join('|'), shape = JSON.stringify([layout.views, layout.pageBounds, layout.viewport, layout.visible, layout.style, layout.overlay?.id]);
        const lookOnly = sentShape.current.shape === shape && sentShape.current.look !== look; sentShape.current = { shape, look };
        // followPage prepares the old content box after this React commit. Sending a split's final bounds now starts a second
        // native spring before its live measurements arrive, briefly reversing the page's resize. Measure the prepared box instead.
        const preparingPageFollow = document.documentElement.dataset.modeSwitch === 'layout' && document.documentElement.dataset.pageLive === undefined && !!pageRef.current?.querySelector(':scope>.page-content:not([data-native])');
        if (lookOnly || preparingPageFollow) { requestAnimationFrame(() => { if (liveLayout.current) { const physical = physicalLayout(liveLayout.current); sendWhenLayoutSwitchReady(() => { if (samePageRef(unsentSlide.current?.page, physical.pageBounds)) unsentSlide.current = null; runtime.setBrowserLayout(physical); }, slidesOnSidebarCurve(physical)); } }); return; }
        // Leaving Seamless (its card rests at the window's edge, y=6): the header is a motion element whose height animation starts after this commit, so it is still at Seamless's
        // height here and the DOM's page rect is an intermediate one, 5px above the card. Sent now it moved the page up and over the toolbar row for a frame (with reduced motion
        // the page flickered); the measured follow (ResizeObserver) sends the real layouts from the next frame, carrying this layout's other fields.
        const headerNode = document.querySelector<HTMLElement>('.browser-root .browser-shell');
        if (!seamless && lastPageBounds.current && lastPageBounds.current.y <= 8 && headerNode && Math.abs(headerNode.getBoundingClientRect().height - headerHeight) > 1) return;
        const physical = physicalLayout(layout);
        sendWhenLayoutSwitchReady(() => { if (samePageRef(unsentSlide.current?.page, physical.pageBounds)) unsentSlide.current = null; runtime.setBrowserLayout(physical); }, slidesOnSidebarCurve(physical));
    }, [profileFrameTint,currentWindowFinish,windowFullscreen,reader?.tabId,setupVisible,tab.id, tab.url, tab.error, tab.contentKind, split?.id, split?.error, native, overlay, contextId, address, addressAnchor, activeSuggestionIndex, suggestions.length, sidebarSpace, workspaceOpen, edge.side, edge.pinned.side, dragging, effectiveMode, headerHeight, fullHeaderHeight, seamless, size.width, size.height, style, dark, s.reducedMotion, s.animationSpeed, s.reducedTransparency, s.browserTint, s.accentColor, s.colorPreset, s.glassOpacity, s.surfaceColor, s.sidebarColor, s.tabColor,s.toolbarColor, state.tabs.length, state.tabGroups.length, state.bookmarks.length, splitPair ? `${splitPair.layout}:${splitPair.tabIds.join(',')}:${splitPair.cols.join(',')}:${splitPair.rows.join(',')}` : '', splitPreview, immediateLayout, presentationChanged, toasts.map(row => row.id).join(','), toastOverChrome, toastState.status?.key, toastState.boundsStatus, toastState.boundsToasts.map(row => row.key).join(','), toastState.expanded, toastState.boundsExpanded, rating?.feature, rating?.phase, rating?.leaving, ratingHidden, menuAnchorMoved]);
    const tabs = <TabStrip state={{ ...state, settings: { ...s, verticalTabs: false } }} dispatch={dispatch} onContext={(id, anchor, isGroup) => open(isGroup === 'split' ? 'split-context' : isGroup ? 'group-context' : 'tab-context', id, anchor)} onBlankContext={anchor => open('strip-context', undefined, anchor)} onPreview={previewGroup}/>;
    const navGlyph = (name: 'back' | 'forward' | 'reload' | 'home' | 'tune' | 'star' | 'starFilled' | 'menu' | 'close') => <ToolbarIcon name={name}/>;
    // Bible §5.2: the one sidebar toggle lives at the toolbar's top-left in every mode, open or closed.
    const sidebarToggle = sidebarControl(state).visible && <IconButton label={workspaceOpen || edge.side ? tr("app.collapseSidebar") : tr("app.expandSidebar")} className="sidebar-toggle-control" onClick={event => {
      // (Seamless shows no button: its sidebar is the left edge's, and Ctrl+Shift+E pins or lets go of it, see sidebarControl.)
      // A mouse click leaves no focus on the button (upstream 1169300d): the next key anyone pressed (a screenshot's, Shift) lit its ring. The keyboard keeps its place.
      const byKeyboard = event.detail === 0; if (!byKeyboard) event.currentTarget.blur();
      // With the hover sidebar out, the button closes the visible sidebar.
      if (!workspaceOpen && currentEdge().side) { dismissEdge('side'); return; }
      if (byKeyboard) focusSidebarControl(!workspaceOpen); setWorkspaceOpen(!workspaceOpen); }}><ToolbarIcon name="sidebar"/></IconButton>;
    const layoutToggle = <IconButton label={focusMode ? tr("app.exitFocusMode") : tr("app.enterFocusMode")} active={focusMode} className="compact-view-toggle" toolbarItem="focus" onClick={() => compactToggleRef.current()}><ToolbarIcon name={focusMode ? 'unfocus' : 'focus'}/></IconButton>;
    const openFrom = (kind: string, node: HTMLElement, id?: string) => { const r = node.getBoundingClientRect(); open(kind, id, { x: r.x, y: r.y, width: r.width, height: r.height }); popupTriggers.set(kind, node); };
    const profileInitial = state.browserProfiles.find(p => p.id === tab.browserProfileId)?.name[0] || 'T', toolbarProfile = state.browserProfiles.find(p => p.id === tab.browserProfileId);
    const profileAvatar = toolbarProfile ? <ProfileAvatar name={toolbarProfile.name} color={toolbarProfile.color || '#6b7280'} avatar={toolbarProfile.avatar} picture={toolbarProfile.picture} size={20}/> : <span>{profileInitial}</span>;
    const popupIcons = { downloads: 'downloads', bookmarks: 'bookmarks', split: 'split', appearance: 'appearance' } as const;
    // Optional actions follow the profile's toolbar order; the Acira menu is fixed as the route to Settings.
    const toolbarAction = (id: ToolbarItemId) => id === 'focus' ? <ReactFragment key={id}>{layoutToggle}</ReactFragment>
        : id === 'profile' ? <button key={id} type="button" className="profile-button toolbar-optional-profile" data-toolbar-item={id} data-popup-trigger aria-label={tr("app.switchProfile")} title={controlTitle('Switch profile')} aria-haspopup="dialog" aria-expanded={overlay === 'profile'} onClick={e => openFrom('profile', e.currentTarget)}>{profileAvatar}</button>
        : id === 'extensions' ? <button key={id} type="button" className="icon-button toolbar-optional-extension" data-toolbar-item={id} data-popup-trigger aria-label={tr("browsermenu.extensions")} title={controlTitle('Extensions')} onClick={e => openFrom('extensions', e.currentTarget)}><ExtensionsIcon size={18}/></button>
        : id === 'aifree' ? <AiFreeButton key={id} controlTitle={controlTitle}/>
        : id === 'protection' ? <button key={id} type="button" className="icon-button" data-toolbar-item={id} data-popup-trigger data-protection-trigger aria-label={toolbarItemLabels.protection} title={controlTitle(tr('protection.title'))} onClick={e => openFrom('protection', e.currentTarget)}><ProtectionIcon/></button>
        : id === 'vpn' ? <button key={id} type="button" className="icon-button" data-toolbar-item={id} data-popup-trigger aria-label={tr('vpn.control.title')} title={controlTitle(tr('vpn.control.title'))} onClick={e => openFrom('vpn', e.currentTarget)}><LockKeyhole size={16}/></button>
        : id === 'routines' ? <IconButton key={id} toolbarItem={id} label={tr("app.tabSets")} onClick={() => openWorkspacePage('routines', state, dispatch)}><Workflow size={16}/></IconButton>
        : id === 'history' ? <IconButton key={id} toolbarItem={id} label={tr("browsermenu.history")} onClick={() => openWorkspacePage('history', state, dispatch)}><ToolbarIcon name="history"/></IconButton>
        : <button key={id} type="button" className="icon-button" data-toolbar-item={id} data-popup-trigger aria-label={toolbarItemLabels[id]} title={controlTitle(toolbarItemLabels[id])} onClick={e => openFrom(id, e.currentTarget)}>{id === 'downloads' ? <DownloadsGlyph downloads={profileDownloads(state, tab.browserProfileId)} reducedMotion={state.settings.reducedMotion} size={18} idle={<ToolbarIcon name="downloads"/>}/> : <ToolbarIcon name={popupIcons[id]}/>}</button>;
    // The buttons in the order Customize toolbar keeps, drawn and tabbed through in that order (no CSS reordering). The pinned
    // extension buttons sit at the left of the optional buttons, after the profile button when it leads (as by default).
    const shownItems = (addrBlock ? toolbarItems.map(item => item.id === 'downloads' ? { ...item, visible: true } : item) : toolbarItems).filter(item => item.visible), lead = shownItems[0]?.id === 'profile' ? 1 : 0;
    const optionalActions = <>{shownItems.slice(0, lead).map(item => toolbarAction(item.id))}<BrowserExtensionActions target={extensionTarget}/>{shownItems.slice(lead).map(item => toolbarAction(item.id))}</>;
    /** P09 (M): narrow compact and Focus rows hide Extensions and Switch profile; this » gathers what its row hides into one
     * menu (Chrome's overflow), so nothing is out of reach in the smallest window. CSS shows it only while it has something
     * to gather; the menu lists exactly the hidden buttons. */
    const overflowButton = <ReactFragment>{toolbarItems.some(item => item.id === 'profile' && item.visible) && <button type="button" className="profile-button toolbar-overflow-profile" data-popup-trigger aria-label={tr("app.switchProfile")} title={controlTitle('Switch profile')} aria-haspopup="dialog" aria-expanded={overlay === 'profile'} onClick={e => openFrom('profile', e.currentTarget)}>{profileAvatar}</button>}<button type="button" className="icon-button toolbar-overflow" data-popup-trigger aria-haspopup="menu" aria-expanded={overlay === 'toolbar-overflow'} aria-label={tr("app.moreToolbarButtons")} title={controlTitle('More toolbar buttons')} onClick={e => { if (overlay === 'toolbar-overflow') { setOverlay(null); return; } /* R3-19: toggles */ const r = e.currentTarget.getBoundingClientRect(); open('toolbar-overflow', e.currentTarget.parentElement?.dataset.overflow || 'none', { x: r.x, y: r.y, width: r.width, height: r.height }); }}><OverflowGlyph/></button></ReactFragment>;
    const actions = <div className="toolbar-actions">{parts.exitFocus ? layoutToggle : optionalActions}{state.browserProfiles.some(profile => profile.private && !profile.tor && profile.id === tab.browserProfileId) && <span className="toolbar-private-chip" title={tr("app.privateWindowHistoryCookiesAnd")}><PrivateWindow size={14} aria-hidden="true"/><span>{tr("app.private")}</span></span>}{parts.overflow&&overflowButton}<UpdatePill onOpen={() => open('update')} onOpenNotes={() => open('whats-new')} active={overlay === 'update'} canAsk={overlay === null && !setupVisible && !(addressFocused && address !== (tab.url === 'acira://new' ? '' : tab.url))} reducedMotion={s.reducedMotion}/><IconButton className="toolbar-menu-control" popup active={overlay === 'menu'} expanded={overlay === 'menu'} label={tr("app.aciraMenu")} onClick={() => open('menu')}>{navGlyph('menu')}</IconButton></div>;
    const tabOverview = s.showTabOverview!==false && <button data-popup-trigger aria-expanded={overlay === 'tabs'} aria-haspopup="dialog" className="toolbar-tab-overview" onClick={()=>open('tabs')} aria-label={tr("browsermenu.allOpenTabs")} title={[`All open tabs (${state.tabs.length})`, shortcutFor('tab-viewer', 'Alt T')].filter(Boolean).join(' · ')}><ToolbarIcon name="tabs"/><span className="toolbar-tab-count" aria-hidden="true">{state.tabs.length}</span></button>;
    const miniTabs = <CompactTabs iconOf={storedIcon} splitIds={state.windowUi.split?.tabIds} splitGroups={state.windowUi.splitGroups} activeSplitId={state.windowUi.split?.groupId} groups={state.tabGroups} onGroupAction={dispatch} tabs={state.tabs} activeTabId={tab.id} titles={s.compactTabTitles} reducedMotion={s.reducedMotion} speed={frequentSpeed(s)} renderIcon={t => tabShowsLoading(t)?<span className="tab-agent-icon"><DotMatrix preset="loader" size={14} reducedMotion={s.reducedMotion}/></span>:<SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon || storedIcon(t.url)} size={16}/>} onSelect={id => selectStripTab(state, dispatch, id, state.windowUi.splitGroups?.find(split => split.tabIds.includes(id)))} onClose={id => dispatch({ type: 'tab.close', id })} onNewTab={() => dispatch({ type: 'tab.new' })} onMute={(id, muted) => dispatch({ type: 'tab.mute', id, muted })} onContext={(id, anchor, isGroup) => open(isGroup === 'split' ? 'split-context' : isGroup ? 'group-context' : 'tab-context', id, anchor)} onNewTabContext={anchor => open('strip-context', undefined, anchor)} onPreview={previewGroup}/>;
    const bookmark = bookmarkControl(state, tab);
    const bookmarkLabel = bookmark.reason === 'private' ? tr('bookmarkcontrol.private') : bookmark.reason === 'internal' ? tr('bookmarkcontrol.internal') : bookmark.saved ? tr('bookmarkcontrol.edit') : tr('app.bookmarkThisPage');
    // The address text rests in the middle of the bar and glides to the left while it is in use (ui/addressGlide.ts); no glide at speed Off.
    const addressGlide = useMemo(() => glideMotion(motionScaleOf(s)), [s.animationSpeed, s.reducedMotion]);
    const addressBar = <form className={`address-bar`} data-tor={isTorWindow(state) || undefined} onSubmit={e => { e.preventDefault(); if (!address.trim())
        return; navigate(address); addressRef.current?.blur(); }}><button type="button" aria-label={tr("app.pageInformation")} title={controlTitle("Page information")} data-popup-trigger className="address-security" onClick={() => open('security')}>{isTorWindow(state) ? <TorSecurityGlyph loading={tab.loading} loader={<DotMatrix preset="pulse" size={16} label={tr("app.loadingPage")} reducedMotion={s.reducedMotion}/>} fallback={navGlyph('tune')}/> : tab.loading ? <DotMatrix preset="pulse" size={16} label={tr("app.loadingPage")} reducedMotion={s.reducedMotion}/> : navGlyph('tune')}</button>{tab.contentKind==='web'&&<CertificateIndicator tabId={tab.id} url={tab.url} onOpen={()=>open('security')}/>}{tab.capturing?.length ? <button type="button" className="address-capture" data-kinds={tab.capturing.join(' ')} aria-label={tr("app.stopSharingYourAnd", { and: tab.capturing.join(' and ') })} title={tr("app.usingYourAndClickTo", { and: tab.capturing.join(' and ') })} onClick={() => void runtime.browserCommand({ type: 'stop-capture', tabId: tab.id })}><span className="address-capture-dot" aria-hidden="true"/>{tab.capturing.map(kind => { const Glyph = kind === 'camera' ? Video : kind === 'microphone' ? Mic : Monitor; return <Glyph key={kind} size={14} aria-hidden="true"/>; })}<span className="address-capture-label">{tr("app.stop")}</span></button> : null}{isTorWindow(state) && <TorChip reducedMotion={s.reducedMotion} onOpen={() => open('tor')}/>}<AddressField glide={addressGlide} inputRef={addressRef} value={address} onChange={value => { addressEditTime.current={tabId:tab.id,at:Date.now()}; setAddressEditTab(tab.id); setAddress(value); setSuggestionIndex(value.trim() ? 0 : -1); if (s.addressSuggestions && value.trim() && overlay !== 'suggestions')
        open('suggestions');
    else if (!value.trim() && overlay === 'suggestions')
        setOverlay(null); }} popupTrigger={s.addressSuggestions && Boolean(address.trim())} suggestionOpen={overlay === 'suggestions'} suggestionListId={native ? 'native-address-suggestions' : 'address-suggestions'} activeSuggestionId={activeSuggestionIndex >= 0 ? `${native ? 'native-address-suggestions' : 'address-suggestions'}-${activeSuggestionIndex}` : undefined} onSuggestionKeyDown={suggestionKey} searchEngine={s.searchEngine} onModifiedEnter={(value, newTab) => { if (newTab) {
        const target = resolveNavigation(value, ...searchFor(s, tab.privacy), state.websiteLanguage);
        if (!target.error)
            dispatch({ type: 'tab.new', url: target.url, ...(tab.privacy === 'tor' || tab.privacy === 'private' ? { privacy: tab.privacy } : {}) });
    }
    else
        navigate(value); }} onFocus={() => { setAddressFocused(true); showSuggestions(); }} onBlur={event => { setAddressFocused(false); setAddressEditTab(null); const next = event.relatedTarget; if (openRef.current === 'suggestions' && !(next instanceof Element && next.closest('[data-popup-trigger]')))
        setOverlay(null); }} style={style} reducedMotion={s.reducedMotion} speed={1}/>{native && overlay === 'suggestions' && <ul className="address-suggestions-a11y" id="native-address-suggestions" role="listbox" aria-label={tr("app.addressSuggestions")}>{suggestions.map((item, index) => <li key={item.id} id={`native-address-suggestions-${index}`} role="option" aria-selected={index === activeSuggestionIndex}>{item.title}. {item.detail}</li>)}</ul>}{isTorSite(state, tab) && <TorOnionChip tab={tab} dispatch={dispatch}/>}{bookmark.reason !== 'private' && <button type="button" data-popup-trigger aria-label={bookmarkLabel} title={controlTitle(bookmarkLabel)} aria-disabled={!bookmark.available} aria-pressed={bookmark.saved} onPointerDown={event => event.preventDefault()} className={`address-star ${bookmark.saved ? 'bookmarked' : ''}`} onClick={() => { if (!bookmark.available) return; /* R3-19: the star toggles its editor like every other trigger */ if (overlay === 'bookmark-edit') { setOverlay(null); return; } if (!bookmark.saved) dispatch({ type: 'bookmark.toggle', url: tab.url }); open('bookmark-edit', tab.url); }}>{navGlyph(bookmark.saved ? 'starFilled' : 'star')}</button>}{(tab.zoom!==100||overlay==='zoom')&&<button type="button" className="address-zoom-indicator" data-popup-trigger title={tr("app.pageZoom")} aria-label={tr("app.pageZoomZoomOpenControls", { zoom: tab.zoom })} onClick={()=>overlay==='zoom'?setOverlay(null):open('zoom',tab.id)}>{tab.zoom}%</button>}{effectiveMode==='standard'&&<NavigationProgress key={tab.id} tab={tab} placement="address" reduced={s.reducedMotion} hidden={addressFocused}/>}</form>;
    const navigationControls = <div className="navigation-controls"><IconButton label={tr("app.back")} disabled={tab.contentKind === 'web' ? !tab.canGoBack && !tab.history.slice(0, tab.historyIndex).some(url => url.startsWith('acira://')) : tab.historyIndex === 0 && !backReturnsToOpener(state, tab)} onClick={() => navigation('back')}>{navGlyph('back')}</IconButton><IconButton label={tr("app.forward")} disabled={tab.contentKind === 'web' ? !tab.canGoForward && tab.historyIndex === tab.history.length - 1 : tab.historyIndex === tab.history.length - 1} onClick={() => navigation('forward')}>{navGlyph('forward')}</IconButton>{<IconButton label={tab.loading ? tr("app.stopLoading") : tr("app.reloadPage")} onClick={() => navigation(tab.loading ? 'stop' : 'reload')}>{tab.loading ? navGlyph('close') : navGlyph('reload')}</IconButton>}{s.showHome && <IconButton label={tr("app.home")} toolbarItem="home" onClick={() => navigate('acira://new')}>{navGlyph('home')}</IconButton>}</div>;
    const bookmarks=(bookmarkVisible||bookmarkHold)&&<BookmarksBar state={state} dispatch={dispatch} onNavigate={navigate} overflowOpen={overlay==='bookmarks'} onOverflow={()=>open('bookmarks')} onContext={(url,anchor)=>open('bookmark-context',url,anchor)} onToolbarContext={anchor=>open('toolbar-context',undefined,anchor)}/>;
    const renderPage = (t: TabSession) => { if(reader?.tabId===t.id&&reader.url===t.url&&reader.profileId===t.browserProfileId)return <ReaderPane reader={reader} onClose={closeReader} onOpen={(url,background)=>dispatch({type:'tab.new',url,background,browserProfileId:reader.profileId})}/>; if (t.contentKind === 'web')
        return <div className="web-placeholder"><ProfileCleanupRecovery profileId={t.browserProfileId} privateMode={state.browserProfiles.some(profile=>profile.private)} onSettings={()=>dispatch({type:'tab.new',url:'acira://settings'})}/>{t.error && t.onionAuth ? <TorOnionAuth key={t.url + t.onionAuth} tab={t}/> : t.error ? <NavigationError key={t.url+ t.error} tab={t} reducedMotion={s.reducedMotion} onNavigate={url=>navigate(url,t.id)} onEditAddress={()=>{if(state.activeTabId!==t.id)dispatch({type:'tab.select',id:t.id});addressRef.current?.focus();addressRef.current?.select();}} onReport={state.siteReports&&reportable(t,isTorWindow(state))?()=>{if(state.activeTabId!==t.id)dispatch({type:'tab.select',id:t.id});open('security','report');}:undefined}/> : !window.acira ? <div className="page-error"><Globe2 size={32}/><h2>{tr("app.openThisWebsiteInAcira")}</h2><p>{tr("app.theDevelopmentPreviewShowsThe")}</p></div> : null}</div>; const effectiveUrl = t.url; if (effectiveUrl === 'acira://home' || effectiveUrl === 'acira://new')
        return <GlassWorkspace state={{ ...state, activeTabId: t.id }} dispatch={dispatch} onNavigate={u => navigate(u, t.id)}/>; const page = effectiveUrl.slice(8) as InternalPage; if(page==='locked') return <LockedWorkspace state={{...state,activeTabId:t.id}} dispatch={dispatch}/>; if(page==='rewind') return <RewindPage state={{...state,activeTabId:t.id}} dispatch={dispatch}/>; if(page==='routines') return <RoutinesPage state={{...state,activeTabId:t.id}} dispatch={dispatch}/>; if(page==='downloads') return <Downloads state={{...state,activeTabId:t.id}}/>; if (page === 'bookmarks') return <GlassWorkspace state={{ ...state, activeTabId: t.id }} dispatch={dispatch} onNavigate={u => navigate(u, t.id)} view="bookmarks"/>; if (page === 'history')
        return <BrowserHistory state={{ ...state, activeTabId: t.id }} dispatch={dispatch} onNavigate={u => navigate(u, t.id)}/>; return <BrowserSettings key={t.id} state={{...state,activeTabId:t.id}} dispatch={dispatch} onNavigate={u=>navigate(u,t.id)}/>; };
    const localPopup = overlay ? popupGeometry(overlay, state, size, overlay === 'suggestions' ? (addressAnchor || popupAnchor('suggestions', state, undefined, effectiveMode)) : popupAnchorRef.current?.kind === overlay && popupAnchorRef.current.style === style ? popupAnchorRef.current.bounds : popupAnchor(overlay, state, contextId), overlay === 'suggestions' ? addressSuggestionsHeight(suggestions.length) : overlay === 'page-context' ? 12 + pageMenu.current.reduce((sum, item) => sum + (item.type === 'separator' ? 9 : 30), 0) : popupMeasure?.kind === overlay && popupMeasure.style === style ? popupMeasure.height : popupHeightRef.current[`${style}:${overlay}`]) : null;
    return <div inert={setupVisible||undefined} aria-hidden={setupVisible||undefined} ref={addrRoot} className={`browser-root mode-${effectiveMode}${sideTabs ? ' side-tabs' : ''}${addrBlock ? ' addr-side' : ''}`} data-resizing={dragTarget || undefined}>
 <div className="sidebar-page-corners" aria-hidden="true"/>
 <div className="sidebar-page-corners sidebar-page-corners-low" aria-hidden="true"/>
 <div className="sidebar-page-rim sidebar-page-rim-top" aria-hidden="true"><svg><path/><path className="rim-edge"/></svg></div>
 <div className="sidebar-page-rim sidebar-page-rim-low" aria-hidden="true"><svg><path/><path className="rim-edge"/></svg></div>
 <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{toolbarAnnouncement}</div>
 <motion.header onContextMenu={e => { if (!(e.target as HTMLElement).closest('input,textarea,button,[role=tab]')) {
        e.preventDefault();
        open('toolbar-context', undefined, { x: e.clientX, y: e.clientY, width: 2, height: 2 });
    } }} className={`browser-shell ${style}-shell`} data-layout={addrBlock ? 'standard' : effectiveMode} data-seamless={seamless ? (topBarHidden ? 'hidden' : 'shown') : undefined} data-sbmode={sbHeader} data-privacy={seamless ? seamlessLine : undefined} onFocus={event => { if (seamless && event.target instanceof Element && event.target.matches(':focus-visible')) setShellFocus(true); }} onBlur={event => { if (seamless && !(event.relatedTarget instanceof Element && event.currentTarget.contains(event.relatedTarget))) { setShellFocus(false); setKeyTop(false); } }} style={{ '--tab-strip-top-inset': `${tabStripTopInset}px`, '--sm-final-hdr': `${headerHeight}px` } as CSSProperties} initial={false} animate={{ height: headerHeight }} transition={seamless ? { duration: 0 } : browserTransition(s.reducedMotion)}>
 {<>
   {!railPrefs.tabs&&<motion.div className="titlebar acira-tab-row" inert={effectiveMode !== 'standard' || sideTabs} aria-hidden={effectiveMode !== 'standard' || sideTabs} initial={false} animate={{ y: effectiveMode === 'standard' ? tabStripTopInset : 0, opacity: effectiveMode === 'standard' ? 1 : 0 }} transition={{ ...browserTransition(s.reducedMotion), opacity: { duration: s.reducedMotion ? 0 : .1, delay: effectiveMode === 'standard' && !s.reducedMotion ? .09 : 0 } }}>
     {sidebarToggle}<div className="tab-strip-tools" hidden={s.showTabOverview===false}><IconButton popup label={tr("app.allOpenTabsAltT")} onClick={() => open('tabs')}><ToolbarIcon name="tabs"/></IconButton></div><WorkspaceChip state={state}/>{tabs}<div className="titlebar-drag"/><div className="caption-reservation"/>
   </motion.div>}
   <motion.div ref={toolbarRef} className="browser-toolbar acira-persistent-toolbar" style={{ '--sm-final-y': `${effectiveMode === 'standard' ? toolbarTop : 0}px` } as CSSProperties} initial={false} animate={{ y: effectiveMode === 'standard' ? toolbarTop : 0, opacity: 1 }} transition={browserTransition(s.reducedMotion)}>
     <div className="acira-leading-controls">
       <div ref={navigationRef} className="expanded-navigation" hidden={effectiveMode !== 'standard' && !addrBlock}>{railPrefs.tabs&&sidebarToggle}{navigationControls}{railPrefs.tabs&&tabOverview}</div>
       <div className="compact-navigation" hidden={effectiveMode === 'standard' || addrBlock}><div className="compact-workspace-toggle">{sidebarToggle}</div>{navigationControls}{parts.tabOverview && tabOverview}{/* One compact strip at a time, only where it shows (D: hidden strips re-rendered every row on each click). Focus keeps it too: tabs stay one click away. */}{parts.miniTabs&&miniTabs}</div>
     </div>
     {addressBar}{addrBlock ? <AddressMore label={tr("app.moreToolbarButtons")} held={overlay !== null && overlay !== 'suggestions'} scale={motionScaleOf(s)}>{s.showHome && <IconButton label={tr("app.home")} onClick={() => navigate('acira://new')}>{navGlyph('home')}</IconButton>}{actions}</AddressMore> : actions}<div className="compact-caption-space"/>
   </motion.div>
   <motion.div className="acira-bookmarks-row" style={{ '--sm-final-y': `${bookmarkTop}px`, '--sm-bar-h': bookmarkVisible ? '36px' : '0px' } as CSSProperties} initial={false} animate={{ y: bookmarkTop, opacity: bookmarkVisible ? 1 : 0 }} transition={browserTransition(s.reducedMotion)} inert={!bookmarkVisible}>{bookmarks}</motion.div>
 </>}

 {(effectiveMode!=='standard'||topBarHidden||sbHeader==='bare')&&<NavigationProgress key={tab.id} tab={tab} placement="boundary" reduced={s.reducedMotion}/>}
 </motion.header>
 <div className="browser-body">
 {<motion.div className="acira-workspace-slot" data-open initial={false} animate={{ width: sidebarSpace }} transition={browserTransition(s.reducedMotion)}><AnimatePresence initial={false}></AnimatePresence>
 {showRail && <aside className="workspace-rail"><button className="rail-brand" aria-label={tr("browsermenu.newTab")} title={controlTitle('New tab')} onClick={() => navigate('acira://new')}><AciraSymbol size={20}/></button><IconButton label={tr("browsermenu.newTab")} onClick={() => dispatch({ type: 'tab.new' })}><ToolbarIcon name="new"/></IconButton><AnimatePresence initial={false}>{[{page:'history',label:tr("browsermenu.history"),icon:'history' as const}].filter(item => item.page !== 'home').slice(0, 4).map(({ page, label, icon }) => <MorphSlot key={page} name={`rail-${page}`} gap={8} reduced={s.reducedMotion}><IconButton label={label} onClick={() => openWorkspacePage(page, state, dispatch)}><WorkspaceIcon name={icon}/></IconButton></MorphSlot>)}</AnimatePresence><div className="rail-spacer"/><IconButton popup label={tr("app.appearance")} onClick={() => open('appearance')}><WorkspaceIcon name="appearance"/></IconButton><IconButton label={tr("browsermenu.settings")} onClick={() => openWorkspacePage('settings', state, dispatch)}><WorkspaceIcon name="settings"/></IconButton></aside>}</motion.div>}
 <main ref={pageRef} className="page-area"><div className={`page-content ${split ? 'split-pages' : ''}`} data-native={!split && tab.contentKind === 'web' && !tab.error && reader?.tabId !== tab.id ? '' : undefined} data-morph={morphPending || morphRun ? '' : undefined} style={splitPair ? { ...splitGridStyle(splitPair), '--pane-radius': `${pageCardRadius() / ([80, 90, 100, 110, 125, 150].includes(s.interfaceScale) ? s.interfaceScale / 100 : 1)}px` } as CSSProperties : undefined}>{visibleTabs.map((t, index) => <section key={t.id} ref={node => { if (node)
        paneRefs.current.set(t.id, node);
    else
        paneRefs.current.delete(t.id); }} className="page-pane" data-web={split && t.contentKind === 'web' && !t.error && reader?.tabId !== t.id ? '' : undefined} data-testid={t.id === tab.id ? 'active-page' : 'split-page'} data-pane={split ? t.id : undefined} onPointerDown={event => { /* A pane's × takes that pane out and its Reload reloads that pane; neither makes it current first. */ if (t.id !== tab.id && !(event.target as Element).closest?.('.split-label-close,.split-label-reload'))
        dispatch({ type: 'tab.select', id: t.id }); }} style={{ '--page-zoom': shownZoom(t.id, t.zoom / 100), ...(splitPair ? paneArea(splitPair, index) : {}) } as CSSProperties}>{split && <SplitRibbon tab={t} active={t.id === tab.id} icon={<SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon} size={14}/>} removeLabel={visibleTabs.length > 2 ? tr("app.removeFromSplitView") : tr("app.closeSplitView")} dispatch={dispatch} reducedMotion={s.reducedMotion}/>}<div className="page-zoom-content">{renderPage(t)}</div></section>)}{splitPair && <SplitHandles split={splitPair} onResize={sizes => dispatch({ type: 'split.resize', ...sizes })} onDragging={dragging => setDragTarget(dragging ? 'split' : null)}/>}</div><SplitPicker picker={splitPicker} panes={pickerPanes()} tabs={state.tabs} renderIcon={t => <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon}/>} reducedMotion={s.reducedMotion}><SplitPaneZone pane={splitPicker?.pane ?? null} reducedMotion={s.reducedMotion}/></SplitPicker><SplitPaneDragLayer drag={paneDrag} stills={splitStills} ribbonHeight={26} tabs={state.tabs} renderIcon={t => <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon} size={14}/>} reducedMotion={s.reducedMotion}/><SplitPicker picker={paneDragPicker(paneDrag)} panes={[]} veil={false} tabs={state.tabs} renderIcon={t => <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon}/>} reducedMotion={s.reducedMotion}><SplitPaneZone pane={paneDragPicker(paneDrag)?.pane ?? null} reducedMotion={s.reducedMotion}/></SplitPicker><SplitMorphLayer run={morphRun} live={liveBoxes} done={morphRun?.done} tabs={state.tabs} renderIcon={t => <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon} size={14}/>} onDone={key => { setMorphRun(run => run && run.key === key ? { ...run, done: true } : run); setTimeout(() => setMorphRun(run => run && run.key === key && run.done ? null : run), 240); }}/><TooltipHost blockPage={toastOverChrome}/><div className="page-toast-slot"><div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{toastAnnouncement}</div><WorkspaceSwitchFeedback state={state} dispatch={dispatch}/><AnimatePresence>{toastState.status && !toastOverChrome && <StatusPill key={toastState.status.key} text={toastState.status.text} icon={toastState.status.icon} reducedMotion={s.reducedMotion}/>}</AnimatePresence>{!toastOverChrome && <ToastStack rows={toastModels} expanded={toastState.expanded} reducedMotion={s.reducedMotion} onHold={toastState.hold} render={renderToast}/>}</div></main>
 </div>
 {findOpen && <div className="find-bar"><Search size={16}/><input autoFocus aria-label={tr("browsermenu.findInPage")} value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && tab.contentKind === 'web')
        void runtime.browserCommand({ type: 'find', tabId: tab.id, text: find, forward: !e.shiftKey, findNext: true }); }}/><span>{matches}</span><IconButton label={tr("app.closeFind")} onClick={() => setFindOpen(false)}><X size={16}/></IconButton></div>}
 <AnimatePresence>{(!native || overlay === 'workspace-cover') && overlay && localPopup && <motion.div className="local-overlay-scrim" key="browser-popup" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }} transition={{ duration: s.reducedMotion ? 0 : .24 }} onMouseDown={() => setOverlay(null)}><PopupSurface geometry={localPopup} state={state} sceneKey={overlay} sizePending={overlay === 'workspace-cover' && !(popupMeasure?.kind === overlay && popupMeasure.style === style)} keyboard={popupInput.current === 'keyboard'} from={popupMotion(localPopup, popupAnchorRef.current?.bounds, {}).from} trigger={popupAnchorRef.current?.bounds}>{overlay === 'suggestions' ? <AddressSuggestions items={suggestions} activeIndex={activeSuggestionIndex} query={address} onActiveIndexChange={setSuggestionIndex} onChoose={chooseSuggestion} onRemove={id => dispatch({ type: 'history.remove', id })} reducedMotion={s.reducedMotion} speed={1}/> : <Popup key={overlay} kind={overlay} intent={popupIntent.current} contextId={contextId} items={overlay === 'page-context' ? pageMenu.current : undefined} state={state} dispatch={dispatch} close={() => setOverlay(null)} onNavigate={navigate} onSplit={id => { setSplitId(id); setOverlay(null); }} onFind={() => { setFindOpen(true); setOverlay(null); }} onFocus={() => compactToggleRef.current()} onSeamless={() => seamlessToggleRef.current()} onOpen={(kind, id) => open(kind, id)} onNaturalHeight={height => { popupHeightRef.current[`${style}:${overlay}`] = height; setPopupMeasure(previous => previous?.kind === overlay && previous.style === style && previous.height === height ? previous : { kind: overlay, style, height }); }}/>}</PopupSurface></motion.div>}</AnimatePresence>
 {native && overlay === 'split' && <NativeSplitBridge onSelect={id => setSplitId(id)}/>}

 </div>;
}
function NativeSplitBridge({ onSelect }: {
    onSelect: (id: string) => void;
}) { useEffect(() => { const listener = (e: Event) => onSelect((e as CustomEvent).detail); window.addEventListener('acira-split', listener); return () => window.removeEventListener('acira-split', listener); }, []); return null; }
function TabStrip({ state, dispatch, onContext, onBlankContext, onPreview }: {
    state: BrowserSnapshot;
    dispatch: Dispatch;
    onContext: (id: string, anchor?: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, isGroup?: boolean | 'split') => void;
    onBlankContext: (anchor: {
        x: number;
        y: number;
        width: number;
        height: number;
    }) => void;
    onPreview?: (id: string, anchor: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, visible: boolean, force?: boolean) => void;
}) { const storedIcon = useSiteIcons(state); return <BrowserTabs state={state} dispatch={dispatch} iconOf={storedIcon} onContext={onContext} onBlankContext={onBlankContext} onPreview={onPreview} tabState={t => undefined} newTab={<IconButton label={tr("browsermenu.newTab")} onClick={() => dispatch({ type: 'tab.new' })}>{<ToolbarIcon name="new"/>}</IconButton>} render={t => { return <><AnimatePresence initial={false}></AnimatePresence>{tabShowsLoading(t) ? <span className="tab-agent-icon" title={tr("app.loading")}><DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/></span> : <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon || storedIcon(t.url)}/>}{!t.pinned ? <TabTitle className="tab-title" tab={t} dispatch={dispatch}>{t.title}</TabTitle> : <TabTitle className="tab-rename-anchor" tab={t} dispatch={dispatch}/>}{tabSound(t) === 'muted' && <button type="button" tabIndex={-1} className="tab-audio is-muted" title={tr("app.unmuteTab")} aria-label={tr("tabsound.unmuteName", { name: t.title })} aria-pressed={true} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); dispatch({ type: 'tab.mute', id: t.id, muted: false }); }}><VolumeX size={14}/></button>}{!t.pinned && <button className="tab-close" data-sound={tabSound(t) === 'playing' ? 'playing' : undefined} tabIndex={-1} title={t.id === state.activeTabId ? controlTitle("Close tab") : tr("app.closeTitle", { title: t.title })} aria-label={tr("app.closeTitle", { title: t.title })} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); dispatch({ type: 'tab.close', id: t.id }); }}>{<X size={14}/>}{tabSound(t) === 'playing' && <TabSoundMeter reducedMotion={state.settings.reducedMotion}/>}</button>}</>; }}/>; }
/** A popup's content height on its own: rows still rising into place (the Formation) must not read as overflow. */
const naturalContentHeight = (content: HTMLElement) => { content.dataset.measuring = ''; const height = content.scrollHeight; delete content.dataset.measuring; return height; };
function NativeOverlay({ state, dispatch, dark }: {
    state: BrowserSnapshot;
    dispatch: Dispatch;
    dark: boolean;
}) {
    const layout = useLayout(), previewRegion = useRef(false);
    useMenuFormHost(layout.overlay?.id);
    useLayoutEffect(() => { const preview = layout.overlay?.kind === 'group-preview'; previewRegion.current = preview; if (preview)
        void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'preview-hold' }); }, [layout.overlay?.id]);
    // Passive popup renderers are cropped; their stage retains window coordinates.
    const popupPoint = (event: React.PointerEvent<HTMLDivElement>) => { const stage = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - stage.x, y: event.clientY - stage.y }; };
    const previewPointer = (event: React.PointerEvent<HTMLDivElement>) => { const overlay = layout.overlay; if (overlay?.kind !== 'group-preview')
        return; const point = popupPoint(event), hit = (rect: import('./runtime/types').Rectangle | undefined) => rect && point.x >= rect.x - 6 && point.x <= rect.x + rect.width + 6 && point.y >= rect.y - 6 && point.y <= rect.y + rect.height + 6; const inside = Boolean(hit(overlay.anchor) || hit(overlay.bounds)); if (inside !== previewRegion.current) {
        previewRegion.current = inside;
        void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: inside ? 'preview-hold' : 'preview-dismiss' });
    } };
    const [retained, setRetained] = useState<BrowserLayout['overlay']>(layout.overlay);
    // The last natural height this popup measured. Until the layout carries it, a fresh sheet stays hidden (bounded), so
    // its first visible frame is already its final size: no open-then-resize when an estimate is off.
    const [measuredSize, setMeasuredSize] = useState<{ id: number; height: number }>();
    const closing = !layout.overlay, overlay = layout.overlay || retained;
    const allowed = !['assistant', 'context', 'accounts'].includes(overlay?.kind || '');
    // Native view hiding can suspend animation completion callbacks. Keep the
    // closing scene for a bounded interval, then release it independently of RAF.
    useLayoutEffect(() => { if (layout.overlay) {
        setRetained(layout.overlay);
        return;
    } const timer = setTimeout(() => setRetained(undefined), popupExitMilliseconds(state.settings.reducedMotion, motionScaleOf(state.settings) > 0 ? 1 / motionScaleOf(state.settings) : 1)); return () => clearTimeout(timer); }, [layout.overlay, state.settings.reducedMotion, state.settings.animationSpeed]);
    const navigate = (url: string) => { dispatch({ type: 'tab.navigate', url }); runtime.closeOverlay(overlay?.id); };
    const ui = (action: 'open' | 'split' | 'find' | 'focus-mode' | 'seamless-mode', kind?: string, targetTabId?: string) => void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action, kind, targetTabId });
    const measured = async (kind: string, height: number) => { if (overlay?.id !== undefined) setMeasuredSize({ id: overlay.id, height: Math.min(12000, Math.ceil(height)) }); const current = await runtime.getBrowserLayout(); if (current.overlay?.kind !== kind || current.overlay.id !== overlay?.id)
        return; const naturalHeight = Math.min(12000, Math.ceil(height)); if (Math.abs((current.overlay.contentHeight || 0) - popupContentHeight(kind, naturalHeight)) < 2)
        return; const viewport = current.viewport || { width: current.overlay.bounds.x + current.overlay.bounds.width + 12, height: current.overlay.bounds.y + current.overlay.bounds.height + 12 }; const geometry = popupGeometry(kind, state, viewport, current.overlay.anchor, naturalHeight, { lockedTop: current.overlay.context?.lockedTop, minTop: (current.pageBounds?.y || 80) + 8 }); runtime.setBrowserLayout({ ...current, overlay: { ...current.overlay, ...geometry } }); };
    const geometry = overlay ? { bounds: overlay.bounds, anchor: overlay.anchor || overlay.bounds, origin: overlay.origin || { x: 1, y: 0 }, contentHeight: overlay.contentHeight || overlay.bounds.height } : null;
    return <div className="native-popup-stage" inert={closing} onPointerMoveCapture={previewPointer} onPointerLeave={() => { if (overlay?.kind === 'group-preview') {
        previewRegion.current = false;
        void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'preview-dismiss' });
    } }} onContextMenu={event => { if (overlay?.kind === 'group-preview')
        event.preventDefault(); }} onPointerDown={e => { const point = popupPoint(e); if (e.target === e.currentTarget && e.button === 2 && overlay?.kind === 'group-preview' && overlay.context?.tabId && overlay.anchor && point.x >= overlay.anchor.x && point.x <= overlay.anchor.x + overlay.anchor.width && point.y >= overlay.anchor.y && point.y <= overlay.anchor.y + overlay.anchor.height) {
        e.preventDefault();
        void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'open', kind: 'group-context', targetTabId: overlay.context.tabId, anchor: overlay.anchor });
        return;
    } if (e.target === e.currentTarget)
        void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'popup-trigger', anchor: { ...point, width: 1, height: 1 } }); }}>{allowed && overlay && geometry && <PopupSurface key="native-popup" geometry={geometry} state={state} sceneKey={`${overlay.id}:${overlay.kind}`} native overlayId={overlay.id} keyboard={overlay.context?.input === 'keyboard'} from={overlay.context?.from} trigger={overlay.context?.trigger} closing={closing} captionHeight={layout.captionHeight} sizePending={!['suggestions', 'toast'].includes(overlay.kind) && !(measuredSize !== undefined && measuredSize.id === overlay.id && Math.abs(popupContentHeight(overlay.kind, measuredSize.height) - geometry.contentHeight) < 2) && !(popupEstimateMeasured(overlay.kind, state) && Math.abs(popupContentHeight(overlay.kind, popupNaturalHeight(overlay.kind, state, { parent: overlay.context?.parent, target: state.tabs.find(item => item.id === overlay.context?.tabId) })) - geometry.contentHeight) < 2)/* a measured estimate is trusted on the first frame (the glass shows on the input frame); a measurement still corrects it */}>{overlay.kind === 'suggestions' ? <NativeAddressSuggestions state={state} dispatch={dispatch} query={overlay.context?.query || ''} index={overlay.context?.index ?? 0}/> : overlay.kind === 'switcher' ? <TabSwitcher state={state} dispatch={dispatch} close={() => runtime.closeOverlay(overlay.id)} onNaturalHeight={height => void measured(overlay.kind, height)}/>: overlay.kind === 'toast' && overlay.context?.rating ? <RatingLayer rating={overlay.context.rating} tabId={state.activeTabId}/> : overlay.kind === 'toast' ? <div className="overlay-toast"><AnimatePresence>{overlay.context?.status && <StatusPill key={overlay.context.status.key} text={overlay.context.status.text} icon={overlay.context.status.icon} reducedMotion={state.settings.reducedMotion}/>}</AnimatePresence><ToastStack rows={(overlay.context?.toasts || []).map(row => ({ key: row.id, text: row.text, ...(row.tone ? { tone: row.tone } : {}), ...(row.action ? { actionLabel: row.action.label, actionKey: toastActionKey(row.action) } : {}), dismissible: dismissible(row.tone) }))} expanded={!!overlay.context?.expanded} reducedMotion={state.settings.reducedMotion} onHold={held => void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: held ? 'toast-hold' : 'toast-release' })} render={model => { const row = (overlay.context?.toasts || []).find(item => item.id === model.key); const done = () => void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'toast-dismiss', ...(row ? { toastId: row.id } : {}) }); return <ToastCard row={model} action={row && <ToastAction action={row.action} dispatch={dispatch} onDone={done}/>} onDismiss={done}/>; }}/></div> : <Popup active={!closing} key={`${overlay.id}:${overlay.kind}`} kind={overlay.kind} intent={overlay.context?.intent}dense={overlay.kind === 'menu' && menuDenseFor(state, window.innerHeight, overlay.anchor)} items={overlay.context?.items} contextId={overlay.context?.url || (overlay.context?.node ? `node:${overlay.context.node}` : '') || overlay.context?.tabId || ''} state={state} dispatch={dispatch} close={() => runtime.closeOverlay(overlay.id)} onNavigate={navigate} onSplit={id => ui('split', undefined, id)} onFind={() => ui('find')} onFocus={() => ui('focus-mode')} onSeamless={() => ui('seamless-mode')} onOpen={(kind, id) => kind === 'tor' && id === 'identity' ? void runtime.native?.({ type: 'shortcuts.run', id: 'tor-identity' }) : ui('open', kind)} parent={overlay.context?.parent} level={overlay.context?.level} input={overlay.context?.input} onNaturalHeight={height => void measured(overlay.kind, height)}/>}</PopupSurface>}<OverlayWarmup state={state} dispatch={dispatch} busy={!!layout.overlay}/></div>;
}
/** Round 3 (motion fix): the first menu opened after launch showed nothing ~35 ms later than every later one, because that was the
 *  first time this renderer mounted the sheet and its rows (cold script and style, the fonts decoding on first use). Once the app is
 *  idle after start-up the overlay renders the real menu once, off screen, hidden and inert, then removes it, so the first real open
 *  runs the warm paths. It never touches the native side (no id, so no overlay IPC) and is gone before anyone can reach it. */
const warmFonts = ['400 13px Inter', '500 13px Inter', '600 13px Inter'];
let overlayWarmed = false;
function OverlayWarmup({ state, dispatch, busy }: { state: BrowserSnapshot; dispatch: Dispatch; busy: boolean }) {
    const [run, setRun] = useState(false), busyNow = useRef(busy);
    busyNow.current = busy;
    useEffect(() => {
        if (overlayWarmed || !window.acira) return;
        let timer = 0;
        // The faces decode once the renderer is idle; the dry run itself waits for main, which shows this view's 24px corner for it.
        timer = window.setTimeout(() => { for (const face of warmFonts) void document.fonts.load(face, 'Ag').catch(() => undefined); }, 1500);
        const stop = runtime.subscribeBrowser((event: { type: string }) => { if (event.type !== 'overlay-warmup' /* main's own message, not part of the browser event union */ || overlayWarmed || busyNow.current) return; overlayWarmed = true; setRun(true); });
        return () => { clearTimeout(timer); stop(); };
    }, []);
    useEffect(() => { if (!run) return; const timer = setTimeout(() => setRun(false), 200); return () => clearTimeout(timer); }, [run]);
    if (!run) return null;
    const geometry = { bounds: { x: 0, y: 0, width: 300, height: 560 }, anchor: { x: 0, y: 0, width: 36, height: 36 }, origin: { x: 1, y: 0 }, contentHeight: 560 };
    const noop = () => undefined;
    // Painted, not hidden: only its top-left corner falls in the 24px window main shows, at 2% opacity, so the glass layers draw once (and their shaders exist) without anyone seeing it.
    return <div aria-hidden="true" inert data-popup-warmup="" style={{ position: 'fixed', left: 'calc(100vw - 48px)', top: 'calc(100vh - 48px)', width: 400, height: 700, opacity: .02, pointerEvents: 'none', contain: 'strict' }}>
        <PopupSurface geometry={geometry} state={state} sceneKey="0:menu" native sizePending={false}>
            <Popup active={false} kind="menu" contextId="" state={state} dispatch={dispatch} close={noop} onNavigate={noop} onSplit={noop} onFind={noop} onFocus={noop} onSeamless={noop} onOpen={noop} onNaturalHeight={noop}/>
        </PopupSurface>
    </div>;
}
function NativeAddressSuggestions({ state, dispatch, query, index }: {
    state: BrowserSnapshot;
    dispatch: Dispatch;
    query: string;
    index: number;
}) {
    const commands = useAddressCommands(profilesAsSpaces(state)), items = rankAddressSuggestions(query, state, 8, { commands });
    return <AddressSuggestions items={items} activeIndex={Math.min(index, items.length - 1)} query={query} onRemove={id => dispatch({ type: 'history.remove', id })} onActiveIndexChange={next => { if (next !== index)
        void runtime.browserCommand({ type: 'address-highlight', tabId: state.activeTabId, query, index: next }); }} onChoose={(item, switchToTab) => { if (!runAddressRow(item, dispatch))
        dispatch(addressSuggestionAction(item, switchToTab, state.activeTabId)); void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'address-commit' }); }} reducedMotion={state.settings.reducedMotion} speed={1}/>;
}
/** Page/link right-click rows carry the same editor glyphs as the tab menu; a row without one keeps the 16px column. */
const Redo2: BrowserMenuIcon = ({ size }) => <Undo2 size={size} style={{ transform: 'scaleX(-1)' }}/>;
const pageMenuIcons: Record<string, BrowserMenuIcon> = {
    'link-tab': Plus, 'image-tab': Plus, 'media-tab': Plus, 'link-foreground': ExternalLink, 'link-peek': Eye, 'link-window': PanelTop, 'link-private': PrivateWindow, 'link-private-tab': PrivateWindow, 'link-tor-tab': TorGlyph,
    'link-save': Download, 'image-save': Download, 'media-save': Download, 'save-page': Download,
    'link-copy': Link2, 'link-copy-clean': Link2, 'image-copy-url': Link2, 'media-copy-url': Link2, 'page-copy-clean': Link2,
    'image-copy': Copy, 'selection-copy': Copy, copy: Copy, paste: ClipboardCheck, undo: Undo2, redo: Redo2,
    'selection-search': Search, 'spelling-learn': BookOpen, back: ArrowLeft, forward: ArrowRight, reload: RotateCw,
    print: FileText, 'save-pdf': ArrowDownToLine, inspect: Code2, 'media-loop': RefreshCw, 'media-controls': SlidersHorizontal, 'media-fullscreen': Maximize2,
};
/** The toolbar menu's on/off rows carry the glyph of what they show, so the accent reads at a glance when on. */
const toolbarItemIcons: Record<string, BrowserMenuIcon> = { bookmarksBar: Bookmark, showHome: Home, showTabOverview: LayoutGrid, toolbarLayout: Minimize2 };
const pageMenuIcon = (item: PageMenuItem): BrowserMenuIcon | undefined => item.id === 'media-play' ? (item.label === tr("sidebarmedia.play") ? Play : Pause) : item.id === 'media-mute' ? (item.label === tr("acirasidebar.mute") ?VolumeX : Volume2) : pageMenuIcons[item.id || ''];
function Popup({ active = true, kind, contextId, state, dispatch, close, onNavigate, onSplit, onFind, onFocus, onSeamless, onOpen, onNaturalHeight, items, dense = false, intent, parent, level, input }: {
    input?: string;
    parent?: string;
    level?: string;
    dense?: boolean;
    intent?: 'identity' | 'report';
    active?: boolean;
    kind: string;
    items?: PageMenuItem[];
    contextId: string;
    state: BrowserSnapshot;
    dispatch: Dispatch;
    close: () => void;
    onNavigate: (url: string) => void;
    onSplit: (id: string) => void;
    onFind: () => void;
    onFocus: () => void;
    onSeamless?: () => void;
    onOpen?: (kind: string, id?: string) => void;
    onNaturalHeight?: (height: number) => void;
}) {
    useShortcutKeys();
    // R4-60: one use per opening (the sheet mounts once per overlay id; the warm-up's inactive dry run is not an opening).
    useEffect(() => { if (active) notePopupOpened(kind); }, []);
    const present = useIsPresent(), interactive = active && present;
    const [keyboardTab, setKeyboardTab] = useState(state.activeTabId), [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>(input === 'keyboard' || !window.acira ? 'keyboard' : 'pointer');
    const [query, setQuery] = useState(''), [findResult, setFindResult] = useState('');
    const s = state.settings, tab = state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0], context = state.tabs.find(t => t.id === contextId) || tab;
    const menuLayout = useMenuLayout(tab.browserProfileId);
    // R3-42: a submenu opened from the Acira menu goes back to it (header row, Left, Backspace, Esc).
    // "Report a problem" replaces Page information, Protection or the Acira menu in place (SiteReport.tsx); the warning page and Help > Report a
    // Problem open it directly. What it may be about: the site in Page information and Protection; from the Acira menu the site or Acira itself
    // (Acira alone off a website). Nothing until this build can send reports (state.siteReports), nothing in Tor.
    const reportSubjects: SiteReportSubject[] = !state.siteReports || isTorWindow(state) || tab.privacy === 'tor' ? [] : kind === 'menu' ? (reportable(tab, false) ? ['site', 'app'] : ['app']) : (kind === 'security' || kind === 'protection') && reportable(tab, false) ? ['site'] : [];
    const [reporting, setReporting] = useState(intent === 'report'), canReport = reportSubjects.length > 0;
    const back = parent === 'menu' && submenuKinds.includes(kind) ? () => onOpen?.('menu') : undefined;
    const matchingTabs = [...state.tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned)).filter(t => (t.title + t.url + t.group).toLowerCase().includes(query.toLowerCase()));
    // R4-48 P1-2: while searching, the tab viewer also lists the other workspaces' matching tabs under each workspace's name; choosing one switches there.
    const otherMatching = kind === 'tabs' && query.trim() ? windowWorkspaces(state).flatMap(workspace => { const found = (state.otherWorkspaceTabs ?? []).filter(t => workspaceIdOf(state, t) === workspace.id && (t.title + t.url + t.group).toLowerCase().includes(query.trim().toLowerCase())); return found.length ? [{ id: workspace.id, name: workspaceShownName(workspace), tabs: found }] : []; }) : [];
    const popupRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null), headerRef = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLDivElement>(null), footerRef = useRef<HTMLDivElement>(null), heightCallback = useRef(onNaturalHeight);
    heightCallback.current = onNaturalHeight;
    const repeatGate = useRef(createNavigationRepeat()), pointerPosition = useRef<{
        x: number;
        y: number;
    } | null>(null), keyboardAnchor = useRef(state.activeTabId);
    const focusTabResult = (id: string) => { keyboardAnchor.current = id; setKeyboardTab(id); };
    const changeInputMode = (mode: 'pointer' | 'keyboard') => setInputMode(old => old === mode ? old : mode);
    useLayoutEffect(() => { if (!interactive)
        return; const content = contentRef.current, header = headerRef.current; if (!content || !header)
        return; let frame = 0, retry: ReturnType<typeof setTimeout> | undefined; const since = performance.now(); const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (content.querySelector('[data-popup-pending]') && performance.now() - since < 150) { clearTimeout(retry); retry = setTimeout(measure, 32); return; } heightCallback.current?.(Math.ceil(naturalContentHeight(content) + (['absolute', 'fixed'].includes(getComputedStyle(header).position) ? 0 : header.offsetHeight) + (searchRef.current?.offsetHeight || 0) + (footerRef.current?.offsetHeight || 0) + parseFloat(getComputedStyle(popupRef.current!).paddingTop) + parseFloat(getComputedStyle(popupRef.current!).paddingBottom) + (kind === 'find' ? 0 : 2))); }); }; const observer = new ResizeObserver(measure); [content, header, searchRef.current, footerRef.current].forEach(node => node && observer.observe(node)); /* A popup is never shorter than its content (founder P0): content that changes inside a box that keeps its size (a status line, a row added to a list held at full height, a disclosure opening) re-measures too. */ const changes = new MutationObserver(measure); changes.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden'] }); measure(); return () => { cancelAnimationFrame(frame); clearTimeout(retry); observer.disconnect(); changes.disconnect(); }; }, [kind, interactive]);
    useEffect(() => { const reset = () => repeatGate.current.release(); window.addEventListener('blur', reset); return () => window.removeEventListener('blur', reset); }, []);
    useLayoutEffect(() => { if (matchingTabs.length && !matchingTabs.some(t => t.id === keyboardTab))
        setKeyboardTab(matchingTabs[0].id); }, [matchingTabs.map(t => t.id).join('|'), keyboardTab]);
    useLayoutEffect(() => {
        if (!interactive || kind === 'group-preview' || kind==='zoom')
            return;
        const previous = document.activeElement, root = popupRef.current;
        if (!root)
            return;
        let frame = 0;
        const focusDialog = () => { setInputMode('keyboard'); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => (root.querySelector<HTMLElement>('[data-initial-focus=true]') || root.querySelector<HTMLElement>('input:not([type=checkbox])') || root).focus({ preventScroll: true })); };
        focusDialog();
        window.addEventListener('focus', focusDialog);
        window.addEventListener('acira-popup-ready', focusDialog);
        return () => { cancelAnimationFrame(frame); window.removeEventListener('focus', focusDialog); window.removeEventListener('acira-popup-ready', focusDialog); if (root.contains(document.activeElement) && previous instanceof HTMLElement && previous.isConnected && !root.contains(previous) && !previous.closest('[inert]'))
            previous.focus({ preventScroll: true }); };
    }, [kind, interactive]);
    const keyboard = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing)
            return;
        changeInputMode('keyboard');
        const root = popupRef.current;
        if (!root)
            return;
        if (back && (e.key === 'ArrowLeft' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            e.stopPropagation();
            back();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (kind === 'find') closeFind(); else if (back) back(); else close();
            return;
        }
        // Ctrl+W in the tab viewer closes the tab the selection is on (not the page behind), and the selection moves to its neighbour.
        if (kind === 'tabs' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w' && matchingTabs.some(t => t.id === keyboardTab)) {
            e.preventDefault();
            e.stopPropagation();
            closeResult(keyboardTab);
            return;
        }
        const buttons = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')).filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[inert]'));
        if (e.key === 'Tab' && buttons.length) {
            const first = buttons[0], last = buttons.at(-1)!;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        const editing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        const tabArrow = ['ArrowDown', 'ArrowUp'].includes(e.key) || !editing && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key);
        if (kind === 'tabs' && tabArrow) {
            e.preventDefault();
            e.stopPropagation();
            if (!repeatGate.current.accept(e.key, e.repeat, performance.now()))
                return;
            const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab-result[data-tab-id]'));
            let index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0)
                index = items.findIndex(item => item.dataset.tabId === keyboardAnchor.current);
            const next = items[tabCursorIndex(index, items.length, e.key)];
            if (next) {
                setKeyboardTab(next.dataset.tabId!);
                next.focus({ preventScroll: true });
            }
            return;
        }
        // Up and Down move between rows, except in a field of several lines (the report form's note), where they move the caret.
        if (kind !== 'tabs' && kind !== 'find' && ['ArrowDown', 'ArrowUp'].includes(e.key) && !(e.target instanceof HTMLTextAreaElement)) {
            const items = Array.from(root.querySelectorAll<HTMLElement>('.tab-result,.menu-row,.profile-row,.acira-menu-row')).filter(item => !item.closest('[inert]') && item.getClientRects().length && !item.matches(':disabled'));
            if (items.length) {
                e.preventDefault();
                let index = items.indexOf(document.activeElement as HTMLElement);
                if (index < 0)
                    index = e.key === 'ArrowDown' ? -1 : 0;
                const next = items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
                next.focus({ preventScroll: true });
                next.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            }
        }
        if (e.key === 'Enter' && ['tabs', 'palette', 'bookmarks'].includes(kind) && editing) {
            e.preventDefault();
            const selected = kind === 'tabs' ? root.querySelector<HTMLButtonElement>(`.tab-result[data-tab-id="${keyboardTab}"]`) || root.querySelector<HTMLButtonElement>('.tab-result[data-tab-id]') : root.querySelector<HTMLButtonElement>('.tab-result,.menu-row');
            selected?.click();
        }
    };
    const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const previous = pointerPosition.current;
        pointerPosition.current = { x: e.clientX, y: e.clientY };
        if (previous ? Math.abs(e.clientX - previous.x) + Math.abs(e.clientY - previous.y) < 1 : !e.movementX && !e.movementY)
            return;
        changeInputMode('pointer');
        const item = (e.target as Element).closest<HTMLElement>('.tab-result-row')?.querySelector<HTMLElement>('.tab-result[data-tab-id]');
        if (item?.dataset.tabId)
            setKeyboardTab(item.dataset.tabId);
    };
    useEffect(() => { if (kind !== 'find')
        return; return runtime.subscribeBrowser(event => { if (event.type === 'find-result' && event.tabId === tab.id)
        setFindResult(event.matches ? `${event.activeMatchOrdinal}/${event.matches}` : 'No matches'); }); }, [kind, tab.id]);
    // Esc hands the keyboard back to the page, as in every other browser.
    const closeFind = () => { close(); if (tab.contentKind === 'web')
        void runtime.browserCommand({ type: 'focus', tabId: tab.id }); };
    useEffect(() => { if (kind === 'find')
        void runtime.browserCommand({ type: 'find', tabId: tab.id, text: query }); }, [kind, query, tab.id]);
    const navItems = baseNavItems, paletteLinks = navItems.map(([page, label]) => ({ url: page === 'home' ? 'acira://new' : `acira://${page}`, title: label }));
    const row = (label: string, Icon: BrowserMenuIcon, action: () => void, hint?: string, tip?: string) => <button className="menu-row" title={tip} onClick={action}><Icon size={16}/><span>{label}</span>{menuShortcut(label, hint) && <kbd>{menuShortcut(label, hint)}</kbd>}</button>;
    // Acira's own pages open beside the page you are on, never in place of it (appPages.ts).
    const openPage = (url: string) => { const page = appPageOf(url); if (!page) { onNavigate(url); return; } openWorkspacePage(page, state, dispatch); close(); };
    const menuParts = { row, newTab: () => { dispatch({ type: 'tab.new' }); close(); }, openWindow: (kind: 'normal' | 'private' | 'tor') => { runtime.openWindow(kind); close(); }, restore: () => { dispatch({ type: 'tab.restore' }); close(); }, open: (next: string) => onOpen?.(next), navigate: openPage, find: onFind, focus: onFocus, seamless: onSeamless, focusActive: effectiveView(state.settings, state.windowUi) === 'focus', seamlessActive: effectiveView(state.settings, state.windowUi) === 'seamless', focusEnabled: true, view: effectiveView(state.settings, state.windowUi), setView: (windowView: WindowView) => { dispatch({ type: 'settings.update', patch: { windowView } }); }, sidebarTabs: !!state.settings.verticalTabs, setSidebarTabs: (verticalTabs: boolean) => { dispatch({ type: 'settings.update', patch: { verticalTabs } }); }, sidebarMode: sidebarModeOn(state.settings), setSidebarMode: (on: boolean) => { setSidebarMode(state, dispatch, on); close(); /* the whole window re-arranges and the menu would cover the sidebar */ }, zoom: <div className="zoom-row"><span>{tr("app.zoom")}</span><IconButton label={tr("app.zoomOut")} disabled={tab.zoom<=25} onClick={()=>void runtime.browserCommand({type:'zoom',tabId:tab.id,zoom:nextPageZoom(tab.zoom,-1)})}><Minus size={16}/></IconButton><button type="button" title={tr("app.resetZoom")} aria-label={tr("app.resetPageZoomCurrentlyZoom", { zoom: tab.zoom })} onClick={()=>void runtime.browserCommand({type:'zoom',tabId:tab.id,zoom:100})}>{tab.zoom}%</button><IconButton label={tr("app.zoomIn")} disabled={tab.zoom>=500} onClick={()=>void runtime.browserCommand({type:'zoom',tabId:tab.id,zoom:nextPageZoom(tab.zoom,1)})}><Plus size={16}/></IconButton></div>, tools: menuTools(tab, close, dispatch), report: kind === 'menu' && canReport ? () => setReporting(true) : undefined, torActive: isTorWindow(state), torIdentity: () => onOpen?.('tor', 'identity'), ...(isTorSite(state, tab) ? { torCircuit: () => { void runTorCircuit(dispatch, tab.id); close(); }, torCircuitKey: torCircuitShortcut() } : {}) };
    const select = (id: string) => { dispatch({ type: 'tab.select', id }); close(); };
    // Pinned tabs are protected from bulk closes; a row with nothing to close is not offered.
    // A linked copy (a group tab also drawn in a loose split) is not closed with its group: it leaves the group and stays a pane of its split.
    const closeGroup = (members: TabSession[], label: string) => { const linked = new Set(state.windowUi.splitGroups?.flatMap(split => split.linked ?? [])), targets = members.filter(member => !member.pinned && !linked.has(member.id)), stay = members.filter(member => linked.has(member.id)); return targets.length || stay.length ? row(label, X, () => { if (stay.length) dispatch({ type: 'tab.group.assign', tabIds: stay.map(member => member.id), groupId: null }); targets.forEach(member => dispatch({ type: 'tab.close', id: member.id })); close(); }) : null; };
    const closeResult = (id: string) => { const index = matchingTabs.findIndex(t => t.id === id), next = matchingTabs[index + 1] || matchingTabs[index - 1]; changeInputMode('keyboard'); if (next)
        focusTabResult(next.id); dispatch({ type: 'tab.close', id }); requestAnimationFrame(() => { const target = next && popupRef.current?.querySelector<HTMLElement>(`.tab-result[data-tab-id="${next.id}"]`); (target || popupRef.current?.querySelector<HTMLInputElement>('.popup-search input'))?.focus({ preventScroll: true }); }); };
    const navigatePalette = (event: React.KeyboardEvent<HTMLInputElement>) => { if (kind !== 'palette' || event.key !== 'Enter' || event.nativeEvent.isComposing || !query.trim())
        return; event.preventDefault(); event.stopPropagation(); const target = resolveNavigation(query, ...searchFor(s, tab.privacy), state.websiteLanguage); if (target.error)
        dispatch({ type: 'toast', text: target.error, tone: 'error' });
    else
        onNavigate(target.url); };
    return <div ref={popupRef} tabIndex={-1} onKeyDown={keyboard} onKeyUp={e => repeatGate.current.release(e.key)} data-input-mode={inputMode} onPointerMove={pointerMove} onPointerDown={() => changeInputMode('pointer')} onPointerEnter={() => { if (!window.acira && kind === 'group-preview')
        void runtime.browserCommand({ type: 'ui', tabId: tab.id, action: 'preview-hold' }); }} onPointerLeave={() => { if (!window.acira && kind === 'group-preview')
        void runtime.browserCommand({ type: 'ui', tabId: tab.id, action: 'preview-dismiss' }); }} className={`browser-popup popup-content-${kind}`} data-backable={back ? '' : undefined} data-level={level || undefined} data-density={dense ? 'compact' : undefined} role="dialog" aria-label={kind === 'recent-closed' ? tr('rewind.recentlyClosed') : kind === 'menu' ? tr("app.aciraMenu") : kind === 'toolbar-overflow' ? tr("app.moreToolbarButtons") : kind==='protection'?tr('protection.title'):kind==='vpn'?tr('vpn.control.title'):kind==='tor'?tr("app.torStatus"):kind==='update'?tr(({ready:'update.readyTitle',downloading:'update.downloadingTitle',paused:'update.pausedTitle'} as const)[updatePanelPhase()]):kind==='whats-new'?tr('update.whatsNew'):kind==='zoom'?tr("app.pageZoom"):kind === 'tabs' ? tr("app.tabSwitcher") : kind === 'workspace-cover' ? tr('local.workspaceCover') : kind === 'appearance' ? tr("app.appearance") : kind === 'security' ? tr("app.pageInformation") : kind === 'profile' ? tr("app.profiles") : kind === 'workspace-menu' || kind === 'workspace-context' ? tr("workspaces.panel") : kind === 'workspace-edit' ? tr("workspaces.editTitle") : kind === 'context' ? tr("app.chooseTabContext") : kind === 'tab-context' ? tr("app.tabActions") : kind === 'group-context' ? tr("app.groupActions") : kind === 'split-context' ? tr("acirasidebar.splitActions") : kind === 'group-preview' ? tr("app.groupPreview") : kind === 'strip-context' ? tr("app.tabBarActions") : kind === 'toolbar-context' ? tr("app.toolbarOptions") : kind === 'customize-toolbar' ? tr("app.customizeToolbar") : kind === 'extensions' ? tr("browsermenu.extensions") : kind === 'bookmark-context' ? tr(contextId.startsWith('node:zone-') ? "sidebarmenu.title" : "app.bookmarkActions") : kind === 'bookmark-edit' ? tr("app.editBookmark") : kind === 'split' ? tr("browsermenu.splitView") : kind === 'find' ? tr("browsermenu.findInPage") : tr("app.commandMenu")}><div ref={headerRef} className="popup-header" inert={['tab-context','group-context','split-context','page-context','strip-context'].includes(kind)||undefined} aria-hidden={['tab-context','group-context','split-context','page-context','strip-context'].includes(kind)||undefined}>{(() => { const heading = kind==='protection'?tr('protection.title'):kind==='vpn'?tr('vpn.control.title'):kind==='zoom'?tr("app.pageZoom"):kind === 'group-preview' ? (groupForTab(state, context)?.name || tr("tabgroupcontrols.tabGroup")) : kind === 'recent-closed' ? tr('rewind.recentlyClosed') : kind === 'menu' ? tr("browsersettings.acira") : kind === 'workspace-cover' ? tr('local.workspaceCover') : kind === 'appearance' ? tr("app.appearance") : kind === 'security' ? tr("app.pageInformation") : kind === 'profile' ? tr("app.profiles") : kind === 'tabs' ? <>{tr("browsermenu.allOpenTabs")}<span className="popup-count">{state.tabs.length}</span></> : kind === 'context' ? tr("app.attachContext") : kind === 'tab-context' ? tr("app.tabActions") : kind === 'group-context' ? tr("app.groupActions") : kind === 'split-context' ? tr("acirasidebar.splitActions") : kind === 'group-preview' ? tr("app.groupPreview") : kind === 'strip-context' ? tr("app.tabBarActions") : kind === 'toolbar-context' ? tr("app.toolbarOptions") : kind === 'customize-toolbar' ? tr("app.customizeToolbar") : kind === 'extensions' ? tr("browsermenu.extensions") : kind === 'bookmark-context' ? tr(contextId.startsWith('node:zone-') ? "sidebarmenu.title" : "app.bookmarkActions") : kind === 'bookmark-edit' ? tr("app.editBookmark") : kind === 'split' ? tr("browsermenu.splitView") : kind === 'downloads' ? tr("browsermenu.downloads") : kind === 'bookmarks' ? tr("browsermenu.bookmarks") : kind === 'find' ? tr("browsermenu.findInPage") : kind === 'more-tools' ? tr("browsermenu.moreTools") : tr("browsermenu.searchAndCommands"); return back ? <SubmenuBack title={heading} onBack={back}/> : <strong>{heading}</strong>; })()}{kind === 'tabs' && <TabViewerDensityToggle value={s.tabViewerDensity ?? 'comfortable'} onChange={tabViewerDensity => dispatch({ type: 'settings.update', patch: { tabViewerDensity } })}/>}{kind === 'tabs' && <kbd className="popup-shortcut">{formatShortcut('Alt T')}</kbd>}{/* The tab viewer has no ×: Esc closes it (critique round 3). */kind !== 'tabs' && <IconButton label={tr("app.closeMenu")} onClick={close}><X size={17}/></IconButton>}</div>{kind === 'tabs' && <div ref={searchRef} className="popup-fixed-search"><label className="popup-search"><Search size={17}/><input autoFocus aria-label={tr("app.searchTabs")} value={query} placeholder={tr("app.searchOpenTabs")} onChange={e => setQuery(e.target.value)}/></label></div>}<ScrollRegion contentRef={contentRef}>{reporting && canReport ? <SiteReport tab={tab} subjects={reportSubjects} initialKind={intent === 'report' && kind === 'security' ? 'blocked' : undefined} dispatch={dispatch} onCancel={() => { if (intent === 'report') close(); else setReporting(false); }} onSent={close}/> : <>
 {kind==='zoom'&&<ZoomFeedback tab={state.tabs.find(item=>item.id===contextId)||tab} close={close}/>}
 {kind === 'toolbar-overflow' && (() => { const hidden = contextId.replace(/^node:/, '').split('.'), profile = state.browserProfiles.find(item => item.id === state.tabs.find(t => t.id === state.activeTabId)?.browserProfileId), Avatar = () => profile ? <ProfileAvatar name={profile.name} color={profile.color || '#6b7280'} avatar={profile.avatar} picture={profile.picture} size={16}/> : null; const glyph = (name: 'downloads' | 'history' | 'bookmarks' | 'split' | 'appearance') => (() => <ToolbarIcon name={name} size={16}/>) as BrowserMenuIcon;
        return <>{hidden.map(id => <ReactFragment key={id}>{id === 'home' ? row(tr("app.home"), Home, () => onNavigate('acira://new'))
            : id === 'extensions' ? row(tr("browsermenu.extensions"), ExtensionsIcon, () => onOpen?.('extensions'))
            : id === 'profile' ? row(tr("app.switchProfile"), Avatar as BrowserMenuIcon, () => onOpen?.('profile'), 'Ctrl Shift M')
            : id === 'focus' ? row(effectiveView(state.settings, state.windowUi) === 'focus' ? tr("app.exitFocusMode") : tr("browsermenu.focusMode"), Maximize2, () => { onFocus?.(); close(); }, 'Ctrl Shift F')
            : id === 'history' ? row(tr("browsermenu.history"), glyph('history'), () => openPage('acira://history'), 'Ctrl H')
            : id === 'routines' ? row(tr("app.routines"), Workflow, () => onNavigate('acira://routines'))
            : id === 'protection' ? row(tr('protection.title'), ProtectionIcon, () => onOpen?.('protection'))
            : id === 'vpn' ? row(tr('vpn.control.title'), LockKeyhole, () => onOpen?.('vpn'))
            : id === 'downloads' || id === 'bookmarks' || id === 'split' || id === 'appearance' ? row(toolbarItemLabels[id], glyph(id), () => onOpen?.(id))
            : null}</ReactFragment>)}</>; })()}{kind === 'more-tools' && <MoreToolsMenu layout={menuLayout} {...menuParts}/>}{kind === 'menu' && <BrowserMenu layout={menuLayout} {...menuParts}/>}
 {kind === 'palette' && <CommandPalette state={state} dispatch={dispatch} close={close} onNavigate={onNavigate} pages={paletteLinks}/>}{['tabs', 'bookmarks'].includes(kind) && <>{kind !== 'tabs' && <label className="popup-search"><Search size={17}/><input autoFocus aria-label={tr("app.searchBookmarks")} value={query} placeholder={tr("app.searchBookmarks")} onChange={e => setQuery(e.target.value)}/></label>}{kind === 'bookmarks' && bookmarkControl(state,tab).available && row(bookmarkControl(state,tab).saved ? tr("app.removeBookmark") : tr("app.bookmarkThisTab"), Star, () => { dispatch({ type: 'bookmark.toggle', url: tab.url }); close(); }, 'Ctrl D')}{kind === 'bookmarks' ? [...state.bookmarks.map(u => ({ u, tor: false })), ...[...new Set(state.bookmarkNodes.filter(node => node.tor && node.url && node.browserProfileId === state.activeBrowserProfileId).map(node => node.url!))].map(u => ({ u, tor: true }))].filter(({ u }) => (siteIdentity(u).label + u).toLowerCase().includes(query.toLowerCase())).map(({ u, tor }) => <button className="tab-result" key={(tor ? 'tor:' : '') + u} onClick={() => { if (tor) { openTorBookmark(state, dispatch, u); close(); } else onNavigate(u); }}><SiteIcon url={u} privacy={tor ? 'tor' : undefined}/><span><strong>{siteIdentity(u).label}</strong><small>{u}</small></span></button>) : <TabResults density={s.tabViewerDensity ?? 'comfortable'} tabs={matchingTabs} groups={otherMatching} currentId={tab.id} cursorId={keyboardTab} inputMode={inputMode} animateSelection={kind === 'tabs'} reducedMotion={s.reducedMotion} speed={1} onCursor={focusTabResult} onSelect={select} onClose={closeResult} renderIcon={t => <SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error} favicon={t.favicon}/>}/>}{kind === 'tabs' && !matchingTabs.length && !otherMatching.length && <p className="popup-empty">{tr("app.noTabsMatchYourSearch")}</p>}{kind !== 'tabs' && row(tr("browsermenu.newTab"), Plus, () => { dispatch({ type: 'tab.new' }); close(); }, 'Ctrl T')}</>}
 {kind === 'workspace-cover' && <WorkspaceCoverPicker profileId={tab.browserProfileId||state.activeBrowserProfileId} privateMode={state.browserProfiles.find(profile=>profile.id===(tab.browserProfileId||state.activeBrowserProfileId))?.private} showVisibility={false}/>}
 {kind === 'appearance' && <AppearancePanel settings={{...s,reducedTransparency:state.userReducedTransparency??s.reducedTransparency}} onChange={patch => dispatch({ type: 'settings.update', patch })} onMore={() => onNavigate('acira://settings')}/>}
 {kind === 'extensions' && <ExtensionManager panel tab={tab} privateMode={state.browserProfiles.some(profile=>profile.id===tab.browserProfileId&&profile.private)} profileId={tab.browserProfileId} profileName={state.browserProfiles.find(p => p.id === tab.browserProfileId)?.name || 'Test browsing'} onGetExtensions={() => { dispatch({ type: 'tab.new', url: 'https://chromewebstore.google.com/category/extensions' }); close(); }}/>}
 {kind === 'tor' && <TorPopover state={state} dispatch={dispatch} close={close} intent={intent === 'identity' ? intent : undefined}/>}
 {kind === 'update' && <UpdatePopover close={close} reducedMotion={state.settings.reducedMotion}/>}
 {kind === 'whats-new' && <WhatsNewPopover close={close} reducedMotion={state.settings.reducedMotion}/>}
 {kind === 'vpn' && <VpnPanel compact onNavigate={url => { dispatch({ type: 'tab.new', url }); close(); }}/>}
 {kind === 'profile' && <ProfileSwitcher state={state} profileId={tab.browserProfileId} dispatch={dispatch} close={close}/>}
 {kind === 'protection' && <ShieldsSummary key={`${tab.id}:${tab.url}`} tab={tab} blockingOnly tor={isTorWindow(state)||tab.privacy==='tor'} privateMode={!!tab.privacy||!!state.browserProfiles.find(profile=>profile.id===tab.browserProfileId)?.private}/>}{kind === 'protection' && canReport && <><hr/>{row(tr('report.row'), MessageSquare, () => setReporting(true))}</>}
 {kind === 'security' && <><div className="acira-menu-row acira-menu-row-identity"><svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d={tab.contentKind === 'web' && !tab.url.startsWith('https:') ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'}/></svg><span className="acira-menu-title" style={{ fontWeight: 500 }}>{tab.contentKind === 'web' ? new URL(tab.url).hostname : tr("app.aciraPage")}<span className="acira-menu-sub">{tab.contentKind === 'web' ? (tab.error ? tr("app.connectionFailed") : tab.loading ? 'Connecting…' : tab.url.startsWith('https:') ? tr("app.connectionIsSecure") : isTorSite(state, tab) && /^http:\/\/[^/]+\.onion(?::\d+)?(?:\/|$)/i.test(tab.url) ? tr("tor.onion.secure") : tr("app.connectionIsNotSecure")) : tr("app.builtIntoAcira")}</span></span><span/></div><hr className="acira-menu-sep"/>{isTorSite(state, tab) && <TorSitePanel state={state} tab={tab} dispatch={dispatch} close={close}/>}<SiteControls state={state}/>{tab.contentKind === 'web' && !tab.error && <><hr/>{row(tr("app.readerMode"), BookOpen, () => { void runtime.browserCommand({ type: 'ui', action: 'reader', tabId: tab.id }); close(); })}{row(tr("app.print"), FileText, () => { void runtime.browserCommand({ type: 'print', tabId: tab.id }); close(); }, 'Ctrl P')}{row(tr("browsermenu.savePageAs"), Download, () => { void runtime.browserCommand({ type: 'save-page', tabId: tab.id }); close(); })}{/^https?:/i.test(tab.url) && !state.browserProfiles.some(profile => profile.id === tab.browserProfileId && profile.private) && row(tr("app.installAsApp"), LayoutGrid, () => { void installSiteAsApp(state, dispatch); close(); })}</>}{canReport && <>{tab.error && <hr/>}{row(tr('report.row'), MessageSquare, () => setReporting(true))}</>}</>}
 
 {kind === 'group-preview' && <div aria-label={tr("app.groupTabs", { Group: groupForTab(state, context)?.name || 'Group' })}>{state.tabs.filter(member => groupForTab(state, member)?.id === groupForTab(state, context)?.id).slice(0, 4).map(member => <button type="button" className="group-preview-row" key={member.id} onClick={() => { dispatch({ type: 'tab.select', id: member.id }); close(); }}><SiteIcon url={member.url} favicon={member.favicon}/><span>{member.title}</span></button>)}</div>}
 {kind === 'page-context' && (items || []).map((item, index) => { const Icon = pageMenuIcon(item); return item.type === 'separator' ? <hr key={`s${index}`}/> : item.header ? <div key={item.id || index} className="menu-heading" data-depth={item.depth || undefined} role="presentation">{item.icon && <img className="menu-ext-icon" src={item.icon} alt=""/>}<span>{item.label}</span></div> : item.checked !== undefined ? <LocalMenuToggle key={item.id || index} icon={Icon} label={item.label || ''} initial={item.checked} disabled={!item.enabled} onToggle={() => void runtime.browserCommand({ type: 'context-run', tabId: context.id, id: item.id || '' })}/> : <button key={item.id || index} type="button" className="menu-row" data-depth={item.depth || undefined} role={item.mark ? (item.mark === 'dot' ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'} aria-checked={item.mark ? item.mark !== 'none' : undefined} disabled={!item.enabled} onClick={() => { void runtime.browserCommand({ type: 'context-run', tabId: context.id, id: item.id || '' }); close(); }}>{item.mark ? (item.mark === 'check' ? <Check size={16}/> : <i className={item.mark === 'dot' ? 'menu-icon menu-dot' : 'menu-icon'} aria-hidden="true"/>) : item.icon ? <img className="menu-ext-icon" src={item.icon} alt=""/> : Icon && <Icon size={16}/>}<span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>; })}
 {kind === 'tab-context' && <>{row(tr("app.reloadTab"), RotateCw, () => { if (context.contentKind === 'web')
        void runtime.browserCommand({ type: 'reload', tabId: context.id });
    else
        dispatch({ type: 'tab.navigate', url: context.url, tabId: context.id }); close(); }, formatShortcut('Ctrl R'))}{row(tr(state.settings.verticalTabs ? "app.newTabBelow" : "app.newTabToTheRight"), Plus, () => { dispatch({ type: 'tab.new', afterId: context.id }); close(); })}{row(tr("app.duplicateTab"), Copy, () => { dispatch({ type: 'tab.duplicate', id: context.id }); close(); })}{row(tr("tabrename.menuRow"), PenLine, () => { void runtime.browserCommand({ type: 'ui', tabId: tab.id, action: 'rename-tab', targetTabId: context.id }); close(); }, 'F2')}{context.contentKind === 'web' && row(tr("browsermenu.copyPageAddress"), Link2, () => { void copyText(context.url).then(() => dispatch({ type: 'toast', text: tr("app.addressCopied") }), () => dispatch({ type: 'toast', text: tr("app.couldnTCopyTheLink"), tone: 'error' })); close(); })}{/* The reducer pins no private, Tor or secured tab (core.ts tab.pin), so the row was a button that did nothing. */!context.privacy && row(context.pinned ? tr("app.unpinTab") : tr("app.pinTab"), Pin, () => { dispatch({ type: 'tab.pin', id: context.id }); close(); })}{/* Add to Favorites: what dragging this tab up does (src/ui/favoriteAdd.ts), asked of the sidebar, which is where Favorites live; the strip layout has none to add to. */state.settings.verticalTabs && context.contentKind === 'web' && !context.privacy && row(tr("acirasidebar.addToFavorites"), LayoutGrid, () => { void runtime.browserCommand({ type: 'ui', tabId: tab.id, action: 'favorite-tab', targetTabId: context.id }); close(); })}{/* A pane of a saved split (docs/launch/SPLIT_IN_GROUPS.md): Open alone or Show split view, and Remove from split view. */}{(pane => pane ? <>{row(paneIsAlone(state, context.id, pane) ? tr("acirasidebar.showSplitView") : tr("acirasidebar.openAlone"), paneIsAlone(state, context.id, pane) ? Columns2 : Maximize2, () => { toggleSolo(state, dispatch, context.id, pane); close(); }, formatShortcut('Shift Enter'))}{row(tr("acirasidebar.removeFromSplit"), Unplug, () => { dispatch({ type: 'split.separate', tabId: context.id }); close(); })}</> : context.contentKind === 'web' && context.id !== tab.id && tab.contentKind === 'web' && row(tr("browsermenu.splitView"), Columns2, () => { dispatch({ type: 'split.open', tabIds: [tab.id, context.id] }); close(); }))(state.windowUi.splitGroups?.find(split => split.tabIds.includes(context.id)))}{row(tr("app.moveToNewWindow"), Plus, () => { dispatch({ type: 'tab.move-window', id: context.id }); close(); })}{context.contentKind === 'web' && row(context.muted ? tr("app.unmuteTab") : tr("app.muteTab"), context.muted ? Volume2 : VolumeX, () => { dispatch({ type: 'tab.mute', id: context.id, muted: !context.muted }); close(); })}{isTorSite(state, context) && row(tr("tor.circuit.new"), TorCircuitGlyph, () => { void runTorCircuit(dispatch, context.id); close(); }, context.id === state.activeTabId ? torCircuitShortcut() : undefined)}<hr /><TabGroupControls state={state} tab={context} dispatch={dispatch} close={close}/><hr />{row(tr("app.closeTab"), X, () => { dispatch({ type: 'tab.close', id: context.id }); close(); }, formatShortcut('Ctrl W'))}{closeGroup(state.tabs.filter(member => member.id !== context.id), tr("shortcutCmd.close-other-tabs"))}{closeGroup(state.tabs.slice(0, state.tabs.findIndex(member => member.id === context.id)), tr("app.closeTabsLeft"))}{closeGroup(state.tabs.slice(state.tabs.findIndex(member => member.id === context.id) + 1), tr("shortcutCmd.close-tabs-right"))}{row(tr("browsermenu.reopenClosedTab"), Undo2, () => { dispatch({ type: 'tab.restore' }); close(); }, formatShortcut('Ctrl Shift T'))}</>}
 {kind === 'group-context' && context.id === contextId && <TabGroupControls scope="group" state={state} tab={context} dispatch={dispatch} close={close}/>}
 {kind === 'split-context' && <SplitHeaderMenu state={state} dispatch={dispatch} tabId={contextId} close={close}/>}
 {kind === 'strip-context' && <>{row(tr("browsermenu.newTab"), Plus, () => { dispatch({ type: 'tab.new' }); close(); }, 'Ctrl T')}{row(tr("browsermenu.newPrivateTab"), PrivateWindow, () => { dispatch({ type: 'tab.new', privacy: 'private' }); close(); })}{isTorSupported() && row(tr("browsermenu.newTorTab"), TorGlyph, () => { dispatch({ type: 'tab.new', privacy: 'tor' }); close(); })}<hr/>{row(tr("browsermenu.newWindow"), PanelTop, () => { runtime.openWindow('normal'); close(); }, 'Ctrl N')}{row(tr("browsermenu.newPrivateWindow"), PrivateWindow, () => { runtime.openWindow('private'); close(); }, 'Ctrl Shift N')}{isTorSupported() && row(tr("browsermenu.newTorWindow"), TorGlyph, () => { runtime.openWindow('tor'); close(); }, isMac() ? 'Cmd Alt N' : 'Alt Shift N')}<hr/>{row(tr("browsermenu.reopenClosedTab"), History, () => { dispatch({ type: 'tab.restore' }); close(); }, 'Ctrl Shift T')}{(profilesAsSpaces(state) || windowWorkspaces(state).length > 0 && windowWorkspaces(state).length < MAX_WORKSPACES) && <><hr/>{row(tr(profilesAsSpaces(state) ? 'profiles.add' : 'workspaces.new'), Plus, () => { close(); if (profilesAsSpaces(state)) openSettings(state, dispatch, { section: 'Profiles', intent: 'add-profile' }); else setTimeout(() => openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'new' }), 0); })}</>}{state.settings.verticalTabs && <><hr/>{sectionActions(row, sidebarWindowId(state), 'tabs', close)}</>}</>}
 {kind === 'toolbar-context' && <>{bookmarkControl(state,tab).available && row(bookmarkControl(state,tab).saved ? tr("app.removeBookmark") : tr("app.bookmarkThisPage"), Star, () => { dispatch({ type: 'bookmark.toggle', url: tab.url }); close(); }, 'Ctrl D')}{toolbarVisibilityItems(s, tab).map(item => <MenuToggle key={item.id} icon={toolbarItemIcons[item.id]} label={item.label} on={item.checked} shortcut={item.shortcut && formatShortcut(item.shortcut)} onToggle={() => dispatch(item.action)}/>)}{row(tr("app.allBookmarks"), Star, () => onOpen?.('bookmarks'))}<hr/>{windowViews.map(mode => <MenuChoice key={mode} icon={windowViewGlyph[mode]} label={windowViewName(mode)} shortcut={mode === 'focus' ? shortcutFor('focus-mode', 'Ctrl Shift F') : mode === 'seamless' ? shortcutFor('seamless-mode', 'Ctrl Shift L') : undefined} on={effectiveView(s, state.windowUi) === mode} onChoose={() => { dispatch({ type: 'settings.update', patch: { windowView: mode } }); }}/>)}<hr/>{row(tr("app.customizeToolbar"), SlidersHorizontal, () => onOpen?.('customize-toolbar'))}{row(tr("app.customizeAppearance"), Contrast, () => onOpen?.('appearance'))}</>}
 {kind === 'customize-toolbar' && <ToolbarCustomizer profileId={tab.browserProfileId} settings={s} tab={tab} reduced={s.reducedMotion} dispatch={dispatch}/>}
 {kind === 'bookmark-edit' && <BookmarkEditor state={state} url={contextId} dispatch={dispatch} close={close}/>}{kind === 'favorite-edit' && <FavoriteEditor state={state} dispatch={dispatch} close={close}/>}{kind === 'workspace-menu' && <WorkspaceMenu state={state} dispatch={dispatch} close={close} mode="list"/>}{kind === 'workspace-context' && <WorkspaceMenu state={state} dispatch={dispatch} close={close} mode="context"/>}{kind === 'workspace-edit' && (profilesAsSpaces(state) ? <NewSpace state={state} dispatch={dispatch} close={close}/> : <WorkspaceEditor state={state} dispatch={dispatch} close={close}/>)}{kind === 'bookmark-context' && <BookmarkMenu state={state} dispatch={dispatch} target={contextId} row={row} close={close} navigate={url => { onNavigate(url); close(); }}/>}
 {kind === 'split' && state.tabs.filter(t => t.id !== tab.id).map(t => <button className="tab-result" key={t.id} onClick={() => onSplit(t.id)}><SiteIcon url={t.url} privacy={shownPrivacy(t)} error={!!t.error}/><span>{t.title}</span></button>)}
 {kind === 'find' && <div className="find-row"><Search size={16}/><input autoFocus aria-label={tr("browsermenu.findInPage")} placeholder={tr("browsermenu.findInPage")} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') {
        e.preventDefault(); void runtime.browserCommand({ type: 'find', tabId: tab.id, text: query, findNext: true, forward: !e.shiftKey }); }
    else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); closeFind(); } }}/><span className="find-count" aria-live="polite">{query.trim() ? findResult : ''}</span><IconButton label={tr("app.previousMatchShiftEnter")} disabled={!query.trim() || findResult === 'No matches'} onClick={() => void runtime.browserCommand({ type: 'find', tabId: tab.id, text: query, findNext: true, forward: false })}><ChevronDown size={16} style={{ transform: 'rotate(180deg)' }}/></IconButton><IconButton label={tr("app.nextMatchEnter")} disabled={!query.trim() || findResult === 'No matches'} onClick={() => void runtime.browserCommand({ type: 'find', tabId: tab.id, text: query, findNext: true })}><ChevronDown size={16}/></IconButton><IconButton label={tr("app.closeFindEsc")} onClick={closeFind}><X size={16}/></IconButton></div>}
 {kind === 'downloads' && <DownloadsPanel state={state} close={close} onSeeAll={() => openPage('acira://downloads')}/>}
 {kind === 'recent-closed' && <RecentlyClosed state={state} dispatch={dispatch} close={close} onNavigate={onNavigate}/>}
 </>}</ScrollRegion>{kind === 'tabs' && (s.tabViewerDensity ?? 'comfortable') === 'comfortable' && <div ref={footerRef} className="popup-fixed-footer">{row(tr("browsermenu.newTab"), Plus, () => { dispatch({ type: 'tab.new' }); close(); }, 'Ctrl T')}</div>}{kind === 'palette' && <div ref={footerRef} className="popup-fixed-footer popup-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>{tr("app.navigate")}</span><span><kbd>↵</kbd>{tr("app.open")}</span><span><kbd>{tr("app.esc")}</kbd>{tr("app.close")}</span></div>}</div>;
}
