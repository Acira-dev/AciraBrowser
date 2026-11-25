// The unsaved-work close card, for the release gates that close a window or a tab whose page asked to keep its work (release-profile-cleanup, release-private-close).
//
// Until Beta 14 step 5 the card was the site-prompt page (desktop/site-prompt.html: #card, a list of the unsaved sites in #sites, buttons "Close anyway" / "Keep editing").
// Now one unsaved site is the reference design's sample "Leave without saving?" card, drawn by the INTERFACE's dialog popup in the overlay page (desktop/site-prompt.cjs presentOverlay ->
// src/features/dialogs/DialogLayer.tsx, a role=dialog named by the title): a file tile, the sentence "Changes you made on <site> may not be saved.", Leave and Keep editing (the primary),
// asked by the tab strip. Only several unsaved sites keep the list card. The gates close ONE window with ONE unsaved site, so this is the card they must see; the legacy page is only
// what main falls back to when the interface cannot draw it (ACIRA_DIALOG_CARD=1, interface down), which is not what a person gets, so it does not count as the card here.
import assert from 'node:assert/strict';
import {poll} from './native-helpers.mjs';

export const UNSAVED_CARD = {title: 'Leave without saving?', detail: host => 'Changes you made on ' + host + ' may not be saved.', leave: 'Leave', keep: 'Keep editing'};

const overlayPages = app => app.context().pages().filter(page => { try { return page.url().includes('view=overlay'); } catch { return false; } });

/** Waits for the card of ONE unsaved site on `host`, checks everything the card promises (title, the sentence naming the site, exactly Leave and Keep editing), and
 * returns `{page, dialog, keepEditing()}`; keepEditing() presses it and waits for the card to be gone. */
export async function unsavedWorkCard(app, host) {
  const found = await poll(async () => {
    for (const page of overlayPages(app)) try {
      const dialog = page.getByRole('dialog', {name: UNSAVED_CARD.title, exact: true});
      if (await dialog.isVisible() && await dialog.getByRole('button', {name: UNSAVED_CARD.keep, exact: true}).isVisible()) return {page, dialog};
    } catch {}
  }, Boolean, 'Actual unsaved-work close card');
  const {page, dialog} = found;
  assert.match(await dialog.innerText(), new RegExp(UNSAVED_CARD.detail(host).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'The close card names the actual unsaved site');
  assert.deepEqual((await dialog.getByRole('button').allInnerTexts()).map(text => text.trim()).sort(), [UNSAVED_CARD.keep, UNSAVED_CARD.leave].sort(), 'The close card offers exactly Leave and Keep editing');
  return {
    page, dialog,
    async keepEditing() {
      await dialog.getByRole('button', {name: UNSAVED_CARD.keep, exact: true}).click();
      await poll(() => dialog.isVisible(), visible => !visible, 'Keep editing dismisses the close card');
    },
  };
}
