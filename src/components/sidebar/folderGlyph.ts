/** The geometry of the sidebar's group folder on the 16 px grid (GroupFolderGlyph.tsx draws it, sidebar.css moves it; tests/group-folder-glyph.test.ts keeps the two in step). */
export const FOLDER_MAX_SHEETS=3;
/** Sheets drawn for a group of this many tabs: 0 for none, 1 for one tab, up to three. */
export const folderSheets=(tabs:number)=>Math.max(0,Math.min(FOLDER_MAX_SHEETS,Math.floor(Number.isFinite(tabs)?tabs:0)));
/** Closed boxes on the 16 px grid, by depth (0 = nearest the front plate). The one behind shows most and is the narrowest, like a
 *  stack seen from the front; each sheet in front is wider. A sheet's bottom edge hides 2.3 units behind the front plate. */
export const FOLDER_SHEET_BOXES=[{x:2.7,y:5.15,w:10.6,h:3.85},{x:3.3,y:4,w:9.4,h:5},{x:3.9,y:2.85,w:8.2,h:6.15}] as const;
export const FOLDER_BACK='M1.2 4.5Q1.2 3.3 2.4 3.3L5.01 3.3Q6 3.3 6.65 4.05L6.65 4.05Q7.3 4.8 8.29 4.8L13.6 4.8Q14.8 4.8 14.8 6L14.8 12.4Q14.8 13.6 13.6 13.6L2.4 13.6Q1.2 13.6 1.2 12.4Z';
/** Closed and open front plates (and the highlight along their top edges) have the same commands, so CSS can transition `d`. */
export const FOLDER_FRONT_CLOSED='M1.2 7.95Q1.2 6.7 2.45 6.7L13.55 6.7Q14.8 6.7 14.8 7.95L14.8 12.35Q14.8 13.6 13.55 13.6L2.45 13.6Q1.2 13.6 1.2 12.35Z';
export const FOLDER_FRONT_OPEN='M2.21 7.72Q2.5 6.5 3.75 6.5L13.95 6.5Q15.2 6.5 14.93 7.72L13.87 12.38Q13.6 13.6 12.35 13.6L2.05 13.6Q0.8 13.6 1.09 12.38Z';
export const FOLDER_SHEEN_CLOSED='M2.9 7.75L13.1 7.75';
export const FOLDER_SHEEN_OPEN='M4.2 7.55L13.5 7.55';
