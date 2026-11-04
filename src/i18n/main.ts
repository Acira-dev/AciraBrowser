/** The main process's side of the catalog (menus, toasts, dialogs). Built to desktop/i18n.cjs with every catalog inside the bundle.
 *  Only English (the fallback) is built at start; another language is built the first time it is the one in use. Each `require` of a
 *  catalog is a lazily run module in the esbuild bundle, so the twelve unused catalogs stay unparsed text instead of live objects
 *  (R4-37: all thirteen as objects held about 10 MB of the main process's heap; English alone 0.4 MB). */
import { createRequire } from 'node:module';
import en from './en.json';
import { format, type Params } from './format';
import { resolveLocale, type LocaleCode } from './locales';
import { platformCatalogText } from './platform';
import { createSaid } from './said';

export type MessageId = keyof typeof en;
type Catalog = Record<string, string>;
// In the bundle `require` is esbuild's (the literal paths below are what puts each catalog in the bundle as a lazily run module).
// Run from source as ES modules (the tsx tests, from the repository root) there is no `require`, and Node's own reads the same files.
// (No module-URL lookup here: the release bundle is CommonJS and must build without warnings.)
const fromSource = typeof require === 'function' ? null : createRequire(process.cwd() + '/src/i18n/main.ts');
const pick = (bundled: () => Catalog, file: string): (() => Catalog) => fromSource ? () => fromSource(file) as Catalog : bundled;
const load: Record<Exclude<LocaleCode, 'en'>, () => Catalog> = {
  es: pick(() => require('./es.json'), './es.json'), fr: pick(() => require('./fr.json'), './fr.json'), de: pick(() => require('./de.json'), './de.json'),
  'pt-BR': pick(() => require('./pt-BR.json'), './pt-BR.json'), it: pick(() => require('./it.json'), './it.json'), ja: pick(() => require('./ja.json'), './ja.json'),
  'zh-CN': pick(() => require('./zh-CN.json'), './zh-CN.json'), ar: pick(() => require('./ar.json'), './ar.json'), tr: pick(() => require('./tr.json'), './tr.json'),
  ru: pick(() => require('./ru.json'), './ru.json'), ko: pick(() => require('./ko.json'), './ko.json'), hi: pick(() => require('./hi.json'), './hi.json'),
};
const catalogs: Partial<Record<LocaleCode, Catalog>> = { en };
const catalog = (code: LocaleCode): Catalog => catalogs[code] ??= code === 'en' ? en : load[code]();
let locale: LocaleCode = 'en';

/** `setting` is the Settings › Languages value ('system' or a code); `systemTag` is Electron's app.getLocale(). */
export function setMainLocale(setting: string | undefined, systemTag: string): LocaleCode { locale = resolveLocale(setting, systemTag); return locale; }
const said = createSaid();
export function tm(id: MessageId, params?: Params): string {
  const text = format(locale, platformCatalogText(id, catalog(locale)[id] ?? (en as Catalog)[id] ?? id, process.platform), params);
  if (params) said.note(text, id, params);
  return text;
}
export const mainLocale = () => locale;
/** The catalog message `text` was made from by tm() in the language in use (said.ts): main's toasts keep their id with it. */
export const saidAs = (text: string) => said.find(text, locale, () => (Object.keys(en) as MessageId[]).filter(id => !(catalog(locale)[id] ?? (en as Catalog)[id]).includes('{')).map(id => [id, tm(id)] as const));
export { resolveLocale };
