import { useId, type ReactElement } from 'react';
import { ChoiceCards } from './ChoiceCards';
import { SettingRow } from './controls';
import { FAVORITES_ACROSS, SIDEBAR_SIZE_ORDER, SIDEBAR_SIZES, sizeOf, type SidebarSize } from '../../runtime/sidebarSizes';
import { SIZE_NAME_ID } from '../../ui/sidebarSizeNames';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { t } from '../../i18n';

/** The sidebar's width in the miniature, out of the 160px window it draws: Narrow, Standard and Wide in the same proportion as 168, 240 and 312 (stretched a little so the
 * three read apart at card size). */
const MINI_WIDTH: Record<SidebarSize, number> = { narrow: 40, standard: 52, wide: 66 };

/** A miniature in the drawing language of the Tabs cards (same wall, frame, sheet, page and ink classes, so it takes the live theme): the sidebar with two rows of
 * Favorites tiles, 2, 3 or 4 across, and a few tab bars under them. It is drawn as the sidebar layout, so it mirrors with the sidebar on the right (sidebar-right.css). */
function SizeMini({ size }: { size: SidebarSize }) {
  const id = useId().replace(/:/g, ''), sidebar = MINI_WIDTH[size], across = FAVORITES_ACROSS[size], left = 20, pad = 5, gap = 2.5;
  const tile = (sidebar - pad * 2 - gap * (across - 1)) / across, pageX = left + sidebar;
  const tiles: ReactElement[] = [];
  for (let row = 0; row < 2; row++) for (let column = 0; column < across; column++) tiles.push(<rect key={row + '-' + column} x={left + pad + column * (tile + gap)} y={21 + row * 10.5} width={tile} height="8.5" rx="2.2" className="cc-sheet" />);
  const barX = left + pad + 8;
  return <svg className="cc-svg" data-mini-layout="sidebar" viewBox="0 0 200 125" focusable="false" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient></defs>
    <rect width="200" height="125" className="cc-wall" />
    <rect width="200" height="125" fill={`url(#${id})`} />
    <rect x="18" y="19" width="164" height="100" rx="10" className="cc-shadow" opacity=".05" />
    <rect x="21" y="18.5" width="158" height="96" rx="7.5" className="cc-shadow" opacity=".1" />
    <rect x="20" y="14" width="160" height="97" rx="7.5" className="cc-frame" />
    {tiles}
    <path d={`M${left + pad} 47.25H${pageX - pad}`} className="cc-hair" />
    <path d={`M${left + pad + 2} 56h.01`} className="cc-dot cc-dot-accent" />
    <path d={`M${left + pad + 2} 66h.01M${left + pad + 2} 76h.01M${left + pad + 2} 86h.01`} className="cc-dot" />
    <path d={`M${barX} 56h${sidebar - 22}`} className="cc-bar cc-bar-strong" />
    <path d={`M${barX} 66h${sidebar - 27}M${barX} 76h${sidebar - 24}M${barX} 86h${sidebar - 30}`} className="cc-bar" />
    <rect x={pageX} y="20" width={176 - pageX} height="87" rx="5.5" className="cc-page" />
    <rect x={pageX + 14} y="22.5" width={176 - pageX - 28} height="9" rx="4.5" className="cc-field" />
    <path d={`M${pageX} 37.25H176`} className="cc-hair" />
    <path d={`M${pageX + 10} 50h${Math.min(34, 160 - pageX - 20)}`} className="cc-bar cc-bar-strong cc-page-ink" />
    <path d={`M${pageX + 10} 62h${Math.min(40, 166 - pageX - 24)}M${pageX + 10} 70h${Math.min(32, 160 - pageX - 24)}M${pageX + 10} 78h${Math.min(38, 164 - pageX - 24)}`} className="cc-bar cc-bar-page cc-page-ink" />
    <rect x={Math.max(pageX + 52, 124)} y="60" width="38" height="26" rx="5" className="cc-picture" />
    <rect x="20.25" y="14.25" width="159.5" height="96.5" rx="7.25" className="cc-rim" />
  </svg>;
}

/** Settings › Tabs › Sidebar › Sidebar size (item 32): Narrow, Standard or Wide as pictures, in the place the read-only Width row held. The same three sizes are one
 * right-click away on the sidebar's edge (components/sidebar/SizeMenu.tsx), and dragging the edge settles on the nearest one. */
export function SidebarSizeRow({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  return <SettingRow id="sidebar-size" title={t('sidebar.sizeTitle')} detail={t('sidebar.sizeDetail')} stacked>
    <ChoiceCards label={t('sidebar.sizeTitle')} value={sizeOf(state.settings.sidebarWidth)} columns={4}
      onChange={(size: SidebarSize) => dispatch({ type: 'settings.update', patch: { sidebarWidth: SIDEBAR_SIZES[size] } })}
      options={SIDEBAR_SIZE_ORDER.map((size) => ({ value: size, label: t(SIZE_NAME_ID[size]), art: <SizeMini size={size} /> }))} />
  </SettingRow>;
}
