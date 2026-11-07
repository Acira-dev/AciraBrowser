import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type FocusEvent,type KeyboardEvent,type PointerEvent,type RefObject,type TransitionEvent } from 'react';
import type { BrowserStyle,SearchEngine } from '../runtime/types';
import { urlDisplay } from '../ui/urlDisplay';
import { glideGuardMs,glideLayout,hiddenPrefixLength,startsGlide,type Glide } from '../ui/addressGlide';
import '../styles/address-glide.css';
import { addressDisplayMap,hitDisplay,mapDisplayChar,mapDisplaySelection,stepAddressGesture,wordAt,type AddressGesture,type AddressGestureEffect } from '../ui/addressSelection';

import { t } from '../i18n';

/** Name of the CSS custom highlight that paints a drag over the at-rest text (styled in toolbar-controls.css). */
const DRAG_HIGHLIGHT = 'acira-address-drag';
/** How long a blur toward the suggestion overlay waits for main to hand focus back (measured well under this in the app). */
export const SUGGESTION_FOCUS_GRACE_MS = 200;
type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
const highlights = () => (globalThis as { CSS?: { highlights?: Highlights } }).CSS?.highlights;

/** Left edge of every shown URL character plus the right edge of the last (characters past the ellipsis are not
 * measured: they sit at the clip edge), and the text nodes, for painting. */
function measureDisplay(el: HTMLElement) {
  const nodes: Text[] = [], edges: number[] = [], range = document.createRange(), clipRight = el.getBoundingClientRect().right;
  for (const part of el.querySelectorAll('[data-url-part]')) for (const node of part.childNodes) if (node instanceof Text) nodes.push(node);
  let right = el.getBoundingClientRect().left;
  for (const node of nodes) for (let i = 0; i < node.length; i += 1) {
    if (right > clipRight) { edges.push(clipRight); continue; }
    range.setStart(node, i); range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect(); edges.push(rect.left); right = rect.right;
  }
  edges.push(Math.min(right, clipRight));
  return { nodes, edges, clipRight };
}

function paintDisplay(nodes: readonly Text[], a: number, b: number) {
  const registry = highlights(), Ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !Ctor) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === hi) { registry.delete(DRAG_HIGHLIGHT); return; }
  const at = (offset: number): [Text, number] | null => {
    let seen = 0;
    for (const node of nodes) { if (offset <= seen + node.length) return [node, offset - seen]; seen += node.length; }
    return null;
  };
  const start = at(lo), end = at(hi);
  if (!start || !end) return;
  const range = document.createRange(); range.setStart(...start); range.setEnd(...end);
  registry.set(DRAG_HIGHLIGHT, new Ctor(range));
}

/** The address field (design bible §5.1): left-aligned, no motion on focus. At rest a URL reads as Inter 13 with its
 * registrable domain at full strength and the rest quieter; focusing shows the full address, selected.
 *
 * Pointer selection follows Chrome's omnibox (see `addressSelection.ts`): a click selects the whole address; a press
 * and drag on the at-rest text keeps that text (and paints the drag on it) until release, then shows the full address
 * with exactly the dragged characters selected; a double click selects the word under the first press, a triple click
 * everything. Once the field shows the full address, the pointer is left to the browser. */
