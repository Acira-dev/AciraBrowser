#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const {userReadme}=createRequire(import.meta.url)('../packaging/linux/user-readme.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),qa=process.env.ACIRA_BUILD_IDENTITY==='qa',pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'))),version=qa&&process.env.ACIRA_LINUX_QA_VERSION||pkg.version;
const output=path.join(root,'release','linux-'+(qa?'qa':'normal')),image=(qa?'AciraBrowserQA':'AciraBrowser')+'-'+version+'-linux-x86_64.AppImage';
const copies={'Install-Acira.sh':'packaging/linux/Install-Acira.sh','install-acira-linux.py':'packaging/linux/install-acira-linux.py','computer.acira.browser.policy':'packaging/linux/computer.acira.browser.policy','acira-icon-512.png':'packaging/acira-icon-512.png','README.txt':null,'LICENSE':'LICENSE','THIRD_PARTY_NOTICES.md':'THIRD_PARTY_NOTICES.md'};
// README.txt is the one people read (packaging/linux/README.user.txt with this build's version and AppImage name), never the builder's notes (BUILDER-README.txt)
for(const [name,from]of Object.entries(copies))if(from)await fs.copyFile(path.join(root,from),path.join(output,name));else await fs.writeFile(path.join(output,name),userReadme({version,image}));
await fs.chmod(path.join(output,'Install-Acira.sh'),0o755);await fs.chmod(path.join(output,'install-acira-linux.py'),0o755);
const names=[image,...Object.keys(copies),'beta-linux.yml','latest-linux.yml'];
let sums='';for(const name of names){const data=await fs.readFile(path.join(output,name));sums+=createHash('sha256').update(data).digest('hex')+'  '+name+'\n';}
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),sums);
await fs.writeFile(path.join(output,'LINUX-BUILD-RESULT.json'),JSON.stringify({schema:1,version,platform:'linux',arch:'x64',qa,appImage:image,sourceBase:'c2baba7da06c5de3df8bdb336a61cb286a90a1ee',sourceCommit:process.env.ACIRA_LINUX_SOURCE_COMMIT||null,signing:'unsigned',feed:'https://update.acirabrowser.com/linux/',publicFeedPublished:false},null,2)+'\n');
console.log('Linux handoff files and checksums saved in '+output);
