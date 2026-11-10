#!/usr/bin/env python3
"""Install the user-owned, updatable Acira AppImage and desktop entry."""
import argparse,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--qa',action='store_true');p.add_argument('--skip-system-policy',action='store_true');p.add_argument('--uninstall',action='store_true');a=p.parse_args()
if sys.platform!='linux' or os.geteuid()==0:raise SystemExit('Run this installer as your ordinary Linux user, not as root.')
here=Path(__file__).resolve().parent;home=Path.home();name='Acira Browser QA' if a.qa else 'Acira Browser';slug='acira-browser-qa' if a.qa else 'acira-browser';exe='AciraBrowserQA' if a.qa else 'AciraBrowser'
data=Path(os.environ.get('XDG_DATA_HOME',str(home/'.local/share')));prefix=data/slug;target=prefix/(exe+'.AppImage');desktop=data/'applications'/(slug+'.desktop');icon=data/'icons/hicolor/512x512/apps'/(slug+'.png');receipt=prefix/'install.json'
if a.uninstall:
 for file in [target,desktop,icon,receipt]:
  if file.is_symlink():raise SystemExit('Refusing to remove a redirected install file: '+str(file))
  file.unlink(missing_ok=True)
 try:prefix.rmdir()
 except OSError:pass
 if shutil.which('update-desktop-database') and desktop.parent.exists():subprocess.run(['update-desktop-database',str(desktop.parent)],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 print(name+' removed. Browser profiles, passwords and the shared authentication policy were preserved.');sys.exit(0)
matches=list(here.glob(exe+'-*-linux-*.AppImage'))
if len(matches)!=1:raise SystemExit('Keep exactly one '+exe+' Linux AppImage beside this installer.')
image=matches[0];policy=here/'computer.acira.browser.policy';source_icon=here/'acira-icon-512.png';manifest=here/'SHA256SUMS.txt'
if not manifest.is_file():raise SystemExit('The release checksum file is missing.')
entries={}
for line in manifest.read_text().splitlines():
 digest,sep,file=line.partition('  ')
 if sep:entries[file]=digest
def checked(file):
 if file.is_symlink() or not file.is_file():raise SystemExit('Missing or redirected release file: '+file.name)
 digest=hashlib.sha256(file.read_bytes()).hexdigest()
 if entries.get(file.name)!=digest:raise SystemExit('Release checksum mismatch: '+file.name)
 return digest
image_hash=checked(image);checked(policy);checked(source_icon)
if not a.skip_system_policy:
 destination=Path('/usr/share/polkit-1/actions/computer.acira.browser.policy')
 installed=destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest()==entries[policy.name]
 if not installed:
  if not Path('/usr/bin/pkexec').is_file():raise SystemExit('Install your distribution’s PolicyKit package, then run this installer again.')
  print('Your system will ask for administrator authorization to install Acira’s protected-action policy.',flush=True)
  subprocess.run(['/usr/bin/pkexec','/usr/bin/install','-m','0644',str(policy),str(destination)],check=True)
for directory in [prefix,desktop.parent,icon.parent]:directory.mkdir(parents=True,exist_ok=True)
temporary=prefix/(exe+'.AppImage.new')
if temporary.exists() or temporary.is_symlink() or target.is_symlink():raise SystemExit('An install file is redirected or a previous incomplete install needs review.')
shutil.copyfile(image,temporary);temporary.chmod(0o755);temporary.replace(target);shutil.copyfile(source_icon,icon)
def desktop_quote(value):return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'
# 13.6: launcher actions (right-click on the launcher or the dock icon): New window, New private window. Each one starts Acira with a flag (--acira-new-window,
# --acira-new-private-window; desktop/os-new-window.cjs): a running Acira opens the window, a closed one starts as usual. The names are the app's own
# translations (src/i18n/<language>.json browsermenu.newWindow and browsermenu.newPrivateWindow; tests/os-new-window.test.cjs keeps them equal).
NEW_WINDOW={'en':'New window','es':'Nueva ventana','fr':'Nouvelle fenêtre','de':'Neues Fenster','pt_BR':'Nova janela','it':'Nuova finestra','ja':'新しいウィンドウ','zh_CN':'新建窗口','ar':'نافذة جديدة','tr':'Yeni pencere','ru':'Новое окно','ko':'새 창','hi':'नई विंडो'}
NEW_PRIVATE_WINDOW={'en':'New private window','es':'Nueva ventana privada','fr':'Nouvelle fenêtre privée','de':'Neues privates Fenster','pt_BR':'Nova janela privada','it':'Nuova finestra privata','ja':'新しいプライベートウィンドウ','zh_CN':'新建无痕窗口','ar':'نافذة خاصة جديدة','tr':'Yeni gizli pencere','ru':'Новое приватное окно','ko':'새 비공개 창','hi':'नई निजी विंडो'}
DESKTOP_ACTIONS=[('NewWindow','--acira-new-window',NEW_WINDOW),('NewPrivateWindow','--acira-new-private-window',NEW_PRIVATE_WINDOW)]
def desktop_names(names):return ''.join('Name'+('' if code=='en' else '['+code+']')+'='+text+'\n' for code,text in names.items())
def desktop_entry(name,slug,target):
 head='[Desktop Entry]\nType=Application\nName='+name+'\nComment=An independent browser\nExec='+desktop_quote(target)+' %U\nIcon='+slug+'\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\nStartupWMClass='+slug+'.desktop\nActions='+''.join(action+';' for action,_,_ in DESKTOP_ACTIONS)+'\n'
 return head+''.join('\n[Desktop Action '+action+']\n'+desktop_names(names)+'Exec='+desktop_quote(target)+' '+flag+'\nIcon='+slug+'\n' for action,flag,names in DESKTOP_ACTIONS)
desktop.write_text(desktop_entry(name,slug,target),encoding='utf-8')  # the launcher actions' names are Japanese, Arabic, Hindi...: never the locale's encoding (a Latin-1 locale raised UnicodeEncodeError after the AppImage was copied)
receipt.write_text(json.dumps({'schema':1,'product':name,'sha256':image_hash,'updatableFile':str(target),'profilePreserved':True},indent=2)+'\n')
if shutil.which('update-desktop-database'):subprocess.run(['update-desktop-database',str(desktop.parent)],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(name+' installed: '+str(target));print('Launch it from your application menu. Future AppImage updates replace this user-owned file. Your default browser was not changed.')
