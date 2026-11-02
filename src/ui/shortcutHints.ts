import { formatShortcut,isMac } from './platform';
import { t,translateText } from '../i18n';
import { shortcutFor } from './shortcutKeys';

/** Controls whose key is a registry command: their tooltip follows the live key (Settings › Shortcuts), not the written one. */
const CONTROL_COMMANDS:Record<string,string>={
 'Open Acira workspace':'workspace','Close Acira workspace':'workspace','Expand sidebar':'workspace','Collapse sidebar':'workspace','Close workspace sidebar':'workspace',
 'New tab':'new-tab','Close tab':'close-tab','Enter Compact view':'focus-mode','Exit Compact view':'focus-mode','Enter Focus mode':'focus-mode','Exit Focus mode':'focus-mode','Turn Focus on':'focus-mode','Turn Focus off':'focus-mode',
 'Reload page':'reload','Switch profile':'switch-profile','Bookmark this page':'bookmark','Edit bookmark':'bookmark','Remove bookmark':'bookmark','All bookmarks':'bookmarks-manager','History':'history',
 'Rewind':'rewind','Split view':'split-view','Downloads':'downloads','Remove from split view':'split-close-pane','Close split view':'split-exit','Settings':'settings',
 'Find on page':'find','Open tab switcher':'tab-viewer','All open tabs':'tab-viewer','All open tabs (Alt+T)':'tab-viewer','Back':'back','Forward':'forward','Home':'home','Acira menu':'menu',
};

/** Callers pass a control's label in English or already translated; the tables here are keyed by the English one. */
let englishLabels:Map<string,string>|null=null;
const toEnglish=(label:string)=>{englishLabels??=new Map([...Object.keys(CONTROL_COMMANDS),'Stop loading','Close menu'].map(english=>[translateText(english),english]));return englishLabels.get(label)??label;};

/** Only advertise commands implemented by the browser's shortcut resolver. */
export function shortcutForControl(label:string):string|undefined {
 label=toEnglish(label);
 const keys:Record<string,string>={
  'Open Acira workspace':'Ctrl + Shift + E','Close Acira workspace':'Ctrl + Shift + E',
  'Expand sidebar':'Ctrl + Shift + E','Collapse sidebar':'Ctrl + Shift + E',
  'Close workspace sidebar':'Ctrl + Shift + E',
  'New tab':'Ctrl + T','Close tab':'Ctrl + W',
  'Enter Compact view':'Ctrl + Shift + F','Exit Compact view':'Ctrl + Shift + F',
  'Enter Focus mode':'Ctrl + Shift + F','Exit Focus mode':'Ctrl + Shift + F','Turn Focus on':'Ctrl + Shift + F','Turn Focus off':'Ctrl + Shift + F',
  'Reload page':'Ctrl + R','Stop loading':'Esc','Switch profile':'Ctrl + Shift + M',
  'Bookmark this page':'Ctrl + D','Edit bookmark':'Ctrl + D','Remove bookmark':'Ctrl + D',
  'All bookmarks':'Ctrl + Shift + O','History':'Ctrl + H','Rewind':'Ctrl + Shift + H','Split view':'Ctrl + Shift + S','Downloads':'Ctrl + J',
  'Remove from split view':'Ctrl + Shift + F4','Close split view':'Ctrl + Shift + 0',
  'Settings':'Ctrl + ,','Close menu':'Esc','Find on page':'Ctrl + F',
  'Open tab switcher':'Alt + T','All open tabs':'Alt + T','All open tabs (Alt+T)':'Alt + T',
 };
 const command=CONTROL_COMMANDS[label];
 if(command&&!isMac())return shortcutFor(command,label==='Back'?'Alt + ←':label==='Forward'?'Alt + →':label==='Home'?'Alt + Home':label==='Acira menu'?'Alt + F':keys[label]);
 if(label==='Back')return isMac()?'⌘[':formatShortcut('Alt + ←');
 if(label==='Forward')return isMac()?'⌘]':formatShortcut('Alt + →');
 if(label==='Home')return isMac()?undefined:formatShortcut('Alt + Home');
 if(label==='Acira menu')return isMac()?undefined:formatShortcut('Alt + F');
 return keys[label]?formatShortcut(keys[label]):undefined;
}

/** One plain line for controls whose purpose isn't obvious from their name (Round 2 clarity rule). */
const explanations:Record<string,()=>string>={
 'Enter Focus mode':()=>t('shortcuthints.focusEnter'),
 'Exit Focus mode':()=>t('shortcuthints.focusExit'),
 'Turn Focus on':()=>t('shortcuthints.focusEnter'),
 'Turn Focus off':()=>t('shortcuthints.focusExit'),
 'Rewind':()=>t('shortcuthints.rewind'),
};

export function controlTitle(label:string):string {
 label=toEnglish(label);
 const shortcut=shortcutForControl(label);
 const name=translateText(label==='All open tabs (Alt+T)'?'All open tabs':label);
 const title=shortcut?`${name} · ${shortcut}`:name;
 return explanations[label]?`${title}
${explanations[label]()}`:title;
}
