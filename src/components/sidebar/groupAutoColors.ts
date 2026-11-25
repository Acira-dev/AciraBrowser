import { useRef } from 'react';
import { groupForTab, isAutoGroup } from '../../runtime/tabGroups';
import type { BrowserSnapshot, TabGroup, TabSession } from '../../runtime/types';
import { PALETTE_HUES, folderColors, type FolderColorInput, type SiteColor } from '../../ui/groupAutoColor';
import { iconColor, iconPending, tabIconSource, useIconColors, type IconColor } from '../../ui/siteIconColor';
import { currentSiteColor, toneOf } from '../../ui/ownPageGlow';

/** Beta 14, section M: the automatic colour of the folders on screen. The sidebar and the group's colour menu both call this with the same folders
 *  (`scopeGroups`), so the swatch in the menu is the colour the folder wears. Pure allocation lives in ui/groupAutoColor.ts. */

const siteOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; } };

/** The folders of one profile and workspace, in the order they appear in the tab list (the order of their first tab), with their tabs. */
export function scopeGroups(state: Pick<BrowserSnapshot, 'tabs' | 'tabGroups'>, of: Pick<TabGroup, 'browserProfileId' | 'workspaceId'>): { group: TabGroup; members: TabSession[] }[] {
  const seen = new Set<string>(), out: { group: TabGroup; members: TabSession[] }[] = [];
  for (const tab of state.tabs) {
    const group = groupForTab(state, tab);
    if (!group || seen.has(group.id) || group.browserProfileId !== of.browserProfileId || (group.workspaceId ?? '') !== (of.workspaceId ?? '')) continue;
    seen.add(group.id);
    out.push({ group, members: state.tabs.filter(item => groupForTab(state, item)?.id === group.id) });
  }
  return out;
}

/** The pure part: what each folder is, to the allocator. A hand-picked folder carries its palette hue, an automatic one its sites. */
export function folderInputs(groups: readonly { group: TabGroup; members: readonly TabSession[] }[], colorOf: (tab: TabSession) => IconColor | null | undefined): FolderColorInput[] {
  return groups.map(({ group, members }) => isAutoGroup(group)
    ? { id: group.id, sites: members.map<SiteColor>(tab => ({ site: siteOf(tab.url), color: colorOf(tab) })) }
    : { id: group.id, fixed: PALETTE_HUES[group.color] ?? null });
}

/** A tab's colour for its folder: the site's colour main gave it (the same one its ring and the frame's glow wear: ui/ownPageGlow.ts siteGlowColour), else its icon's own reading
 *  while main has not read the tab (14.1: the folder used to read the icon alone, so a site with a theme-color, or a many-coloured icon, coloured its folder unlike its ring). */
export const colorOfTab = (tab: Pick<TabSession, 'url' | 'favicon' | 'siteColor' | 'siteColorHost'>): IconColor | null | undefined => { const site = toneOf(currentSiteColor(tab)); if (site) return site; const src = tabIconSource(tab.url, tab.favicon); return src ? iconColor('', src) : null; };

/** The automatic colour of every automatic folder in `groups` (listed in the order they appear): `{h,c}`, or `null` when none of its sites has a colour.
 *  Re-renders as icons finish being read. While one of a folder's icons is still being read the folder keeps what it wore, so it never blinks. */
export function useGroupAutoColors(groups: readonly { group: TabGroup; members: readonly TabSession[] }[]): Map<string, IconColor | null> {
  const items = groups.flatMap(({ group, members }) => isAutoGroup(group) ? members.map(tab => ({ key: tab.id, site: '', src: tabIconSource(tab.url, tab.favicon) })) : []);
  useIconColors(items); // subscribes: a finished read renders again
  const kept = useRef(new Map<string, FolderColorInput>());
  const inputs = folderInputs(groups, colorOfTab).map(input => {
    const entry = groups.find(item => item.group.id === input.id)!;
    if (input.fixed !== undefined) { kept.current.delete(input.id); return input; }
    const waiting = entry.members.some(tab => !toneOf(currentSiteColor(tab)) && iconPending('', tabIconSource(tab.url, tab.favicon)));
    const last = kept.current.get(input.id);
    if (waiting && last) return last;
    if (!waiting) kept.current.set(input.id, input);
    return input;
  });
  for (const id of [...kept.current.keys()]) if (!groups.some(item => item.group.id === id)) kept.current.delete(id);
  return folderColors(inputs);
}
