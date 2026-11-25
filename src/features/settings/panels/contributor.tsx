import { useState } from 'react';
import { feedbackAct, useFeedbackView } from '../../../runtime/feedback';
import { SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { t } from '../../../i18n';

/** Beta 14, Settings: the off switch (hides points, rank, ring, the aura and notes; points keep counting on our side and report status still works), "View ranks", and "Delete my contributor data"
 * (the points, rank and report list, here and on our side; the key and an Insider certificate stay (B5, 17 Nov); kept whole when we cannot be reached). Per profile: the profile of the tab Settings is open in. Nothing in a private window. */
function ContributorSettings(_props: SettingsPanelProps) {
  const view = useFeedbackView('settings'), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  if (view.privateOrTor || view.key === 'none') return null;
  const insider = view.insider.insider;   // B5: for an Insider, Delete keeps the key and the certificate, and the words say so
  const del = async () => {
    setBusy(true); setNote('');
    const result = await feedbackAct({ type: 'feedback.delete-data' });
    setBusy(false); setConfirm(false);
    setNote(result.ok ? t('feedback.settings.deleted') : t('feedback.settings.deleteFailed'));
  };
  return <SettingGroup title={t('feedback.settings.group')}>
    <SettingRow id="contributor-show" title={t('feedback.settings.show')} detail={t('feedback.settings.show.detail')}>
      <Switch checked={!view.off} label={t('feedback.settings.show')} onChange={on => void feedbackAct({ type: 'feedback.set-off', off: !on })}/>
    </SettingRow>
    <SettingRow id="contributor-ranks" title={t('feedback.settings.ranks')} detail={t('feedback.settings.ranks.detail')}>
      <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent('acira-open-popup', { detail: { kind: 'ranks' } }))}>{t('feedback.link.ranks')}</button>
    </SettingRow>
    <SettingRow id="contributor-delete" title={t('feedback.settings.delete')} detail={view.key === 'unreadable' ? t('feedback.settings.unreadable') : confirm ? t(insider ? 'feedback.settings.delete.confirm.insider' : 'feedback.settings.delete.confirm') : t(insider ? 'feedback.settings.delete.detail.insider' : 'feedback.settings.delete.detail')}>
      {confirm
        ? <span className="rewind-confirm"><button type="button" className="btn" disabled={busy} onClick={() => setConfirm(false)}>{t('ext.dlgCancel')}</button> <button type="button" className="btn danger" disabled={busy} onClick={() => void del()}>{t('feedback.settings.delete.do')}</button></span>
        : <button type="button" className="btn" onClick={() => { setNote(''); setConfirm(true); }}>{t('pwp.deleteEllipsis')}</button>}
    </SettingRow>
    {note && <SettingNote>{note}</SettingNote>}
  </SettingGroup>;
}
const panel: SettingsPanel = { section: 'Profiles', order: 20, Component: ContributorSettings };
export default panel;
