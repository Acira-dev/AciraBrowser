import type { BrowserAction } from '../../runtime/types';
import type { SplitLayoutId } from '../../runtime/splitLayout';

/** A split's layout is changed on the open split, so its saved arrangement opens first; choosing the layout it already has
 * only opens it. */
export const changeLayoutActions=(group:{id:string;layout:SplitLayoutId},layout:SplitLayoutId):BrowserAction[]=>
 [{type:'split.group.select',id:group.id},...(layout!==group.layout?[{type:'split.layout',layout} as BrowserAction]:[])];

/** The hover "+" on a tab group's header (R3-49): a new tab right after the group's last tab, in the group; a collapsed group opens so the
 * new tab shows. ONE action (14.1, tester 21 Nov): `tab.new` names the group and the reducer opens the tab inside it (runtime/tabGroups.ts
 * joinNewTab, which also opens the group). It used to be a `tab.new` and then a `tab.group.assign`: the interface draws `tab.new` on the press
 * frame and the join only when main answered, so for a frame or two the tab was a loose tab at the end of the list, drawn above the folder
 * ("new tabs at the top"), before it jumped into the group. The tab id is chosen here so the interface and main name it alike. */
export const newTabInGroupActions=(group:{id:string;collapsed?:boolean},lastMemberId:string|undefined,profileId:string,tabId:string):BrowserAction[]=>[
 {type:'tab.new',id:tabId,browserProfileId:profileId,...(lastMemberId?{afterId:lastMemberId}:{}),groupId:group.id},
];

/** The tabs that just arrived at the end of the sidebar's list as NEW tabs (founder, 24 Oct: with "new tabs at the top" a new tab shows under the
 * New tab row at once, and the model is reordered a moment later). A tab in `reopened` (it was in the closed list a moment ago: Ctrl+Shift+T, an
 * Undo) is not new: it comes back at its own place, even when that place was the end of the list.
 * `listed` (every tab the list shows, pinned and grouped ones too; the loose ones when absent): a list that keeps none of the tabs
 * shown before is another list (a workspace or a profile's space came on screen), not new tabs. Its first frame showed every one
 * of them upside down at the top, and the next frame put them back (founder, 3 Nov). */
export const appendedTabs=<T extends {id:string}>(loose:readonly T[],previous:ReadonlySet<string>,reopened:ReadonlySet<string>,listed:readonly T[]=loose):T[]=>
 !listed.some(tab=>previous.has(tab.id))?[]:loose.filter((tab,index)=>!previous.has(tab.id)&&!reopened.has(tab.id)&&!loose.slice(index+1).some(item=>previous.has(item.id)));

/** A catalog tip written "Name · {shortcut} what it does" reads as the name with the rest on its own line. The tooltip's key cap holds only keys
 *  (components/transient/tooltipParse.ts): it took everything after the dot for the cap, so "Add to Favorites" was squeezed into three lines
 *  and broke in the middle of a word beside a cap as wide as the sentence. */
export const nameAndNote=(tip:string):string=>{const at=tip.indexOf(' · ');return at>0?tip.slice(0,at)+'\n'+tip.slice(at+3):tip;};
