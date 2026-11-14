import type { BookmarkNode } from './types';

/** Chromium's fixed id of the bookmark bar folder (components/bookmarks/browser/bookmark_uuids.cc, kBookmarkBarNodeUuid). Chrome, Edge,
 *  Brave and the other Chromium browsers write it as the "guid" of roots.bookmark_bar in their Bookmarks file, and Acira's importer keeps
 *  a node's guid as the end of its importKey (desktop/imports.cjs collectBookmarks): an imported folder whose key ends with it WAS that
 *  browser's bookmarks bar, whatever it was called. */
export const CHROMIUM_BAR_UUID = '0bc5d13f-2cba-5d74-951f-3f233fe6c908';

/** Every name a Chromium browser gives its bookmark bar folder: IDS_BOOKMARK_BAR_FOLDER_NAME ("Bookmarks bar", message id
 *  8349305172487531364) and its title-case form on the Mac ("Bookmarks Bar", 5190835502935405962) in all 81 of Chromium's languages
 *  (components/strings/components_strings_<locale>.xtb, read 13 Nov 2026; BSD-3-Clause, Copyright The Chromium Authors), plus
 *  Microsoft Edge's English "Favorites bar". Chromium stores the folder under its translated name (bookmark_node.cc CreateBookmarkBar,
 *  bookmark_codec.cc writes node->GetTitle() as "name"), so a bookmarks bar imported from a browser in another language, or from Edge,
 *  arrived in Acira as an ordinary top-level folder with one of these names. */
export const IMPORTED_BAR_NAMES: readonly string[] = [
 "Bookmarks bar", // en (Windows, Linux) en-GB fil
 "Bookmarks Bar", // en (Mac: title case)
 "Boekmerkebalk", // af
 "የዕልባቶች አሞሌ", // am
 "شريط الإشارات", // ar
 "বুকমাৰ্কৰ বাৰ", // as
 "Əlfəcin paneli", // az
 "Əlfəcinlər Paneli", // az
 "Панэль закладак", // be
 "Лента на отметките", // bg
 "বুকমার্কস বার", // bn
 "বুকমার্ক বার", // bn
 "Traka oznaka", // bs hr
 "Barra d'adreces d'interès", // ca
 "Lišta záložek", // cs
 "Bar nodau tudalen", // cy
 "Bar Nodau Tudalen", // cy
 "Bogmærkelinje", // da
 "Lesezeichenleiste", // de
 "Γραμμή σελιδοδεικτών", // el
 "Barra de favoritos", // es-419 pt-BR
 "Barra de marcadores", // es gl pt-PT
 "Järjehoidjariba", // et
 "Laster-marken barra", // eu
 "نوار نشانک‌ها", // fa
 "Kirjanmerkkipalkki", // fi
 "Bar ng Mga Bookmark", // fil
 "Barre de favoris", // fr fr-CA
 "બુકમાર્ક બાર", // gu
 "बुकमार्क बार", // hi mr
 "Könyvjelzősáv", // hu
 "Էջանիշների գոտի", // hy
 "Bilah bookmark", // id
 "Bilah Bookmark", // id
 "Bókamerkjastika", // is
 "Barra dei preferiti", // it
 "סרגל סימניות", // iw
 "סרגל הסימניות", // iw
 "ブックマーク バー", // ja
 "სანიშნეების ზოლი", // ka
 "Бетбелгілер жолағы", // kk
 "របាចំណាំ", // km
 "ಬುಕ್‌ಮಾರ್ಕ್‌ಗಳ ಬಾರ್", // kn
 "북마크바", // ko
 "Кыстармалар тилкеси", // ky
 "ແຖບບຸກມາກສ໌", // lo
 "Žymių juosta", // lt
 "Grāmatzīmju josla", // lv
 "Лента со обележувачи", // mk
 "ബുക്മാര്‍ക്ക് ബാര്‍", // ml
 "ബുക്ക്‌മാര്‍‌ക്ക് ബാര്‍‌", // ml
 "Хайлтын жагсаалтын цонх", // mn
 "Bar penanda halaman", // ms
 "Bar Penanda Halaman", // ms
 "စာညှပ် ဘား", // my
 "बुकमार्क पट्टी", // ne
 "पृष्ठमञ्जूषा पट्टी", // ne
 "Bookmarkbalk", // nl
 "Bokmerkerad", // no
 "ବୁକମାର୍କସ୍ ଦଣ୍ଡିକା", // or
 "ବୁକମାର୍କ ବାର୍", // or
 "ਬੁੱਕਮਾਰਕਸ ਬਾਰ", // pa
 "ਬੁੱਕਮਾਰਸ ਬਾਰ", // pa
 "Pasek zakładek", // pl
 "Bara de marcaje", // ro
 "Bară de marcaje", // ro
 "Панель закладок", // ru uk
 "පිටු සලකුණු බාර් එක", // si
 "පොත්සලකුණු තීරුව", // si
 "Panel so záložkami", // sk
 "Vrstica z zaznamki", // sl
 "Shiriti i faqeshënuesve", // sq
 "Traka sa obeleživačima", // sr-Latn
 "Трака са обележивачима", // sr
 "Bokmärkesfältet", // sv
 "Sehemu ya Alamisho", // sw
 "புக்மார்க் பட்டி", // ta
 "బుక్‌మార్క్‌ల బార్‌", // te
 "బుక్‌మార్క్‌ల బార్", // te
 "แถบบุ๊กมาร์ก", // th
 "Yer işaretleri çubuğu", // tr
 "Yer İşaretleri Çubuğu", // tr
 "بُک مارکس بار", // ur
 "Xatcho‘plar paneli", // uz
 "Thanh dấu trang", // vi
 "Thanh Dấu trang", // vi
 "书签栏", // zh-CN
 "書籤列", // zh-HK zh-TW
 "Ibha yamabhukhimakhi", // zu
 "Favorites bar", // Microsoft Edge (en)
];

