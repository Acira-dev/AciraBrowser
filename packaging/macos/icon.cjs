'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),plist=require('plist');
async function applyMacIcon(bundle,repo=path.resolve(__dirname,'../..')){
 const provenance=JSON.parse(await fs.readFile(path.join(repo,'packaging/icon-provenance.json'),'utf8'));
 const bytes=await fs.readFile(path.join(repo,'packaging/mac/acira-icon.icns'));
 if(createHash('sha256').update(bytes).digest('hex')!==provenance.icnsSha256)throw Error('Mac icon differs from the approved branding');
 await fs.copyFile(path.join(repo,'packaging/mac/acira-icon.icns'),path.join(bundle,'Contents/Resources/AciraBrowser.icns'));
 const file=path.join(bundle,'Contents/Info.plist'),info=plist.parse(await fs.readFile(file,'utf8'));info.CFBundleIconFile='AciraBrowser.icns';await fs.writeFile(file,plist.build(info));
 return {variant:provenance.variant,icnsSha256:provenance.icnsSha256,sourceSha256:provenance.macSourceSha256||provenance.sourceSha256};
}
module.exports={applyMacIcon};
