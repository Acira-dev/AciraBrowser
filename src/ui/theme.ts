import { appearancePalette } from '../runtime/appearancePalettes';
import { TAB_GROUP_COLORS } from '../runtime/tabGroups';
import type { BrowserSnapshot,Settings,TabGroupColor } from '../runtime/types';
import { contrast,fromOklch,luminance,mix,rgb,toOklch } from './colorMath';
import { designTokens } from './designSystem';
import { semanticColorVariables,type AppearanceColorOverrides } from './semanticColors';
export { contrast,luminance,mix,rgb } from './colorMath';
export function readableAccent(accent:string,surface:string,dark:boolean,minimum=3){let result=accent;for(let i=0;i<10&&contrast(result,surface)<minimum;i++)result=mix(result,dark?'#ffffff':'#000000',.8);return result;}
/** Readable neutral foreground; custom tint never becomes an icon color. */
export function readableForeground(background:string){
 const options=['#242629','#f0f1f2','#000000','#ffffff'];
 return options.find(color=>contrast(color,background)>=4.5)||'#000000';
}
/** Group accents color sidebar/editor glyphs; trays follow the browser finish. */
export function tabGroupPalette(frame:string,highContrast=false){
 const dark=luminance(frame)<.25;
 const colors=!dark&&highContrast?{...TAB_GROUP_COLORS,grey:'#6C6C70',blue:'#1E6EF4',red:'#E9152D',yellow:'#A16A00',green:'#008932',pink:'#E7124D',purple:'#B02FC2',cyan:'#007EAE',orange:'#C55300'}:dark?{...TAB_GROUP_COLORS,grey:'#98989D',blue:'#0091FF',red:'#FF4245',yellow:'#FFD600',green:'#30D158',pink:'#FF375F',purple:'#DB34F2',cyan:'#3CD3FE',orange:'#FF9230'}:TAB_GROUP_COLORS;
 return Object.fromEntries(Object.entries(colors).map(([name,color])=>[`--tab-group-${name}`,color])) as Record<`--tab-group-${TabGroupColor}`,string>;
}
export function tabGroupColor(color:TabGroupColor,selected=false){return color==='none'?(selected?'var(--frame-selection-muted)':'var(--frame-muted)'):`var(--${selected?'selected-':''}tab-group-${color},${TAB_GROUP_COLORS[color]})`;}
function neutralStep(background:string,toward:string,minimum:number,against:string[]=[background]){
 let low=0,high=1;
 for(let i=0;i<18;i++){
  const amount=(low+high)/2,candidate=mix(toward,background,amount);
  if(against.every(other=>contrast(candidate,other)>=minimum))high=amount;else low=amount;
 }
 return mix(toward,background,Math.min(1,high+.004));
}
export function interactionPalette(background:string,preferredSelection?:string,gentle=false){
 const foreground=readableForeground(background);
 const hover=neutralStep(background,foreground,1.12);
 const selected=preferredSelection&&contrast(preferredSelection,background)>=(gentle?1.08:1.2)&&contrast(preferredSelection,background)<=2?preferredSelection:neutralStep(background,foreground,gentle?1.16:1.3);
 const selectedForeground=readableForeground(selected);
 const markerTarget=['#242629','#f0f1f2','#000000','#ffffff'].find(color=>[background,selected].every(surface=>contrast(color,surface)>=3.2))||selectedForeground;
 return {background,hover,hoverForeground:readableForeground(hover),selected,foreground:selectedForeground,muted:neutralStep(selected,selectedForeground,4.5),marker:neutralStep(background,markerTarget,3.2,[background,selected])};
}
/** All appearance consumers use the final finish roles, with no overwritten palette. */
// Pure color math, recomputed on every render and once per finish swatch: memoised on its inputs (a theme switch
// re-rendered ~12 swatches and the chrome, ~25ms of parse/mix/contrast). Callers get a copy, so the cache stays clean.
const tokenCache=new Map<string,Record<string,string>>();
const memo=(key:string,make:()=>Record<string,string>)=>{let hit=tokenCache.get(key);if(!hit){hit=make();if(tokenCache.size>=128)tokenCache.delete(tokenCache.keys().next().value!);tokenCache.set(key,hit);}return {...hit};};
/** The window frame takes 7% (dark 8%) of the current profile's colour, mixed in OKLab, so you know where you are at
 * a glance (Arc, Dia; benchmark §2 #2). The default profile, private and Tor stay neutral. */
