import { DotMatrix } from '../../components/DotMatrix';
import { isTorSupported } from '../../ui/platform';
import { runtime } from '../../runtime/client';
import '../../components/PanelParts.css';
import './private-new-tab.css';
import { t, useT } from '../../i18n';

/** A private tab opens on its own page, the sibling of the Tor page: same column, a deep teal graphite surface in light and dark
 *  alike, the classic dot matrix swept clean, what Acira will not keep and what can still see you. It never shows links built from history. */
export function PrivateNewTab({ onNavigate: _onNavigate, reducedMotion }: { onNavigate: (url: string) => void; reducedMotion: boolean }) {
  useT();
  return <main className="pvt-page" aria-labelledby="pvt-title">
    <div className="pvt-column">
      <span className="pvt-glyph"><DotMatrix preset="private" size={48} tone="ink" reducedMotion={reducedMotion} label={t('pvt.title')} /></span>
      <h1 id="pvt-title" className="display-page">{t('pvt.title')}</h1>
      <p className="lede pvt-lede">{t('pvt.lede')}</p>
      <div className="pvt-cols">
        <section aria-labelledby="pvt-keep"><h2 id="pvt-keep">{t('pvt.keepTitle')}</h2><ul><li>{t('pvt.history')}</li><li>{t('pvt.cookies')}</li><li>{t('pvt.forms')}</li></ul></section>
        <section aria-labelledby="pvt-see"><h2 id="pvt-see">{t('pvt.seeTitle')}</h2><ul><li>{t('pvt.sites')}</li><li>{t('pvt.network')}</li><li>{t('pvt.files')}</li></ul></section>
      </div>
      <div className="pvt-row"><span id="pvt-cookies">{t('pvt.thirdParty')}<small>{t('pvt.alwaysBlocked')}</small></span>
        <button type="button" role="switch" aria-checked="true" aria-labelledby="pvt-cookies" className="shields-switch" disabled><span /></button></div>
      {isTorSupported() && <p className="pvt-foot"><button type="button" className="pvt-link" onClick={() => { void runtime.dispatch({ type: 'tab.new', privacy: 'tor' }); }}>{t('pvt.tor')}</button></p>}
    </div>
  </main>;
}
