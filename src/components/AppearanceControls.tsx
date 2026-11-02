import {WorkspaceCoverPicker} from './WorkspaceCoverPicker';
import {colorToCommit,completeHexColor,parseHexColor} from '../ui/hexColor';
import {toolbarLayout,toolbarLayoutPatch} from '../runtime/toolbarLayout';
import { useEffect,useId,useState,type CSSProperties,type KeyboardEvent } from 'react';
import { appearancePalettes,palettePreference } from '../runtime/appearancePalettes';
import type { Settings } from '../runtime/types';
import { useRafChange } from '../ui/useRafChange';
import { frameChromeOf } from '../ui/theme';
import './AppearanceControls.css';
import { ChevronRight,Contrast,Moon,Sun } from './AppIcons';
import { MenuToggle } from './MenuToggle';

import { t } from '../i18n';
import { paletteName } from '../features/onboarding/MakeItYours';
const modes=[{value:'light',label:t("appearancecontrols.light"),Icon:Sun},{value:'dark',label:t("appearancecontrols.dark"),Icon:Moon},{value:'system',label:t("appearancecontrols.auto"),Icon:Contrast}] as const;

/** An immediate, single-choice control. Arrow navigation stays inside its group. */
export function AppearanceModePicker({value,onChange}:{value:Settings['appearance'];onChange:(value:Settings['appearance'])=>void}){
 const index=Math.max(0,modes.findIndex(mode=>mode.value===value));
 function keyboard(event:KeyboardEvent<HTMLDivElement>){
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')),focused=buttons.indexOf(document.activeElement as HTMLButtonElement),current=focused<0?index:focused;
  const next=event.key==='Home'?0:event.key==='End'?2:(current+(['ArrowLeft','ArrowUp'].includes(event.key)?2:1))%3;
  onChange(modes[next].value);buttons[next]?.focus();
 }
 return <div className="appearance-mode-picker" role="radiogroup" aria-label={t("app.appearance")} onKeyDown={keyboard} style={{'--mode-index':index} as CSSProperties}>
  <span className="appearance-mode-indicator" aria-hidden="true"/>
  {modes.map(({value:mode,label,Icon})=><button type="button" role="radio" aria-label={t("appearancecontrols.labelAppearance", { label: label })} aria-checked={value===mode} data-initial-focus={value===mode?'true':undefined} tabIndex={value===mode?0:-1} key={mode} onClick={()=>onChange(mode)}><Icon size={16}/><span>{label}</span></button>)}
 </div>;
}

export type AppearanceFinish=typeof appearancePalettes[number];

/** One finish, the one swatch style everywhere: a diagonal split of the finish's real chrome, its light-mode tone top
 * left and its dark-mode tone bottom right. Square, 4px radius, one hairline rim; selected = 2px accent ring offset 2px;
 * hover lifts with a shadow, never a scale. 24px in panels (appearance popup, "Make it yours"), 20px in Settings rows.
 * A finish applies only when chosen (click, Enter, Space) — never on hover or focus (founder, 24 Oct). onPreview and
 * onPreviewEnd are accepted for older callers and ignored. */
export function FinishSwatch({finish,selected,onSelect,size=24,showName=false,tabIndex}:{finish:AppearanceFinish;selected:boolean;onSelect:()=>void;onPreview?:()=>void;onPreviewEnd?:()=>void;size?:number;showName?:boolean;tabIndex?:number}){
 const preference=palettePreference(finish);
 const swatch=<button type="button" role="radio" className="finish-swatch" aria-checked={selected} aria-label={paletteName(finish)} title={paletteName(finish)} tabIndex={tabIndex}
  style={{'--swatch-light':frameChromeOf(preference,false),'--swatch-dark':frameChromeOf(preference,true),'--swatch-size':`${size}px`} as CSSProperties}
  onClick={onSelect}/>;
 return showName?<span className="finish-swatch-item">{swatch}<span className="finish-swatch-name">{paletteName(finish)}</span></span>:swatch;
}

/** The finishes as one radio group of FinishSwatches, one row by default (12 × 24 + 11 × 8 = 376px). Arrow keys move
 * focus; a finish applies only on click, Enter or Space. */
export function GlassFinishPicker({settings,onChange,size=24,columns=appearancePalettes.length}:{settings:Settings;onChange:(patch:Partial<Settings>)=>void;size?:number;columns?:number}){
 const selected=appearancePalettes.find(palette=>palette.name===settings.colorPreset&&palette.tint.toLowerCase()===settings.browserTint.toLowerCase());
 const choose=(palette:AppearanceFinish)=>onChange(palettePreference(palette));
 function keyboard(event:KeyboardEvent<HTMLDivElement>){
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')),current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(current<0)return;
  event.preventDefault();event.stopPropagation();
  const top=buttons[0].getBoundingClientRect().top;
  const visibleColumns=buttons.filter(button=>Math.abs(button.getBoundingClientRect().top-top)<1).length;
  let next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
  if(visibleColumns<buttons.length&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
   const rows=Math.ceil(buttons.length/visibleColumns),row=(Math.floor(current/visibleColumns)+(event.key==='ArrowUp'?-1:1)+rows)%rows;
   next=row*visibleColumns+Math.min(current%visibleColumns,buttons.length-row*visibleColumns-1);
  }
  buttons[next]?.focus();
 }
 return <div className="glass-finish">
  <div className="glass-finish-grid" role="radiogroup" aria-label={t("appearancecontrols.finish")} onKeyDown={keyboard} style={{'--swatch-size':`${size}px`,'--swatch-columns':columns} as CSSProperties}>{appearancePalettes.map((palette,index)=>{const on=palette===selected;return <FinishSwatch key={palette.name} finish={palette} selected={on} size={size} tabIndex={on||!selected&&index===0?0:-1} onSelect={()=>choose(palette)}/>;})}</div>
  <span className="glass-finish-name">{(selected&&paletteName(selected))||'Custom'}</span>
 </div>;
}

