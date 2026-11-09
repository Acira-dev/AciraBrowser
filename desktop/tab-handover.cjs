'use strict';
// A tab moved to a new window (Move to new window, a drag out of the strip) is opened there from its address, so its page reloads. What the person
// set on the tab itself goes with it: its own name, mute and pin (they used to be lost: "Seven" arrived as "Page 7", unmuted and unpinned).
// Returns the actions to apply to the new window's first tab (the caller adds its id). Pure.
function handoverActions(tab) {
  if (!tab || typeof tab !== 'object') return [];
  const steps = [];
  if (typeof tab.customTitle === 'string' && tab.customTitle.trim()) steps.push({type: 'tab.rename', title: tab.customTitle});
  if (tab.muted === true) steps.push({type: 'tab.mute', muted: true});
  if (tab.pinned === true) steps.push({type: 'tab.pin'});
  return steps;
}
module.exports = {handoverActions};
