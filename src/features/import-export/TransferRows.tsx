// Settings › Import & export, beta.14 (spec 4.1): the "Another computer" group (Send this profile, Receive a profile) and the two profile-file rows of the Files group
// (Save profile file…, Open profile file…). Same row look as the Files group (`.aip-file-row`); each opens the transfer sheet on its side. No hooks here, so the rows can be called and clicked in tests.
import { t } from '../../i18n';
import { openTransferSheet } from '../transfer/client';
import { useSendLive } from '../transfer/useSendLive';
import type { TransferIntent } from '../transfer/types';
import '../transfer/transfer.css';

type Open = (intent: TransferIntent) => void | Promise<void>;
const openSheet: Open = intent => { void openTransferSheet(intent).catch(() => {}); };

/** The small live dot after "Send this profile" while a send is waiting (spec 4.1). */
export function LiveDot({ live }: { live: boolean }) {
  return live ? <i className="aip-dot" role="img" aria-label={t('transfer.live')} /> : null;
}
/** Its own component, so a status nudge re-renders the dot and not the panel. */
export function SendLiveDot() { return <LiveDot live={useSendLive()} />; }

/** The new first group. `disabled`: an import is running, or this is a private window (the same rule as every button in the Files group). */
export function AnotherComputerGroup({ disabled, privateWindow = false, open = openSheet }: { disabled: boolean; /** No status is read in a private window: nothing can be sent from there. */ privateWindow?: boolean; open?: Open }) {
  return <div className="aip-section">
    <header className="aip-header"><h2 className="aip-heading">{t('transfer.settings.group')}</h2></header>
    <div className="aip-file-row" data-setting="transfer-send">
      <div><h3>{t('transfer.settings.send')}{!privateWindow && <SendLiveDot />}</h3><p className="aip-copy">{t('transfer.settings.sendDesc')}</p></div>
      <button type="button" className="aip-button" disabled={disabled} onClick={() => void open('send')}>{t('transfer.settings.sendBtn')}</button>
    </div>
    <div className="aip-file-row" data-setting="transfer-receive">
      <div><h3>{t('transfer.settings.receive')}</h3><p className="aip-copy">{t('transfer.settings.receiveDesc')}</p></div>
      <button type="button" className="aip-button" disabled={disabled} onClick={() => void open('receive')}>{t('transfer.settings.receiveBtn')}</button>
    </div>
  </div>;
}

/** The first two rows of the Files group: the profile file in one file, saved or opened (a file from before beta.14 and a bookmarks file open here too). */
export function ProfileFileRows({ disabled, open = openSheet }: { disabled: boolean; open?: Open }) {
  return <>
    <div className="aip-file-row" data-setting="profile-file-save">
      <div><h3>{t('transfer.file.save.title')}</h3><p className="aip-copy">{t('transfer.file.saveDesc')}</p></div>
      <button type="button" className="aip-button" disabled={disabled} onClick={() => void open('file-save')}>{t('transfer.file.save')}</button>
    </div>
    <div className="aip-file-row" data-setting="profile-file-open">
      <div><h3>{t('transfer.file.open.title')}</h3><p className="aip-copy">{t('transfer.file.openDesc')}</p></div>
      <button type="button" className="aip-button" disabled={disabled} onClick={() => void open('file-open')}>{t('transfer.file.open')}</button>
    </div>
  </>;
}
