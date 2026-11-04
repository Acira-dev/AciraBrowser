'use strict';
// The Windows setup run by Acira's updater never stops behind a window nobody can answer (the co-founder's e493a626, ea5ea64b, b34487a1 and
// ea4a851d, on this installer):
//   - Install now on beta.8 and earlier starts the new setup with --updated and without /S: it no longer asks "Update to X / Open / Cancel" again;
//   - an old uninstaller that is cut short, zero bytes or damaged ("Unsupported 16-Bit Application"), or a launcher whose real uninstaller is gone,
//     is dropped before electron-builder runs it, so the new version installs over the old one;
//   - old files that cannot be removed (a locked file) end a silent or updater run with exit code 2 instead of an OK box; Install now opens the old
//     version again.
// No NSIS compiler runs here, so the three new Functions run in a small interpreter of the instructions they use (below), against real files: the
// shipped acira-uninstall.exe, cut and empty copies of it, and an install folder laid out like Acira's. The rest is held to the script's text and to
// electron-builder's own templates. A real silent update on a Windows PC is still to be checked by hand.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..'),read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8').replace(/\r\n/g,'\n');
const nsh=read('packaging','acira-installer.nsh'),template=(...parts)=>read('node_modules','app-builder-lib','templates','nsis',...parts);
const body=name=>{const start=nsh.indexOf('Function '+name+'\n');assert.ok(start>=0,name);return nsh.slice(start,nsh.indexOf('FunctionEnd',start)+'FunctionEnd'.length);};
const made=[];test.after(()=>{for(const dir of made)fs.rmSync(dir,{recursive:true,force:true});});
const tmp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-nsis-'));made.push(dir);return dir;};

/** Just enough NSIS for these Functions: registers, the stack, the error flag, files, FindFirst, the registry (a Map), Call, and LogicLib
 *  ${If}/${IfNot}/${AndIf}/${AndIfNot}/${EndIf} with =, >=, >, <, ==, !=, ${Errors} and ${FileExists}. Anything else throws, so a new instruction
 *  cannot slip through untested. */
