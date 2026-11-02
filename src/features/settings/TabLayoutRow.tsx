import { ChoiceCards, MiniBrowser, type MiniLayout } from './ChoiceCards';
import { SettingRow } from './controls';
import { t } from '../../i18n';

/** The Tabs choice (R4-56): along the top, or in a sidebar. One component, two places: Appearance › Layout (where people look
 * first) and the top of Tabs (where the sidebar's other options live). Both show the SAME setting (`verticalTabs`, written by
 * `onChange` together with the per-profile rail switch), the same registry id and the same words as the menu and Make it
 * yours: "Tabs", "Along the top", "In a sidebar". Only one section renders at a time, so the anchor is never duplicated. */
export function TabLayoutRow({ layout, onChange, columns }: { layout: MiniLayout; onChange: (layout: MiniLayout) => void; /** Card width in columns of a 4-up row: Appearance passes 4 so the two cards match the Window view cards under them; Tabs leaves the default (two large cards). */ columns?: number }) {
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
        ]}
      />
    </SettingRow>
  );
}
