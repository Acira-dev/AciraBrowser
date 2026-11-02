'use strict';
// A style Acira lays on a website for a moment and takes off again (a matte while it changes shape, no text selection while a
// divider is dragged). In Electron 44 `removeInsertedCSS` resolves but leaves the rule in force (qa: a blur inserted, removed and
// read back stays), so a rule inserted that way could never be taken off. Here each named style is one constructable stylesheet
// adopted by the document from Acira's own isolated world: the page's scripts never see it in the DOM, replacing its text is
// atomic, and emptying it takes it off for certain. A new document starts without it.
const WORLD = 1407;

const script = (name, css) => `(()=>{const key=${JSON.stringify('__aciraStyle:' + name)},css=${JSON.stringify(css)};let sheet=window[key];
if(!sheet){if(!css)return true;sheet=window[key]=new CSSStyleSheet();}
sheet.replaceSync(css);const list=document.adoptedStyleSheets;
if(css&&!list.includes(sheet))document.adoptedStyleSheets=[...list,sheet];
if(!css&&list.includes(sheet))document.adoptedStyleSheets=list.filter(item=>item!==sheet);
return true;})()`;

/** Sets the style `name` on `wc` to `css` (an empty string takes it off). Resolves false when the page could not take it. */
function setPageStyle(wc, name, css) {
  if (!wc || wc.isDestroyed()) return Promise.resolve(false);
  return Promise.resolve(wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: script(name, css) }], false)).then(() => true, () => false);
}

module.exports = { setPageStyle };
