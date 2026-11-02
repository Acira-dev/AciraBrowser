import type { BrowserStyle,Rectangle } from '../runtime/types';

/** Target geometry used before DOM measurements; the layout coordinator follows measured pane bounds during motion. */
export function browserGeometry(input: {
  width: number; height: number; headerHeight: number; style: BrowserStyle;
  focus: boolean; sidebarWidth: number; split: boolean; splitRatio?:number; splitGap?:number; cardInset?:number;
}) {
  // The white study uses flush reading surfaces. Match the measured DOM even
  // before its first layout publication, with no legacy card margin.
  const inset = 0;
  const x = input.sidebarWidth + inset;
  // With the sidebar open the page is a card inset from the window's right and bottom edges (G, benchmark §2 #1).
  const card = input.cardInset ?? 0;
  const page: Rectangle = {
    x, y: input.headerHeight + inset,
    width: Math.max(0, input.width - x - inset - card),
    height: Math.max(0, input.height - input.headerHeight - inset * 2 - card),
  };
  const splitHeader = input.split ? 32 : 0;
  const gap=input.split?input.splitGap??1:0,ratio=Math.max(.2,Math.min(.8,input.splitRatio??.5));
  const firstWidth = input.split ? Math.floor((page.width - gap) * ratio) : page.width;
  const views: Rectangle[] = [{x: page.x, y: page.y + splitHeader, width: firstWidth, height: Math.max(0, page.height - splitHeader)}];
  if (input.split) views.push({x: page.x + firstWidth + gap, y: page.y + splitHeader, width: page.width - firstWidth - gap, height: Math.max(0, page.height - splitHeader)});
  return {page, views};
}
