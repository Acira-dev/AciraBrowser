import { useState } from 'react';
import { runtime } from '../../runtime/client';
import { t } from '../../i18n';
import { addOwnVideo, artworkError, useOwnVideo, videoErrorKey } from '../../ui/ownVideo';
import { videoTitle } from '../../ui/liveWallpaper';
import type { NewTabPreferences } from '../../ui/newTabPreferences';
import { SettingRow, Switch } from './controls';
import './personal-video.css';

/** 14.4 live wallpaper, Settings > Appearance > New tab background, under "My artworks": the profile's own video. Adding one turns it on; "Play on battery"
 * is off by default; a file the engine cannot decode efficiently never plays on battery, and the row says so. Not in a private window. */
export function PersonalVideoRow({ profileId, privateMode, prefs, update, canImport }: { profileId: string; privateMode: boolean; prefs: NewTabPreferences; update: (patch: Partial<NewTabPreferences>) => void; canImport: boolean }) {
  const own = useOwnVideo(profileId, privateMode, canImport), video = own.video;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (privateMode) return null;
  const add = async () => {
    setBusy(true); setError('');
    try {
      const added = await addOwnVideo();
      if (added) { await own.refresh(); update({ ownVideo: true, modules: { ...prefs.modules, artwork: true } }); }
    } catch (reason) {
      const key = videoErrorKey(reason);
      setError(key ? t(key as 'ntp.videoUnplayable') : artworkError(reason, t('ntp.videoAddFailed')));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await runtime.service({ type: 'artwork.video-remove' }); await own.refresh(); update({ ownVideo: false }); }
    catch (reason) { setError(artworkError(reason, t('ntp.videoAddFailed'))); }
    finally { setBusy(false); }
  };
  return <>
    <SettingRow id="newtab-personal-video" title={t('ntp.video')} detail={t('ntp.videoDetail')}>
      <div className="nt-video-actions">
        <button type="button" className="st-button" disabled={busy || !canImport} onClick={() => void add()}>{t(busy ? 'ntp.wait' : video ? 'ntp.replaceVideo' : 'ntp.addVideo')}</button>
        {video && <Switch label={t('ntp.video')} checked={prefs.ownVideo} disabled={busy} onChange={on => update({ ownVideo: on, modules: { ...prefs.modules, artwork: true } })} />}
      </div>
    </SettingRow>
    {video && <div className="nt-video-item">
      <img className="nt-video-still" src={video.still} alt="" aria-hidden="true" draggable={false} />
      <span className="nt-video-name"><bdi>{videoTitle(video.name)}</bdi></span>
      <button type="button" className="st-button" disabled={busy} onClick={() => void remove()}>{t('ntp.removeVideo')}</button>
    </div>}
    {video && <SettingRow id="newtab-video-battery" title={t('ntp.videoOnBattery')} detail={video.powerEfficient ? t('ntp.videoOnBatteryDetail') : t('ntp.videoNotEfficient')}>
      <Switch label={t('ntp.videoOnBattery')} checked={prefs.videoOnBattery && video.powerEfficient} disabled={busy || !video.powerEfficient} onChange={on => update({ videoOnBattery: on })} />
    </SettingRow>}
    {error && <p className="st-error" role="alert">{error}</p>}
  </>;
}
