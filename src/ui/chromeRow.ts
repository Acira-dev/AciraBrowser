/** R3-65: what each chrome mode puts in the top row, in one place (App renders from it; tests/chrome-row.test.ts pins every
 * combination of tab layout x Toolbar setting x Focus).
 *
 *  - Standard: the full chrome. Horizontal tabs get their own strip above the toolbar; the toolbar carries every button.
 *  - Compact:  "Everything stays, in one slimmer row." The same controls, tabs included, in one 32px row.
 *  - Focus:    "Only what you need to read and navigate." Back, the address field (always visible and editable), the
 *              sidebar button when tabs are in the sidebar, the menu and the way out. Bookmarks bar, extensions and
 *              other toolbar buttons hide, and the tab strip shrinks to its favicon chips. */
export type ChromeMode = 'standard' | 'compact' | 'focus';
export type ToolbarSetting = 'visible' | 'compact' | 'hidden';

/** Focus is the person's explicit choice and wins; Compact applies once the toolbar has tucked in; a reveal (Ctrl+Tab, Ctrl+T)
 * shows the full chrome for a moment. Hide-until-needed is independent of the mode (it only changes the row's height). */
export function chromeMode(input: { focus: boolean; toolbar: ToolbarSetting; engaged: boolean; reveal: boolean }): ChromeMode {
  const base: ChromeMode = input.focus ? 'focus' : input.toolbar === 'compact' && input.engaged ? 'compact' : 'standard';
  return input.reveal ? 'standard' : base;
}

export const compactRowHeight = 32;

export interface ChromeRow {
  /** The horizontal tab strip row above the toolbar (never when tabs live in the sidebar). */
  tabStrip: boolean;
  /** The favicon chips that replace the strip inside the one row (horizontal tabs only). */
  miniTabs: boolean;
  /** The toolbar button that shows or hides the sidebar (tabs in the sidebar); Focus keeps it. */
  sidebarToggle: boolean;
  navigation: boolean;
  /** The address field: present, visible and editable in every mode. */
  addressField: boolean;
  tabOverview: boolean;
  extensions: boolean;
  optionalButtons: boolean;
  overflow: boolean;
  /** The button that leaves Focus; Focus always shows it so the way out is never hidden by toolbar settings. */
  exitFocus: boolean;
  menu: boolean;
  bookmarksBar: boolean;
  /** Rows of chrome above the page, in CSS px (a standard toolbar with a strip is two rows). */
  height: number;
}

export function chromeRow(mode: ChromeMode, sidebarTabs: boolean, toolbarHeight: number, tabRowHeight: number): ChromeRow {
  const standard = mode === 'standard', focus = mode === 'focus';
  return {
    tabStrip: standard && !sidebarTabs,
    miniTabs: !standard && !sidebarTabs,
    sidebarToggle: sidebarTabs,
    navigation: true,
    addressField: true,
    tabOverview: standard ? sidebarTabs : !focus,
    extensions: !focus,
    optionalButtons: !focus,
    overflow: !focus,
    exitFocus: focus,
    menu: true,
    bookmarksBar: standard,
    height: standard ? toolbarHeight + (sidebarTabs ? 0 : tabRowHeight) : compactRowHeight,
  };
}
