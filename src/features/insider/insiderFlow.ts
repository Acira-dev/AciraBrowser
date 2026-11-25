import { insiderCall } from '../../runtime/feedback';

/** Beta 14: which screen the Insider pop-up opens on. The pop-up is one popup kind ('insider'); whoever opens it says first what it is for, and the pop-up takes the answer once when it mounts:
 *  welcome  the one-time Beta 14 welcome (Beta 14): its own pop-up kind `welcome`, see src/features/welcome (the flow name only tells it which way it starts)
 *  code     "Are you an Insider?" on its own (the profile viewer's "Enter Insider code", for an invite's code), then the seal and card when the code is accepted
 *  reveal   the same welcome screen, starting on the Gift step, for an Insider whose pass arrived after the welcome (the Insider build's activation had no answer yet), shown once
 *  invites  "Invite someone (N left)" and the codes made
 *  seal     the person's own seal, large, to look at closer (a click on it in the profile viewer): the full-window close-up on the Welcome's glass (src/features/welcome/Viewer.tsx), opened as the `welcome` pop-up kind
 *  card     the person's own member card, large, with its Share actions (the profile viewer's "Your card"): the same close-up, opened the same way
 *  activate the confirmation sheet of a personal Insider link (AH rule 4): ONLY main opens it, for a link (the interface cannot ask for it)
 * The answer is kept by main (insider-service.cjs flowSet/flowTake), not in the page: the pop-up is drawn in the overlay page, a page of its own, and the browser's own popup opening only carries ids of tabs. */
export type InsiderFlow = 'welcome' | 'code' | 'invites' | 'seal' | 'reveal' | 'activate' | 'card';
export const INSIDER_FLOWS: readonly InsiderFlow[] = ['welcome', 'code', 'invites', 'seal', 'reveal', 'activate', 'card'];
/** The flow a name stands for; anything else is the code screen. */
export const flowOf = (name?: string | null): InsiderFlow => (INSIDER_FLOWS as readonly string[]).includes(String(name)) ? (name as InsiderFlow) : 'code';
/** Tells main which screen the pop-up is about to open on; resolves when it is told (open the pop-up after). */
export const askInsider = (flow: Exclude<InsiderFlow, 'activate'>) => insiderCall({ type: 'insider.flow-set', flow }).catch(() => undefined);
/** Opens the Insider pop-up from the window's own page (App.tsx listens for it): main is told the screen first. */
export const openInsider = async (flow: Exclude<InsiderFlow, 'activate'>) => { await askInsider(flow); try { window.dispatchEvent(new CustomEvent('acira-open-popup', { detail: { kind: 'insider' } })); } catch { /* not in a page */ } };

/** Opens the Beta 14 welcome pop-up (kind `welcome`, src/features/welcome): 'welcome' is the one-time welcome, 'reveal' starts it on the Gift step. Main is told first, as for the Insider pop-up. `automatic`: the welcome host asked, not the person: if a welcome is already showing, nothing changes (App.tsx: an automatic open never toggles it closed, D146). */
export const openWelcome = async (flow: 'welcome' | 'reveal', automatic = false) => { await askInsider(flow); try { window.dispatchEvent(new CustomEvent('acira-open-popup', { detail: { kind: 'welcome', ...(automatic ? { automatic: true } : {}) } })); } catch { /* not in a page */ } };
