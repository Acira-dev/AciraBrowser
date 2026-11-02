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
