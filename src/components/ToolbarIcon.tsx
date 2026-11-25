import { Activity,ArrowLeft,ArrowRight,Bookmark,ClipboardCheck,Columns2,Download,FocusRow,SeamlessRow,History,Home,MoreHorizontal,PanelLeftClose,Plus,RotateCw,Settings2,ShieldCheck,SlidersHorizontal,SquareStack,Star,Contrast,X } from './AppIcons';
import { EditorGlyph } from './EditorGlyph';
import { PreviewIcon } from './PreviewIcon';
import { LineIcon } from './LineIcon';
import { lineNameFor } from '../ui/lineIconSet';
import './ToolbarIcon.css';

const icons = {
 // The sidebar toggle is the outline panel (outer frame + divider): the filled-pane PanelLeft mixed fill and stroke (§3.6).
 back:ArrowLeft,forward:ArrowRight,reload:RotateCw,home:Home,tune:SlidersHorizontal,
 star:Star,menu:MoreHorizontal,close:X,sidebar:PanelLeftClose,tabs:SquareStack,
 // Focus mode has its own glyph (C01); the toggle's pressed state, not a second glyph, says it is on.
 focus:FocusRow,unfocus:FocusRow,seamless:SeamlessRow,new:Plus,activity:Activity,approvals:ClipboardCheck,
 security:ShieldCheck,history:History,appearance:Contrast,settings:Settings2,
 downloads:Download,bookmarks:Bookmark,split:Columns2,
} as const;
export type ToolbarIconName = keyof typeof icons | 'starFilled' | 'sidebarClosed';

/** A single optical weight and 18px grid for Acira's browser furniture. The icons the brief's section G animates are the website's
 * single line (LineIcon: they redraw, nudge and morph); the rest stay the Codicons they were, still and quiet. The star's saved state
 * is the same drawing with its fill, so Save and Remove morph the one element (the old filled contour is gone). */
export function ToolbarIcon({name,size=18}:{name:ToolbarIconName;size?:number}){
 const line=lineNameFor[name];
 if(line)return <LineIcon name={line} size={size} className={name==='star'||name==='starFilled'?'toolbar-line-icon li-star':'toolbar-line-icon'}/>;
 const Icon=icons[name as keyof typeof icons];
 return <PreviewIcon icon={Icon} className="toolbar-icon" size={size}/>;
}

/** Keep the icon separate from flexible menu-label spans. */
export function ExtensionsIcon({size=18,className}:{size?:number;className?:string}){
 return <span className={`menu-icon ${className||''}`} style={{display:'inline-flex',flex:`0 0 ${size}px`,width:size,height:size,alignItems:'center',justifyContent:'center'}}><EditorGlyph name="extensions"/></span>;
}
