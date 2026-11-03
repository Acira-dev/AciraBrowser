/** What the update panel shows at the moment, as last read by this page: the download (running or paused) or the finished one. The popup system
 *  sizes and names the 'update' panel from it before the panel has measured itself (popup.ts, App.tsx); useUpdateReady keeps it current. */
export type UpdatePanelPhase = 'downloading' | 'paused' | 'ready';
let phase: UpdatePanelPhase = 'ready';
export const noteUpdatePhase = (next: UpdatePanelPhase) => { phase = next; };
export const updatePanelPhase = (): UpdatePanelPhase => phase;
