'use strict';
// The two places the release tools write, and the private place the Windows and Linux machines hand their builds to.
//   legacy   the GitHub raw feed (folder feed/, branch main) that beta.1 to beta.10 read: written by beta.11 for the last time, then frozen.
//   current  update.acirabrowser.com = GitHub Pages of the repository named in update-targets.json (folder docs/, branch main).
//   handoff  the private source repository: each laptop uploads its finished build to a private release there (scripts/handoff.mjs).
// A target is {name, repo, branch, dir, publicBase}: dir is the folder in the repository, publicBase the address anyone can read the documents at.
const fs=require('node:fs'),path=require('node:path');
const {HOST_URL,GITHUB_FEED_URL}=require('../desktop/browser-services/update-hosts.cjs');
const SLUG=/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
function loadConfig(file=path.join(__dirname,'update-targets.json')){
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const key of ['legacyRepo','currentRepo','handoffRepo'])if(!SLUG.test(String(raw[key]||'')))throw Error('update-targets.json: "'+key+'" must be owner/name.');
 return raw;
}
function targets(config=loadConfig()){
 return Object.freeze({
  legacy:Object.freeze({name:'legacy',repo:config.legacyRepo,branch:'main',dir:'feed',publicBase:GITHUB_FEED_URL}),
  current:Object.freeze({name:'current',repo:config.currentRepo,branch:'main',dir:'docs',publicBase:HOST_URL}),
  handoffRepo:config.handoffRepo,
 });
}
module.exports={loadConfig,targets,SLUG};
