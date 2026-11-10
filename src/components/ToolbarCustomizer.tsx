import { Reorder, useDragControls } from 'motion/react';
import { useRef, useState } from 'react';
import type { BrowserAction, Settings, TabSession } from '../runtime/types';
import '../styles/toolbar-customize.css';
import { aciraSpring } from '../ui/motion';
import { motionScale } from '../ui/sharedMotion';
import { toolbarVisibilityItems } from '../ui/toolbarMenu';
import { moveToolbarItem, resetToolbarItems, setToolbarItems, toolbarItemLabels, useToolbarItems, type ToolbarItem, type ToolbarItemId } from '../ui/toolbarPrefs';
import { ArrowUp } from './AppIcons';

import { t } from '../i18n';
type Dispatch = (action: BrowserAction) => void;

function Row({ item, index, count, reduced, onToggle, onMove, onDragEnd }: { item: ToolbarItem; index: number; count: number; reduced: boolean; onToggle: () => void; onMove: (delta: number) => void; onDragEnd: () => void }) {
  const controls = useDragControls(), label = toolbarItemLabels[item.id];
  return <Reorder.Item as="li" value={item} data-item={item.id} dragListener={false} dragControls={controls} onDragEnd={onDragEnd} transition={aciraSpring(reduced, motionScale() > 0 ? 1 / motionScale() : 1)} className="toolbar-customize-row" data-hidden={!item.visible || undefined}
    onKeyDown={event => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); onMove(event.key === 'ArrowUp' ? -1 : 1); } }}>
    <span className="toolbar-customize-grip" aria-hidden="true" onPointerDown={event => controls.start(event)}/>
    <label className="toolbar-customize-check" title={label}><input type="checkbox" checked={item.visible} onChange={onToggle} aria-describedby="toolbar-customize-hint"/><span>{label}</span></label>
    <button type="button" className="toolbar-customize-move" aria-label={t("toolbarcustomizer.moveLabelLeft", { label: label })} title={t("toolbarcustomizer.moveLeftAltUp")} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14}/></button>
    <button type="button" className="toolbar-customize-move down" aria-label={t("toolbarcustomizer.moveLabelRight", { label: label })} title={t("toolbarcustomizer.moveRightAltDown")} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowUp size={14}/></button>
  </Reorder.Item>;
}

/** Show, hide and order the optional toolbar buttons. Changes apply live; the Acira menu always stays. */
export function ToolbarCustomizer({ profileId, settings, tab, reduced, dispatch }: { profileId: string; settings: Settings; tab: Pick<TabSession, 'url' | 'contentKind'>; reduced: boolean; dispatch: Dispatch }) {
  const saved = useToolbarItems(profileId), [dragging, setDragging] = useState<ToolbarItem[] | null>(null), list = useRef<HTMLUListElement>(null);
  const items = dragging || saved;
  const save = (next: ToolbarItem[]) => setToolbarItems(next, profileId);
  const move = (id: ToolbarItemId, delta: number) => {
    save(moveToolbarItem(items, id, delta));
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>(`[data-item="${id}"] input`)?.focus());
  };
  const builtins = toolbarVisibilityItems(settings, tab).filter(item => item.id !== 'toolbarLayout');
  return <div className="toolbar-customize">
    <p className="toolbar-customize-hint" id="toolbar-customize-hint">{t("toolbarcustomizer.dragToReorderOrUse")}</p>
    <Reorder.Group as="ul" axis="y" values={items} onReorder={next => setDragging(next)} ref={list} className="toolbar-customize-list" aria-label={t("toolbarcustomizer.toolbarButtons")}>
      {items.map((item, index) => <Row key={item.id} item={item} index={index} count={items.length} reduced={reduced}
        onToggle={() => save(items.map(entry => entry.id === item.id ? { ...entry, visible: !entry.visible } : entry))}
        onMove={delta => move(item.id, delta)} onDragEnd={() => { if (dragging) save(dragging); setDragging(null); }}/>)}
    </Reorder.Group>
    <p className="popup-label">{t("toolbarcustomizer.alsoInTheToolbar")}</p>
    <ul className="toolbar-customize-list">
      {builtins.map(item => <li key={item.id} className="toolbar-customize-row fixed"><label className="toolbar-customize-check"><input type="checkbox" checked={item.checked} onChange={() => dispatch(item.action)}/><span>{item.label.replace(/^Show /, '').replace(/^./, c => c.toUpperCase())}</span></label></li>)}
    </ul>
    <div className="toolbar-customize-footer"><span>{t("toolbarcustomizer.theAciraMenuAlwaysStays")}</span><button type="button" className="toolbar-customize-reset" onClick={() => { resetToolbarItems(profileId); dispatch({ type: 'settings.update', patch: { showHome: true, showTabOverview: true, showZoomIcon: true, showBookmarkStar: true } }); }}>{t("browsersettings.reset")}</button></div>
  </div>;
}
