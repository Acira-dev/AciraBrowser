'use strict';
// Acira's own version, the full build version so builds can be told apart (0.1.0-beta.6.local.4, not 0.1.0-beta.6).
// A packaged app answers app.getVersion() with the version the packager stamped into it; the bundled main.cjs carries the repository's package.json,
// which does not have the build suffix. From source app.getVersion() answers with Electron's version, so the repository's package.json is read there.
// A version the usage server would refuse (supabase/functions/usage/handler.mjs VERSION, at most 24 characters) falls back to package.json's, so the
// counts still arrive.
const VERSION=/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/;
function appVersion({app=null,source=require('../../package.json').version}={}){
 const fallback=String(source);
 let packaged=null;try{if(app?.isPackaged)packaged=String(app.getVersion());}catch{}
 return packaged&&packaged.length<=24&&VERSION.test(packaged)?packaged:fallback;
}
let electronApp=null;try{electronApp=require('electron').app||null;}catch{}
module.exports={version:appVersion({app:electronApp}),appVersion};
