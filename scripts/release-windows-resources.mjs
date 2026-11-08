import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {root,sha} from './release-build.mjs';
const run=promisify(execFile);
export async function ensureResourceEditor(){
 const record=JSON.parse(await fs.readFile(path.join(root,'packaging/rcedit-tool.json'),'utf8')),file=path.join(root,'.bootstrap','rcedit-'+record.version+'-x64.exe');let bytes;
 try{bytes=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch(record.url,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error('Resource editor fetch failed: '+response.status);bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw new Error('Pinned resource editor hash mismatch');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});}
 if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw new Error('Cached resource editor hash mismatch');return {file,record};
}
/** The four-part number Windows shows as the file's version: 0.1.0-beta.13 is 0.1.0.13. A fix release (0.1.0-beta.13.1) keeps its beta's number there; the whole version
 *  (the fix number included) is in the ProductVersion string and in what the installer registers. */
export function windowsFileVersion(version){
 const numeric=String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z.-]*?(\d+)(?:\.\d+)?)?$/);if(!numeric)throw new Error('Unsupported application version');
 return [numeric[1],numeric[2],numeric[3],numeric[4]||'0'].join('.');
}
export async function applyWindowsResources(executable,version){
 executable=path.resolve(executable);if(!executable.startsWith(path.join(root,'release')+path.sep)||path.basename(executable)!=='AciraBrowser.exe')throw new Error('Resource editing is restricted to the generated Acira portable executable');
 const fileVersion=windowsFileVersion(version);
 const icon=JSON.parse(await fs.readFile(path.join(root,'packaging/icon-provenance.json'),'utf8')),ico=path.join(root,'packaging/acira-icon.ico'),source=path.resolve(root,icon.source);if(!source.startsWith(path.join(root,'public')+path.sep)||sha(await fs.readFile(ico))!==icon.icoSha256||sha(await fs.readFile(source))!==icon.sourceSha256)throw new Error('Packaging icon is stale relative to the approved source');
 const tool=await ensureResourceEditor();await run(tool.file,[executable,'--set-icon',ico,'--set-file-version',fileVersion,'--set-product-version',fileVersion,'--set-version-string','ProductName','Acira Browser','--set-version-string','FileDescription','Acira Browser','--set-version-string','CompanyName','Acira, Inc.','--set-version-string','LegalCopyright','Copyright © 2026 Acira, Inc.','--set-version-string','InternalName','AciraBrowser','--set-version-string','OriginalFilename','AciraBrowser.exe','--set-version-string','ProductVersion',version,'--set-requested-execution-level','asInvoker'],{windowsHide:true,timeout:30000});
 return {product:'Acira Browser',version,fileVersion,iconSha256:icon.icoSha256,canonicalLogoSha256:icon.canonicalSha256,tool:{name:tool.record.name,version:tool.record.version,sourceCommit:tool.record.sourceCommit,sha256:tool.record.sha256},signing:'Unsigned; resource editing does not sign the app'};
}
