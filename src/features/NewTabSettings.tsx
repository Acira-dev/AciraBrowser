import { useRef, useState } from 'react';
import { useFlip } from '../ui/sharedMotion';
import {WorkspaceCoverPicker} from '../components/WorkspaceCoverPicker';
import type { BrowserProfile } from '../runtime/types';
import { artStyles, artworkCatalog, defaultArtwork, selectedArtwork, readNewTabPreferences, newTabModules, shortcutURL, useNewTabPreferences, type NewTabModule, type Shortcut } from '../ui/newTabPreferences';
import '../styles/new-tab.css';
import { runtime } from '../runtime/client';
import { usePersonalArtwork, artworkError } from '../ui/usePersonalArtwork';
import { useArtworkDay } from '../ui/useArtworkDay';
import { ArrowUp, Trash2 } from '../components/AppIcons';
import { Select, SettingRow, Switch } from './settings/controls';
import { useSettingsDraft } from './settings/draft';
import { newTabChanged } from './settings/changed';
import { t, useT, type MessageId } from '../i18n';
import { artworkCollectionChoice, artworkCollectionShortName, artworkCollections, collectionPreview, type ArtworkCollection } from '../ui/artworkCollections';
import { ChoiceCards } from './settings/ChoiceCards';
import { PersonalArtworkLibrary } from './settings/PersonalArtworkLibrary';
import './settings/collection-cards.css';

const moduleTitleIds: Record<Exclude<NewTabModule, 'workspace'>, MessageId> = { artwork: 'ntp.show.artwork', name: 'ntp.show.name', mark: 'ntp.show.mark', search: 'ntp.show.search', shortcuts: 'ntp.show.shortcuts', saved: 'ntp.show.saved', recent: 'ntp.show.recent' };
const moduleTitle = (module: NewTabModule) => module === 'workspace' ? t('local.showWorkspaceHeader') : t(moduleTitleIds[module]);
const artStyleOptions = () => (Object.keys(artStyles) as (keyof typeof artStyles)[]).map((value) => ({ value, label: t(value === 'framed' ? 'ntp.style.framed' : 'ntp.style.full') }));
const moduleAnchor: Record<NewTabModule, string> = { workspace: 'newtab-workspace', artwork: 'newtab-art', name: 'newtab-name', mark: 'newtab-mark', search: 'newtab-search', shortcuts: 'newtab-shortcuts', saved: 'newtab-saved', recent: 'newtab-recent' };

const collectionHost: Record<string, string> = { landscapes: 'commons.wikimedia.org', nature: 'commons.wikimedia.org', space: 'commons.wikimedia.org', architecture: 'commons.wikimedia.org' };
const intervalOptions = (): { value: 'never' | 'tab' | 'hour' | 'day'; label: string }[] => [{ value: 'never', label: t('ntp.int.never') }, { value: 'tab', label: t('ntp.int.tab') }, { value: 'hour', label: t('ntp.int.hour') }, { value: 'day', label: t('ntp.int.day') }];
/** Settings › Appearance › "New tab background" shows the `background` part (the picture: style, collection, artwork, caption, own images);
 *  Settings › New tab shows the `layout` part (what is on the page, and the shortcuts). R3-74: same ids and storage, two places by what people look for. */
