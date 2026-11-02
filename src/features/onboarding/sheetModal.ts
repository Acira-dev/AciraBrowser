import { useEffect } from "react";

/** While a sheet covers the card, everything else in the card is inert: Tab and screen readers stay in the sheet. */
export function useSheetModal(card: HTMLElement | null) {
  useEffect(() => {
    if (!card) return;
    const others = [...card.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains("fr-sheet"));
    for (const child of others) child.inert = true;
    // The step beneath fades out while a sheet is up, so the sheet can be the card's own glass instead of a solid slab (R3-06).
    card.setAttribute("data-sheet", "");
    return () => {
      for (const child of others) child.inert = false;
      card.removeAttribute("data-sheet");
    };
  }, [card]);
}
