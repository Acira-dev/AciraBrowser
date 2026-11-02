// Workspace popover: "Next workspace" / "Previous workspace" rows with their live keys (Ctrl+Alt+PageDown / PageUp from the shortcut
// registry), on the shared menu row, acting exactly like the shortcut (wrapping round); the popup estimate counts them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cycledWorkspace } from '../src/runtime/workspaces';
import { popupNaturalHeight } from '../src/ui/popup';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const state = (count: number, active: number) => ({
  activeBrowserProfileId: 'p', activeWorkspaceId: `w${active}`,
  workspaces: Array.from({ length: count }, (_, i) => ({ id: `w${i}`, name: i ? `W${i}` : '', browserProfileId: 'p' })),
}) as never;

test('next / previous wrap round the window\'s workspaces like the shortcut; none with a single workspace', () => {
  assert.equal(cycledWorkspace(state(3, 0), 1)?.id, 'w1');
  assert.equal(cycledWorkspace(state(3, 2), 1)?.id, 'w0', 'wraps forward');
  assert.equal(cycledWorkspace(state(3, 0), -1)?.id, 'w2', 'wraps back');
  assert.equal(cycledWorkspace(state(1, 0), 1), undefined);
  const main = read('desktop/main.cjs');
  assert.match(main, /const next=list\[\(Math\.max\(0,at\)\+command\.direction\+list\.length\)%list\.length\]/, 'the same rule as main\'s workspace-cycle');
});

test('the rows use the registry ids, their live keys and the shared row anatomy', () => {
  const menu = read('src/features/workspaces/WorkspaceMenu.tsx'), switcher = read('src/features/workspaces/WorkspaceSwitcher.tsx');
  assert.match(switcher, /\['next-workspace', 1, 'Next workspace', 'Ctrl \+ Alt \+ PgDn'\], \['prev-workspace', -1, 'Previous workspace', 'Ctrl \+ Alt \+ PgUp'\]/);
  assert.match(switcher, /export const cycleKey = \(id: typeof CYCLE_COMMANDS\[number\]\[0\], written: string\): string \| undefined => shortcutFor\(id, isMac\(\) \? undefined : written\);/);
  assert.match(menu, /list\.length > 1 && CYCLE_COMMANDS\.map/, 'offered only when there is somewhere to go');
  assert.match(menu, /className="acira-menu-row ws-menu-cycle"/);
  assert.match(menu, /<span className="acira-menu-title">\{label\}<\/span>\{key \? <span className="acira-menu-meta">\{key\}<\/span> : <span \/>\}/, 'the shared row: icon, title, trailing key (or an empty span)');
  assert.match(menu, /title=\{key \? `\$\{label\} · \$\{key\}` : label\}/, 'a long name that ellipsizes is still readable in the tooltip');
  assert.match(menu, /dispatch\(\{ type: 'workspace\.select', id: target\.id \}\)/);
  // The names already exist in every catalog (Settings › Shortcuts uses them): no new strings.
  for (const file of fs.readdirSync(path.join(root, 'src/i18n')).filter(name => /^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(name))) {
    const catalog = JSON.parse(read(`src/i18n/${file}`));
    for (const id of ['shortcutCmd.next-workspace', 'shortcutCmd.prev-workspace']) assert.ok(catalog[id], `${file} ${id}`);
  }
  const registry = read('desktop/shortcut-registry.cjs');
  assert.match(registry, /C\('next-workspace','Next workspace','Windows',\{action:'workspace-cycle',direction:1\},\['Mod\+Alt\+PageDown'\]\)/);
  assert.match(registry, /C\('prev-workspace','Previous workspace','Windows',\{action:'workspace-cycle',direction:-1\},\['Mod\+Alt\+PageUp'\]\)/);
});

test('the popover estimate adds the two rows from two workspaces on, and keeps the divider at eight', () => {
  const at = (count: number) => popupNaturalHeight('workspace-menu', { ...(state(count, 0) as object), tabs: [], activeTabId: '', settings: {} } as never);
  assert.equal(at(2) - at(1), 44 + 60, 'one more workspace row and the two cycle rows');
  assert.equal(at(3) - at(2), 44);
  assert.equal(at(8) - at(7), 44 - 39 + 9, 'at eight New workspace… goes, its divider stays for the cycle rows');
});
