import { useSyncExternalStore } from 'react';
import en from './en.json';
import { format, type Params } from './format';
import { resolveLocale, type LocaleCode } from './locales';
import { applyDocumentLocale } from './direction';
import { platformCatalogText } from './platform';
import { createSaid } from './said';

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

const said = createSaid();
/** Looks a message up in the active language, then English, then shows the id (never blank). Plain function: usable anywhere, including module level, because the language is fixed for a page's lifetime (changing it reloads the view). */
export function t(id: MessageId, params?: Params): string {
  const platform = typeof window !== 'undefined' ? window.acira?.platform || (/Mac/.test(navigator.platform) ? 'darwin' : '') : '';
  const text = format(locale, platformCatalogText(id, catalog[id] ?? (en as Catalog)[id] ?? id, platform), params);
  if (params) said.note(text, id, params);
  return text;
}
export const currentLocale = () => locale;

/** The catalog message `text` was made from by t() in this language (said.ts): a toast sent as text carries its id with it. */
export const saidAs = (text: string) => said.find(text, locale, () => (Object.keys(en) as MessageId[]).filter(id => !(catalog[id] ?? (en as Catalog)[id]).includes('{')).map(id => [id, t(id)] as const));

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
  // A page that loaded in its language ends that language's reload count: switching back and forth is never a loop.
  try { sessionStorage.removeItem(`${loopKey}:${locale}`); } catch { /* nothing counted */ }
}

/** Applies the Settings › Languages choice ('system' follows the Windows display language). A page is built in one language, so a
 *  change remembers the new one and reloads the view (the browser's state lives in the main process and loses nothing). */
let reloading = false;
export async function applyLanguageSetting(setting: string | undefined): Promise<void> {
  const target = resolveLocale(setting, systemTag());
  // Every snapshot comes here; those that arrive before this page unloads must not ask for (and count) another reload.
  if (target === locale || reloading) return;
  try {
    // A loop is the same language failing to stick: three reloads into it within a minute that each loaded another language. A load
    // that lands in its language clears its count (initLocale), and each language is counted on its own.
    const key = `${loopKey}:${target}`, now = Date.now(), seen = (JSON.parse(sessionStorage.getItem(key) || '[]') as number[]).filter(time => now - time < 60000);
    if (seen.length >= 3) return;
    sessionStorage.setItem(key, JSON.stringify([...seen, now]));
    localStorage.setItem(cacheKey, target);
    reloading = true;
    location.reload();
  } catch { await setLocale(target); }
}

/** For components that want to re-render if the language is ever switched without a reload. */
export function useT() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return t;
}
