/** Letters follow the active layout when it types Latin letters (AZERTY Cmd+Z stays Undo);
    non-Latin layouts and Option-modified characters fall back to the physical key. Digits stay physical. */
function shortcutKey(input) {
 const code=input.code||'',typed=String(input.key||'');
 if(code==='NumpadAdd'||typed==='Add')return '+';
 if(code==='NumpadSubtract'||typed==='Subtract')return '-';
 if(code==='Numpad0')return '0';
 if(code==='Equal')return '=';
 // Shift turns the comma and period keys into < and > (; and : on other layouts): an extension's Ctrl+Shift+Comma and Alt+Shift+Period are these keys with Shift.
 if(input.shift&&code==='Comma')return ',';
 if(input.shift&&code==='Period')return '.';
 if(code==='Minus')return '-';
 if(code==='BracketLeft')return '[';
 if(code==='BracketRight')return ']';
 if(/^[a-z]$/i.test(typed))return typed.toLowerCase();
 if(/^Key[A-Z]$/.test(code))return code.slice(3).toLowerCase();
 if(/^Digit[0-9]$/.test(code))return code.slice(5);
 return typed.toLowerCase();
}

/** Browser commands are resolved independently of which native page has focus. */
function resolveDefaultShortcut(input, platform = process.platform) {
 if(input.type!=='keyDown')return null;
 const key=shortcutKey(input),mac=platform==='darwin',mod=mac?!!input.meta:!!(input.control||input.meta),shift=!!input.shift;
 // Keep macOS editing/system keys native (notably Ctrl+A/E/K and Cmd+H).
 if(mac){
  if(input.control&&!input.meta&&!input.alt&&key==='tab')return {action:'tab-switcher',direction:shift?-1:1};
  if(input.control&&!input.meta&&!input.alt&&(key==='pageup'||key==='pagedown'))return {action:'cycle-tab',direction:key==='pageup'?-1:1};
  if(input.meta&&input.control&&key==='f')return {action:'fullscreen'};
  if(input.meta&&input.alt&&key==='arrowleft')return {action:'cycle-tab',direction:-1};
  if(input.meta&&input.alt&&key==='arrowright')return {action:'cycle-tab',direction:1};
  if(input.meta&&input.alt&&key==='b')return {action:'bookmarks'};
  if(input.meta&&input.alt&&!shift&&key==='n')return {action:'tor-window'}; // Option+Cmd+N · New Tor window (Brave's Mac key; Option+Shift+N types a character)
  if(input.meta&&input.alt&&(key==='i'||key==='j'))return {action:'devtools'};
  if(input.meta&&!input.control&&!input.alt){
   if(key==='h'&&!shift||key==='q'||key==='m'&&!shift||key==='tab')return null; // Shift+Cmd+H is Rewind: only Cmd+H (Hide) belongs to the system
   if(key==='['||key===']')return {action:shift?'cycle-tab':key==='['?'back':'forward',...(shift?{direction:key==='['?-1:1}:{})};
   if(key==='y')return {action:'history'};
   if(key==='j'&&shift)return {action:'downloads'};
   if(key==='e'&&!shift)return null;
  }
  // Ctrl+1–8: the Nth workspace (Alt+1–8 elsewhere; Option+digit types characters on a Mac).
  if(input.control&&!input.meta&&!input.alt&&!shift&&/^[1-8]$/.test(key))return {action:'switch-workspace',index:Number(key)-1};
  if(input.control&&!input.meta)return null;
 }
 // Ctrl+Alt+PageDown / PageUp: the next / previous workspace (R4-48 P1-5). Ctrl+PageDown is the next tab; adding Alt moves up a level. No auto-repeat: a held key would spin through them.
 if(mod&&input.alt&&!shift&&(key==='pagedown'||key==='pageup'))return input.isAutoRepeat?null:{action:'workspace-cycle',direction:key==='pageup'?-1:1};
 // Alt+Shift+T focuses the toolbar (Chrome); Alt+T alone opens the tab viewer.
 if(input.alt&&!mod){if(key==='t'&&shift&&!mac)return {action:'focus-toolbar'};if(key==='t')return input.isAutoRepeat?null:{action:'tabs'};
  // Option+arrows move by word and Option+letters type characters on macOS.
  if(mac)return null;
  // Alt+1–8: the Nth workspace (R3-57). Ctrl+1–9 is go to tab, Ctrl+Shift+1–6 the split layouts, so Alt is the free one.
  if(!shift&&/^[1-8]$/.test(key))return input.isAutoRepeat?null:{action:'switch-workspace',index:Number(key)-1};
  if(key==='n'&&shift)return {action:'tor-window'}; // N · New Tor window (Brave's Alt+Shift+N)
  if(key==='arrowleft')return {action:'back'};if(key==='arrowright')return {action:'forward'};if(key==='home')return {action:'home'};if(key==='d')return {action:'address'};if(key==='f'||key==='e')return {action:'menu'};}
 if(mod&&!input.alt){
  if(key==='n')return {action:shift?'private-window':'new-window'};
  if(key==='e'&&shift)return {action:'workspace'};
  if(key==='t')return {action:shift?'restore':'new-tab'};
  // Ctrl+Shift+F4 closes the current split pane (Ctrl+F4 still closes the tab, Ctrl+Shift+W the window).
  if(key==='f4'&&shift)return {action:'split-close-pane'};
  if(key==='w'||key==='f4')return {action:shift?'close-window':'close-tab'};
  if(key==='q'&&shift&&!mac)return {action:'quit'}; // R4-36 · Close Acira (Chrome's Ctrl+Shift+Q); a Mac has Cmd+Q in the app menu
  if(shift&&(key==='pagedown'||key==='pageup'))return {action:'move-tab',direction:key==='pageup'?-1:1};
  if(key==='tab')return {action:'tab-switcher',direction:shift?-1:1};
  if(key==='pagedown'||key==='pageup')return {action:'cycle-tab',direction:key==='pageup'?-1:1};
  if(!shift&&/^[1-9]$/.test(key))return {action:'select-tab',index:key==='9'?-1:Number(key)-1};
  // Ctrl+Shift+1–6: the split layouts in the picker's order; Ctrl+Shift+0 leaves split view (digits stay physical).
  if(shift&&/^[1-6]$/.test(key))return {action:'split-layout',layout:['columns','rows','three-columns','top-two-bottom-one','left-one-right-two','grid'][Number(key)-1]};
  if(shift&&key==='0')return {action:'split-exit'};
  if(key==='l'&&shift)return {action:'seamless-mode'}; // R3-68 · Seamless (Ctrl+S is Save page; nothing with Ctrl+Alt, which is AltGr on many keyboards)
  if(key==='l'||key==='e'||key==='k')return {action:key==='k'&&shift?'palette':'address'};
  if(key==='f')return {action:shift?'focus-mode':'find'};
  if(key==='m')return {action:shift?'profile':'mute-tab'}; // Ctrl+M mutes the tab (Firefox); Cmd+M stays the macOS minimize
  if(key==='c'&&shift)return {action:'copy-url'};
  if(key==='x'&&shift)return {action:'ai-free'};
  if(key==='g')return {action:'find-next',forward:!shift};
  if(key==='r')return {action:shift?'hard-reload':'reload'};
  if(key==='d')return {action:shift?'pin-app':'bookmark'};
  if(key==='h')return {action:shift?'rewind':'history'};
  if(key==='j')return {action:shift?'devtools':'downloads'};
  if(key==='i'&&shift)return {action:'devtools'};
  if(key==='b'&&shift)return {action:'toggle-bookmarks'};
  if(key==='o')return {action:shift?'bookmarks':'open-file'};
  if(key==='a'&&shift)return {action:'tabs'};
  // The Mac Delete key reports Backspace.
  if((key==='delete'||mac&&key==='backspace')&&shift)return {action:'clear-data'};
  if(key==='u'&&shift)return {action:'tor-identity'}; // R3-61 · New Tor identity (Tor Browser's key); main only acts in a Tor tab or window
  if(key==='p')return {action:shift?'private-tab':'print'};
  if(key==='s')return {action:shift?'split-view':'save-page'};
  if(key===',')return {action:'settings'};
  if(['+','=','-','0'].includes(key))return {action:'zoom',change:key==='0'?0:key==='-'?-1:1};
 }
 if(key==='f3')return {action:'find-next',forward:!shift};
 if(key==='f5')return {action:mod||shift?'hard-reload':'reload'};
 // Ctrl+F6 / Ctrl+Shift+F6 move between split panes (the Windows next-document key); Ctrl+Alt+F6 swaps with the next pane.
 if(key==='f6'&&mod)return input.alt?{action:'split-swap'}:{action:'split-focus',direction:shift?-1:1};
 if(key==='f6')return {action:'address'};

 // F9 reader (Edge, Firefox); plain F10 focuses the toolbar (Chrome) and Shift+F10 stays the context-menu key.
 if(key==='f9'&&!mod&&!shift&&!input.alt)return {action:'reader'};
 if(key==='f10'&&!mod&&!shift&&!input.alt)return {action:'focus-toolbar'};
 if(key==='f11')return {action:'fullscreen'};
 if(key==='f12')return {action:'devtools'};
 if(key==='escape')return {action:'escape'};
 return null;
}

// Like Chrome, only window and tab management is reserved; websites get every other key first
// (Escape for their dialogs, Cmd+K/F/S in web apps) and the browser acts only when they leave it unhandled.
const RESERVED=new Set(['record-key','record-pending','new-tab','restore','close-tab','close-window','cycle-tab','select-tab','move-tab','fullscreen','controls','workspace']);
function isReservedShortcut(command, input) {
 if(RESERVED.has(command.action))return true;
 const key=shortcutKey(input);
 return command.action==='address'&&(key==='l'||key==='f6');
}
// The registry (desktop/shortcut-registry.cjs) layers user bindings and recording over the stock resolver.
let registry=null;
const setShortcutRegistry=value=>{registry=value;};
const resolveShortcut=(input,platform=process.platform)=>registry?registry.resolve(input,resolveDefaultShortcut,shortcutKey):resolveDefaultShortcut(input,platform);
module.exports={resolveShortcut,resolveDefaultShortcut,setShortcutRegistry,isReservedShortcut,shortcutKey};
