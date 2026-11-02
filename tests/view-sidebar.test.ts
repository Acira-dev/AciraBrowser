import test from 'node:test';
import assert from 'node:assert/strict';
import { tuckSidebarStep } from '../src/ui/viewSidebar';

test('R4-25 Compact and Focus tuck an open sidebar (tabs in the sidebar); Full and Seamless bring back what the switch closed', () => {
  const into = tuckSidebarStep({ before: 'full', after: 'compact', sidebarTabs: true, open: true, reopen: false });
  assert.deepEqual(into, { open: false, reopen: true });
  assert.deepEqual(tuckSidebarStep({ before: 'compact', after: 'focus', sidebarTabs: true, open: false, reopen: true }), { reopen: true }, 'slim to slim keeps it tucked');
  assert.deepEqual(tuckSidebarStep({ before: 'focus', after: 'full', sidebarTabs: true, open: false, reopen: true }), { open: true, reopen: false });
  assert.deepEqual(tuckSidebarStep({ before: 'compact', after: 'seamless', sidebarTabs: true, open: false, reopen: true }), { open: true, reopen: false });
});

test('R4-25 a sidebar the person closed or opened themselves is left alone; the strip layout never touches it', () => {
  assert.deepEqual(tuckSidebarStep({ before: 'full', after: 'compact', sidebarTabs: true, open: false, reopen: false }), { reopen: false });
  // Opened with Ctrl+S while Compact, then back to Full: stays open, nothing to reopen.
  assert.deepEqual(tuckSidebarStep({ before: 'compact', after: 'full', sidebarTabs: true, open: true, reopen: true }), { reopen: false });
  assert.deepEqual(tuckSidebarStep({ before: 'compact', after: 'full', sidebarTabs: true, open: false, reopen: false }), { reopen: false });
  assert.deepEqual(tuckSidebarStep({ before: 'full', after: 'compact', sidebarTabs: false, open: true, reopen: false }), { reopen: false });
  assert.deepEqual(tuckSidebarStep({ before: 'full', after: 'full', sidebarTabs: true, open: true, reopen: true }), { reopen: true });
});