/** Retains the system color picker; the well and editable hex value share one value. "ff0000" and " #ff0000 " are taken as #ff0000;
 *  text that is still not a colour stays in the field with a short message (Escape puts the colour back), never a silent revert. */
export function AppearanceColorWell({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const [input,setInput]=useState(value),[invalid,setInvalid]=useState(false),picker=useRafChange(onChange),messageId=useId();useEffect(()=>{setInput(value);setInvalid(false);},[value]);
 function commit(){
  if(!parseHexColor(input)){if(input.trim())setInvalid(true);else setInput(value);return;}
  const next=colorToCommit(input,value);if(next)onChange(next);setInput(next||value);setInvalid(false);
 }
 return <div className="appearance-color-field" role="group" aria-label={label}>
  <span className="appearance-color-well" style={{'--well-color':value} as CSSProperties}><input type="color" aria-label={t("appearancecontrols.labelPicker", { label: label })} value={completeHexColor(input)||value} onChange={event=>{setInput(event.target.value);setInvalid(false);picker.change(event.target.value);}} onPointerUp={picker.flush} onBlur={picker.flush}/><span aria-hidden="true"/></span>
  <input className="appearance-hex" aria-label={t("appearancecontrols.labelHexCode", { label: label })} aria-invalid={invalid||undefined} aria-describedby={invalid?messageId:undefined} value={input} maxLength={16} autoComplete="off" spellCheck={false} onChange={event=>{const text=event.target.value,next=completeHexColor(text);setInput(text);setInvalid(false);if(next)onChange(next);}} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setInput(value);setInvalid(false);}}}/>
  {invalid&&<p id={messageId} className="appearance-hex-message" role="alert">{t("appearancecontrols.hexInvalid")}</p>}
 </div>;
}

/** Glass opacity 40–100 (round 2). 100 is the opaque endpoint and turns Reduce transparency on; the store restores the last
 * translucent value when it is turned off again, so Settings and this popup always show one value. */
export function GlassOpacitySlider({value,onChange}:{value:number;onChange:(value:number)=>void}){
 const [draft,setDraft]=useState(value),change=useRafChange(onChange);useEffect(()=>setDraft(value),[value]);
 return <label className="appearance-opacity"><span>{t("appearancecontrols.windowOpacity")}</span><input type="range" min={40} max={100} step={1} value={draft} aria-label={t("appearancecontrols.windowOpacity")} aria-valuetext={draft===100?t('appearancecontrols.opaqueValue'):`${draft}%`} style={{'--opacity-progress':`${(draft-40)/60*100}%`} as CSSProperties} onChange={event=>{const next=Number(event.target.value);setDraft(next);change.change(next);}} onPointerUp={change.flush} onKeyUp={change.flush} onBlur={change.flush}/><output>{draft}%</output></label>;
}

export function AppearancePanel({settings,onChange,onMore,profileId,privateMode}:{settings:Settings;profileId?:string;privateMode?:boolean;onChange:(patch:Partial<Settings>)=>void;onMore:()=>void}){
 return <div className="appearance-panel study-appearance">
  <section className="appearance-section" aria-label={t("app.appearance")}><AppearanceModePicker value={settings.appearance} onChange={appearance=>onChange({appearance})}/></section>
  <section className="appearance-section"><div className="appearance-section-heading"><h3>{t("appearancecontrols.finish")}</h3></div><p>{t("appearancecontrols.colorsTheWindowFrameTabs")}</p><GlassFinishPicker settings={settings} onChange={onChange} columns={6}/></section>
  {profileId&&<section className="appearance-section"><div className="appearance-section-heading"><h3>{t('local.workspaceCover')}</h3></div><WorkspaceCoverPicker profileId={profileId} privateMode={privateMode} compact/></section>}
  <div className="appearance-preferences">
   <GlassOpacitySlider value={settings.reducedTransparency?100:settings.glassOpacity} onChange={glassOpacity=>onChange({glassOpacity})}/>
   {/* The house switch (MenuToggle), like every other popup (R3-B03). */}
   <MenuToggle label={t("appearancecontrols.compactAutomatically")} on={toolbarLayout(settings)==='automatic'} onToggle={()=>onChange(toolbarLayoutPatch(settings,toolbarLayout(settings)==='automatic'?'expanded':'automatic'))}/>
   <MenuToggle label={t("appearancecontrols.reducedTransparency")} on={settings.reducedTransparency} onToggle={()=>onChange({reducedTransparency:!settings.reducedTransparency})}/>
   <MenuToggle label={t("appearancecontrols.reducedMotion")} on={settings.reducedMotion} onToggle={()=>onChange({reducedMotion:!settings.reducedMotion})}/>
  </div>
  <button type="button" className="appearance-more" onClick={onMore}><span>{t("appearancecontrols.openSettings")}</span><ChevronRight size={15}/></button>
 </div>;
}
