import { useRef } from 'react';
import { UpdateMark } from './UpdateMark';
import { ScrollRegion } from '../../components/ScrollRegion';
import { NoteList } from './NoteList';
import { t } from '../../i18n';
import { useWhatsNew } from './useUpdateReady';
import './update-pill.css';

/** The first launch on a new version, when the feed came with notes: "Acira updated to X" and what changed, once, centred in the window (the popup
 *  system's centred kind, like the tab viewer) in the same glass, rows and buttons as the update popup. The notes are plain text from the feed (main
 *  strips every tag); they scroll in the popup's own scroll region past 15 lines. One Close; Esc and a click on the page close it too. Without notes
 *  there is no popup at all: main shows a quiet toast instead. */
export function WhatsNewPopover({ close, reducedMotion }: { close: () => void; reducedMotion: boolean }) {
  const note = useWhatsNew(), notesBox = useRef<HTMLDivElement>(null);
  return (
    <div className="update-popover update-whatsnew" role="group" aria-labelledby="whatsnew-title" data-popup-pending={note ? undefined : ''}>
      <div className="acira-menu-row acira-menu-row-identity">
        <span className="acira-menu-icon update-pop-mark" aria-hidden="true"><UpdateMark panel preset="check" tone="accent" reducedMotion={reducedMotion} /></span>
        <span className="acira-menu-title" id="whatsnew-title">{note ? t('update.updatedTo', { version: note.version }) : t('update.whatsNew')}<span className="acira-menu-sub">{t('update.whatsNew')}</span></span><span />
      </div>
      <div className="update-pop-scroll"><ScrollRegion contentRef={notesBox}><div className="update-pop-notes" tabIndex={0} role="region" aria-label={t('update.whatsNew')}><NoteList notes={note?.notes ?? ''} /></div></ScrollRegion></div>
      <div className="update-pop-actions">
        <span className="update-pop-gap" />
        <button type="button" className="acira-button acira-button-primary" onClick={close}>{t('update.close')}</button>
      </div>
    </div>
  );
}