export function AddressField({glide, inputRef, value, onChange, onFocus, onBlur, onModifiedEnter, suggestionOpen=false,popupTrigger=false,activeSuggestionId,suggestionListId='address-suggestions',onSuggestionKeyDown,placeholder=t('addressfield.placeholder'),label=t('addressfield.label')}: {
  /** The address text at rest sits in the middle of the field and glides to the left edge while the field is in use (and back): its time and easing (ui/addressGlide.ts). `ms` 0 places it without a glide (Reduce motion, speed Off). Left out: the text stays at the left, as ever. */glide?: Glide;
  centerWithin?: string; label?: string; placeholder?: string; inputRef: RefObject<HTMLInputElement | null>; value: string; onChange: (value: string) => void;
  onFocus: () => void; onBlur: (event:FocusEvent<HTMLInputElement>) => void; style: BrowserStyle; reducedMotion: boolean; speed: number;
  onModifiedEnter: (value: string, newTab: boolean) => void;
  searchEngine?:SearchEngine;suggestionOpen?:boolean;popupTrigger?:boolean;activeSuggestionId?:string;suggestionListId?:string;onSuggestionKeyDown?:(event:KeyboardEvent<HTMLInputElement>)=>boolean;
}) {
  const pointer = useRef(false), focusClick = useRef<{id:number;x:number;y:number;moved:boolean}|null>(null);
  const [focused, setFocused] = useState(false), [keyboard, setKeyboard] = useState(false), [holding, setHolding] = useState(false);
  const displayRef = useRef<HTMLSpanElement>(null), gesture = useRef<AddressGesture>({kind:'idle'}), held = useRef(false), swallowMouse = useRef(false);
  const measured = useRef<ReturnType<typeof measureDisplay>|null>(null);
  // The glide (ui/addressGlide.ts). `aligned` is where the text is headed: at the left (the field is in use) or in the middle. A press that
  // holds the at-rest text for a drag leaves it in the middle until release. A change of it starts a glide, and for its length the at-rest
  // layer stays mounted and cross-fades with the input's own text (address-glide.css reads one number, --af-p, for both and for the move).
  const aligned = focused && !holding, fieldRef = useRef<HTMLDivElement>(null), rulerRef = useRef<HTMLSpanElement>(null);
  const [wasAligned, setWasAligned] = useState(aligned), [glideOn, setGlideOn] = useState(false);
  if (wasAligned !== aligned) { setWasAligned(aligned); setGlideOn(startsGlide(wasAligned, aligned, glide)); }
  useEffect(() => {
    if (!glideOn || !glide) return;
    const guard = window.setTimeout(() => setGlideOn(false), glideGuardMs(glide)); // the end of the transition ends it; this is for a window that never paints
    return () => window.clearTimeout(guard);
  }, [glideOn, wasAligned, glide?.ms]);
  const display = !focused || holding || glideOn ? urlDisplay(value) : null;
  // Where the middle is: measured here (the text's width in the field's own font), applied as CSS numbers on the field.
  const shownKey = display ? display.prefix + display.domain + display.rest + display.insecure : '';
  useLayoutEffect(() => {
    const field = fieldRef.current, ruler = rulerRef.current, input = inputRef.current;
    if (!glide || !field || !ruler || !input) return;
    const measure = () => {
      const shown = displayRef.current; let textWidth: number;
      if (shown) { const range = document.createRange(); range.selectNodeContents(shown); textWidth = range.getBoundingClientRect().width; }
      else if (!aligned) { ruler.textContent = value || placeholder; textWidth = ruler.getBoundingClientRect().width; }
      else return; // in use and nothing at rest to place: the text is at the left
      const map = shown ? addressDisplayMap(input.value) : null, hidden = map ? hiddenPrefixLength(map.index) : 0;
      let hiddenWidth = 0; if (hidden > 0) { ruler.textContent = input.value.slice(0, hidden); hiddenWidth = ruler.getBoundingClientRect().width; }
      const layout = glideLayout({ fieldWidth: field.clientWidth, textWidth, hiddenPrefixWidth: hiddenWidth });
      field.style.setProperty('--af-center', layout.center + 'px'); field.style.setProperty('--af-pre', layout.pre + 'px');
      field.toggleAttribute('data-glidable', layout.center > 0); // no room: the text stays at the left and swaps as it always did
    };
    measure();
    const watch = new ResizeObserver(measure); watch.observe(field);
    document.fonts?.addEventListener('loadingdone', measure); // the first measure may come before Inter has loaded
    return () => { watch.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [!!glide, value, placeholder, aligned, shownKey]);

  const parked = useRef<{start:number|null;end:number|null;direction:'forward'|'backward'|'none'|null;timer:number}|null>(null);
  useEffect(() => () => window.clearTimeout(parked.current?.timer), []);
  const release = () => { held.current = false; measured.current = null; setHolding(false); highlights()?.delete(DRAG_HIGHLIGHT); };
  const finishBlur = (event: FocusEvent<HTMLInputElement>) => { setFocused(false); pointer.current = false; focusClick.current=null; gesture.current={kind:'idle'}; if(held.current)release(); onBlur(event); };
  const apply = (effect: AddressGestureEffect, input: HTMLInputElement) => {
    if (effect.type === 'hold') {
      held.current = true; setHolding(true); pointer.current = true; setKeyboard(false);
      input.focus({preventScroll:true}); input.setSelectionRange(0, 0);
      paintDisplay(measured.current?.nodes ?? [], effect.anchor, effect.focus);
    } else if (effect.type === 'paint') paintDisplay(measured.current?.nodes ?? [], effect.anchor, effect.focus);
    else if (effect.type === 'select-all' || effect.type === 'select-range' || effect.type === 'select-word') {
      release();
      const map = addressDisplayMap(input.value);
      if (effect.type === 'select-all' || !map) { input.select(); return; }
      if (effect.type === 'select-range') { const s = mapDisplaySelection(map, effect.anchor, effect.focus); input.setSelectionRange(s.start, s.end, s.direction); return; }
      const word = wordAt(input.value, mapDisplayChar(map, effect.char)); input.setSelectionRange(word.start, word.end);
    }
  };
  const hit = (event: PointerEvent<HTMLInputElement>) => measured.current ? hitDisplay(measured.current.edges, event.clientX, measured.current.clipRight) : {caret:0,char:0};

  return <div ref={fieldRef} className="address-field" data-focused={focused} data-keyboard-focus={focused && keyboard} data-display={display && (!glideOn || holding) ? true : undefined} data-holding={holding || undefined}
    {...(glide ? { 'data-glide': '', 'data-aligned': aligned || undefined, 'data-crossfade': glideOn && !holding && display ? '' : undefined, style: { '--af-ms': glide.ms + 'ms', '--af-ease': glide.ease } as CSSProperties, onTransitionEnd: (event: TransitionEvent) => { if (event.target === event.currentTarget && event.propertyName === '--af-p') setGlideOn(false); } } : {})}>
    {glide && <span ref={rulerRef} className="address-ruler" aria-hidden="true"/>}
    {display && <span ref={displayRef} className="address-display" aria-hidden="true">
      {display.insecure && <span className="address-insecure">{t("addressfield.notSecure")}</span>}
      <span data-url-part className="address-quiet">{display.prefix}</span><span data-url-part className="address-domain">{display.domain}</span><span data-url-part className="address-quiet">{display.rest}</span>
    </span>}
    <input data-popup-trigger={popupTrigger||undefined} ref={inputRef} aria-label={label} value={value} placeholder={placeholder}
      role={onSuggestionKeyDown?'combobox':undefined} aria-autocomplete={onSuggestionKeyDown?'list':undefined} aria-expanded={onSuggestionKeyDown?suggestionOpen:undefined} aria-controls={suggestionOpen?suggestionListId:undefined} aria-activedescendant={suggestionOpen?activeSuggestionId:undefined}
      autoComplete="off" spellCheck={false}
      onPointerDown={event => {
        const input = event.currentTarget, el = displayRef.current;
        // The at-rest text is drawn over a transparent input holding the full address: only while it is really drawn
        // (not in forced colours, not on the new-tab page) do the shown characters differ from the input's.
        const atRest = event.button === 0 && !!el && !held.current && document.activeElement !== input && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && !!addressDisplayMap(input.value);
        swallowMouse.current = false;
        if (atRest && el) {
          measured.current = measureDisplay(el);
          const {caret,char} = hit(event);
          const step = stepAddressGesture(gesture.current, {type:'down',pointerId:event.pointerId,x:event.clientX,y:event.clientY,caret,char,button:event.button,detail:1,shift:event.shiftKey,time:event.timeStamp,atRest});
          gesture.current = step.state; swallowMouse.current = true; focusClick.current = null;
          event.preventDefault(); input.setPointerCapture(event.pointerId); apply(step.effect, input); return;
        }
        // Presses on a field that already shows the full address stay native; a double/triple click that follows a
        // click-to-expand is taken in onMouseDown (its `detail` is the click count; a pointerdown's is not).
        pointer.current = true; setKeyboard(false); if(event.button===0)setFocused(true);
        focusClick.current = event.button===0&&!event.shiftKey&&document.activeElement!==input
          ? {id:event.pointerId,x:event.clientX,y:event.clientY,moved:false}:null;
      }}
      onMouseDown={event => {
        if (swallowMouse.current) { swallowMouse.current = false; event.preventDefault(); return; }
        if (gesture.current.kind !== 'clicked') return;
        const step = stepAddressGesture(gesture.current, {type:'down',pointerId:-1,x:event.clientX,y:event.clientY,caret:0,char:0,button:event.button,detail:event.detail,shift:event.shiftKey,time:event.timeStamp,atRest:false});
        gesture.current = step.state;
        if (step.effect.type !== 'native') { event.preventDefault(); apply(step.effect, event.currentTarget); }
      }}
      onPointerMove={event => {
        if (gesture.current.kind === 'press') { const {caret} = hit(event); const step = stepAddressGesture(gesture.current, {type:'move',pointerId:event.pointerId,x:event.clientX,y:event.clientY,caret}); gesture.current = step.state; apply(step.effect, event.currentTarget); return; }
        const click=focusClick.current;if(click?.id===event.pointerId&&Math.hypot(event.clientX-click.x,event.clientY-click.y)>4)click.moved=true;
      }}
      onPointerUp={event => {
        if (gesture.current.kind !== 'press') return;
        const {caret} = hit(event); const step = stepAddressGesture(gesture.current, {type:'up',pointerId:event.pointerId,x:event.clientX,y:event.clientY,caret,time:event.timeStamp});
        gesture.current = step.state; apply(step.effect, event.currentTarget);
      }}
      onPointerCancel={event => {focusClick.current=null; const step = stepAddressGesture(gesture.current, {type:'cancel',pointerId:event.pointerId}); gesture.current = step.state; apply(step.effect, event.currentTarget);}}
      onLostPointerCapture={event => {if (gesture.current.kind !== 'press') return; const step = stepAddressGesture(gesture.current, {type:'cancel',pointerId:event.pointerId}); gesture.current = step.state; apply(step.effect, event.currentTarget);}}
      onClick={event => {const click=focusClick.current;focusClick.current=null;if(click&&!click.moved&&event.detail===1)event.currentTarget.select();}}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (gesture.current.kind === 'clicked') gesture.current = {kind:'idle'};
        if(event.nativeEvent.isComposing)return;
        if(!event.altKey&&!event.ctrlKey&&!event.metaKey&&onSuggestionKeyDown?.(event)){event.preventDefault();event.stopPropagation();return;}
        if (event.key !== 'Enter' || !(event.altKey || event.ctrlKey || event.metaKey)) return;
        event.preventDefault(); event.stopPropagation();
        const input = value.trim();
        const target = (event.ctrlKey || event.metaKey) && /^[a-z\d-]+$/i.test(input) ? `https://www.${input}.com` : input;
        onModifiedEnter(target, event.altKey); inputRef.current?.blur();
      }}
      onFocus={event => {
        // Back from a press on the suggestion list: the field never lost the person's draft, so nothing restarts.
        const back = parked.current;
        if (back) { window.clearTimeout(back.timer); parked.current = null; if (back.start !== null && back.end !== null) event.target.setSelectionRange(back.start, back.end, back.direction ?? undefined); return; }
        setFocused(true); setKeyboard(!pointer.current); onFocus(); if(!focusClick.current&&!held.current)event.target.select();}}
      onBlur={event => {
        // The open suggestion list is its own native view: a press on it (a row, a ×) takes focus for a moment and main hands
        // it straight back. Until it is clear the field really lost focus, nothing closes and the text, caret and selection stay.
        if (suggestionOpen && !event.relatedTarget && !document.hasFocus()) {
          const input = event.currentTarget;
          window.clearTimeout(parked.current?.timer);
          parked.current = {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,timer:window.setTimeout(() => { parked.current = null; finishBlur(event); }, SUGGESTION_FOCUS_GRACE_MS)};
          return;
        }
        finishBlur(event);}}
    />
  </div>;
}
