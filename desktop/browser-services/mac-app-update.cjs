'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const signer=require('./mac-distribution-identity.cjs');

// Squirrel.Mac validates incoming code against this application's signing identity.
// Enable delivery only for an installed, sealed Developer ID build with its feed.
function macUpdateAvailability({app,resourcesPath=process.resourcesPath,run=spawnSync}){
 try{
  const exe=fs.realpathSync(app.getPath('exe')),bundle=path.dirname(path.dirname(path.dirname(exe)));
  if(!bundle.endsWith('.app')||path.relative(bundle,exe)!=='Contents/MacOS/'+path.basename(exe))return 'Install Acira before using automatic updates.';
  fs.accessSync(path.dirname(bundle),fs.constants.W_OK);
  const resources=path.join(bundle,'Contents','Resources');
  if(!resourcesPath||fs.realpathSync(resourcesPath)!==resources||!fs.statSync(path.join(resources,'app-update.yml')).isFile())return 'This Mac build has no update feed. Install a distribution build.';
  const verified=run('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{encoding:'utf8',timeout:15000});
  if(verified.status!==0)return 'The installed application signature could not be verified.';
  const details=run('/usr/bin/codesign',['--display','--verbose=4',bundle],{encoding:'utf8',timeout:15000});
  const lines=(details.stderr||'').split(/\r?\n/);
  if(details.status!==0||!lines.includes('Authority=Developer ID Application: '+signer.name+' ('+signer.team+')')||!lines.includes('TeamIdentifier='+signer.team))return 'Automatic Mac updates require a Developer ID distribution build.';
  return null;
 }catch{return 'Install the distribution build in a writable Applications folder before using automatic updates.';}
}
module.exports={macUpdateAvailability};
