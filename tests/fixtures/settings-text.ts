// Renders every Settings section in one interface language and prints what a person would read (text and the labels screen readers
// speak), plus the search registry's titles, descriptions and breadcrumbs, as JSON on stdout. tests/settings-translated.test.ts runs
// one of these per language: a page is built in one language (module-level text is translated when it loads), so each needs its own
// process.   node node_modules/tsx/dist/cli.mjs tests/fixtures/settings-text.ts <locale>
import { createRequire, register } from 'node:module';

// Vite-only pieces under Node: stylesheets load as nothing, and `import.meta.glob('./x/*.ts', { eager: true })` (the Settings registry
// and panel list) becomes static imports of the same files.
register('data:text/javascript,' + encodeURIComponent(`
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  const result = await next(url, context);
  if (!/\\/src\\/features\\/settings\\/(registry|panels)\\.ts$/.test(url.split('?')[0])) return result;
  let imports = '';
  const source = String(result.source).replace(/import\\.meta\\.glob(?:<[^>]*>)?\\(\\s*["']\\.\\/(\\w+)\\/\\*\\.(tsx?)["'][^)]*\\)/g, (_match, dir, ext) => {
    const files = readdirSync(path.join(path.dirname(fileURLToPath(url.split('?')[0])), dir)).filter(name => name.endsWith('.' + ext)).sort();
    return '({' + files.map((name, i) => { imports += 'import * as __glob_' + dir + i + ' from "./' + dir + '/' + name + '";\\n'; return JSON.stringify('./' + dir + '/' + name) + ': __glob_' + dir + i; }).join(',') + '})';
  });
  return { ...result, source: imports + source };
}`));

// Just enough of a browser page for the components to render once on the server (effects never run there).
const noop = () => {};
const store = new Map<string, string>();
const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } };
const element = () => ({ dataset: {}, style: { setProperty: noop, getPropertyValue: () => '' }, classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, getAttribute: () => null, setAttribute: noop, removeAttribute: noop, appendChild: noop, lang: '', dir: '' });
Object.assign(globalThis, {
  localStorage: storage, sessionStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  document: { documentElement: element(), body: element(), createElement: element, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', fonts: { ready: Promise.resolve() } },
});
Object.assign(globalThis, { window: Object.assign(globalThis, { addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, location: { search: '', href: 'acira-browser-ui://ui/index.html' } }) });
// The platform Settings is drawn for (tests/passkey-setting.test.cjs): navigator.platform as a Mac, Windows or Linux browser reports it.
if (process.env.ACIRA_TEST_NAVIGATOR_PLATFORM) Object.defineProperty(globalThis.navigator, 'platform', { value: process.env.ACIRA_TEST_NAVIGATOR_PLATFORM, configurable: true });
// Server rendering refuses a store without a server snapshot; here the client snapshot is the server's.
const require = createRequire(import.meta.url);
const React = require('react');
const syncStore = React.useSyncExternalStore;
React.useSyncExternalStore = (subscribe: unknown, get: unknown, server?: unknown) => syncStore(subscribe, get, server ?? get);

const locale = process.argv[2] || 'en';
const { setLocale, translateText } = await import('../../src/i18n');
await setLocale(locale as Parameters<typeof setLocale>[0]);
const { renderToStaticMarkup } = await import('react-dom/server');
const { Parser } = require('htmlparser2');
const { createInitialState } = await import('../../src/runtime/core');
const { settingsView, settingsViewKey } = await import('../../src/ui/settingsView');
const { BrowserSettings } = await import('../../src/features/BrowserSettings');
const { settingsRegistry, breadcrumb } = await import('../../src/features/settings/registry');
const { settingsPanels } = await import('../../src/features/settings/panels');
const { settingsSections } = await import('../../src/features/settings/model');

/** Text nodes and the attributes people read or hear, in document order. */
function readable(html: string): string[] {
  const out: string[] = [];
  let skip = 0, text = '';
  // The parser can hand one run of text over in pieces (around an entity): a run ends at a tag.
  const flush = () => { out.push(text); text = ''; };
  const parser = new Parser({
    onopentag(name: string, attributes: Record<string, string>) {
      flush();
      if (name === 'script' || name === 'style') skip++;
      for (const attribute of ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'placeholder', 'alt']) if (attributes[attribute]) out.push(attributes[attribute]);
    },
    ontext(chunk: string) { if (!skip) text += chunk; },
    onclosetag(name: string) { flush(); if (name === 'script' || name === 'style') skip--; },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  flush();
  return out.map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const sections = [...new Set([...settingsSections, ...settingsPanels.map(panel => panel.section)])];
const result: { sections: Record<string, string[]>; registry: string[] } = { sections: {}, registry: [] };
for (const [index, profiles] of [[1], [2]].entries()) {
  // A second profile shows the rows that say which profile a setting applies to.
  const state = createInitialState();
  if (profiles[0] === 2) state.browserProfiles.push({ ...state.browserProfiles[0], id: 'profile-work', name: 'Work', partition: 'persist:work' });
  const tab = state.tabs.find(item => item.id === state.activeTabId)!;
  tab.url = 'acira://settings';
  tab.id = `settings-${index}`;
  state.activeTabId = tab.id;
  for (const section of sections) {
    settingsView(settingsViewKey(tab)).section = section;
    const html = renderToStaticMarkup(React.createElement(BrowserSettings, { state, dispatch: noop }));
    result.sections[section] = [...new Set([...(result.sections[section] ?? []), ...readable(html)])];
  }
}
for (const entry of settingsRegistry) result.registry.push(entry.title, entry.description, ...breadcrumb(entry).map(translateText));
process.stdout.write(JSON.stringify(result));
