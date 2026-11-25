/**
 * Beta 14.4 (battery): the popup layer (the interface's `view=overlay` page) renders main's state only while it shows a popup.
 * Main sends every state change to every view, the layer too (the message is cheap and the layer always holds current facts). While the layer shows nothing,
 * rendering each change is work nobody can see, so it keeps only the newest one; the moment a popup opens, that held state is applied in the same task as the
 * popup's layout (desktop/main.cjs placeHost sends the layout in one message), so React renders the two together, once: the popup's first frame already has
 * current facts and comes no later. A changed setting is rendered at once (a language loads its strings, the appearance and the scale change what it draws), as before.
 * (Replaces the 14.4 state gate in main, earlier work: that one sent the held state first INSIDE the open, two messages and two renders before
 * the popup's first frame; measured 24 Nov: All open tabs 1.5 ms later at the median.)
 */
type WithSettings = { settings?: unknown } | null | undefined;
export const settingsKeyOf = (state: WithSettings): string => JSON.stringify(state?.settings ?? null);
/** Whether the layer keeps this state instead of rendering it: it shows no popup, and the settings are the ones it last rendered. */
export function overlayHolds(showing: boolean, lastSettingsKey: string, next: WithSettings): boolean {
  return !showing && settingsKeyOf(next) === lastSettingsKey;
}
