'use strict';
// Origin matching for saved logins (reference: Chromium components/password_manager/core/browser/password_form_manager
// and its affiliation/PSL matching). The page origin always comes from the browser process, never from page content.
//   exact    same scheme, host and port
//   upgrade  saved on http, offered on https for the same host (default ports only): sites that moved to https
//   site     same registrable domain, https on both sides, not an IP / single-label host; always a separate, labelled row
// A login saved on https is never offered on http.
const {getDomain}=require('tldts');
const MAX_URL=4096;

function normalizeOrigin(value){
 if(typeof value!=='string'||value.length>MAX_URL)return null;
 try{
  const url=new URL(value);
  if(url.protocol!=='http:'&&url.protocol!=='https:')return null;
  if(url.username||url.password||!url.hostname)return null;
  return url.origin;
 }catch{return null;}
}
function parts(origin){const url=new URL(origin);return {scheme:url.protocol,host:url.hostname.toLowerCase(),port:url.port||(url.protocol==='https:'?'443':'80')};}
const isIpHost=host=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(':');
/** Registrable domain with private suffixes honoured (a.github.io and b.github.io are different sites). */
function siteOf(host){if(isIpHost(host)||!host.includes('.'))return null;return getDomain(host,{allowPrivateDomains:true});}

/** 'exact' | 'upgrade' | 'site' | null for a saved origin against the page being viewed. */
function classify(savedOrigin,pageUrl){
 const saved=normalizeOrigin(savedOrigin),page=normalizeOrigin(pageUrl);
 if(!saved||!page)return null;
 const a=parts(saved),b=parts(page);
 if(a.scheme===b.scheme&&a.host===b.host&&a.port===b.port)return 'exact';
 if(a.scheme==='http:'&&b.scheme==='https:'&&a.host===b.host&&a.port==='80'&&b.port==='443')return 'upgrade';
 if(a.scheme==='https:'&&b.scheme==='https:'&&a.host!==b.host&&a.port===b.port){
  const site=siteOf(a.host);
  if(site&&site===siteOf(b.host))return 'site';
 }
 return null;
}
const RANK={exact:0,upgrade:1,site:2};
/** Display host for a row ("example.com", "mail.example.com:8443"). */
function displayHost(origin){try{const url=new URL(origin);return url.host.replace(/^www\./,'');}catch{return '';}}
module.exports={normalizeOrigin,classify,siteOf,displayHost,RANK};
