'use strict';
// Where an installed Acira asks whether a newer version exists. One place for the app (desktop/) and for the packaging and publishing tools (packaging/, scripts/).
//   HOST_URL        update.acirabrowser.com: the address beta.11 and later ask first (GitHub Pages of the public updates repository).
//   GITHUB_FEED_URL the GitHub raw feed that every build up to beta.10 reads, and that beta.11 and later fall back to. It is written for the last time by
//                   beta.11 and then frozen for good: copies that come back after months still find beta.11 there and update from it (docs/launch/UPDATE_HOST.md).
// A build's app-update.yml names its first address; the other is derived from it (fallbackFor), so a build that names anything else (a QA feed, a local
// rig) asks that address alone.
const HOST_URL='https://update.acirabrowser.com/';
const GITHUB_FEED_URL='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const TESTERS_PATH='testers/'; // the folder only the founder's own machines are pointed at (local opt-in, see updater.json "testersFeed")
const REHEARSAL_PATH='rehearsal/'; // the folder a beta.10 test copy is pointed at to rehearse the bridge release (never read by an installed app)

/** The GitHub address that matches an address on the new host (the Linux folder included), or null for any other address. */
function fallbackFor(url){return typeof url==='string'&&url.startsWith(HOST_URL)?GITHUB_FEED_URL+url.slice(HOST_URL.length):null;}
/** The testers address that matches an address on the new host, or null for any other address. */
function testersFor(url){return typeof url==='string'&&url.startsWith(HOST_URL)?HOST_URL+TESTERS_PATH+url.slice(HOST_URL.length):null;}
/** The addresses to ask, in order: [{name, url}]. testers: only the founder's testers folder, never GitHub. */
function feedsFor({primary,testers=false}={}){
 if(typeof primary!=='string'||!/^https?:\/\//.test(primary))return [];
 const base=primary.endsWith('/')?primary:primary+'/';
 const folder=testers?testersFor(base):null;
 if(folder)return [{name:'testers',url:folder}];
 const fallback=fallbackFor(base);
 return fallback?[{name:'primary',url:base},{name:'fallback',url:fallback}]:[{name:'primary',url:base}];
}
/** The first address in an app-update.yml's text (the JSON-string form the packagers write, or plain YAML), or null. */
function feedUrlFromConfig(text){
 const match=/^url:\s*["']?([^"'\s]+)/m.exec(String(text||''));
 return match?match[1]:null;
}
module.exports={HOST_URL,GITHUB_FEED_URL,TESTERS_PATH,REHEARSAL_PATH,fallbackFor,testersFor,feedsFor,feedUrlFromConfig};
