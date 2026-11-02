import type { BrowserAction, BrowserSnapshot, TabSession } from "../runtime/types";

export interface SettingsView {
  section: string;
  query: string;
  name: string;
  scrollTop: number;
  zoomTargetTabId?:string;
  /** Unsent text in Settings fields, kept while this Settings tab is in the background. */
  drafts: Record<string, string>;
  /** Something to do once the section shows (not just where to land): taken, once, by the control that does it. */
  intent?: SettingsIntent;
}
const views = new Map<string, SettingsView>();
export const settingsViewKey = (tab: TabSession) =>
  `${tab.browserProfileId}/${tab.id}`;
export function settingsView(key: string): SettingsView {
  let view = views.get(key);
  if (!view) {
    view = { section: "Appearance", query: "", name: "", scrollTop: 0, drafts: {} };
    views.set(key, view);
  }
  return view;
}
export function retainSettingsViews(tabs: TabSession[]) {
  const keys = new Set(
    tabs.filter((tab) => tab.url === "acira://settings").map(settingsViewKey),
  );
  for (const key of views.keys()) if (!keys.has(key)) views.delete(key);
}

/** What Settings should do on arrival, beyond landing: "add-profile" opens the add-profile form with its name field focused. */
export type SettingsIntent = "add-profile";
/** The section each intent happens in. */
export const settingsIntentSection: Record<SettingsIntent, string> = { "add-profile": "Profiles" };
const intentIds = Object.keys(settingsIntentSection) as SettingsIntent[];
/** Where to land when Settings opens: a section, and optionally one control inside it (a registry id) or an intent. */
export interface SettingsTarget { section?: string; setting?: string; intent?: SettingsIntent }
export interface SettingsDestination { windowId: string; tabId: string }
const previewWindowId = `preview-${crypto.randomUUID()}`;
/** Native window identity is shared by its chrome and popup renderers. Preview has only one renderer. */
export function settingsDestination(tabId: string, windowId?: string): SettingsDestination {
  return { windowId: windowId || (typeof window === 'undefined' ? undefined : window.acira?.initialSnapshot?.windowId) || previewWindowId, tabId };
}
const targetKey = (destination: SettingsDestination) => `acira-settings-target:${encodeURIComponent(destination.windowId)}:${encodeURIComponent(destination.tabId)}`;
const targetListeners = new Map<string, Set<() => void>>();
const notifyTarget = (key: string) => targetListeners.get(key)?.forEach(listener => listener());
/** Popups and Settings share storage, but only the intended window and tab can consume an arrival. Old contextless
 *  requests are ignored: broadcasting one would let another visible Settings window steal it. */
export function requestSettingsTarget(target: SettingsTarget, destination?: SettingsDestination) {
  if (!destination) return;
  const key = targetKey(destination);
  try { localStorage.setItem(key, JSON.stringify({ ...target, at: Date.now() })); } catch { /* the plain open still works */ }
  notifyTarget(key);
}
/** Give a Settings-opening command an explicit destination before it goes through its normal dispatch path. */
export function settingsTargetAction(action: BrowserAction, target: SettingsTarget): BrowserAction {
  if (action.type !== 'tab.new' || action.url !== 'acira://settings') return action;
  const id = action.id || `tab-${crypto.randomUUID()}`;
  requestSettingsTarget(target, settingsDestination(id));
  return { ...action, id };
}
/** Open Settings (this profile's existing tab, else a new one) and land on a section or control. */
export function openSettings(state: BrowserSnapshot, dispatch: (action: BrowserAction) => void, target?: SettingsTarget) {
  const profileId = state.tabs.find((tab) => tab.id === state.activeTabId)?.browserProfileId || state.activeBrowserProfileId;
  const existing = state.tabs.find((tab) => tab.url === "acira://settings" && tab.browserProfileId === profileId);
  const id = existing?.id || `tab-${crypto.randomUUID()}`, destination = settingsDestination(id, state.windowId);
  if (target) requestSettingsTarget(target, destination);
  if (existing) dispatch({ type: "tab.select", id: existing.id });
  else dispatch({ type: "tab.new", url: "acira://settings", id });
  notifyTarget(targetKey(destination));
}
/** The pending target, once: stale ones (older than eight seconds) are dropped. */
export function takeSettingsTarget(destination?: SettingsDestination): SettingsTarget | null {
  if (!destination) return null;
  try {
    const key = targetKey(destination), raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    const value = JSON.parse(raw) as SettingsTarget & { at?: number };
    if (typeof value.at !== "number" || !Number.isFinite(value.at) || Date.now() - value.at > 8000 || value.at > Date.now()) return null;
    return {
      section: typeof value.section === "string" ? value.section : undefined,
      setting: typeof value.setting === "string" ? value.setting : undefined,
      // Only present when an intent was asked for, so plain arrivals keep their exact shape.
      ...(intentIds.includes(value.intent as SettingsIntent) ? { intent: value.intent } : {}),
    };
  } catch { return null; }
}
const intentListeners = new Set<() => void>();
/** Leave an intent on this Settings tab's view and wake whoever is already showing the control; a control that mounts
 *  later (the section is still switching) finds it with takeSettingsIntent. */
export function raiseSettingsIntent(key: string, intent: SettingsIntent) {
  settingsView(key).intent = intent;
  intentListeners.forEach((listener) => listener());
}
/** True once for a raised intent; the control that does the thing calls it. */
export function takeSettingsIntent(key: string, intent: SettingsIntent): boolean {
  const view = views.get(key);
  if (!view || view.intent !== intent) return false;
  view.intent = undefined;
  return true;
}
export function onSettingsIntent(listener: () => void) {
  intentListeners.add(listener);
  return () => { intentListeners.delete(listener); };
}
export function onSettingsTarget(listener: () => void, destination?: SettingsDestination) {
  if (!destination) return () => {};
  const key = targetKey(destination), listeners = targetListeners.get(key) || new Set<() => void>();
  const storage = (event: StorageEvent) => { if (event.key === key && event.newValue) listener(); };
  listeners.add(listener);
  targetListeners.set(key, listeners);
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); if (!listeners.size) targetListeners.delete(key); window.removeEventListener("storage", storage); };
}
