import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, Search, X } from '../../components/AppIcons';
import { useListMotion } from '../../ui/sharedMotion';
import { breadcrumb, settingsRegistry, type SettingsContext, type SettingsEntry } from './registry';
import { searchSettingsDetailed, type SettingsHit } from './search';

import { t, translateText } from '../../i18n';
/** Where a result lives (section, then group), in the interface language: the registry keeps the English names. */
const trail = (entry: SettingsEntry) => breadcrumb(entry).map(translateText);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text: string, query: string): ReactNode {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (!tokens.length) return text;
  const parts = text.split(new RegExp(`(${tokens.join('|')})`, 'ig'));
  return parts.map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>));
}

export interface SettingsSearchProps {
  query: string;
  onQuery: (value: string) => void;
  context: SettingsContext;
  /** Called when a person picks a result. Must only navigate; never change the setting. */
  onSelect: (entry: SettingsEntry) => void;
}

export function SettingsSearch({ query, onQuery, context, onSelect }: SettingsSearchProps) {
  const uid = useId(), resultsRef = useRef<HTMLUListElement>(null); useListMotion(resultsRef, query);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trimmed = query.trim();
  const result = useMemo(() => (trimmed ? searchSettingsDetailed(settingsRegistry, trimmed, context) : { hits: [] as SettingsHit[], corrected: undefined as string | undefined }), [trimmed, context.customGlassColors, context.privateProfile, context.desktop, context.websiteOpen, context.appearanceChanged, context.toolbarChanged, context.newTabChanged, context.stockSearch, context.verticalTabs, context.hideToolbarRow, context.sidebarClosable]);
  const hits: SettingsHit[] = result.hits, corrected = result.corrected, marked = corrected ?? trimmed;
  const showList = open && Boolean(trimmed);
  const status = !trimmed ? '' : hits.length ? `${corrected ? `${t("settingssearch.showingFor", { query: corrected })}. ` : ''}${t('settingssearch.foundStatus', { count: hits.length })}` : t('settingssearch.noneFoundStatus', { query: trimmed });

  useEffect(() => setActive(0), [trimmed]);
  // `/` and Ctrl+F (handled by Settings) move focus here.
  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('acira:settings-focus-search', focus);
    return () => window.removeEventListener('acira:settings-focus-search', focus);
  }, []);
  useEffect(() => {
    if (showList) root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, showList]);

  const choose = (hit: SettingsHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    onSelect(hit.entry);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!showList) setOpen(true);
      else setActive((index) => (hits.length ? (index + 1) % hits.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (showList) setActive((index) => (hits.length ? (index - 1 + hits.length) % hits.length : 0));
    } else if (event.key === 'Enter') {
      if (showList && hits.length) {
        event.preventDefault();
        choose(hits[active]);
      }
    } else if (event.key === 'Escape') {
      if (showList) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (query) {
        event.preventDefault();
        event.stopPropagation();
        onQuery('');
      }
    } else if (event.key === 'Home' && showList && hits.length) {
      if (event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) setActive(0);
    }
  };

  return (
    <div
      className="st-search"
      ref={root}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <div className="st-search-field" data-focused-within>
        <Search size={17} />
        <input
          ref={input}
          role="combobox"
          aria-label={t("settingssearch.searchSettings")}
          aria-expanded={showList}
          aria-controls={showList ? `${uid}-list` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits.length ? `${uid}-r${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("settingssearch.searchSettings")}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {!query && <kbd className="st-kbd" aria-hidden="true">/</kbd>}
        {query && (
          <button
            type="button"
            className="st-search-clear"
            aria-label={t("settingssearch.clearSettingsSearch")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onQuery('');
              input.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="st-sr-only" role="status" aria-live="polite">
        {status}
      </div>
      {showList && (
        <ul ref={resultsRef} id={`${uid}-list`} className="st-results" role="listbox" aria-label={t("settingssearch.matchingSettings")} onMouseDown={(event) => event.preventDefault()}>
          {hits.length === 0 ? (
            <li className="st-result-empty" role="presentation">
              <strong>{t("settingssearch.noMatch", { query: trimmed })}</strong>
              <span>{t("settingssearch.tryASimplerWordSuch")}</span>
            </li>
          ) : (
            [corrected ? <li key="corrected" className="st-result-note" role="presentation">{t("settingssearch.showingFor", { query: corrected })}</li> : null, ...hits.map((hit, index) => (
              <li key={hit.entry.id} id={`${uid}-r${index}`} role="option" aria-selected={index === active} data-active={index === active} onPointerEnter={() => setActive(index)} onClick={() => choose(hit)}>
                <span className="st-result-title">{highlight(hit.entry.title, marked)}</span>
                <span className="st-result-trail" aria-label={t("settingssearch.inJoin", { join: trail(hit.entry).join(', ') })}>
                  {trail(hit.entry).map((part, partIndex) => (
                    <Fragment key={part}>
                      {partIndex > 0 && <ChevronRight size={11} />}
                      {part}
                    </Fragment>
                  ))}
                </span>
                <span className="st-result-detail">
                  {hit.via ? (
                    <>
                      {t("settingssearch.alsoKnownAs")} “{highlight(hit.via, marked)}”. {hit.entry.description}
                    </>
                  ) : (
                    highlight(hit.entry.description, marked)
                  )}
                </span>
              </li>
            ))]
          )}
        </ul>
      )}
    </div>
  );
}
