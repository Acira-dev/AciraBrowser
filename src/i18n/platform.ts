/** Setup's import step and its password hand-off: "this PC" and the "Recycle Bin" are the Mac and its Trash, in every language. */
const macWording = new Set(['setup.import.found', 'handoff.trash', 'handoff.trashed']);
/** Messages whose only platform word is the OS name. Every language writes it "Windows", so a Mac says macOS in the same sentence. */
const osNameMessages = new Set(['language.system', 'browsersettings.animationSystemOff', 'privacy.passkeysDetail', 'vpn.control.protonApp']);

/** Keys written in Windows terms inside a sentence ("Ctrl+S", "Ctrl+Shift+E", "Alt+T") are Mac keys on a Mac: ⌘S, ⇧⌘E, ⌥T, in the Mac's
 * ⌥⇧⌘ order. Letters only: Ctrl+Tab is the Control key there too, and Option+digit is not the workspace key. German and French write the
 * keys as their keyboards label them ("Strg+Umschalt+E", "Ctrl+Maj+E"): the same keys. */
const writtenKey = /\b((?:Ctrl|Strg|Alt|Shift|Umschalt|Maj)(?:\+(?:Ctrl|Strg|Alt|Shift|Umschalt|Maj))*)\+([A-Z])\b/g;
const macModifier: Record<string, string> = { Ctrl: '⌘', Strg: '⌘', Alt: '⌥', Shift: '⇧', Umschalt: '⇧', Maj: '⇧' };
const macOrder = '⌥⇧⌘';
/** Any other "Alt" is the Option key on a Mac, in every language ("Alt+click", "Alt+Up", "Alt-Klick", "按住 Alt 点击" read Option), and
 * Alt+Enter is Option+Return there. Alt+digit is left alone: Option+digit is not the workspace key (import.desc.spaces says ⌃1–8). */
const optionKey = (text: string) => text.replace(/\bAlt\+Enter\b/g, 'Option+Return').replace(/\bAlt\b(?!\s*\+\s*\d)/g, 'Option');
/** The same conversion for text that is still written in English in the code (a Settings row's detail), for a Mac only. */
export const macKeys = (text: string) =>
  optionKey(text.replace(writtenKey, (_match, modifiers: string, key: string) =>
    [...new Set(modifiers.split('+').map((name) => macModifier[name]))].sort((a, b) => macOrder.indexOf(a) - macOrder.indexOf(b)).join('') + key));

const replaceAll = (text: string, pairs: readonly (readonly [string, string])[]) => pairs.reduce((out, [from, to]) => out.replaceAll(from, to), text);
/** "Windows Settings" in the thirteen catalogs, and what a Mac calls that place in the same sentence. */
const systemSettings = [
  ['Windows Settings', 'System Settings'], ['إعدادات Windows', 'إعدادات النظام'], ['Windows-Einstellungen', 'Systemeinstellungen'],
  ['Configuración de Windows', 'Ajustes del Sistema'], ['Paramètres de Windows', 'Réglages Système'], ['Windows सेटिंग', 'सिस्टम सेटिंग'],
  ['Impostazioni di Windows', 'Impostazioni di Sistema'], ['Windows の設定', 'システム設定'], ['Windows 설정', '시스템 설정'],
  ['Configurações do Windows', 'Configurações do Sistema'], ['configurações do Windows', 'configurações do Sistema'], ['настройках Windows', 'системных настройках'],
  ['Windows Ayarları', 'Sistem Ayarları'], [' Windows 设置', '系统设置'],
] as const;
/** The clause about keys with the Windows key in the Shortcuts note, in the thirteen catalogs, and the sentence without it. */
const withoutWindowsKey = [
  [', Esc and keys with the Windows key stay', ' and Esc stay'], [' والمفاتيح المصحوبة بمفتاح Windows', ''], [', Esc und Tasten mit der Windows-Taste bleiben', ' und Esc bleiben'],
  [', Esc y las teclas con la tecla Windows se reservan', ' y Esc se reservan'], [', Échap et les touches avec la touche Windows restent', ' et Échap restent'],
  [', Esc और Windows कुंजी वाले संयोजन सिस्टम के लिए रहते हैं', ' और Esc सिस्टम के लिए रहते हैं'], [', Esc e i tasti con il tasto Windows restano', ' ed Esc restano'],
  ['、Esc、および Windows キーを使うキーはシステム用に予約されています', '、Esc はシステム用に予約されています'], [', Esc 및 Windows 키를 사용하는 조합은 시스템에서 처리합니다', ' 및 Esc는 시스템에서 처리합니다'],
  [', Esc e teclas com a tecla Windows ficam', ' e Esc ficam'], [', Esc и сочетания с клавишей Windows остаются', ' и Esc остаются'], [', Esc ve Windows tuşu içeren birleşimler sistemde kalır', ' ve Esc sistemde kalır'],
  ['、Esc 以及带 Windows 键的组合键由系统保留', '和 Esc 由系统保留'],
] as const;

/** Native security names in the shared secured-workspace copy. Translate the catalog
 * before substituting parameters, so a workspace's own name is never rewritten. */
export function platformCatalogText(id: string, text: string, platform: string): string {
  if (platform !== 'darwin') return text;
  if (macWording.has(id)) text = text.replace(/\bPC\b/g, 'Mac').replaceAll('Recycle Bin', 'Trash');
  // A Tor window opens with Option+Cmd+N on a Mac (Option+Shift+N types a character), in every language: Alt+Shift+N, Alt+Umschalt+N, Alt+Maj+N.
  if (id === 'privacy.forAnonymityRatherThanA') text = text.replace(/Alt\+[^+()（）\s]+\+N/, '⌥⌘N');
  // The English copy calls the computer "this PC" (folders an extension is loaded from, files it cannot open, what setup found).
  text = macKeys(text.replaceAll('this PC', 'this Mac'));
  if (id.startsWith('workspaces.')) return text.replaceAll('Windows Hello', 'macOS').replaceAll('Windows', 'macOS');
  // The Nth workspace opens with Control+digit on a Mac (Option+digit types a character), in every language: ⌃1–8, as the toasts write it.
  if (id === 'import.desc.spaces') return text.replaceAll('Alt+1–8', '⌃1–8');
  // A Mac has no Windows key: its clause leaves the sentence, in every language.
  if (id === 'shortcuts.systemKeysNote') return replaceAll(text, withoutWindowsKey);
  // The Mac's own name for the place Windows calls Settings (the clock fix Tor asks for), in every language.
  if (id === 'tor.clock.detail' || id === 'tor.err.clock.detail') return replaceAll(text, systemSettings);
  return osNameMessages.has(id) ? text.replaceAll('Windows', 'macOS') : text;
}
