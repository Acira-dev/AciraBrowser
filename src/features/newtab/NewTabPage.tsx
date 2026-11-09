import {motion} from 'motion/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { AddressField } from '../../components/AddressField';
import { ArrowRight, Globe2 } from '../../components/AppIcons';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { profilesAsSpaces, workspaceName } from '../../runtime/workspaces';
import { ProfileAvatar } from '../accounts/profileModel';
import { BrandLogo } from '../../components/BrandLogo';
import { EditorGlyph } from '../../components/EditorGlyph';
import { PreviewIcon } from '../../components/PreviewIcon';
import { SiteIdentityIcon } from '../../components/SiteIdentityIcon';
import { carriesHttpsFirst, resolveNavigation } from '../../runtime/navigation';
import { effectiveProviders } from '../../runtime/searchProviders';
import { useArtColors } from '../../ui/artColors';
import { useSiteIcons } from '../../ui/siteIcons';
import { siteIdentity } from '../../runtime/sites';
import { isAddressLike } from '../../runtime/siteMark';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import { bookmarkContext, openPage, savedPageIdentity } from '../../ui/pageActions';
import { artworkCatalog, hideWorkspaceArtwork, selectedArtwork, useNewTabPreferences, type CatalogArtwork } from '../../ui/newTabPreferences';
import { artworkSignature, dropStaleTabArtwork, shuffleTabArtwork, useTabArtwork } from '../../ui/tabArtwork';
import { useArtworkDay } from '../../ui/useArtworkDay';
import { usePersonalArtwork } from '../../ui/usePersonalArtwork';
import { useBufferedDraft } from '../../ui/useBufferedDraft';
import { openWorkspacePage, selectWorkspaceView } from '../../ui/workspaceView';
import {runtime} from '../../runtime/client';
import { useRemoteArtwork } from '../../ui/useRemoteArtwork';
import { address, artworkCaption, frequentPages, fromHistory, host, profileHistory as historyFor, recentPages, tileLabel, isPrivateNewTab, distinctSites } from './pages';
import '../../styles/neutral-primary.css';
import '../../styles/new-tab-page.css';
import { formatShortcut } from '../../ui/platform';
import { ArtworkControls } from './ArtworkControls';
import { DotMatrix } from '../../components/DotMatrix';
import { inkFromColor, measureInks } from './labelInk';
import { t, useT } from '../../i18n';

type Props = { state: BrowserSnapshot; tab: TabSession; dispatch: (action: BrowserAction) => void; onNavigate: (url: string) => void };
/** Position in the reveal sequence (search, frame, caption, modules); the stylesheet turns it into a delay. */
const fallbackArt = '/artwork/dunes.svg';
const step = (index: number): CSSProperties => ({ '--nt-i': Math.min(index, 3) } as CSSProperties);
/** How long the painting takes to leave after it is hidden, so the page rebalances without a cut. */
const artExit = 520;

/** A shortcut never asks the network for an icon: bundled brand icon, an icon the visit already cached, or a letter. */
function TileIcon({ url, title, favicon }: { url: string; title: string; favicon?: string }) {
  const known = Boolean(siteIdentity(url).icon) || Boolean(favicon && /^(https?:|data:image\/|acira-app:)/i.test(favicon));
  if (known) return <SiteIdentityIcon url={url} favicon={favicon} size={24} />;
  // A letter only for a real hostname; an IP address, localhost or a local file gets a neutral globe (a "1" or a dot reads as broken).
  if (isAddressLike(url)) return <Globe2 className="nt-globe" size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />;
  const first = (value: string) => [...value.replace(/^www\./i, '')].find((char) => /\p{L}/u.test(char));
  const letter = (first(title) || first(host(url)) || '').toUpperCase();
  return letter ? <span className="nt-letter" aria-hidden="true">{letter}</span> : <Globe2 className="nt-globe" size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />;
}

