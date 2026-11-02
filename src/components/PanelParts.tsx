import type {ReactNode} from 'react';
import './PanelParts.css';

/** Row parts for the one panel system (src/styles/panels.css, bible §4): [icon column] [title] [trailing], text at x = 36. */
export function Chevron(){return <svg className="acira-menu-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4.5 3 3 3-3 3"/></svg>;}

/** A fact: a quiet title with its value on the right. */
export function FactRow({label,value}:{label:string;value:ReactNode}){return <div className="acira-menu-row acira-menu-row-fact"><span/><span className="acira-menu-title">{label}</span><span className="acira-menu-value">{value}</span></div>;}

/** A switch row: the title on the text edge, the app toggle (the accent token) on the right. */
export function SwitchRow({id,label,checked,disabled,onChange,icon}:{id:string;label:string;checked:boolean;disabled?:boolean;onChange:()=>void;icon?:ReactNode}){
 return <div className="acira-menu-row acira-menu-row-fact">{icon??<span/>}<span className="acira-menu-title" id={id}>{label}</span><button type="button" role="switch" aria-labelledby={id} aria-checked={checked} className="shields-switch" disabled={disabled} onClick={onChange}><span aria-hidden="true"/></button></div>;
}

/** A disclosure: one row with a trailing chevron (an optional value and control before it); the body sits on the text edge. */
export function Disclosure({title,sub,icon,value,control,children,className=''}:{title:string;sub?:ReactNode;icon?:ReactNode;value?:ReactNode;control?:ReactNode;children:ReactNode;className?:string}){
 return <details className={`acira-disclosure ${className}`.trim()}><summary className={`acira-menu-row ${sub?'acira-menu-row-identity':'acira-menu-row-fact'}`}>{icon??<span/>}<span className="acira-menu-title">{title}{sub&&<span className="acira-menu-sub">{sub}</span>}</span><span className="acira-trail">{value!==undefined&&value!==''&&<span className="acira-menu-value">{value}</span>}{control}<Chevron/></span></summary><div className="acira-disclosure-body">{children}</div></details>;
}

/** An action row: the title on the text edge; destructive actions are red text only. */
export function ActionRow({label,onClick,disabled,danger}:{label:string;onClick:()=>void;disabled?:boolean;danger?:boolean}){
 return <button type="button" className={`acira-menu-row${danger?' acira-menu-row-danger':''}`} disabled={disabled} onClick={onClick}><span/><span className="acira-menu-title">{label}</span><span/></button>;
}
