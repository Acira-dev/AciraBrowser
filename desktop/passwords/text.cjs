'use strict';
// User-facing text of the password backend (Windows prompt, dialogs, errors, the in-page prompt). Main sets the translator
// (its `tm`, which follows Settings › Languages); until then, and in tests, the English written at each call is used, so
// these modules never depend on the catalog being loaded.
let translate = null;
const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (all, key) => (key in params ? String(params[key]) : all)) : text);

function setTranslator(fn) {
  translate = typeof fn === 'function' ? fn : null;
}

/** tr('pw.id', 'English', {name}) */
function tr(id, english, params) {
  if (translate) {
    try {
      const value = translate(id, params);
      if (typeof value === 'string' && value && value !== id) return value;
    } catch {}
  }
  return fill(english, params);
}

/** The words the in-page save prompt shows; sent with each state so the frame follows the language. */
const frameStrings = () => ({
  list: tr('pw.frame.list', 'Saved passwords'),
  close: tr('pw.frame.close', 'Close'),
  username: tr('pw.frame.username', 'Username'),
  password: tr('pw.frame.password', 'Password'),
  never: tr('pw.frame.never', 'Never for this site'),
  titleSave: tr('pw.frame.titleSave', 'Save password?'),
  titleUpdate: tr('pw.frame.titleUpdate', 'Update password?'),
  save: tr('pw.frame.save', 'Save'),
  update: tr('pw.frame.update', 'Update'),
  noUsername: tr('pw.frame.noUsername', 'No username'),
});

module.exports = { setTranslator, tr, frameStrings };
