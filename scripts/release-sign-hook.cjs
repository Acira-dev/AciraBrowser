'use strict';
// electron-builder's custom sign function (win.signtoolOptions.sign, set by packaging/signing-config.cjs applySigning in Certum mode). electron-builder signs the
// NSIS uninstaller and the setup itself while it builds, so their signatures exist before it computes the blockmap and the SHA-512 in latest.yml. It calls this once
// per file ({path}); the work is scripts/release-sign.mjs signFiles: sign with the Certum certificate, verify, record, and throw (which stops the build) on any problem.
const path=require('node:path'),{pathToFileURL}=require('node:url');
module.exports=async function signOne(configuration){
 const {signFiles}=await import(pathToFileURL(path.join(__dirname,'release-sign.mjs')).href);
 signFiles([configuration.path],process.env);
};
