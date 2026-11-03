import { useSyncExternalStore } from 'react';
import en from './en.json';
import { format, type Params } from './format';
import { resolveLocale, type LocaleCode } from './locales';
import { applyDocumentLocale } from './direction';
import { platformCatalogText } from './platform';

/** Every message id, taken from the English catalog: a typo in `t('…')` is a type error. */
export type MessageId = keyof typeof en;
type Catalog = Record<string, string>;

const loaders: Record<LocaleCode, () => Promise<{ default: Catalog }>> = {
  en: () => Promise.resolve({ default: en as Catalog }),
  es: () => import('./es.json'), fr: () => import('./fr.json'), de: () => import('./de.json'), 'pt-BR': () => import('./pt-BR.json'),
  it: () => import('./it.json'), ja: () => import('./ja.json'), 'zh-CN': () => import('./zh-CN.json'),
  ar: () => import('./ar.json'), tr: () => import('./tr.json'), ru: () => import('./ru.json'),
  ko: () => import('./ko.json'), hi: () => import('./hi.json'),
};
const cacheKey = 'acira-locale', loopKey = 'acira-locale-reloads';
let locale: LocaleCode = 'en', catalog: Catalog = en as Catalog, version = 0;
const listeners = new Set<() => void>();
const systemTag = () => (typeof navigator === 'undefined' ? 'en' : navigator.language);

/** Looks a message up in the active language, then English, then shows the id (never blank). Plain function: usable anywhere, including module level, because the language is fixed for a page's lifetime (changing it reloads the view). */
export function t(id: MessageId, params?: Params): string {
  const platform = typeof window !== 'undefined' ? window.acira?.platform || (/Mac/.test(navigator.platform) ? 'darwin' : '') : '';
  return format(locale, platformCatalogText(id, catalog[id] ?? (en as Catalog)[id] ?? id, platform), params);
}
export const currentLocale = () => locale;

let reverse: Map<string, string> | null = null;
/** For text that is still English in code (hints, titles built from a label): its translation when the English text is in the catalog, else itself. */
export function translateText(english: string): string {
  reverse ??= new Map(Object.entries(en as Catalog).map(([id, text]) => [text, id]));
  const id = reverse.get(english);
  return id ? t(id as MessageId) : english;
}

export async function setLocale(code: LocaleCode): Promise<void> {
  if (code === locale) {
    if (typeof document !== 'undefined') applyDocumentLocale(document.documentElement, code);
    return;
  }
  let next: Catalog;
  try { next = (await loaders[code]()).default; } catch { return; }
  catalog = next; locale = code;
  if (typeof document !== 'undefined') applyDocumentLocale(document.documentElement, code);
  try { localStorage.setItem(cacheKey, code); } catch { /* the language still applies for this run */ }
  version++; listeners.forEach(listener => listener());
}

/** Before the first render and before any screen module runs: the last language used, else the system's, so nothing flashes in English first. */
export async function initLocale(): Promise<void> {
  let cached = '';
  try { cached = localStorage.getItem(cacheKey) || ''; } catch { /* no cache */ }
  await setLocale(resolveLocale(cached || 'system', systemTag()));
}

/** Applies the Settings › Languages choice ('system' follows the Windows display language). A page is built in one language, so a
 *  change remembers the new one and reloads the view (the browser's state lives in the main process and loses nothing). */
export async function applyLanguageSetting(setting: string | undefined): Promise<void> {
  const target = resolveLocale(setting, systemTag());
  if (target === locale) return;
  try {
    const now = Date.now(), seen = (JSON.parse(sessionStorage.getItem(loopKey) || '[]') as number[]).filter(time => now - time < 60000);
    if (seen.length >= 3) return;
    sessionStorage.setItem(loopKey, JSON.stringify([...seen, now]));
    localStorage.setItem(cacheKey, target);
    location.reload();
  } catch { await setLocale(target); }
}

/** For components that want to re-render if the language is ever switched without a reload. */
export function useT() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return t;
}