function nsis({defines={},parameters='',registry=new Map()}={}){
 const vars={},stack=[],files=new Map();let errors=false,handles=0;
 const expand=value=>value.replace(/\$\{(\w+)\}/g,(_,name)=>{if(!(name in defines))throw new Error('undefined '+name);return defines[name];}).replace(/\$(R?\d|INSTDIR)/g,(_,name)=>vars[name]??'');
 const word=token=>expand(token.replace(/^(["'`])([\s\S]*)\1$/,'$2'));
 const tokens=line=>line.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g);
 const target=token=>{const m=/^\$(R?\d)$/.exec(token);if(!m)throw new Error('not a register: '+token);return m[1];};
 const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
 const file=value=>value.replace(/\\/g,'/'); // the script's Windows paths, on this computer
 function test(parts){
  if(parts[0]==='${Errors}')return errors;
  if(parts[0]==='${FileExists}')return fs.existsSync(file(word(parts[1])));
  const [a,op,b]=[word(parts[0]),parts[1],word(parts[2])];
  switch(op){case '=':return num(a)===num(b);case '>=':return num(a)>=num(b);case '>':return num(a)>num(b);case '<':return num(a)<num(b);case '==':return a.toLowerCase()===b.toLowerCase();case '!=':return a.toLowerCase()!==b.toLowerCase();}
  throw new Error('unknown test '+parts.join(' '));
 }
 function parse(lines){
  const out=[];
  while(lines.length){
   const line=lines.shift(),parts=tokens(line);
   if(parts[0]==='${If}'||parts[0]==='${IfNot}'){
    const conditions=[{not:parts[0]==='${IfNot}',parts:parts.slice(1)}];
    while(/^\$\{AndIf(Not)?\}/.test(lines[0]||'')){const next=tokens(lines.shift());conditions.push({not:next[0]==='${AndIfNot}',parts:next.slice(1)});}
    const inner=[];let depth=1;
    while(lines.length){const next=lines.shift();if(/^\$\{(If|IfNot)\}/.test(next))depth++;if(next==='${EndIf}'&&--depth===0)break;inner.push(next);}
    out.push({conditions,body:parse(inner)});
   }else out.push({parts});
  }
  return out;
 }
 const functions={};
 function load(text){const lines=text.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith(';'));const name=lines[0].split(/\s+/)[1];functions[name]=parse(lines.slice(1,-1));}
 function run(block){
  for(const step of block){
   if(step.conditions){if(step.conditions.every(c=>test(c.parts)!==c.not))run(step.body);continue;}
   const [op,...args]=step.parts;
   switch(op){
    case 'Push':stack.push(word(args[0]));break;
    case 'Pop':if(!stack.length){errors=true;break;}vars[target(args[0])]=stack.pop();break;
    case 'Exch':{const name=target(args[0]),top=stack.pop();stack.push(vars[name]??'');vars[name]=top;break;}
    case 'StrCpy':vars[target(args[0])]=word(args[1]);break;
    case 'ClearErrors':errors=false;break;
    case 'IntOp':{const [a,o,b]=[num(word(args[1])),args[2],num(word(args[3]))];vars[target(args[0])]=String(o==='*'?a*b:o==='+'?a+b:NaN);break;}
    case 'FileOpen':{try{const fd=fs.openSync(file(word(args[1])),'r');const id=String(++handles);files.set(id,{fd,at:0});vars[target(args[0])]=id;}catch{errors=true;vars[target(args[0])]='';}break;}
    case 'FileSeek':{const open=files.get(word(args[0])),size=fs.fstatSync(open.fd).size,offset=num(word(args[1]));open.at=args[2]==='END'?size+offset:offset;if(args[3])vars[target(args[3])]=String(open.at);break;}
    case 'FileReadByte':{const open=files.get(word(args[0])),one=Buffer.alloc(1);if(fs.readSync(open.fd,one,0,1,open.at)===1){vars[target(args[1])]=String(one[0]);open.at++;}else{errors=true;vars[target(args[1])]='';}break;}
    case 'FileClose':{const id=word(args[0]);fs.closeSync(files.get(id).fd);files.delete(id);break;}
    case 'FindFirst':{const spec=file(word(args[2])),dir=path.dirname(spec),re=new RegExp('^'+path.basename(spec).replace(/[.]/g,'\\.').replace(/\*/g,'.*')+'$','i');const found=(fs.existsSync(dir)?fs.readdirSync(dir).sort():[]).find(name=>re.test(name));vars[target(args[0])]='find';vars[target(args[1])]=found||'';if(!found)errors=true;break;}
    case 'FindClose':break;
    case 'Delete':fs.rmSync(file(word(args[0])),{force:true});break;
    case 'DeleteRegValue':registry.delete(`${args[0]}\\${word(args[1])}\\${word(args[2])}`);break;
    case 'Call':run(functions[args[0]]);break;
    case '${GetParameters}':vars[target(args[0])]=parameters;break;
    case '${GetOptions}':{const all=word(args[0]),option=word(args[1]),at=all.toLowerCase().indexOf(option.toLowerCase());if(at<0){errors=true;vars[target(args[2])]='';}else vars[target(args[2])]=all.slice(at+option.length).split(/\s+-|\s+\//)[0].trim();break;}
    default:throw new Error('the interpreter does not know '+op);
   }
  }
 }
 return {vars,stack,registry,load,call(name,...pushed){for(const value of pushed)stack.push(value);run(functions[name]);},get errors(){return errors;}};
}
const exeOk=file=>{const machine=nsis();machine.load(body('AcExeOk'));machine.call('AcExeOk',file);assert.equal(machine.stack.length,1,'the stack is left with the answer only');return machine.stack.pop();};

test('a real program passes; a cut, empty or damaged one does not; one that cannot be read is never deleted on a guess',()=>{
 const dir=tmp(),real=fs.readFileSync(path.join(root,'packaging','installer','acira-uninstall.exe'));
 const write=(name,bytes)=>{fs.writeFileSync(path.join(dir,name),bytes);return path.join(dir,name);};
 assert.equal(exeOk(path.join(root,'packaging','installer','acira-uninstall.exe')),'1','the shipped remover');
 assert.equal(exeOk(path.join(root,'packaging','installer','acira-progress.exe')),'1');
 assert.equal(exeOk(write('cut.exe',real.subarray(0,40000))),'0','cut short (under 64 KB)');
 assert.equal(exeOk(write('empty.exe',Buffer.alloc(0))),'0','zero bytes');
 assert.equal(exeOk(write('zeros.exe',Buffer.alloc(200000))),'0','no MZ header (overwritten with zeros)');
 const noPe=Buffer.from(real);noPe.writeUInt16LE(0x7fff,60);
 assert.equal(exeOk(write('nope.exe',noPe.subarray(0,100000))),'0','MZ, but no PE header where it points');
 const head=Buffer.from(real.subarray(0,real.readUInt16LE(60)));
 assert.equal(exeOk(write('head.exe',Buffer.concat([head,Buffer.alloc(70000)]))),'0','everything from the PE header on overwritten');
 assert.equal(exeOk(path.join(dir,'missing.exe')),'1','not readable: left for electron-builder, as before');
});

function install({remover=true,real='Uninstall Acira Browser.exe',damage=null}={}){
 const dir=tmp(),good=fs.readFileSync(path.join(root,'packaging','installer','acira-uninstall.exe'));
 if(remover)fs.writeFileSync(path.join(dir,'AciraRemove.exe'),damage==='remover'?good.subarray(0,1000):good);
 if(real)fs.writeFileSync(path.join(dir,real),damage==='real'?Buffer.alloc(0):good);
 fs.writeFileSync(path.join(dir,'AciraBrowser.exe'),good);
 const key='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\c0ffee';
 const registry=new Map([[`SHELL_CONTEXT\\${key}\\UninstallString`,`"${dir}\\AciraRemove.exe" /currentuser`],[`SHELL_CONTEXT\\${key}\\QuietUninstallString`,`"${dir}\\${real}" /currentuser /S`]]);
 const machine=nsis({defines:{PRODUCT_FILENAME:'Acira Browser',UNINSTALL_APP_KEY:'c0ffee',AC_OLD_UNINSTALLER:'Uninstall Acira Browser.exe',AC_OLD_UNINSTALL_KEY:key},registry});
 machine.vars.INSTDIR=dir;machine.load(body('AcExeOk'));machine.load(body('AcDropBadUninstaller'));
 for(const register of ['0','1','2'])machine.vars[register]='kept '+register;
 machine.call('AcDropBadUninstaller');
 assert.deepEqual([machine.vars[0],machine.vars[1],machine.vars[2],machine.stack.length],['kept 0','kept 1','kept 2',0],'registers and stack as they were');
 return {left:fs.readdirSync(dir).sort(),pointers:registry.size};
}

test('a damaged old remover is dropped before electron-builder runs it; a healthy install is left exactly as it was',()=>{
 assert.deepEqual(install(),{left:['AciraBrowser.exe','AciraRemove.exe','Uninstall Acira Browser.exe'],pointers:2},'healthy: nothing changes');
 assert.deepEqual(install({real:'Uninstall AciraBrowser.exe'}),{left:['AciraBrowser.exe','AciraRemove.exe','Uninstall AciraBrowser.exe'],pointers:2},'an older uninstaller name is still found (as AciraRemove.exe finds it)');
 assert.deepEqual(install({damage:'remover'}),{left:['AciraBrowser.exe','Uninstall Acira Browser.exe'],pointers:0},'a cut AciraRemove.exe: gone, and the registry no longer points at a remover');
 assert.deepEqual(install({damage:'real'}),{left:['AciraBrowser.exe','AciraRemove.exe'],pointers:0},'a zero-byte real uninstaller: gone, and nothing points at the launcher that needs it');
 assert.deepEqual(install({real:null}),{left:['AciraBrowser.exe','AciraRemove.exe'],pointers:0},'a launcher whose real uninstaller is missing');
 assert.deepEqual(install({remover:false}),{left:['AciraBrowser.exe','Uninstall Acira Browser.exe'],pointers:2},'an install from before AciraRemove.exe');
});

test('the check runs before electron-builder removes the old version, in the installer only',()=>{
 const check=nsh.slice(nsh.indexOf('!macro customCheckAppRunning'),nsh.indexOf('!macroend',nsh.indexOf('!macro customCheckAppRunning')));
 assert.match(check,/!ifndef BUILD_UNINSTALLER[\s\S]*Call AcDropBadUninstaller\s+!endif[\s\S]*_CHECK_APP_RUNNING/);
 const section=template('installSection.nsh');
 assert.ok(section.indexOf('!insertmacro CHECK_APP_RUNNING')<section.indexOf('!insertmacro uninstallOldVersion SHELL_CONTEXT'),'electron-builder: the running-app check, then the old version\'s uninstaller');
 assert.match(template('include','installUtil.nsh'),/!insertmacro readReg \$uninstallString "\$rootKey" "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString\s+\$\{if\} \$uninstallString == ""/,'no UninstallString: electron-builder runs no old uninstaller');
});

test('the Functions compiled with this file name electron-builder\'s files and keys themselves, the way it does',()=>{
 const block=nsh.slice(nsh.indexOf('; --- Updates that never stop behind a window'),nsh.indexOf('; Acira-owned per-user capabilities only.'));
 for(const name of ['AcUpdaterRun','AcExeOk','AcDropBadUninstaller'])assert.doesNotMatch(body(name),/\$\{UNINSTALL_FILENAME\}|\$\{UNINSTALL_REGISTRY_KEY\}/,name+': defined only after this file is read');
 assert.match(block,/!define AC_OLD_UNINSTALLER "Uninstall \$\{PRODUCT_FILENAME\}\.exe"/);
 assert.ok(template('common.nsh').includes('!define UNINSTALL_FILENAME "Uninstall ${PRODUCT_FILENAME}.exe"'),'the same name electron-builder gives it');
 assert.ok(block.includes('!define AC_OLD_UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_KEY}"'));
 assert.ok(template('multiUser.nsh').includes('!define /ifndef UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_KEY}"'),'the same key');
 const target=read('node_modules','app-builder-lib','out','targets','nsis','NsisTarget.js');
 assert.match(target,/UNINSTALL_APP_KEY: uninstallAppKey,[\s\S]*PRODUCT_FILENAME: appInfo\.productFilename/,'both come from the command line, so they exist when this file is read');
 assert.match(block,/^!ifndef BUILD_UNINSTALLER\n!include "FileFunc\.nsh"/m,'GetParameters and GetOptions are there for these Functions');
assert.doesNotMatch(block.split('\n').filter(line=>!line.trim().startsWith(';')).join('\n'),/FileReadWord|StdUtils|::/,'no Unicode-only instruction and no plugin call (plugins are registered after this file is read)');
});

test('the updater\'s setup run never asks "Update to X / Open / Cancel"; a person running setup still does',()=>{
 const ask=body('AcAskExisting');
 assert.match(ask,/^Function AcAskExisting\s+IfSilent acAskDone\s+;[^\n]*\n\s+Call AcUpdaterRun\s+IfErrors 0 acAskDone\s+IfFileExists "\$INSTDIR\\\$\{AC_APP_EXE\}" 0 acAskDone/);
 const updaterRun=parameters=>{const machine=nsis({parameters});machine.load(body('AcUpdaterRun'));machine.vars.R0='kept';machine.vars.R1='kept too';machine.call('AcUpdaterRun');assert.deepEqual([machine.vars.R0,machine.vars.R1,machine.stack.length],['kept','kept too',0]);return machine.errors;};
 assert.equal(updaterRun('--updated --force-run'),false,'Install now on beta.8 and earlier (no /S): skips the question');
 assert.equal(updaterRun('--updated /S --force-run'),false,'Install now from beta.9 on (IfSilent already skips it)');
 assert.equal(updaterRun(''),true,'a person running the downloaded setup: asked as before');
 assert.equal(updaterRun('/preview'),true);
});

test('old files that cannot be removed: exit code 2 for the updater (and a reopened Acira after Install now), the box only for a person',()=>{
 const start=nsh.indexOf('!macro customUnInstallCheck\n');assert.ok(start>=0,'the check macro exists');
 const check=nsh.slice(start,nsh.indexOf('!macro customUnInstallCheckCurrentUser'));
 for(const piece of ['${IfNot} ${Errors}','${AndIf} $R0 != 0','"--updated"','${AndIfNot} ${Silent}','MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"','"--force-run"',"Exec '\"$INSTDIR\\${AC_APP_EXE}\"'",'SetErrorLevel 2','Quit'])assert.ok(check.includes(piece),piece);
 assert.ok(check.indexOf('"--updated"')<check.indexOf('MessageBox')&&check.indexOf('MessageBox')<check.indexOf('"--force-run"'));
 assert.doesNotMatch(check,/^\s*[A-Za-z]\w*:\s*$/m,'no hand-written labels: the macro is inserted for both registry roots');
 assert.match(nsh,/!macro customUnInstallCheckCurrentUser\n\s+!insertmacro customUnInstallCheck\n!macroend\n!endif/);
 // electron-builder uses them in place of its own result handling, whose box has no silent default (the hang this removes)
 const util=template('include','installUtil.nsh');
 assert.match(util,/"SHELL_CONTEXT"\s+!ifmacrodef customUnInstallCheck\s+!insertmacro customUnInstallCheck\s+Return/);
 assert.match(util,/"HKEY_CURRENT_USER"\s+!ifmacrodef customUnInstallCheckCurrentUser\s+!insertmacro customUnInstallCheckCurrentUser\s+Return/);
 assert.match(util,/MessageBox MB_OK\|MB_ICONEXCLAMATION "\$\(uninstallFailed\): \$R0"\n/,'the stock box: no /SD, so a silent run sat behind it');
 assert.ok(util.includes('!macro uninstallOldVersion')||util.includes('Function uninstallOldVersion'));
});
