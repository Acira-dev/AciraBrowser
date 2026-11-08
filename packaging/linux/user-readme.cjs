'use strict';
// The README that goes into AciraBrowser-Linux-SetupFiles.zip, the one people read: how to install, what the installer does, how to uninstall, where help is.
// README.user.txt is the text with {{VERSION}} and {{IMAGE}} (the AppImage's file name) where the build fills them in; scripts/package-linux-handoff.mjs writes the result as
// README.txt beside the AppImage. BUILDER-README.txt is for whoever builds Acira on Linux and is never packed into the zip.
const fs=require('node:fs'),path=require('node:path');

const TEMPLATE=path.join(__dirname,'README.user.txt');
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,IMAGE=/^[A-Za-z0-9][A-Za-z0-9._-]*\.AppImage$/;

/** The user README for one build. version: the build's version (0.1.0-beta.13.1); image: the AppImage's file name (AciraBrowser-0.1.0-beta.13.1-linux-x86_64.AppImage). */
function userReadme({version,image,template=fs.readFileSync(TEMPLATE,'utf8')}={}){
 if(!VERSION.test(String(version)))throw new Error('The README needs the build\'s version (like 0.1.0-beta.13.1), not '+JSON.stringify(version)+'.');
 if(!IMAGE.test(String(image)))throw new Error('The README needs the AppImage\'s file name, not '+JSON.stringify(image)+'.');
 const text=template.replace(/\{\{VERSION\}\}/g,version).replace(/\{\{IMAGE\}\}/g,image);
 if(/\{\{|\}\}/.test(text))throw new Error('The README template has a placeholder this build does not fill.');
 return text;
}
module.exports={userReadme,TEMPLATE};
