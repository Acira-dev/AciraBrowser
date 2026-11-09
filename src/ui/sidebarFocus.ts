import { useLayoutEffect } from 'react';

let pending: {expanded: boolean; requested: number} | undefined;
function restoreFocus() {
  if(!pending)return;
  if(performance.now()-pending.requested>1000){pending=undefined;return;}
  const label = pending.expanded ? 'Collapse sidebar' : 'Expand sidebar';
  const button=Array.from(document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`))
    .find(button => !button.closest('[inert]') && button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden');
  if(button){button.focus({preventScroll:true});pending=undefined;}
}

/** Native dispatch is asynchronous; focus only after its new header has committed. */
export function focusSidebarControl(expanded: boolean) {
  pending={expanded,requested:performance.now()};
}

export function useSidebarFocus(expanded: boolean, mode: string) {
  useLayoutEffect(restoreFocus,[expanded,mode]);
}

/** What `keepTabFocus` needs from the page; the real one is `tabFocusEnvironment`. */
export interface TabFocusEnvironment {find:(id:string)=>{focus:()=>void}|null;active:()=>unknown;body:unknown;now:()=>number;frame:(run:()=>void)=>void}
/** Alt+Shift+Up/Down moves a tab row and the keyboard stays on it, so the next press moves it again. A move inside one list keeps the row's element
 *  (and its focus); a move into or out of a tab group puts the row under another parent, so the page builds a new element when the new order arrives
 *  (main answers a round trip later, not on the next frame) and the old one, which had the focus, goes: focus fell to the page and the keys did nothing
 *  until the row was clicked again. For a moment after the move, every frame: when focus has been lost to the page itself (and only then, never from
 *  something the person moved to), put it back on the row of that tab. */
export function keepTabFocus(id:string,env:TabFocusEnvironment,ms=800):void {
  const started=env.now();
  const tick=()=>{
    const row=env.find(id),active=env.active();
    if(row&&(active===null||active===undefined||active===env.body))row.focus();
    if(env.now()-started<ms)env.frame(tick);
  };
  env.frame(tick);
}
export const tabFocusEnvironment=():TabFocusEnvironment=>({find:id=>document.querySelector<HTMLElement>(`.acira-sidebar [data-tab-id="${id}"] .sb-tab-main`),active:()=>document.activeElement,body:document.body,now:()=>performance.now(),frame:run=>{requestAnimationFrame(run);}});

/** Delete on a focused tab row closes the tab, and its row goes: focus fell to the page and the arrow keys stopped. The row to move on to: the one below, else the one above. */
export const neighbourTabId=(ids:readonly string[],id:string):string|undefined=>{const at=ids.indexOf(id);return at<0?undefined:ids[at+1]??ids[at-1];};
/** The tab ids of the sidebar's rows as they read on screen (a split card's panes once each, hidden rows left out). */
export const listedTabIds=(root:ParentNode):string[]=>[...new Set([...root.querySelectorAll<HTMLElement>('.sb-tab[data-tab-id]')].filter(row=>!row.closest('[inert]')&&row.getClientRects().length).map(row=>row.dataset.tabId!))];
