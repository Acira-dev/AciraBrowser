import { ChoiceCards, MiniBrowser, type MiniLayout } from './ChoiceCards';
import { SettingRow } from './controls';
import { t } from '../../i18n';

/** The Tabs choice (R4-56): along the top, in a sidebar, or in a sidebar with the address bar in it (Sidebar mode: Arc, Zen). One component, two places: Appearance › Layout (where people look
 * first) and the top of Tabs (where the sidebar's other options live). Both show the SAME choice (ui/sidebarMode.ts: `verticalTabs` and `addressInSidebar` read as one of three layouts, written
 * together with the per-profile rail switch and the morph), the same registry id and the same words as the menu and Make it
 * yours: "Tabs", "Along the top", "In a sidebar", "Sidebar + address". Only one section renders at a time, so the anchor is never duplicated. */
export function TabLayoutRow({ layout, onChange, columns }: { layout: MiniLayout; onChange: (layout: MiniLayout) => void; /** Card width in columns of a 4-up row: Appearance passes 4 so the three cards match the Window view cards under them; Tabs leaves the default (three cards across the row). */ columns?: number }) {
  return (
    <SettingRow id="sidebar-only-tabs" title={t('yours.tabs')} detail={t('settings.tabsDetail')} stacked>
      <ChoiceCards
        label={t('yours.tabs')}
        value={layout}
        onChange={onChange}
        columns={columns}
        options={[
          { value: 'toolbar', label: t('yours.tabsTop'), art: <MiniBrowser layout="toolbar" /> },
          { value: 'sidebar', label: t('yours.tabsSide'), art: <MiniBrowser layout="sidebar" /> },
          { value: 'sidebar-address', label: t('yours.tabsSideAddress'), art: <MiniBrowser layout="sidebar-address" /> },
        ]}
      />
    </SettingRow>
  );
}
