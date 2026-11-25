'use strict';
// Every media element of a page, attached or not (Beta 14.1, Spotify's web player). A player that makes its element with createElement('audio') or `new Audio()` and never puts it in the
// document is invisible to document.querySelectorAll('video,audio'), so pause, play, volume, position and the rest saw nothing. browser-services/media-session-preload.cjs remembers each
// element `play()` was called on (a WeakRef list in the page's note, `note.all()`, most recently played first). MEDIA_LIST is the document's media, then those that are not in it; it is
// the expression the fixed scripts (media-controls.cjs, unseen-media-gate.cjs) run in the page, and `withAll` puts it where such a script asks the document for its media.
const SELECTOR = "document.querySelectorAll('video,audio')";
const MEDIA_LIST = "(()=>{const a=[...document.querySelectorAll('video,audio')];try{const n=window[Symbol.for('acira.mediaSession')];if(n&&typeof n.all==='function')for(const e of n.all())if(!a.includes(e))a.push(e);}catch{}return a;})()";
const withAll = script => script.split(SELECTOR).join(MEDIA_LIST);
module.exports = { MEDIA_LIST, withAll, SELECTOR };
