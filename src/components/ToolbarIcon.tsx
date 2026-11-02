import { Activity,ArrowLeft,ArrowRight,Bookmark,ClipboardCheck,Columns2,Download,FocusRow,History,Home,MoreHorizontal,PanelLeftClose,Plus,RotateCw,Settings2,ShieldCheck,SlidersHorizontal,SquareStack,Star,Contrast,X } from './AppIcons';
import { EditorGlyph } from './EditorGlyph';
import { PreviewIcon } from './PreviewIcon';
import './ToolbarIcon.css';

const icons = {
 // The sidebar toggle is the outline panel (outer frame + divider): the filled-pane PanelLeft mixed fill and stroke (§3.6).
 back:ArrowLeft,forward:ArrowRight,reload:RotateCw,home:Home,tune:SlidersHorizontal,
 star:Star,menu:MoreHorizontal,close:X,sidebar:PanelLeftClose,tabs:SquareStack,
 // Focus mode has its own glyph (C01); the toggle's pressed state, not a second glyph, says it is on.
 focus:FocusRow,unfocus:FocusRow,new:Plus,activity:Activity,approvals:ClipboardCheck,
 security:ShieldCheck,history:History,appearance:Contrast,settings:Settings2,
 downloads:Download,bookmarks:Bookmark,split:Columns2,
} as const;
export type ToolbarIconName = keyof typeof icons | 'starFilled';

/** The address star's saved state: the star's own outer contour, filled (the outline glyph is a ring and cannot be filled). */
const starFilled = `M11.947 14.987Q11.68 14.987 11.467 14.88L8 13.067L4.533 14.88Q4.213 15.04 3.893 14.987Q3.573 14.933 3.307 14.613Q3.04 14.293 3.147 13.867L3.787 10.027L0.96 7.253Q0.533 6.827 0.72 6.267Q0.907 5.707 1.493 5.653L5.387 5.067L7.147 1.547Q7.307 1.227 7.653 1.093Q8 0.96 8.347 1.093Q8.693 1.227 8.853 1.547L10.613 5.067L14.507 5.653Q15.093 5.707 15.28 6.267Q15.467 6.827 15.04 7.253L12.213 10.027L12.853 13.867Q12.96 14.293 12.667 14.64Q12.373 14.987 11.947 14.987Z`;

/** A single optical weight and 18px grid for Acira's browser furniture. */
export function ToolbarIcon({name,size=18}:{name:ToolbarIconName;size?:number}){
 if(name==='starFilled')return <svg className="toolbar-icon ed-editor-icon" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d={starFilled}/></svg>;
 const Icon=icons[name];
 return <PreviewIcon icon={Icon} className="toolbar-icon" size={size}/>;
}

/** Keep the icon separate from flexible menu-label spans. */
export function ExtensionsIcon({size=18,className}:{size?:number;className?:string}){
 return <span className={`menu-icon ${className||''}`} style={{display:'inline-flex',flex:`0 0 ${size}px`,width:size,height:size,alignItems:'center',justifyContent:'center'}}><EditorGlyph name="extensions"/></span>;
}
