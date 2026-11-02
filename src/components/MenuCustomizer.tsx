import { Reorder, useDragControls } from 'motion/react';
import { useRef, useState } from 'react';
import '../styles/toolbar-customize.css';
import '../styles/menu-customize.css';
import { aciraSpring } from '../ui/motion';
import { isDefaultMenuLayout, menuItemLabel, menuSections, moveMenuItem, moveMenuItemToList, reorderMenuList, resetMenuLayout, setMenuItemHidden, setMenuLayout, useMenuLayout, type MenuItemId, type MenuLayout, type MenuList } from '../ui/menuPrefs';
import { ArrowUp, ChevronLeft, ChevronRight } from './AppIcons';
import { t } from '../i18n';

function Row({ id, list, index, count, reduced, onToggle, onMove, onSwitch, onDragEnd }: { id: MenuItemId; list: MenuList; index: number; count: number; reduced: boolean; onToggle: () => void; onMove: (delta: number) => void; onSwitch: () => void; onDragEnd: () => void }) {
  const controls = useDragControls(), label = menuItemLabel(id), other = list === 'main' ? t('browsermenu.moreTools') : t('menucustomizer.mainMenu');
  return <Reorder.Item as="li" value={id} data-item={id} dragListener={false} dragControls={controls} onDragEnd={onDragEnd} transition={aciraSpring(reduced)} className="toolbar-customize-row menu-customize-row"
    onKeyDown={event => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); onMove(event.key === 'ArrowUp' ? -1 : 1); } }}>
    <span className="toolbar-customize-grip" aria-hidden="true" onPointerDown={event => controls.start(event)}/>
    <label className="toolbar-customize-check" title={label}><input type="checkbox" checked onChange={onToggle}/><span>{label}</span></label>
    <button type="button" className="toolbar-customize-move" aria-label={t('menucustomizer.moveUp', { label })} title={t('menucustomizer.moveUpHint')} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14}/></button>
    <button type="button" className="toolbar-customize-move down" aria-label={t('menucustomizer.moveDown', { label })} title={t('menucustomizer.moveDownHint')} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowUp size={14}/></button>
    <button type="button" className="toolbar-customize-move menu-customize-switch" aria-label={list === 'main' ? t('menucustomizer.moveToMore', { label }) : t('menucustomizer.moveToMain', { label })} title={list === 'main' ? t('menucustomizer.toMore') : t('menucustomizer.toMain')} data-other={other} onClick={onSwitch}>{list === 'main' ? <ChevronRight size={14}/> : <ChevronLeft size={14}/>}</button>
  </Reorder.Item>;
}

/** What the menu will look like, drawn from the same composition the real one uses (rows as quiet lines, a hairline between groups). */
function Preview({ layout, list }: { layout: MenuLayout; list: MenuList }) {
  const ids = layout[list], fixed = list === 'main' ? [layout.more.length ? t('browsermenu.moreTools') : '', t('browsermenu.settings')].filter(Boolean) : [];
  return <div className="menu-preview" role="img" aria-label={`${list === 'main' ? t('menucustomizer.mainMenu') : t('browsermenu.moreTools')}: ${t('menucustomizer.preview')}`}>
    <div className="menu-preview-title">{list === 'main' ? t('menucustomizer.mainMenu') : t('browsermenu.moreTools')}</div>
    {menuSections(ids).map((section, index) => <div key={section[0]} className="menu-preview-group" data-first={index === 0 || undefined}>{section.map(id => <span key={id} className="menu-preview-row">{menuItemLabel(id)}</span>)}</div>)}
    {fixed.length > 0 && <div className="menu-preview-group" data-first={!ids.length || undefined}>{fixed.map(label => <span key={label} className="menu-preview-row" data-fixed>{label}</span>)}</div>}
    {!ids.length && !fixed.length && <span className="menu-preview-empty">{t('menucustomizer.empty')}</span>}
  </div>;
}

function ListEditor({ list, layout, reduced, save }: { list: MenuList; layout: MenuLayout; reduced: boolean; save: (next: MenuLayout) => void }) {
  const [dragging, setDragging] = useState<MenuItemId[] | null>(null), ref = useRef<HTMLUListElement>(null), items = dragging || layout[list];
  const focusRow = (id: MenuItemId) => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`.menu-customize [data-item="${id}"] input`)?.focus());
  return <section className="menu-customize-list" aria-label={list === 'main' ? t('menucustomizer.mainMenu') : t('browsermenu.moreTools')}>
    <p className="popup-label">{list === 'main' ? t('menucustomizer.mainMenu') : t('browsermenu.moreTools')}</p>
    {items.length === 0 && <p className="menu-customize-empty">{t('menucustomizer.empty')}</p>}
    <Reorder.Group as="ul" axis="y" values={items} onReorder={next => setDragging(next)} ref={ref} className="toolbar-customize-list">
      {items.map((id, index) => <Row key={id} id={id} list={list} index={index} count={items.length} reduced={reduced}
        onToggle={() => save(setMenuItemHidden(layout, id, true))}
        onMove={delta => { save(moveMenuItem(layout, id, delta)); focusRow(id); }}
        onSwitch={() => { save(moveMenuItemToList(layout, id, list === 'main' ? 'more' : 'main')); focusRow(id); }}
        onDragEnd={() => { if (dragging) save(reorderMenuList(layout, list, dragging)); setDragging(null); }}/>)}
    </Reorder.Group>
  </section>;
}

/** Settings › Appearance › Menu (R3-43): reorder the three-dots menu, move rows between the main menu and More tools, hide
 * or show them, reset. Same row pattern as Customize toolbar; changes apply live and belong to the profile. */
export function MenuCustomizer({ profileId, reduced }: { profileId: string; reduced: boolean }) {
  const layout = useMenuLayout(profileId), save = (next: MenuLayout) => setMenuLayout(next, profileId);
  return <div className="toolbar-customize menu-customize">
    <p className="toolbar-customize-hint" id="menu-customize-hint">{t('menucustomizer.hint')}</p>
    <div className="menu-customize-grid">
      <div className="menu-customize-lists">
        <ListEditor list="main" layout={layout} reduced={reduced} save={save}/>
        <ListEditor list="more" layout={layout} reduced={reduced} save={save}/>
        {layout.hidden.length > 0 && <section className="menu-customize-list" aria-label={t('menucustomizer.hidden')}>
          <p className="popup-label">{t('menucustomizer.hidden')}</p>
          <ul className="toolbar-customize-list">
            {layout.hidden.map(id => <li key={id} className="toolbar-customize-row menu-customize-row" data-hidden><label className="toolbar-customize-check" title={menuItemLabel(id)}><input type="checkbox" checked={false} onChange={() => save(setMenuItemHidden(layout, id, false))}/><span>{menuItemLabel(id)}</span></label></li>)}
          </ul>
        </section>}
      </div>
      <div className="menu-customize-previews" aria-hidden={false}>
        <Preview layout={layout} list="main"/>
        {layout.more.length > 0 && <Preview layout={layout} list="more"/>}
      </div>
    </div>
    <div className="toolbar-customize-footer"><span>{t('menucustomizer.footer')}</span><button type="button" className="toolbar-customize-reset" disabled={isDefaultMenuLayout(layout)} onClick={() => resetMenuLayout(profileId)}>{t('browsersettings.reset')}</button></div>
  </div>;
}
