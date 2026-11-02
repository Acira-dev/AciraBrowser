import {useEffect,useLayoutEffect,useRef} from 'react';
import {Info,X} from '../../components/AppIcons';
import {useT} from '../../i18n';
import '../../components/setting-info.css';

/** The choice is already saved; this acknowledgment never delays or reverses it. */
export function UsageOffNotice({onClose}: {onClose: () => void}) {
  const t = useT();
  const notice=useRef<HTMLElement>(null);
  // Setup animates a transformed card. The native top layer keeps this acknowledgment
  // at the window edge without clipping it or taking keyboard focus from the choice.
  useLayoutEffect(()=>{notice.current?.showPopover();},[]);
  useEffect(() => { const timer = setTimeout(onClose, 12000); return () => clearTimeout(timer); }, [onClose]);
  return <aside ref={notice} popover="manual" className="usage-off-notice" role="status">
    <Info size={16} className="usage-off-glyph" aria-hidden="true"/>
    <p>{t('usage.offAcknowledgment')}</p>
    <button type="button" onClick={onClose} aria-label={t('app.close')}><X size={16}/></button>
  </aside>;
}
