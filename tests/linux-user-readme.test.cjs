'use strict';
// AciraBrowser-Linux-SetupFiles.zip is packed from the folder scripts/package-linux-handoff.mjs fills. Its README.txt is the one people read: install steps, what the installer does,
// uninstall, help. It carries the build's version and the AppImage's file name, filled in when the build is packaged. The builder's notes (packaging/linux/BUILDER-README.txt:
// "not published from this machine", WSL test hosts, handoff commands) are never in the zip.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {userReadme,TEMPLATE}=require('../packaging/linux/user-readme.cjs');
const repo=path.resolve(__dirname,'..');

test('the template has the version and the AppImage name as placeholders and nothing of a past version',()=>{
 const template=fs.readFileSync(TEMPLATE,'utf8');
 assert.ok(/\{\{VERSION\}\}/.test(template)&&/\{\{IMAGE\}\}/.test(template));
 assert.ok(!/\d+\.\d+\.\d+-beta/.test(template),'no version is written into the template');
});

test('userReadme fills the version and the AppImage name everywhere, and the text is the user\'s: install, uninstall, updates, help',()=>{
 const image='AciraBrowser-0.1.0-beta.13.2-linux-x86_64.AppImage',text=userReadme({version:'0.1.0-beta.13.2',image});
 assert.ok(text.startsWith('Acira Browser 0.1.0-beta.13.2 for Linux (x86_64)\n'));
 assert.ok(text.includes('1. Put '+image+' in the same folder'));
 assert.ok(!/\{\{|\}\}/.test(text));
 for(const part of ['bash Install-Acira.sh','bash Install-Acira.sh --uninstall','SHA256SUMS.txt','libfuse2','https://acirabrowser.com/download/','Settings > About'])assert.ok(text.includes(part),part);
});

test('none of the builder\'s notes is in it',()=>{
 const text=userReadme({version:'0.1.0-beta.13.2',image:'AciraBrowser-0.1.0-beta.13.2-linux-x86_64.AppImage'});
 for(const builder of [/not published from this machine/i,/\bWSL/i,/Windows laptop/i,/handoff/i,/VALIDATION\.json/,/private (?:GitHub )?release/i,/Do not infer testing/i,/npm (?:ci|run|test)/,/REBUILD/,/Mesa|d3d12/i,/beta\.11\b/])
  assert.ok(!builder.test(text),String(builder));
 const builderNotes=fs.readFileSync(path.join(repo,'packaging/linux/BUILDER-README.txt'),'utf8');
 assert.ok(/not published from this machine/.test(builderNotes),'the builder\'s notes stay where they are, under their own name');
 assert.ok(!fs.existsSync(path.join(repo,'packaging/linux/README.txt')),'no file called README.txt is left in packaging/linux to be packed by mistake');
});

test('a version or an image name that is not one is refused, so a broken build cannot print a broken README',()=>{
 const image='AciraBrowser-0.1.0-beta.13.2-linux-x86_64.AppImage';
 for(const version of [undefined,'','latest','0.1','{{VERSION}}','1.0.0 beta','0.1.0-beta.1\n'])assert.throws(()=>userReadme({version,image}),/version/,String(version));
 for(const bad of [undefined,'','a/b.AppImage','../x.AppImage','x.zip','{{IMAGE}}.AppImage'])assert.throws(()=>userReadme({version:'0.1.0-beta.13.2',image:bad}),/file name/,String(bad));
 assert.throws(()=>userReadme({version:'1.0.0',image,template:'{{VERSION}} {{OTHER}}'}),/placeholder/);
});

test('the packaging script puts THAT README in the folder the zip is made from, with the build\'s version, and lists it in SHA256SUMS.txt',()=>{
 // the script and what it copies, laid out the way the repository lays them out, in a throwaway folder (it works relative to its own place)
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-linux-readme-'));
 try{
  const put=(rel,data)=>{const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);};
  const copy=rel=>put(rel,fs.readFileSync(path.join(repo,rel)));
  for(const rel of ['scripts/package-linux-handoff.mjs','packaging/linux/user-readme.cjs','packaging/linux/README.user.txt','packaging/linux/BUILDER-README.txt','packaging/linux/Install-Acira.sh','packaging/linux/install-acira-linux.py','packaging/linux/computer.acira.browser.policy','packaging/acira-icon-512.png','LICENSE','THIRD_PARTY_NOTICES.md'])copy(rel);
  put('package.json',JSON.stringify({name:'x',version:'0.1.0-beta.13.2'}));
  const out='release/linux-normal',image='AciraBrowser-0.1.0-beta.13.2-linux-x86_64.AppImage';
  put(out+'/'+image,'appimage');put(out+'/beta-linux.yml','a');put(out+'/latest-linux.yml','b');
  execFileSync(process.execPath,[path.join(root,'scripts/package-linux-handoff.mjs')],{cwd:root,env:{...process.env,ACIRA_BUILD_IDENTITY:'',NODE_OPTIONS:''},stdio:'pipe'});
  const readme=fs.readFileSync(path.join(root,out,'README.txt'),'utf8');
  assert.equal(readme,userReadme({version:'0.1.0-beta.13.2',image}),'the user\'s README, filled in');
  assert.ok(!/not published from this machine/.test(readme));
  const sums=fs.readFileSync(path.join(root,out,'SHA256SUMS.txt'),'utf8');
  assert.ok(sums.includes(createHash('sha256').update(readme).digest('hex')+'  README.txt'),'the checksum list covers the README that is in the folder');
  assert.deepEqual(sums.trim().split('\n').map(line=>line.split('  ')[1]),[image,'Install-Acira.sh','install-acira-linux.py','computer.acira.browser.policy','acira-icon-512.png','README.txt','LICENSE','THIRD_PARTY_NOTICES.md','beta-linux.yml','latest-linux.yml'],'the same files, in the same order, as before');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
