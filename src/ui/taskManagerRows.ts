/** How many extension rows the Task manager last listed, so the pop-up's height can be counted before its next opening has a reading
 *  (ui/popup.ts; the same hand-off the toolbar overflow uses: ui/overflowRows.ts). Kept in this page's memory only; 0 until it has been opened once. No imports. */
let extensionRows = 0;
export const noteTaskManagerExtensions = (count: number): void => { extensionRows = Math.max(0, Math.floor(count) || 0); };
export const peekTaskManagerExtensions = (): number => extensionRows;