export function frameTintFor(state:Pick<BrowserSnapshot,'activeBrowserProfileId'|'browserProfiles'|'settings'>&Partial<Pick<BrowserSnapshot,'workspaces'|'activeWorkspaceId'>>):string|undefined{
 const profile=state.browserProfiles.find(item=>item.id===state.activeBrowserProfileId);
 if(!profile||profile.private||(profile as {tor?:boolean}).tor)return undefined;
 // R3-57: the open workspace's own colour wins over the profile's (the same tint, at the same strength). R4-48 P0-6: only once
 // there is a second workspace to tell apart; with one, the window wears the profile's colour exactly as before, and Main
 // (the first) inherits it unless it was given its own.
 const siblings=state.workspaces?.filter(item=>item.browserProfileId===profile.id)??[];
 const own=siblings.length>1?siblings.find(item=>item.id===state.activeWorkspaceId)?.color:undefined;
 if(own&&/^#[\da-f]{6}$/i.test(own))return own;
 const fallback=state.settings.defaultProfileId||state.browserProfiles.find(item=>!item.private&&!(item as {tor?:boolean}).tor)?.id;
 return profile.id!==fallback&&/^#[\da-f]{6}$/i.test(profile.color||'')?profile.color:undefined;
}
/** Settings with the current profile's frame tint, for the theme. */
export const withFrameTint=(state:Pick<BrowserSnapshot,'activeBrowserProfileId'|'browserProfiles'|'settings'>&Partial<Pick<BrowserSnapshot,'workspaces'|'activeWorkspaceId'>>):Settings&{frameTint?:string}=>{const frameTint=frameTintFor(state);return frameTint?{...state.settings,frameTint}:state.settings;};
function mixOklab(tint:string,base:string,amount:number){
 const [l1,c1,h1]=toOklch(tint),[l2,c2,h2]=toOklch(base),k=1-amount;
 const a=c1*Math.cos(h1)*amount+c2*Math.cos(h2)*k,b=c1*Math.sin(h1)*amount+c2*Math.sin(h2)*k;
 return fromOklch(l1*amount+l2*k,Math.hypot(a,b),Math.atan2(b,a));
}
export function themeTokens(s:Settings&{frameTint?:string;windowFinish?:WindowFinish;systemAccent?:string},dark:boolean,highContrast=false):Record<string,string>{return memo(`t|${dark}|${highContrast}|${JSON.stringify(s)}`,()=>computeThemeTokens(s,dark,highContrast));}
function computeThemeTokens(s:Settings&{frameTint?:string;windowFinish?:WindowFinish;systemAccent?:string},dark:boolean,highContrast=false):Record<string,string>{
 const interfaceScale=[80,90,100,110,125,150].includes(s.interfaceScale)?s.interfaceScale/100:1;
 return {...studyFinish(s,dark,highContrast,Boolean(s.reducedTransparency)),'--interface-scale':String(interfaceScale)};
}

/** Page tones for the study: one ink at alpha strengths over white (light) or near-black (dark) sheets. */
const studyTones={
 light:{overlay:'#ffffff',ink:'37 38 43',sheet:'#ffffff',raised:'#ffffff',alt:'#f7f8fa',hover:'#fafafa',shade:'12 22 44',hiK:'1',glass:'255 255 255',line:'#eaebee',muted:'#686b73',icon:'#5d6068',fill:'#f6f6f7',selected:'#f0f1f3',edge:'#c7cad1',chrome:'#f3f3f4'},
 dark:{overlay:'#303136',ink:'233 234 237',sheet:'#1e1f22',raised:'#292a2e',alt:'#222326',hover:'#242528',shade:'0 0 0',hiK:'.14',glass:'40 41 45',line:'#33343a',muted:'#9b9da4',icon:'#a4a6ad',fill:'#28292d',selected:'#2e2f34',edge:'#4a4c52',chrome:'#0f1012'},
};
const triple=(hex:string)=>rgb(hex).join(' '),rgbHex=(value:string)=>value.split(' ').map(n=>Number(n).toString(16).padStart(2,'0')).join('');
/** One OKLCH ladder per finish: every page step keeps the finish hue at a fixed lightness offset, so Burgundy,
 * Emerald and Ocean Blue read as the same system in different colors. Deep ladders step lighter, pale ones darker. */
function finishTones(L:number,C:number,h:number,deep:boolean){
 const at=(l:number,c:number)=>fromOklch(Math.max(0,Math.min(1,l)),Math.max(0,c),h),d=deep?1:-1;
 const raised=at(L+(deep?.05:.012),C*(deep?1:.35));
 return {
  ink:triple(at(deep?.97:.255,Math.min(C*(deep?.12:.25),.012))),sheet:at(L,C),raised,glass:triple(raised),
  alt:at(L+d*.016,C),hover:at(L+d*.02,C),fill:at(L+d*.034,C),selected:at(L+d*.056,C),
  line:at(L+d*(deep?.08:.075),C*.8),edge:at(L+d*(deep?.19:.18),C*.6),
  muted:at(deep?.8:.52,Math.min(C*.5,.024)),icon:at(deep?.83:.49,Math.min(C*.5,.024)),
  shade:triple(at(deep?.1:.2,Math.min(C*.6,.03))),hiK:deep?'.14':'1',
  // Floating surfaces (toasts, menus, dialogs) sit clearly above the page: lighter on deep pages, white on pale.
  overlay:deep?at(L+.085,C*.9):at(.997,C*.25),
 };
}
/** A finish paints the glass chrome in its own color (Burgundy is burgundy chrome with light ink), carries the
 * same hue into Acira's own pages, and drives the accent and primary actions. Websites are untouched.
 * Ink is chosen per surface, so text stays readable on every finish in light and dark. */
const finishCache=new Map<string,Record<string,string>>();
/** Private and Tor windows wear their own finish in light and dark alike (benchmark part 2: Brave, Firefox, Vivaldi and
 * Chrome re-tint the whole window): a deep teal graphite for private (R3-59: far from Tor on the wheel), the same graphite in Tor's purple for Tor (the
 * hue of N's and G's Tor mark). OKLCH lightness, chroma, hue in degrees. */
/** The desktop's accent colour when it has a hue to show (a grey is no accent). Every accent role is still derived from it with
 * readableAccent, so any hue stays legible on Acira's own surfaces. */
export function systemAccentOf(value?:string):string|undefined{return value&&/^#[\da-f]{6}$/i.test(value)&&toOklch(value)[1]>=.02?value.toLowerCase():undefined;}
export type WindowFinish='private'|'tor';
const windowFinishes:Record<WindowFinish,[number,number,number]>={private:[.24,.035,200],tor:[.24,.04,310]};
export function studyFinish(s:Pick<Settings,'colorPreset'|'browserTint'|'accentColor'>&AppearanceColorOverrides&{windowFinish?:WindowFinish;frameTint?:string;systemAccent?:string},dark=false,highContrast=false,reducedTransparency=false):Record<string,string>{return memo(`f|${dark}|${highContrast}|${reducedTransparency}|${JSON.stringify(s)}`,()=>computeStudyFinish(s,dark,highContrast,reducedTransparency));}
/** A finish's frame colour alone (what a FinishSwatch shows, the token set's --ed-chrome without a frame tint), with no
 * token set built: the opening lines of computeStudyFinish below, kept identical (a test holds them equal). G measured
 * 24 full token sets for the swatches stalling the first Settings mount by 133ms. */
const frameChromeCache=new Map<string,string>();
export function frameChromeOf(s:Pick<Settings,'colorPreset'|'browserTint'>&{windowFinish?:WindowFinish},dark=false):string{
 const key=JSON.stringify([s.colorPreset,s.browserTint,s.windowFinish,dark]),hit=frameChromeCache.get(key);if(hit)return hit;
 const neutral=dark?studyTones.dark:studyTones.light;
 const preset=appearancePalette(s.colorPreset),matched=!!preset&&preset.tint.toLowerCase()===(s.browserTint||'').toLowerCase();
 const forced=s.windowFinish?windowFinishes[s.windowFinish]:null;
 const porcelain=!forced&&(!s.colorPreset||matched&&preset!.name==='Porcelain');
 const [srcL,srcC,h]=forced?[forced[0],forced[1],forced[2]*Math.PI/180] as [number,number,number]:toOklch(porcelain?neutral.chrome:matched?preset!.light:s.browserTint||neutral.chrome);
 const deepFinish=!porcelain&&srcL<.62;
 const chromeL=forced?forced[0]:dark?.16:deepFinish?Math.min(.3,Math.max(.25,srcL)):Math.min(.93,Math.max(.86,srcL+.06));
 const chrome=porcelain?neutral.chrome:forced?fromOklch(forced[0],forced[1],h):fromOklch(chromeL,dark?Math.min(srcC*.45,.032):Math.min(srcC*(deepFinish?.95:.8),deepFinish?.09:.06),h);
 frameChromeCache.set(key,chrome);return chrome;
}
function computeStudyFinish(s:Pick<Settings,'colorPreset'|'browserTint'|'accentColor'>&AppearanceColorOverrides&{windowFinish?:WindowFinish;frameTint?:string;systemAccent?:string},dark=false,highContrast=false,reducedTransparency=false):Record<string,string>{
 const key=JSON.stringify([s.colorPreset,s.browserTint,s.accentColor,dark,highContrast,reducedTransparency,s.glassOpacity,s.surfaceColor,s.sidebarColor,s.tabColor,s.toolbarColor,s.windowFinish,s.frameTint,s.systemAccent]);
 const cached=finishCache.get(key);if(cached)return cached;
 const neutral=dark?studyTones.dark:studyTones.light;
 const preset=appearancePalette(s.colorPreset),matched=!!preset&&preset.tint.toLowerCase()===(s.browserTint||'').toLowerCase();
 const forced=s.windowFinish?windowFinishes[s.windowFinish]:null;
 const porcelain=!forced&&(!s.colorPreset||matched&&preset!.name==='Porcelain');
 // Hue and colorfulness come from the finish's light swatch; lightness comes from Acira's own scale, so no
 // finish ends up muddy or near-black. Deep finishes: a deep frame around a softer canvas of the same hue.
 const [srcL,srcC,h]=forced?[forced[0],forced[1],forced[2]*Math.PI/180] as [number,number,number]:toOklch(porcelain?neutral.chrome:matched?preset!.light:s.browserTint||neutral.chrome);
 const surfaceOverride=s.surfaceColor&&/^#[\da-f]{6}$/i.test(s.surfaceColor)?s.surfaceColor:undefined;
 const [contentL,contentC,contentHue]=toOklch(surfaceOverride||neutral.sheet);
 // Acira's own pages and the new tab follow the finish (round 2): a colour finish gives them a pale wash of its hue in
 // light and its deep tone in dark; Porcelain and private/Tor stay neutral. A chosen page-surface color still wins.
 const deepFinish=!porcelain&&srcL<.62,deep=dark||(surfaceOverride?contentL<.62:false);
 // The frame sits a clear step away from the page it holds (at least .06 in OKLab lightness when either is dark), so the
 // sidebar and the main page never read as one surface.
 const chromeL=forced?forced[0]:dark?.16:deepFinish?Math.min(.3,Math.max(.25,srcL)):Math.min(.93,Math.max(.86,srcL+.06));
 const finishChrome=porcelain?neutral.chrome:forced?fromOklch(forced[0],forced[1],h):fromOklch(chromeL,dark?Math.min(srcC*.45,.032):Math.min(srcC*(deepFinish?.95:.8),deepFinish?.09:.06),h);
 // A profile's frame tint (G, benchmark §2 #2); a private or Tor window keeps its own finish.
 const chrome=!forced&&s.frameTint&&/^#[\da-f]{6}$/i.test(s.frameTint)?mixOklab(s.frameTint,finishChrome,dark?.08:.07):finishChrome;
 // Strong ink on colored chrome: pure white on dark finishes, near-black on pale ones.
 const chromeDark=luminance(chrome)<.3,chromeInk=chromeDark?'255 255 255':(porcelain?'37 38 43':'20 21 24');
 const chromeSheet=porcelain||!chromeDark?(dark?mix('#ffffff',chrome,.1):'#ffffff'):fromOklch(chromeL+(dark?.07:.09),Math.min(srcC*.7,.06),h);
 // "Match my system theme" (Linux): the desktop's accent takes the accent role alone. Frame, tones and finish stay the person's own.
 const systemAccent=systemAccentOf(s.systemAccent);
 const base=systemAccent||(porcelain?designTokens.color.blue:matched?preset!.accent:(s.accentColor||s.browserTint));
 // Acira's own pages take the finish too: deep in its hue with light ink for a deep finish, a pale wash of it
 // with dark ink for a pale one. Porcelain keeps the website's exact neutrals.
 const tone=surfaceOverride?finishTones(dark?.235:deep?.37:.984,Math.min(contentC*(dark?.3:deep?.48:.2),dark?.022:deep?.044:.011),contentHue,deep)
  // C's page tone (light .972; dark .235, one step lighter than C's .215 so the frame keeps its .06 separation), shared
  // with --page-tint below so the new tab and every other Acira page are one surface.
  :!porcelain&&!forced?finishTones(dark?.235:.972,Math.min(srcC*(dark?.4:.3),dark?.03:.022),h,dark)
  :deep?studyTones.dark:studyTones.light;
 // On deep surfaces the accent is a clear pastel of the finish hue, not the base color bleached toward white.
 const [,baseC,baseH]=toOklch(base),pastel=fromOklch(.8,Math.min(Math.max(baseC,.05)*1.15,.12),baseH);
 // Fills (primary buttons, switches) only need non-text contrast (3:1), so on deep pages they keep a firm, saturated
 // tone of the finish instead of the pale tint text needs.
 const accentFill=deep?readableAccent(fromOklch(.72,Math.min(Math.max(baseC,.06)*1.7,.16),baseH),tone.sheet,true,3.2):undefined;
 const accent=porcelain&&!deep&&!systemAccent?designTokens.color.blue:deep?readableAccent(pastel,tone.sheet,true,4.5):readableAccent(base,tone.sheet,false,4.5);
 const soft=mix(accent,tone.sheet,deep?.2:.1),ink=deep?mix(accent,'#ffffff',.6):readableAccent(mix(accent,'#16181c',.82),soft,false,6);
 const chromeAccent=chromeDark?readableAccent(pastel,chrome,true,3.2):readableAccent(base,chrome,false,3.2),chromeSoft=mix(chromeAccent,chromeSheet,chromeDark?.24:.12),chromeAccentInk=chromeDark?mix(chromeAccent,'#ffffff',.45):ink;
 const semantic=semanticColorVariables({canvas:tone.sheet,chrome,chromeSheet,chromeInk:'#'+rgbHex(chromeInk),accent,accentFill,chromeAccent,deep,chromeDark,porcelain,groups:tabGroupPalette(chrome,highContrast),overrides:s,windowDark:dark},highContrast,reducedTransparency);
 // AppKit supplies the blur. Tint it with the finish itself: the very dark
 // chrome tone loses its hue when diluted over the neutral native material.
 const glassChroma=Math.min(srcC*1.45,.18);
 const macGlass=porcelain?chrome:fromOklch(chromeDark?.56:Math.min(.94,Math.max(.8,srcL)),glassChroma,h);
 // A light native material needs dark ink even when the opaque finish is deep.
 // Adapt chrome roles locally instead of hiding the native glass under a 72% coat.
 const macLightSheet=fromOklch(.97,Math.min(srcC*.18,.018),h);
 const macLightAccent=readableAccent(base,macLightSheet,false,4.5),macLightSoft=mix(macLightAccent,macLightSheet,.12);
 const macGroupColors=Object.fromEntries(Object.entries(tabGroupPalette(macLightSheet,true)).filter(([name])=>name!=='--tab-group-none').map(([name,color])=>[name.replace('--tab-group-','--mac-tab-group-'),color]));
 const opacity=Number(semantic['--material-opacity']),baseDensity=porcelain?.18:.38;
 const macDensity=opacity<=.64?baseDensity*opacity/.64:baseDensity+(1-baseDensity)*(opacity-.64)/.36;
 const tokens={
  '--finish':porcelain?'Porcelain':matched?preset!.name:'Custom',
  '--surface-tone':deep?'dark':'light','--chrome-tone':chromeDark?'dark':'light',
  // The new tab and Acira's own pages take the finish's page tone: a faint wash of its hue (Porcelain stays neutral).
  ...(porcelain?{}:{'--page-tint':!forced&&!surfaceOverride?tone.sheet:deep?fromOklch(.215,Math.min(srcC*.4,.03),h):fromOklch(.972,Math.min(srcC*.3,.022),h)}),
  '--on-ink':tone.sheet,'--shade':tone.shade,'--hi-k':tone.hiK,
  '--ed-chrome':chrome,'--chrome-ink':chromeInk,'--chrome-sheet':chromeSheet,'--chrome-sheet-rgb':triple(chromeSheet),
  '--chrome-hi-k':chromeDark?'.16':'1','--chrome-accent':chromeAccent,'--chrome-accent-soft':chromeSoft,'--chrome-accent-ink':chromeAccentInk,
  '--shadow':deep?'0 12px 36px #00000066':designTokens.material.overlayShadow,
  '--rim':deep?'#ffffff14':'#ffffffcc',
  ...semantic,
  '--mac-glass-color':macGlass,'--mac-glass-density':`${macDensity*100}%`,
  '--mac-light-ink':'20 21 24','--mac-light-sheet':macLightSheet,'--mac-light-sheet-rgb':triple(macLightSheet),'--mac-light-accent':macLightAccent,'--mac-light-accent-soft':macLightSoft,'--mac-light-accent-ink':readableAccent(macLightAccent,macLightSoft,false,6),...macGroupColors,
 };
 if(finishCache.size>=64)finishCache.delete(finishCache.keys().next().value!);
 finishCache.set(key,tokens);return tokens;
}

/** Popups share the finish's paired content/selection roles in both appearances. */
export function tabViewerTokens(settings:Settings,dark:boolean){
 return themeTokens(settings,dark);
}