export function NewTabSettings({ profile, part }: { profile: BrowserProfile; part: 'layout' | 'background' }) {
  useT();
  const [prefs, update] = useNewTabPreferences(profile.id, profile.private),
    [title, setTitle] = useSettingsDraft('newtab-shortcut-title'),
    [url, setURL] = useSettingsDraft('newtab-shortcut-url'),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<string | null>(null);
  // The shortcut rows swap places on the morph spring (R3-55).
  const shortcutList = useRef<HTMLUListElement>(null);
  useFlip(shortcutList, prefs.shortcuts.map((shortcut) => shortcut.id).join(","));
  const background = part === 'background', layout = part === 'layout';
  const personal = usePersonalArtwork(profile.id, profile.private, Boolean(runtime.platform) && background),
    [busy, setBusy] = useState(false),
    [imageError, setImageError] = useState('');
  const artworkDay = useArtworkDay(prefs.daily||prefs.hourly,prefs.hourly),
    chosen = selectedArtwork(prefs, profile.id, artworkDay, personal.assets);
  const interval: 'never' | 'tab' | 'hour' | 'day' = prefs.perTab ? 'tab' : prefs.hourly ? 'hour' : prefs.daily ? 'day' : 'never';
  const importImage = async () => {
    setBusy(true);
    setImageError('');
    try {
      const result = await runtime.service({ type: 'artwork.import' });
      if (result.artwork?.addedId) {
        await personal.refresh();
        update({ artwork: 'personal:' + result.artwork.addedId, daily: false, perTab: false, hourly: false, collection: 'built-in', modules: { ...readNewTabPreferences(profile.id, profile.private).modules, artwork: true } });
      }
    } catch (reason) {
      setImageError(artworkError(reason, t('ntp.addFailed')));
    } finally {
      setBusy(false);
    }
  };
  const removeImage = async (id: string) => {
    setBusy(true);
    setImageError('');
    try {
      await runtime.service({ type: 'artwork.remove', id });
      if (readNewTabPreferences(profile.id, profile.private).artwork === 'personal:' + id) update({ artwork: defaultArtwork, daily: false, perTab: false, hourly: false, collection: 'built-in' });
      await personal.refresh();
    } catch (reason) {
      setImageError(artworkError(reason, t('ntp.removeFailed')));
    } finally {
      setBusy(false);
    }
  };
  const save = (items: Shortcut[]) => update({ shortcuts: items });
  const clearForm = () => {
    setEditing(null);
    setTitle('');
    setURL('');
    setError('');
  };
  const artworkValue = prefs.daily || prefs.hourly ? chosen.id : prefs.artwork;
  const personalSelected = prefs.artwork.startsWith('personal:');
  const personalCover = personal.assets.find(asset => 'personal:' + asset.id === prefs.artwork) ?? personal.assets[0];
  const selectPersonal = (id: string) => update({ artwork: 'personal:' + id, collection: 'built-in', daily: false, perTab: false, hourly: false, modules: { ...prefs.modules, artwork: true } });
  const artworkOptions = [
    ...(prefs.artwork === 'coast' ? [{ value: 'coast', label: t('ntp.previousChoice') }] : []),
    ...artworkCatalog.map((item) => ({ value: item.id as string, label: item.name })),
  ];
  return (
    <>
      {layout && <p className="st-note st-note-inline">{t('ntp.intro', { name: profile.name })}</p>}
      {(Object.keys(newTabModules) as NewTabModule[]).filter((module) => (module === 'artwork') === background).map((module) => (
        <SettingRow key={module} id={moduleAnchor[module]} title={moduleTitle(module)}>
          <Switch label={moduleTitle(module)} checked={prefs.modules[module]} onChange={(on) => update({ modules: { ...prefs.modules, [module]: on } })} />
        </SettingRow>
      ))}
      {background && <>
      <SettingRow id="newtab-art-style" title={t('ntp.artStyle')} detail={t('ntp.artStyleDetail')}>
        <Select label={t('ntp.artStyle')} value={prefs.artStyle} options={artStyleOptions()} onChange={(artStyle) => update({ artStyle })} />
      </SettingRow>
      {/* The same real previews as setup's cover step (R4-05): one card per collection, a photograph from it, shipped with the app. */}
      <SettingRow id="newtab-collection" title={t('ntp.collection')} detail={personalSelected ? t(profile.private ? 'ntp.personalPrivate' : 'ntp.personalDetail') : prefs.collection === 'built-in' ? t('ntp.colBuiltInDetail') : t('ntp.colRemoteDetail', { host: collectionHost[prefs.collection] })} stacked>
        <div className="nt-collection-cards">
          <ChoiceCards<ArtworkCollection | 'personal'>
            label={t('ntp.collection')}
            value={personalSelected ? 'personal' : prefs.collection}
            // Choosing a picture means wanting to see it: a profile that started with "No image" turns artwork back on here.
            onChange={(collection) => collection === 'personal' ? personalCover && selectPersonal(personalCover.id) : update({ ...artworkCollectionChoice(collection, prefs.artwork), modules: { ...prefs.modules, artwork: true } })}
            options={[
              ...artworkCollections.map((collection) => ({ value: collection, label: artworkCollectionShortName(collection), art: <img className="nt-collection-img" src={collectionPreview[collection]} alt="" draggable={false} decoding="async" /> })),
              ...(personalCover || personalSelected ? [{ value: 'personal' as const, label: t('ntp.personal'), art: personalCover ? <img className="nt-collection-img" src={personalCover.url} alt="" draggable={false} decoding="async"/> : <span className="nt-personal-collection-empty">{t('ntp.personalUnavailable')}</span> }] : []),
            ]}
          />
        </div>
      </SettingRow>
      <PersonalArtworkLibrary id="newtab-personal-image" assets={personal.assets} selected={prefs.artwork} busy={busy} canImport={Boolean(runtime.platform)} privateMode={Boolean(profile.private)} onImport={() => void importImage()} onSelect={selectPersonal} onRemove={id => void removeImage(id)}/>
      {!personalSelected && <><SettingRow id="newtab-artwork" title={t('ntp.artwork')} detail={chosen?.artist ? `${chosen.artist}${chosen.date ? ', ' + chosen.date : ''}` : undefined}>
        <Select label={t('ntp.artwork')} value={artworkValue} options={artworkOptions} onChange={(value) => update({ artwork: value as typeof prefs.artwork, daily: false, perTab: false, hourly: false, collection: 'built-in', modules: { ...prefs.modules, artwork: true } })} />
      </SettingRow>
      <details className="newtab-image-browser"><summary>{t('local.browseCovers')}</summary><WorkspaceCoverPicker profileId={profile.id} privateMode={profile.private} showVisibility={false} personalAssets={personal.assets} personalPending={personal.pending}/></details></>}
      {chosen?.artist && (
        <details className="newtab-art-details" id="newtab-art-details" data-setting="newtab-art-details">
          <summary>{t('ntp.about')}</summary>
          <p>
            {chosen.name} · {chosen.artist}, {chosen.date}
          </p>
          <p>
            {chosen.provider} · {chosen.rights}. {t('ntp.includedOffline')}
          </p>
          <button type="button" className="st-button" onClick={() => void runtime.dispatch({ type: 'tab.new', url: chosen.source! })}>
            {t('ntp.museumRecord')}
          </button>
        </details>
      )}
      <SettingRow id="newtab-daily" title={t('ntp.change')} detail={interval === 'never' ? t('ntp.changeNeverDetail') : t('ntp.changeDetail')}>
        <Select label={t('ntp.change')} value={interval} options={intervalOptions()} onChange={(value) => update({ daily: value === 'day', perTab: value === 'tab', hourly: value === 'hour' })} />
      </SettingRow>
      <SettingRow id="newtab-caption" title={t('ntp.caption')} detail={t('ntp.captionDetail')}>
        <Switch label={t('ntp.caption')} checked={prefs.caption} onChange={(caption) => update({ caption })} />
      </SettingRow>
      {(imageError || personal.error) && <p className="st-error" role="alert">{imageError || personal.error}</p>}
      </>}
      {layout && <>
      <SettingRow id="newtab-frequent" title={t('ntp.frequent')} detail={t('ntp.frequentDetail')}>
        <Switch label={t('ntp.frequent')} checked={prefs.frequent} disabled={profile.private} onChange={(frequent) => update({ frequent })} />
      </SettingRow>
      {newTabChanged(prefs, defaultArtwork) && (<SettingRow id="newtab-reset" title={t('ntp.resetLayout')} detail={t('ntp.resetDetail')}>
        <button type="button" className="st-button" onClick={() => update({ modules: { workspace: true, artwork: true, name: false, mark: false, search: true, shortcuts: false, saved: true, recent: true }, artwork: defaultArtwork, artStyle: 'framed', daily: false, perTab: false, hourly: false, collection: 'built-in', caption: true, frequent: false })}>
          {t('ntp.reset')}
        </button>
      </SettingRow>)}
      <div className="st-subgroup" data-setting="newtab-shortcut-editor">
        <h3>{t('ntp.shortcuts')}</h3>
        <p className="st-note st-note-inline">{t('ntp.shortcutsNote')}</p>
        <ul className="newtab-shortcut-editor" ref={shortcutList}>
          {prefs.shortcuts.map((item, index) => (
            <li key={item.id}>
              <span className="st-shortcut-copy">
                <strong>{item.title}</strong>
                <small>
                  <bdi>{item.url}</bdi>
                </small>
              </span>
              <label>
                <input type="checkbox" checked={item.start} onChange={(event) => save(prefs.shortcuts.map((shortcut) => (shortcut.id === item.id ? { ...shortcut, start: event.target.checked } : shortcut)))} />
                {t('ntp.newTab')}
              </label>
              <label>
                <input type="checkbox" checked={item.sidebar} onChange={(event) => save(prefs.shortcuts.map((shortcut) => (shortcut.id === item.id ? { ...shortcut, sidebar: event.target.checked } : shortcut)))} />
                {t('ntp.sidebar')}
              </label>
              <div className="newtab-shortcut-actions">
                <button
                  type="button"
                  className="st-icon-button"
                  disabled={!index}
                  aria-label={t('ntp.moveUp', { title: item.title })}
                  onClick={() => {
                    const next = [...prefs.shortcuts];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    save(next);
                  }}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="st-icon-button flip"
                  disabled={index === prefs.shortcuts.length - 1}
                  aria-label={t('ntp.moveDown', { title: item.title })}
                  onClick={() => {
                    const next = [...prefs.shortcuts];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    save(next);
                  }}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="st-button"
                  onClick={() => {
                    setEditing(item.id);
                    setTitle(item.title);
                    setURL(item.url);
                    setError('');
                  }}
                >
                  {t('ntp.edit')}<span className="sr-only"> {item.title}</span>
                </button>
                <button
                  type="button"
                  className="st-icon-button"
                  aria-label={t('ntp.removeAria', { title: item.title })}
                  onClick={() => {
                    save(prefs.shortcuts.filter((shortcut) => shortcut.id !== item.id));
                    if (editing === item.id) clearForm();
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="newtab-shortcut-form"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = shortcutURL(url.trim());
            if (!parsed || !title.trim()) {
              setError(t('ntp.errAddress'));
              return;
            }
            if (!editing && prefs.shortcuts.length >= 12) {
              setError(t('ntp.errLimit'));
              return;
            }
            save(editing ? prefs.shortcuts.map((item) => (item.id === editing ? { ...item, title: title.trim(), url: parsed } : item)) : [...prefs.shortcuts, { id: crypto.randomUUID(), title: title.trim(), url: parsed, start: true, sidebar: false }]);
            clearForm();
          }}
        >
          <label>
            <span>{t('ntp.shortcutName')}</span>
            <input className="st-input" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            <span>{t('ntp.websiteAddress')}</span>
            <input className="st-input" value={url} maxLength={4096} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com" autoComplete="off" required />
          </label>
          <div className="st-form-actions">
            <button className="st-button primary" disabled={!editing && prefs.shortcuts.length >= 12}>
              {editing ? t('ntp.saveShortcut') : t('ntp.addShortcut')}
            </button>
            {editing && (
              <button type="button" className="st-button" onClick={clearForm}>
                {t('ntp.cancelEdit')}
              </button>
            )}
          </div>
          {error && <p className="st-error" role="alert">{error}</p>}
        </form>
      </div>
      </>}
    </>
  );
}
