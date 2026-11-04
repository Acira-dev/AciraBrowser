import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { BrowserSnapshot } from '../src/runtime/types';
import { popupEstimateMeasured } from '../src/ui/popup';

// The workspace menus' "Lock this workspace · Own sign-ins · opens with macOS" row ended in an ellipsis in 12 of 13 languages
// (English: "opens with macO…"; Arabic even crossed the menu's edge). It wraps now, and the switcher, whose first frame otherwise
// trusts an estimate that cannot know the wrap, waits for its measured height while that row is on screen.
const css = fs.readFileSync(new URL('../src/styles/workspaces.css', import.meta.url), 'utf8');

test('the Lock row wraps in both workspace menus and only that row', () => {
  assert.match(css, /:is\(\.popup-content-workspace-context, \.popup-content-workspace-menu\) \.acira-menu-row-identity:has\(\.ws-beta\) \{ height: auto; min-height: 44px;/);
  assert.match(css, /\.acira-menu-row-identity:has\(\.ws-beta\) :is\(\.acira-menu-title, \.acira-menu-sub\) \{ white-space: normal;/);
});

const state = (active: number, secured = false) => ({
  activeBrowserProfileId: 'p', browserProfiles: [{ id: 'p' }], tabs: [], activeWorkspaceId: `w${active}`,
  workspaces: [0, 1, 2].map(index => ({ id: `w${index}`, name: index ? `W${index}` : '', browserProfileId: 'p', ...(secured && index ? { secured: true } : {}) })),
}) as unknown as BrowserSnapshot;

test('the switcher waits for its measured height only while the Lock row is shown', () => {
  assert.equal(popupEstimateMeasured('workspace-menu', state(0)), true, 'first workspace: no Lock row, the estimate is trusted');
  assert.equal(popupEstimateMeasured('workspace-menu', state(2)), false, 'another workspace: Lock row, measured');
  assert.equal(popupEstimateMeasured('workspace-menu', state(2, true)), true, 'a locked workspace shows plain rows');
  assert.equal(popupEstimateMeasured('menu', state(2)), true, 'other menus unchanged');
});
