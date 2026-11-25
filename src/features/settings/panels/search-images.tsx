import { useState } from 'react';
import type { BrowserAction, BrowserSnapshot, Settings } from '../../../runtime/types';
import { SettingGroup, SettingNote, SettingRow, Select } from '../controls';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';

/**
 * Beta 14 (Settings, Search): "Search images with", the service the right-click item "Search for this image" sends a picture to. There is no silent default: until a service is
 * chosen here or in the first-use chooser, nothing is sent anywhere. Custom takes an address with %s where the picture's address goes, and optional POST parameters (name=value
 * lines, %s again the picture's address), as Vivaldi's custom image search does. "Ask every time" shows the chooser each time.
 */
const SERVICES = [['lens', 'Google Lens'], ['tineye', 'TinEye'], ['yandex', 'Yandex'], ['bing', 'Bing']] as const;
const validAddress = (value: string, withParams: boolean) => {
  try { const url = new URL(value.replace('%s', 'x')); return url.protocol === 'https:' && !url.username && !url.password && (value.split('%s').length === 2 || (withParams && !value.includes('%s'))); } catch { return false; }
};

function SearchImages({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const s = state.settings, service = s.imageSearch || '';
  const update = (patch: Partial<Settings>) => dispatch({ type: 'settings.update', patch });
  const [address, setAddress] = useState<string | null>(null), [post, setPost] = useState<string | null>(null);
  const shownAddress = address ?? (s.imageSearchCustom || ''), shownPost = post ?? (s.imageSearchCustomPost || '');
  const withParams = shownPost.split(/\r?\n/).some(line => line.includes('=')), invalid = shownAddress.trim() !== '' && !validAddress(shownAddress.trim(), withParams);
  const options = [...(service === '' ? [{ value: '', label: t('imagesearch.optNone') }] : []), ...SERVICES.map(([value, label]) => ({ value, label })), { value: 'custom', label: t('imagesearch.optCustom') }, { value: 'ask', label: t('imagesearch.optAsk') }] as { value: Settings['imageSearch']; label: string }[];
  return (
    <>
      <SettingGroup title={t('imagesearch.groupTitle')}>
        <SettingRow id="image-search" title={t('imagesearch.title')} detail={t('imagesearch.detail')}>
          <Select value={service} label={t('imagesearch.title')} options={options} onChange={imageSearch => update({ imageSearch })} />
        </SettingRow>
        {service === 'custom' && (
          <>
            <SettingRow id="image-search-custom" title={t('imagesearch.customAddress')} detail={t('imagesearch.customAddressHelp')} stacked>
              <input className="st-input" style={{ width: '100%' }} dir="ltr" inputMode="url" spellCheck={false} aria-label={t('imagesearch.customAddress')} aria-invalid={invalid || undefined} placeholder="https://images.example.com/search?url=%s" value={shownAddress}
                onChange={event => { const next = event.target.value; setAddress(next); const trimmed = next.trim(); if (trimmed === '' || validAddress(trimmed, withParams)) update({ imageSearchCustom: trimmed }); }} onBlur={() => setAddress(null)} />
              {invalid && <p className="nc-message" data-bad role="alert">{t('imagesearch.customInvalid')}</p>}
            </SettingRow>
            <SettingRow id="image-search-custom-post" title={t('imagesearch.customPost')} detail={t('imagesearch.customPostHelp')} stacked>
              <textarea className="st-input" style={{ width: '100%', resize: 'vertical' }} dir="ltr" rows={3} spellCheck={false} aria-label={t('imagesearch.customPost')} /* i18n-ignore example parameter */ placeholder="image=%s" value={shownPost}
                onChange={event => { const next = event.target.value; setPost(next); if (next.split(/\r?\n/).filter(line => line.trim()).length <= 12 && next.length <= 1000) update({ imageSearchCustomPost: next }); }} onBlur={() => setPost(null)} />
            </SettingRow>
          </>
        )}
      </SettingGroup>
      <SettingNote>{t('imagesearch.note')}</SettingNote>
    </>
  );
}

const panel: SettingsPanel = { section: 'Search', order: 35, Component: SearchImages as SettingsPanel['Component'] };
export default panel;
