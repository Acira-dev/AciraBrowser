/** A rectangle of the interface page, in CSS pixels. */
export interface AnchorBox { x: number; y: number; width: number; height: number }

/**
 * Where an extension's popup hangs when the browser asks for it (chrome.action.openPopup(), an extension's own shortcut) and there is no button of the extension to hang it from.
 * The Acira menu's button is the anchor when the toolbar has none to give: Focus view with the Top bar layout draws no extension buttons at all, and the menu button is where the
 * person already goes for extensions (More tools > Extensions). Otherwise the right end of the toolbar's extension buttons, 30 px wide, as before.
 */
export function popupAnchor({ menu, edge, viewportWidth }: { menu?: AnchorBox | null; edge?: { right: number; top: number; height: number } | null; viewportWidth: number }): AnchorBox {
  if (menu && menu.width > 0 && menu.height > 0) return { x: menu.x, y: menu.y, width: menu.width, height: menu.height };
  return { x: Math.max(0, (edge?.right ?? viewportWidth) - 30), y: edge?.top ?? 0, width: 30, height: edge?.height || 30 };
}
