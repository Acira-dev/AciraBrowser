'use strict';
// Where an installed Acira asks whether a newer version exists. One place for the app (desktop/) and for the packaging and publishing tools (packaging/, scripts/).
//   HOST_URL        update.acirabrowser.com: the address beta.11 and later ask first (GitHub Pages of the public updates repository).
//   GITHUB_FEED_URL the GitHub raw feed that every build up to beta.10 reads, and that beta.11 and later fall back to. It is written for the last time by
//                   beta.11 and then frozen for good: copies that come back after months still find beta.11 there and update from it (docs/launch/UPDATE_HOST.md).
//   MIRROR_FEED_URLS  copies of the feed on another host than GitHub (beta.13.2; empty until the founder has one). Same layout as update.acirabrowser.com, so an address on the new
//                   host has a matching address under each mirror (mirrorsFor). Asked after the first address and before the frozen GitHub feed, under the same rules as any later
//                   address (update-feeds.cjs rule 3: it counts only if it offers a version STRICTLY NEWER than the running one). The files a feed lists may name mirrors of their own
//                   (files[].mirrors, update-download.cjs); this list is only for the feed documents.
// A build's app-update.yml names its first address; the other is derived from it (fallbackFor), so a build that names anything else (a QA feed, a local
// rig) asks that address alone.
const HOST_URL='https://update.acirabrowser.com/';
const GITHUB_FEED_URL='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const MIRROR_FEED_URLS=[]; // e.g. 'https://updates.example.com/' once there is a host; nothing else in the app names a mirror
const TESTERS_PATH='testers/'; // the folder only the founder's own machines are pointed at (local opt-in, see updater.json "testersFeed")
const REHEARSAL_PATH='rehearsal/'; // the folder a beta.10 test copy is pointed at to rehearse the bridge release (never read by an installed app)

/** The GitHub address that matches an address on the new host (the Linux folder included), or null for any other address. */
function fallbackFor(url){return typeof url==='string'&&url.startsWith(HOST_URL)?GITHUB_FEED_URL+url.slice(HOST_URL.length):null;}
/** The testers address that matches an address on the new host, or null for any other address. */
function testersFor(url){return typeof url==='string'&&url.startsWith(HOST_URL)?HOST_URL+TESTERS_PATH+url.slice(HOST_URL.length):null;}
/** The addresses under each mirror that match an address on the new host (the Linux folder included); a mirror that is not an https address (or an http one on this computer, for rigs) is ignored. */
function mirrorsFor(url,list=MIRROR_FEED_URLS){
 if(typeof url!=='string'||!url.startsWith(HOST_URL)||!Array.isArray(list))return [];
 const seen=new Set(),result=[];
 for(const item of list){
  let base;try{base=new URL(String(item));}catch{continue;}
  const local=/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(base.hostname);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&local))continue;
  if(base.username||base.password||base.search||base.hash)continue;
  const root=base.href.endsWith('/')?base.href:base.href+'/',address=root+url.slice(HOST_URL.length);
  if(!seen.has(address)&&root!==HOST_URL&&root!==GITHUB_FEED_URL){seen.add(address);result.push(address);}
 }
 return result;
}
/** The addresses to ask, in order: [{name, url}]. testers: only the founder's testers folder, never GitHub. mirrors: the mirror feeds' addresses (MIRROR_FEED_URLS; none today). */
function feedsFor({primary,testers=false,mirrors=MIRROR_FEED_URLS}={}){
 if(typeof primary!=='string'||!/^https?:\/\//.test(primary))return [];
 const base=primary.endsWith('/')?primary:primary+'/';
 const folder=testers?testersFor(base):null;
 if(folder)return [{name:'testers',url:folder}];
 const fallback=fallbackFor(base);
 return fallback?[{name:'primary',url:base},...mirrorsFor(base,mirrors).map(url=>({name:'mirror',url})),{name:'fallback',url:fallback}]:[{name:'primary',url:base}];
}
/** The first address in an app-update.yml's text (the JSON-string form the packagers write, or plain YAML), or null. */
function feedUrlFromConfig(text){
 const match=/^url:\s*["']?([^"'\s]+)/m.exec(String(text||''));
 return match?match[1]:null;
}
module.exports={HOST_URL,GITHUB_FEED_URL,MIRROR_FEED_URLS,TESTERS_PATH,REHEARSAL_PATH,fallbackFor,testersFor,mirrorsFor,feedsFor,feedUrlFromConfig};
