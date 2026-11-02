export const isMac = () => typeof window !== 'undefined' && (window.acira?.platform === 'darwin' || (!window.acira && /Mac/.test(navigator.platform)));
export const isWindows = () => typeof window !== 'undefined' && (window.acira?.platform === 'win32' || (!window.acira && /Win/.test(navigator.platform)));
export const isTorSupported = () => isWindows() || isMac();

const MAC_MODIFIERS: Record<string,string> = {Ctrl:'⌃',Option:'⌥',Shift:'⇧',Cmd:'⌘'};
const MAC_ORDER = '⌃⌥⇧⌘';

/** macOS shows shortcuts as modifier symbols in ⌃⌥⇧⌘ order directly before the key: "⇧⌘T". */
function macGlyphs(shortcut:string):string {
  return shortcut.split(' / ').map(part=>{
    const tokens=part.split(/\s*\+\s*|\s+/).filter(Boolean);
    const modifiers=tokens.filter(token=>token in MAC_MODIFIERS).map(token=>MAC_MODIFIERS[token]);
    const keys=tokens.filter(token=>!(token in MAC_MODIFIERS));
    if(!modifiers.length||!keys.length)return part;
    return modifiers.sort((a,b)=>MAC_ORDER.indexOf(a)-MAC_ORDER.indexOf(b)).join('')+keys.join(' ');
  }).join(' / ');
}

/** One spelling for every shortcut on screen (design round 4): "Ctrl+Shift+N" on Windows and Linux, "⇧⌘N" on Mac. It accepts
 * every spelling found in the code and the registry ("Ctrl Shift N", "Ctrl + Shift + N", "Ctrl+Shift+N"); " / " separates
 * alternatives ("Alt+← / →"). Menus, tooltips, the tab viewer, the command bar and Settings all go through it. */
export function formatShortcut(shortcut:string):string {
  const parts=shortcut.trim().split(/\s+\/\s+/).map(part=>part.split(/\s*\+\s*|\s+/).filter(Boolean));
  if(isMac())return shortcutLabel(parts.map(tokens=>tokens.join(' + ')).join(' / '));
  return parts.map(tokens=>tokens.join('+')).join(' / ');
}

/** Shortcut hints are written in Windows terms ("Ctrl Shift T", "Alt + ← / →"); Mac gets Mac keys. */
export function shortcutLabel(label:string):string {
  if(!isMac())return label;
  return macGlyphs(label
    .replace(/Ctrl \+ H/g,'Cmd + Y')
    .replace(/Ctrl \+ J/g,'Cmd + Shift + J')
    .replace(/Ctrl \+ Shift \+ O/g,'Cmd + Option + B')
    .replace(/Alt \+ ← \/ →/g,'Cmd + [ / ]')
    .replace(/F3 \/ Shift \+ F3/g,'Cmd + G / Cmd + Shift + G')
    .replace(/F11/g,'Ctrl + Cmd + F')
    .replace(/Ctrl(?![ +]*(?:Shift[ +]*)?Tab)/g,'Cmd')
    .replace(/Alt/g,'Option'));
}