const BAR_TITLE = 'Bookmarks bar';
const fold = (title: string) => title.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const barNames = new Set(IMPORTED_BAR_NAMES.map(fold));
const isBar = (node: BookmarkNode) => !node.url && !node.parentId && fold(node.title) === 'bookmarks bar';
/** A top-level folder an import made from another browser's bookmarks bar: recorded by Chromium's bar id in its importKey. */
export const recordedBarRoot = (node: BookmarkNode) => !node.url && !node.parentId && !!node.importKey?.endsWith(':' + CHROMIUM_BAR_UUID);
/** A top-level folder an import made under one of the bar's known names (an import that did not record the id). */
export const namedBarRoot = (node: BookmarkNode) => !node.url && !node.parentId && !!node.importKey && barNames.has(fold(node.title));

/** Once per load (restoreSnapshot), for each profile: a bookmarks bar that an earlier import brought in under another name becomes
 *  Acira's Bookmarks bar folder, so its pages and folders show on the bar.
 *  - A recorded bar root (Chromium's bar id in its importKey) becomes the bar when the profile has none; when it has one, the root's
 *    children move to the end of it, in their order, and the emptied root goes (what importing it today does: the importer names the
 *    bar root "Bookmarks bar" and a folder of the same name and place takes its items).
 *  - Otherwise a top-level folder an import made under a known bar name becomes the bar, only when the profile has no bar yet.
 *  - A folder the person made (no importKey) is never touched, and nothing else moves. Nothing to do: the same array comes back.
 *  Returns the nodes and the profiles that changed (their positions are renumbered by the caller). Pure. */
export function repairImportedBarRoots(nodes: BookmarkNode[]): { nodes: BookmarkNode[]; changed: string[] } {
  const changed: string[] = [];
  let out = nodes;
  for (const profile of new Set(nodes.map(node => node.browserProfileId))) {
    const top = out.filter(node => node.browserProfileId === profile && !node.parentId && !node.url).sort((a, b) => a.position - b.position);
    let bar = top.find(isBar);
    const recorded = top.filter(node => node !== bar && recordedBarRoot(node)), named = top.filter(node => node !== bar && !recordedBarRoot(node) && namedBarRoot(node));
    if (!recorded.length && (bar || !named.length)) continue;
    if (out === nodes) out = nodes.map(node => ({ ...node }));
    const own = (id: string) => out.find(node => node.id === id)!;
    const rename = (id: string) => { const node = own(id); node.title = BAR_TITLE; return node; };
    let merge = recorded;
    if (!bar && recorded.length) { bar = rename(recorded[0].id); merge = recorded.slice(1); }
    for (const root of merge) {
      const target = bar!.id, end = out.filter(node => node.parentId === target).length;
      out.filter(node => node.parentId === root.id).sort((a, b) => a.position - b.position).forEach((child, index) => { child.parentId = target; child.position = end + index; });
      out = out.filter(node => node.id !== root.id);
    }
    if (!bar && named.length) rename(named[0].id);
    changed.push(profile);
  }
  return { nodes: out, changed };
}