export function NewTabPage({ state, tab, dispatch, onNavigate }: Props) {
  useT();
  useEffect(() => { performance.mark('acira-newtab-mounted'); requestAnimationFrame(() => requestAnimationFrame(() => performance.mark('acira-newtab-painted'))); }, []);
  const profileId = tab.browserProfileId || state.activeBrowserProfileId;
  const profile = state.browserProfiles.find((item) => item.id === profileId);
  const workspace = state.workspaces.find(item => item.id === (tab.workspaceId || state.activeWorkspaceId));
  const privateMode = isPrivateNewTab(Boolean(profile?.private), (tab as { privacy?: string }).privacy);
  const [prefs, setPrefs] = useNewTabPreferences(profileId, privateMode);
  const siteIcon = useSiteIcons(state);
  const { modules } = prefs;
  const artOn = modules.artwork;
  const reduced = state.settings.reducedMotion;
  const artworkDay = useArtworkDay((prefs.daily || prefs.hourly) && artOn, prefs.hourly);
  const personal = usePersonalArtwork(profileId, privateMode, artOn && (prefs.perTab || prefs.artwork.startsWith('personal:')));
  // "Another image" is this tab's own pick (tabArtwork.ts); everything else the profile chose applies to every tab.
  const signature = artworkSignature(profileId, privateMode, prefs), mine = useTabArtwork(tab.id, signature);
  useEffect(() => dropStaleTabArtwork(profileId, signature), [profileId, signature]);
  const builtIn = (mine?.artwork ? artworkCatalog.find(item => item.id === mine.artwork) : undefined) ?? selectedArtwork(prefs, profileId, artworkDay, personal.assets, tab.id);
  const remote = useRemoteArtwork(prefs.collection, mine?.seed ? 'tab:' + mine.seed : (prefs.perTab ? tab.id : profileId + (prefs.hourly ? artworkDay.toISOString().slice(0, 13) : prefs.daily ? artworkDay.toDateString() : 'fixed')) + '|' + prefs.collectionSeed, artOn && !privateMode && !prefs.artwork.startsWith('personal:'), mine?.seed ? mine.excludeId : prefs.collectionExcludeId);
  // The profile's own images are listed by the main process a moment after the page mounts. Until they are, the choice cannot be
  // resolved (a personal image, or a pool that includes them), and what it falls back to is the first catalog painting: that one
  // must never reach the screen between the picture the page already shows (or the empty ground) and the one the person chose.
  const awaitingPersonal = artOn && personal.pending && (prefs.perTab || prefs.artwork.startsWith('personal:'));
  const decoded = useDecodedArtwork(remote.active ? remote.picture : builtIn, builtIn, prefs.artStyle !== 'full', artOn, profileId + ':' + privateMode, tab.id, awaitingPersonal);
  const artwork = decoded.artwork;
  // A page the user comes back to (its own tab's picture is known) or lands on through a workspace switch is not "opening": the reveal below (everything rising out of nothing, the frame included) would dip the crossfade to the bare ground, so it does not replay.
  const [resumed] = useState(() => decoded.seed === 'own' || (decoded.seed === 'carried' && document.documentElement.dataset.modeSwitch === 'workspace'));
  const draft = useBufferedDraft(tab.id, tab.searchDraft, dispatch, 'searchDraft');
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [artMounted, setArtMounted] = useState(artOn);
  const layout = useRef<HTMLDivElement>(null), pageRef = useRef<HTMLDivElement>(null), tilesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (artOn) { setArtMounted(true); return; }
    const timer = window.setTimeout(() => setArtMounted(false), reduced ? 0 : artExit);
    return () => window.clearTimeout(timer);
  }, [artOn, reduced]);

  // The history is a 5000-visit list that every state change re-renders this page against: these three are sorted and filtered only when the list itself (the reducer replaces it when it changes), the profile or the choices change.
  const firstProfileId = state.browserProfiles[0]?.id;
  const profileHistory = useMemo(() => privateMode ? [] : fromHistory(state.browsingHistory, 'profile|' + profileId + '|' + firstProfileId, () => historyFor(state.browsingHistory, profileId, firstProfileId)), [privateMode, state.browsingHistory, profileId, firstProfileId]);
  const manual = prefs.shortcuts.filter((item) => item.start);
  const manualUrls = manual.map((item) => item.url), manualKey = JSON.stringify(manualUrls);
  const frequent = useMemo(() => prefs.frequent ? fromHistory(profileHistory, 'frequent|' + manualKey + '|' + privateMode, () => frequentPages(profileHistory, new Set(manualUrls), 12 - manualUrls.length, privateMode)) : [], [prefs.frequent, profileHistory, manualKey, privateMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = [...manual.map((item) => ({ key: item.id, url: item.url, title: item.title })), ...frequent.map((item) => ({ key: item.url, url: item.url, title: item.title || host(item.url) }))];
  // One quiet row of up to 7 links (shortcuts, then saved, then recent) plus a "More" tile; each source follows its own switch.
  const savedItems = modules.saved ? state.bookmarks.map((url) => ({ key: 's:' + url, url, title: savedPageIdentity(url, state).title || address(url) })) : [];
  const recentItems = useMemo(() => modules.recent ? fromHistory(profileHistory, 'recent|' + privateMode, () => recentPages(profileHistory, 7, privateMode)).map((item) => ({ key: item.id, url: item.url, title: item.title || address(item.url) })) : [], [modules.recent, profileHistory, privateMode]);
  const seen = new Set<string>();
  const every = distinctSites([...(modules.shortcuts ? tiles : []), ...savedItems, ...recentItems].filter((item) => !seen.has(item.url) && Boolean(seen.add(item.url))));
  const quick = every.slice(0, 7);
  const showTiles = quick.length > 0;
  const showMore = showTiles && (modules.saved || modules.recent || every.length > 7);
  const moreView = modules.recent ? 'history' : 'bookmarks';
  const framed = prefs.artStyle !== 'full';
  const showName = modules.name && Boolean(profile?.name);
  // Changing the cover presentation keeps the profile identity in its header.
  const nameInHead = showName;
  const showFrame = framed && artMounted;
  const showHead = modules.mark || nameInHead;
  const hasStack = modules.workspace || showHead || showFrame || modules.search || showTiles;
  const artColors = useArtColors(artwork.src, artwork.averageColor, showFrame);
  const engineName = (() => { const providers = effectiveProviders(state.settings.searchProviders ?? undefined, state.settings.searchEngine); return (providers.engines.find((engine) => engine.id === providers.defaultId) ?? providers.engines[0])?.name ?? t('nt.search'); })();
  const leaving = !artOn ? true : undefined;
  const hide = () => { hideWorkspaceArtwork(profileId, privateMode); (input.current || document.querySelector<HTMLInputElement>('.address-bar input'))?.focus({ preventScroll: true }); };
  /** "Another image": a random different picture of the chosen collection for THIS tab only. No profile preference changes, so every other tab keeps its picture. */
  const change = () => shuffleTabArtwork(tab.id, profileId, signature, prefs.collection !== 'built-in' && !privateMode && !prefs.artwork.startsWith('personal:') ? prefs.collection : null, artwork.id);
  const popup = (kind: string, target: HTMLButtonElement) => { const {x,y,width,height}=target.getBoundingClientRect(); void runtime.browserCommand({type:'ui',tabId:tab.id,action:'open',kind,anchor:{x,y,width,height}}); };
  const toggleArt = () => artOn ? hide() : setPrefs({modules:{...modules,artwork:true}});
  const artLoading = remote.loading || decoded.loading;
  // Framed: search ~18% from the top (10% without a search), as in the approved layout; the head row sits above that line.
  const headHeight = showHead ? 44 : 0;
  const stackStyle = framed ? { '--nt-head': `${headHeight}px`, '--nt-top': modules.search ? '18cqh' : '10cqh' } as CSSProperties : undefined;
  const artControls = <ArtworkControls collection={prefs.collection} visible={artOn} loading={artOn && artLoading} failed={remote.failed || decoded.failed} kept={Boolean(decoded.src) && !decoded.fallback} visibilityOnly={!framed} onRetry={() => remote.failed ? remote.retry() : decoded.retry()} onNext={change} onVisibility={toggleArt} onChoose={target => popup('workspace-cover', target)} />;
  // Measure actual wrapped links and the stable credit row, then fit the 16:9 picture in the remaining viewport.
  useLayoutEffect(() => {
    const root = layout.current; if (!framed || !root) return;
    const measure = () => {
      const style = getComputedStyle(root), stack = root.firstElementChild as HTMLElement;
      const siblings = [...stack.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.classList.contains('nt-frame-wrap'));
      const credit = root.querySelector<HTMLElement>('.nt-credit');
      const gap = parseFloat(getComputedStyle(stack).rowGap) || 0, frame = root.querySelector<HTMLElement>('.nt-frame-wrap');
      const height = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - siblings.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0) - siblings.length * gap - (frame ? parseFloat(getComputedStyle(frame).marginTop) : 0) - (credit?.getBoundingClientRect().height ?? 36) - 12 - 12;
      root.style.setProperty('--nt-frame-height', `${Math.max(0, height)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('.nt-workspace-heading,.nt-head,.nt-search,.nt-tiles,.nt-credit').forEach(node => observer.observe(node));
    measure(); return () => observer.disconnect();
  }, [framed, showHead, modules.search, showTiles, artMounted, prefs.caption]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current) return;
    const value = draft.flush().trim();
    if (value) onNavigate(value);
  };
  const open = (event: MouseEvent<HTMLButtonElement>, url: string) => openPage(event, url, dispatch, onNavigate);

  // Full background: the ink of the shortcut labels follows the painting behind them (labelInk.ts). Read once per picture, layout and tile set, never per frame.
  const tileSignature = quick.map((item) => item.key).join('|') + (showMore ? '+' : '');
  useEffect(() => {
    const page = pageRef.current, tiles = tilesRef.current;
    if (!page || !tiles || framed || !artOn) return;
    let frame = 0, pending: HTMLImageElement | null = null;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const art = page.querySelector<HTMLElement>(':scope > .nt-art'), image = page.querySelector<HTMLImageElement>(':scope > .nt-art > img[data-current]');
        const labels = [...tiles.querySelectorAll<HTMLElement>('.nt-tile-label')];
        if (image && !image.complete && pending !== image) { pending = image; image.addEventListener('load', run, { once: true }); return; }
        const inks = art && image ? measureInks(art, image, labels) : null;
        // A picture that cannot be read keeps its catalog average; with neither, the label keeps the safe default (white ink and a firm shadow).
        const fallback = inkFromColor(artwork.averageColor);
        for (const label of labels) { const ink = inks?.get(label) ?? fallback; if (ink) label.dataset.ink = ink; else delete label.dataset.ink; }
      });
    };
    run();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(run) : null;
    observer?.observe(page);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [decoded.src, framed, artOn, tileSignature, artwork.averageColor]);

  return <div ref={pageRef} className="nt-page" data-art={artOn ? 'on' : 'off'} data-style={framed ? 'framed' : 'full'} data-glass={!framed && artOn ? 'true' : undefined} data-blank={!hasStack ? 'true' : undefined} data-resumed={resumed || undefined} data-scene={`${tab.id}:home`}>
    {showFrame && <div className="nt-glow" data-leaving={leaving} aria-hidden="true" style={{ '--g1': artColors[0], '--g2': artColors[1] ?? artColors[0], '--g3': artColors[2] ?? artColors[0] } as CSSProperties} />}
    {!framed && artMounted && <ArtLayer decoded={decoded} reduced={reduced} leaving={leaving} />}
    {(!framed || !artOn) && <div className="nt-full-art-controls">{artControls}</div>}
    {hasStack && <div ref={layout} className="nt-scroll" style={stackStyle}><div className="nt-stack">
      {modules.workspace && <header className="nt-workspace-heading" aria-label={t("frostworkspace.workspace")}>
        <div className="nt-workspace-title"><span className="nt-workspace-glyph" aria-hidden="true"><WorkspaceGlyph icon={workspaceIcon(workspace || {name:''})} /></span><h1><bdi>{profilesAsSpaces(state) && profile ? profile.name : workspace ? workspaceName(workspace, t('workspaces.main')) : t('workspaces.main')}</bdi></h1></div>
        <button type="button" className="nt-workspace-profile" data-popup-trigger title={profile?.name || t('ntp.defaultName')} aria-label={t('local.profileSwitch',{name:profile?.name || t('ntp.defaultName')})} onClick={event=>popup('profile',event.currentTarget)}><ProfileAvatar name={profile?.name || t('ntp.defaultName')} color={profile?.color || '#6b7280'} avatar={profile?.avatar} picture={profile?.picture} size={28} /></button>
      </header>}

      {showHead && <header className="nt-head nt-vapor" style={step(0)}>
        {modules.mark && <BrandLogo mark size={24} className="nt-logo" />}
        {nameInHead && <h1 className="nt-title"><bdi>{profile!.name}</bdi></h1>}
      </header>}
      {modules.search && <form className="nt-search nt-vapor" style={step(0)} onSubmit={submit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
        <EditorGlyph name="search" />
        <AddressField centerWithin=".nt-search" inputRef={input} label={t('nt.searchLabel')} value={draft.value} onChange={draft.edit} onFocus={draft.onFocus} onBlur={() => draft.onBlur()} style="acira" reducedMotion={reduced} speed={1} searchEngine={state.settings.searchEngine} placeholder={t('nt.placeholder')} onModifiedEnter={(value, newTab) => {
          if (newTab) { const target = resolveNavigation(value, state.settings.searchEngine, state.settings.searchProviders ?? undefined, state.websiteLanguage); if (!target.error) dispatch({ type: 'tab.new', url: target.url, ...(carriesHttpsFirst(target, target.url) ? { httpsFirst: true } : {}) }); } else onNavigate(value);
        }} />
        {draft.value.trim()
          ? <button className="nt-submit" type="submit" aria-label={t('nt.submit')}><PreviewIcon icon={ArrowRight} size={14} /></button>
          : <span className="nt-hint" aria-hidden="true"><span>{engineName}</span><span className="nt-key">{formatShortcut('Ctrl L')}</span></span>}
      </form>}
      {showTiles && <nav ref={tilesRef} className="nt-tiles nt-vapor" style={step(1)} aria-label={t('nt.quickLinks')}>
        {quick.map((item) => <button type="button" className="nt-tile" key={item.key} title={`${item.title} · ${item.url}`} onClick={(event) => open(event, item.url)} onAuxClick={(event) => open(event, item.url)}>
          <span className="nt-tile-icon"><TileIcon url={item.url} title={item.title} favicon={savedPageIdentity(item.url, state).favicon || siteIcon(item.url)} /></span><span className="nt-tile-label"><bdi>{siteIdentity(item.url).icon ? siteIdentity(item.url).label : tileLabel(item.title, item.url)}</bdi></span>
        </button>)}
        {showMore && <button type="button" className="nt-tile nt-more" title={moreView === 'history' ? t('nt.allHistory') : t('nt.allBookmarks')} onClick={() => (moreView === 'history' ? openWorkspacePage('history', state, dispatch) : selectWorkspaceView('bookmarks', state, dispatch))}><span className="nt-tile-icon nt-more-glyph" aria-hidden="true"><PreviewIcon icon={ArrowRight} size={16} /></span><span className="nt-tile-label"><bdi>{moreView === 'history' ? t('nt.allHistory') : t('nt.allBookmarks')}</bdi></span></button>}
      </nav>}
      {framed && <motion.div className="nt-frame-wrap" data-leaving={leaving} aria-hidden={!artOn || undefined} inert={!artOn || undefined}
        initial={reduced||resumed?false:{gridTemplateRows:'0fr',opacity:0,filter:'blur(4px)'}}
        animate={{gridTemplateRows:artOn?'1fr':'0fr',opacity:artOn?1:0,filter:artOn?'blur(0px)':'blur(4px)',scale:artOn?1:.985,marginTop:artOn?12:0,marginBottom:artOn?0:-20}}
        transition={{duration:reduced?0:.52,ease:[.16,1,.3,1]}}>
        <figure className="nt-figure">
          <div className="nt-frame nt-vapor" style={step(2)}>
            <ArtLayer decoded={decoded} reduced={reduced} leaving={leaving} framed />
            {artLoading && <span className="nt-art-loading" aria-hidden="true"><DotMatrix size={24} reducedMotion={reduced} /></span>}
          </div>
          <Credit artwork={artwork} controls={artOn ? artControls : undefined} caption={prefs.caption} />
        </figure>
      </motion.div>}
    </div></div>}
  </div>;
}

type DecodedPicture = { artwork: CatalogArtwork; src: string; fallback?: boolean };
type Seen = DecodedPicture & { owner: string };
/** How a page's first picture came to be: its own tab's last decoded one ('own': nothing to fade, it is already right) or the one the page it replaced was showing
 *  ('carried': the page starts from that, and crossfades to its own once that is decoded, on the workspace length, so a switch never lands on an empty, dark ground). */
type Seed = 'own' | 'carried';
/** Decoded pictures per tab (a tab shows its own picture on its first frame when it comes back) and the one last on screen (the page a switch lands on starts from it). Small and in memory only. */
const seenByTab = new Map<string, Seen>();
let lastSeen: Seen | null = null;
/** The decoded images themselves are kept for a few pictures, so a page that returns to one paints it on its first frame without decoding it again. */
const held = new Map<string, HTMLImageElement>();
const remember = (tabId: string, picture: Seen, image?: HTMLImageElement) => {
  seenByTab.delete(tabId); seenByTab.set(tabId, picture); lastSeen = picture;
  if (seenByTab.size > 24) seenByTab.delete(seenByTab.keys().next().value as string);
  if (image) { held.delete(picture.src); held.set(picture.src, image); if (held.size > 8) held.delete(held.keys().next().value as string); }
};
/** Fetch and decode offscreen; one commit changes both the picture and its attribution. Effect cleanup rejects late generations. */
function useDecodedArtwork(candidate: CatalogArtwork | null, initial: CatalogArtwork, framed: boolean, enabled: boolean, owner: string, tabId: string, hold = false) {
  const [shown, setShown] = useState<DecodedPicture & { previous: DecodedPicture | null; owner: string; seed?: Seed; crossfade?: boolean }>(() => {
    const own = seenByTab.get(tabId), from = !enabled ? null : own?.owner === owner ? own : lastSeen?.owner === owner ? lastSeen : null;
    return from ? { artwork: from.artwork, src: from.src, fallback: from.fallback, previous: null, owner, seed: from === own ? 'own' : 'carried' } : { artwork: initial, src: '', previous: null, owner };
  });
  const [answer, setAnswer] = useState({ key: '', failed: false });
  const [attempt, setAttempt] = useState(0);
  const sameOwner = shown.owner === owner;
  const target = hold ? null : candidate ?? (sameOwner && shown.src ? null : initial);
  const source = target ? framed && target.thumb ? target.thumb : target.src : '';
  const key = owner + '|' + source + '|' + attempt;
  useEffect(() => {
    if (!enabled || !target || !source) return;
    let alive = true, decodedImage: HTMLImageElement | undefined;
    const decode = (src: string) => new Promise<string>((resolve, reject) => {
      const image = new Image(); image.decoding = 'async';
      image.onload = () => { void image.decode().then(() => { decodedImage = image; resolve(src); }, reject); };
      image.onerror = () => reject(Error('Image unavailable'));
      image.src = src;
    });
    void (async () => {
      try {
        let src: string;
        try { src = await decode(source); }
        catch (error) { if (source === target.src) throw error; src = await decode(target.src); }
        if (!alive) return;
        // The same picture again (a page that started from it) changes nothing on screen: no new layer, no fade. Another one replaces the seed, and a carried seed leaves on the workspace length (crossfade).
        setShown(old => { const swap = old.owner !== owner || old.src !== src; return { artwork: target, src, owner, previous: old.owner !== owner ? null : old.src && old.src !== src ? { artwork: old.artwork, src: old.src } : old.previous, ...(swap ? { crossfade: old.owner === owner && old.seed === 'carried' } : { seed: old.seed, crossfade: old.crossfade }) }; });
        remember(tabId, { artwork: target, src, owner }, decodedImage);
        setAnswer({ key, failed: false });
      } catch {
        if (!alive) return;
        // Initial offline fallback only. A failed replacement never discards a ready painting or changes its caption.
        if (!sameOwner || !shown.src) try { const src = await decode(fallbackArt); if (alive) setShown({ artwork: { id: 'dunes', name: '', src, alt: initial.alt }, src, previous: null, owner, fallback: true }); } catch { /* keep the page ground */ }
        if (alive) setAnswer({ key, failed: true });
      }
    })();
    return () => { alive = false; };
  }, [source, key, enabled]); // Metadata belongs to the source captured by this request.
  useEffect(() => { if (!shown.previous) return; const timer = window.setTimeout(() => setShown(old => ({ ...old, previous: null })), 420); return () => clearTimeout(timer); }, [shown.previous]);
  return { ...(sameOwner ? shown : { artwork: initial, src: '', previous: null, fallback: false, seed: undefined as Seed | undefined, crossfade: false }), loading: enabled && Boolean(source) && answer.key !== key, failed: enabled && answer.key === key && answer.failed, retry: () => setAttempt(value => value + 1) };
}

/** Both layers are already decoded; the preceding layer stays underneath until the new one settles. */
function ArtLayer({ decoded, reduced, leaving, framed }: { decoded: ReturnType<typeof useDecodedArtwork>; reduced: boolean; leaving?: boolean; framed?: boolean }) {
  const { artwork, src, previous, seed, crossfade } = decoded;
  return <div className="nt-art" data-state={src ? 'ready' : 'loading'} data-seeded={seed} data-crossfade={crossfade || undefined} data-framed={framed || undefined} data-leaving={framed ? undefined : leaving} data-reduced={reduced || undefined} style={{ '--nt-art-position': artwork.objectPosition || '50% 50%', '--nt-art-color': artwork.averageColor || 'transparent' } as CSSProperties}>
    {previous && <img className="nt-art-previous" src={previous.src} alt="" aria-hidden="true" decoding="sync" draggable={false} style={{ objectPosition: previous.artwork.objectPosition }} />}
    {src && <img key={src} data-current src={src} alt={artwork.alt} decoding={seed ? 'sync' : 'async'} draggable={false} />}
  </div>;
}

/** Bounded two-line attribution; its wrapped top-layer tooltip never changes the figure's geometry. */
function Credit({ artwork, controls, caption = true }: { artwork: CatalogArtwork; controls: ReactNode; caption?: boolean }) {
  const { title, byline, museum } = artworkCaption(artwork);
  const id = useId(), text = useRef<HTMLSpanElement>(null), tip = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const full = [title, byline.join(' · '), museum].filter(Boolean).join('\n');
  const hide = () => { clearTimeout(timer.current); tip.current?.hidePopover(); };
  useEffect(() => hide, []);
  const show = () => {
    const node = tip.current, anchor = text.current; if (!node || !anchor || !full) return;
    // The house tooltip (.t-tip, placed by its centre) opens over the caption itself: its text lands exactly on the caption's
    // text (8px padding) and unfolds downward into the free margin, so it never covers the painting unless the window is too short.
    if (!node.matches(':popover-open')) node.showPopover();
    // Never wider than the caption cell (plus its 8px pad each side), so the tooltip never lands on the Another image / Collection buttons beside it.
    const rect = anchor.getBoundingClientRect(); node.style.maxWidth = `${Math.min(560, innerWidth - 16, Math.max(240, rect.width + 16))}px`;
    const w = node.offsetWidth, h = node.offsetHeight;
    node.dataset.side = 'below';
    node.style.left = `${Math.max(8 + w / 2, Math.min(rect.left - 8 + w / 2, innerWidth - 8 - w / 2))}px`;
    node.style.top = `${Math.max(8 + h / 2, Math.min(rect.top - 8 + h / 2, innerHeight - 8 - h / 2))}px`;
  };
  return <figcaption className="nt-credit nt-vapor" data-caption={caption || undefined} style={step(3)}>
    <span ref={text} className="nt-credit-text" tabIndex={caption ? 0 : -1} aria-label={full} aria-describedby={id} aria-live="polite" hidden={!caption} onPointerEnter={() => { timer.current = setTimeout(show, 500); }} onPointerLeave={() => { clearTimeout(timer.current); if (document.activeElement !== text.current) hide(); }} onFocus={show} onBlur={hide} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); hide(); } }}>
      {/* dir="auto": an English title in an Arabic interface is cut at its end ("Wheat Field with Cypr…"), not its start ("…t Field
          with Cypresses"); new-tab-page.css keeps it on the interface's side. */}
      <span className="nt-credit-title" dir="auto"><bdi>{title}</bdi></span>
      {byline.length > 0 && <span className="nt-credit-meta" dir="auto"><bdi>{byline.join(' · ')}</bdi></span>}
    </span>
    <div ref={tip} id={id} className="t-tip nt-credit-tip" popover="manual" role="tooltip"><strong>{title}</strong>{[byline.join(' · '), museum].filter(Boolean).map(line => <span key={line}>{line}</span>)}</div>
    {controls}
  </figcaption>;
}
