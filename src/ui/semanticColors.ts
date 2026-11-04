import { compositeColor,contrast,fromOklch,mix,rgb,toOklch } from './colorMath';

export interface AppearanceColorOverrides {glassOpacity?:number;surfaceColor?:string;sidebarColor?:string;tabColor?:string;toolbarColor?:string}
/** The glass slider, 40–100% (round 2: "down to about 40%"); the default stays 64. */
export function materialOpacity(value:unknown,reduced=false){return reduced?1:(typeof value==='number'&&Number.isFinite(value)?Math.max(40,Math.min(100,value)):64)/100;}
const colorSeed=(value:string|undefined)=>value&&/^#[\da-f]{6}$/i.test(value)?value:undefined;
interface FinishSurfaces {
 canvas:string; chrome:string; chromeSheet:string; chromeInk:string;
 accent:string; accentFill?:string; chromeAccent:string; deep:boolean; chromeDark:boolean; porcelain:boolean;
 groups:Record<string,string>;
 overrides?:AppearanceColorOverrides;
 /** The window's own theme: Windows acrylic under the chrome follows it. */
 windowDark?:boolean;
}

/** What Windows acrylic itself shows under the chrome's veil, whatever the wallpaper: light acrylic runs from mid-grey
 * (over a black desktop) to near-white, dark acrylic from near-black to a dark grey (bible §3.5). */
const acrylicRange={light:['#7a7a7a','#f6f6f6'],dark:['#161616','#6e6e6e']};
/** The chrome's glass veil (round 2): the slider's amount, translucent on every finish, raised only as far as the frame's
 * own ink needs to keep its contrast over both ends of the acrylic range (4.5:1 text, 3:1 muted), so nothing goes
 * unreadable at 40%. Light maps 40–100% to a .70–1 veil so light glass still reads light over a dark wallpaper; dark
 * maps it almost one to one. The bottom of the veil is a step thinner, as before. */
function glassVeil(opacity:number,dark:boolean,surfaces:{color:string;ink:string;min:number}[]){
 if(opacity>=1)return {top:1,bottom:1};
 const range=acrylicRange[dark?'dark':'light'],t=(opacity-.4)/.6;
 // Light glass lets the blur through as dark glass does (founder, 31 Oct: "the light version isn't premium glass"): .58-.88 white
 // rather than .7-1, with the same readability floor below lifting it wherever an ink would fall short on a grey backdrop.
 const wantTop=dark?opacity+(1-opacity)*.06:.58+.3*t,wantBottom=dark?Math.max(.3,opacity-.1):Math.max(.5,wantTop-.1);
 const floor=(alpha:number)=>{let a=alpha;for(let step=0;step<40&&a<1;step++){if(surfaces.every(s=>range.every(back=>contrast(s.ink,compositeColor(`rgb(${triple(s.color)} / ${a})`,back))>=s.min)))return +a.toFixed(3);a=Math.min(1,a+.025);}return 1;};
 return {top:floor(wantTop),bottom:floor(wantBottom)};
}

/** Keep the chosen hue where possible, then validate the actual rounded sRGB bytes.
 * All supplied substrates belong to one tonal family, so a shared neutral exists. */
function readable(seed:string,backgrounds:string[],minimum:number){
 const target=contrast('#ffffff',backgrounds[0])>contrast('#000000',backgrounds[0])?'#ffffff':'#16181c';
 for(let step=0;step<=255;step++){
  const color=mix(target,seed,step/255);
  if(backgrounds.every(background=>contrast(color,background)>=minimum))return color;
 }
 return target;
}
const triple=(hex:string)=>rgb(hex).join(' ');
/** A switch's "on" track (WCAG 1.4.11): the finish accent's hue at a lightness where the white thumb AND every surface the
 * switch sits on keep at least 3:1. The readable dark-mode accent is too pale for this (a white thumb on #9dbdff is
 * 1.9:1). Keeps the seed when it passes (3.2 for rounding headroom); otherwise takes the lightness that balances the two
 * contrasts, with enough chroma to read as the finish's color (near-neutral finishes stay neutral). */
function toggleTrack(seed:string,surfaces:string[]){
 const score=(color:string)=>Math.min(contrast(color,'#ffffff'),...surfaces.map(surface=>contrast(color,surface)));
 if(score(seed)>=3.2)return seed;
 const [,C,h]=toOklch(seed),chroma=C<.03?C:Math.max(C,.13);let best=seed,bestScore=score(seed);
 for(let l=.2;l<=.86;l+=.005){const color=fromOklch(l,chroma,h),value=score(color);if(value>bestScore){best=color;bestScore=value;}}
 return best;
}

/** Semantic paint for Acira-owned surfaces. Website colors and stored seeds are untouched. */
export function semanticColorVariables(base:FinishSurfaces,highContrast=false,reducedTransparency=false):Record<string,string>{
 const {canvas,chrome,chromeSheet,chromeInk,deep}=base,[L,C,h]=toOklch(canvas);
 const at=(l:number,c:number)=>fromOklch(Math.max(0,Math.min(1,l)),c,h);
 const raised=deep?at(L+.055,C*.75):at(.998,Math.min(C*.25,.002));
 const overlay=deep?at(L+.085,C*.65):'#ffffff';
 const input=deep?at(L+.04,C*.78):at(.969,Math.min(C*.5,.006));
 const inputHover=deep?at(L+.05,C*.75):at(.958,Math.min(C*.5,.006));
 const alt=deep?at(L+.025,C*.8):at(.978,Math.min(C*.5,.006));
 const hover=deep?at(L+.06,C*.65):at(.946,Math.min(C*.6,.008));
 const pressed=deep?at(L+.09,C*.6):at(.92,Math.min(C*.6,.008));
 const selected=deep?at(L+.085,Math.min(C+.012,.045)):mix(base.accent,canvas,.12);
 const surfaces=[canvas,raised,overlay,input,inputHover,alt,hover,pressed,selected];
 // Light primary ink is 88% black on white (round 12: never near-pure black), not #111113.
 const text=readable(deep?'#ededef':'#1f1f1f',surfaces,7.05);
 const muted=readable(mix(text,canvas,.64),surfaces,highContrast?7:4.6);
 const placeholder=readable(mix(text,canvas,.5),surfaces,highContrast?7:4.5);
 const strongEdge=readable('#777777',[canvas,input,inputHover,raised,overlay],highContrast?4.5:3.2);
 // Resting field edges stay quiet; the fill step carries the field and focus brings the strong ring.
 const edge=highContrast?strongEdge:mix(deep?'#ffffff':'#000000',input,.08);
 const icon=readable(mix(text,canvas,.64),surfaces,4.5);
 const accent=readable(base.accent,surfaces,4.6),focus=readable(accent,surfaces,highContrast?4.5:3.2);
 const primary=base.porcelain?(deep?'#e3e5eb':'#25262b'):deep&&base.accentFill?readable(base.accentFill,surfaces,3):accent;
 const onPrimary=contrast('#ffffff',primary)>=4.5?'#ffffff':'#16181c';
 const chromeHover=mix(chromeInk,chrome,.08),chromePressed=mix(chromeInk,chrome,.13);
 // Selection is a quiet tonal state, not the raised edit surface or a focus ring.
 const chromeSelected=mix(chromeInk,chrome,base.chromeDark?.10:.065);
 const sidebarSeed=colorSeed(base.overrides?.sidebarColor),tabSeed=colorSeed(base.overrides?.tabColor);
 // A sidebar color paints the sidebar's own glass; its ink and states derive from that color, like the chrome's.
 const sidebar=sidebarSeed||chrome,sidebarDark=sidebarSeed?contrast('#ffffff',sidebarSeed)>contrast('#16181c',sidebarSeed):base.chromeDark;
 const sidebarInk=sidebarSeed?(sidebarDark?'#ffffff':'#16181c'):chromeInk;
 const sidebarSelected=sidebarSeed?mix(sidebarInk,sidebar,sidebarDark?.13:.09):chromeSelected,sidebarHover=sidebarSeed?mix(sidebarInk,sidebar,sidebarDark?.08:.055):chromeHover;
 // A tab color fills the selected tab; hover is a lighter step of the same color.
 const tabSelected=tabSeed?mix(tabSeed,chrome,.6):deep?chromeSelected:'#ffffff',tabHover=tabSeed?mix(tabSeed,chrome,.24):chromeHover;
 // A toolbar color (round 2: customisable apart from the sidebar) paints the toolbar's own glass; ink and states derive
 // from it. Without one the toolbar is the chrome, or the frame in sidebar mode.
 const toolbarSeed=colorSeed(base.overrides?.toolbarColor),toolbar=toolbarSeed||chrome;
 const toolbarDark=toolbarSeed?contrast('#ffffff',toolbarSeed)>contrast('#16181c',toolbarSeed):base.chromeDark;
 const toolbarInk=toolbarSeed?(toolbarDark?'#ffffff':'#16181c'):chromeInk;
 const toolbarHover=toolbarSeed?mix(toolbarInk,toolbar,toolbarDark?.08:.055):chromeHover,toolbarPressed=toolbarSeed?mix(toolbarInk,toolbar,toolbarDark?.13:.09):chromePressed;
 const toolbarMuted=toolbarSeed?readable(toolbarDark?'#aeb0b9':'#60636c',[toolbar,toolbarHover],highContrast?7:4.6):undefined;
 const tabInk=tabSeed?(['#16181c','#ffffff','#000000'].find(ink=>contrast(ink,tabSelected)>=4.6)??'#000000'):deep?chromeInk:'#1c1d21';
 const chromeSurfaces=[chrome,chromeSheet,chromeHover,chromePressed,...(sidebarSeed?[]:[sidebarSelected,sidebarHover]),...(tabSeed?[]:[tabSelected,tabHover])];
 const sidebarSurfaces=[sidebar,sidebarSelected,sidebarHover],sidebarMuted=readable(sidebarDark?'#aeb0b9':'#60636c',sidebarSurfaces,highContrast?7:4.8);
 const chromeMuted=readable(mix(chromeInk,chrome,.64),chromeSurfaces,highContrast?7:4.6);
 const chromeStrongEdge=readable('#777777',[chrome,chromeSheet],highContrast?4.5:3.2);
 const chromeEdge=highContrast?chromeStrongEdge:mix(base.chromeDark?'#ffffff':'#000000',chromeSheet,.06);
 const chromeFocus=readable(base.chromeAccent,chromeSurfaces,highContrast?4.5:3.2);
 const divider=mix(text,canvas,.08),chromeDivider=mix(chromeInk,chrome,.1);
 // Hairlines and text steps as alpha, so they stay crisp on glass as well as on solid pages.
 const hairline=deep?'255 255 255':'0 0 0',chromeHairline=base.chromeDark?'255 255 255':'0 0 0';
 const popoverShadow=deep?'0 0 0 1px rgb(0 0 0 / .45),0 1px 2px rgb(0 0 0 / .2),0 8px 24px -4px rgb(0 0 0 / .32),0 24px 64px -12px rgb(0 0 0 / .36)'
  :'0 0 0 1px rgb(0 0 0 / .08),0 1px 1px rgb(0 0 0 / .02),0 4px 8px -4px rgb(0 0 0 / .04),0 16px 24px -8px rgb(0 0 0 / .06)';
 const soft=mix(accent,canvas,deep?.16:.09);
 // Glass remains visible. Popup ink is paired with BOTH uniform backing bounds,
 // rather than reusing reading-page muted ink on a translucent plane.
 const opacity=materialOpacity(base.overrides?.glassOpacity,reducedTransparency||highContrast);
 const overlayOpacity=opacity===1?1:opacity+(1-opacity)*(deep?.61:.50);
 const glass=`rgb(${triple(overlay)} / ${overlayOpacity})`;
 const popupSurfaces=[overlay,compositeColor(glass,'#000000'),compositeColor(glass,'#ffffff')];
 const popupInk=readable(text,popupSurfaces,4.6),popupMuted=readable(muted,popupSurfaces,4.6);
 const popupIcon=readable(icon,popupSurfaces,3.2),popupFocus=readable(focus,popupSurfaces,3.2);
 const nativeOpaque=opacity===1;
 const veil=glassVeil(opacity,base.windowDark??deep,[{color:chrome,ink:chromeInk,min:4.5},{color:chrome,ink:chromeMuted,min:3},{color:sidebar,ink:sidebarInk,min:4.5},{color:sidebar,ink:sidebarMuted,min:3}]);
 // A toolbar color has its own veil, so it never thickens the frame. One whose tone runs against the window's (a cream
 // toolbar in a dark window) holds at least .86, or the acrylic behind would grey it into mud.
 const windowDark=base.windowDark??deep,toolbarVeil=toolbarSeed?Math.max(glassVeil(opacity,windowDark,[{color:toolbar,ink:toolbarInk,min:4.5},{color:toolbar,ink:toolbarMuted!,min:3}]).top,toolbarDark===windowDark||opacity>=1?0:.86):veil.top;
 // Popovers are denser glass than the chrome: a translucent dark tint at the chrome's 60-70% over a white page
 // composites to flat mid-grey. At 84-94% the menu reads as dark (or light) glass on any page, while blur and
 // saturation still let the backdrop's color through. 100% stays the opaque endpoint.
 // Light popovers are fixed at 90% white (round 12, Linear popup #ffffffe6 over 32px blur): light glass reads as glass
 // by letting 1-2% of the page through, never by thinning the white.
 const popupOpacity=nativeOpaque?1:deep?Math.min(.94,Math.max(.84,opacity+.2)):.9;
 // Keep the established 60–88% tint. The new upper range approaches the opaque
 // tone continuously, so the final slider step does not switch tint families.
 const nativeBase=deep?at(.18,Math.min(C*.75,.02)):overlay;
 const upperBlend=Math.max(0,(opacity-.88)/.12);
 const nativeGoal=deep&&!nativeOpaque?mix(overlay,nativeBase,upperBlend):overlay;
 let nativeTint=nativeGoal;
 if(deep&&!nativeOpaque)for(let step=0;step<20;step++){
  if(['#000000','#ffffff'].every(back=>contrast('#ffffff',compositeColor(`rgb(${triple(nativeTint)} / ${popupOpacity})`,back))>=4.7))break;
  nativeTint=upperBlend>0?mix(nativeBase,nativeGoal,(step+1)/20):at(Math.max(.08,.18-(step+1)*.005),Math.min(C*.75,.02));
 }
 const nativeGlass=`rgb(${triple(nativeTint)} / ${popupOpacity})`;
 const nativeSurfaces=[compositeColor(nativeGlass,'#000000'),compositeColor(nativeGlass,'#ffffff'),selected,input];
 const nativeInk=readable(text,nativeSurfaces,4.6),nativeMuted=readable(muted,nativeSurfaces,4.6);
 // Keep one result for the page and explicit aliases for chrome descendants.
 const result:Record<string,string>={
  '--sheet':canvas,'--sheet-rgb':triple(canvas),'--ed-surface':canvas,'--surface':canvas,
  '--raised':raised,'--overlay':overlay,'--overlay-rgb':triple(overlay),'--surface-alt':alt,'--sheet-alt':alt,'--sheet-hover':hover,
  '--ink':triple(text),'--text-primary':text,'--text-secondary':muted,'--text-placeholder':placeholder,
  '--ed-ink':text,'--text':text,'--ed-muted':muted,'--muted':muted,'--ed-icon':icon,
  '--input-fill':input,'--input-hover':inputHover,'--input-edge':edge,'--input-edge-strong':strongEdge,'--focus-ring':focus,
  '--ed-controlEdge':edge,'--divider-subtle':divider,'--ed-line':divider,'--subtle-line':divider,
  // Text ladder. Light (round 12, Windows/Dia/Interfere): 88 / 61 / 45 / 28% black; dark keeps 100 / 64 / 44 / 32% ink.
  '--text-1':deep?text:'rgb(0 0 0 / .88)','--text-2':deep?`rgb(${triple(text)} / .64)`:'rgb(0 0 0 / .61)','--text-3':deep?`rgb(${triple(text)} / .58)`:'rgb(0 0 0 / .58)','--text-disabled':deep?`rgb(${triple(text)} / .32)`:'rgb(0 0 0 / .28)',
  '--line':`rgb(${hairline} / .08)`,'--toggle-track-off':`rgb(${hairline} / ${deep?.16:.14})`,'--toggle-track-off-hover':`rgb(${hairline} / ${deep?.22:.2})`,'--line-strong':`rgb(${hairline} / .14)`,'--line-emphasis':`rgb(${hairline} / .22)`,
  '--chrome-line':`rgb(${chromeHairline} / .08)`,'--chrome-line-strong':`rgb(${chromeHairline} / .14)`,
  '--chrome-text-2':`rgb(${triple(chromeInk)} / .64)`,'--chrome-text-3':`rgb(${triple(chromeInk)} / .44)`,
  '--focus-ring-color':focus,'--chrome-focus-ring-color':chromeFocus,
  // One shadow scale (round 12, Vercel's design system): a 1px 8% ring, then 2-10% layers with negative spread. Never a ring and a border
  // on the same edge. Dark keeps its rim + deep popover shadow.
  '--shadow-ring':deep?'0 0 0 1px rgb(255 255 255 / .08)':'0 0 0 1px rgb(0 0 0 / .08)',
  '--shadow-card':deep?'var(--shadow-ring),0 1px 2px rgb(0 0 0 / .3)':'var(--shadow-ring),0 1px 1px rgb(0 0 0 / .02),0 1px 2px rgb(0 0 0 / .05)',
  '--shadow-popover':deep?'var(--shadow-popover-dark)':'var(--shadow-ring),0 1px 1px rgb(0 0 0 / .02),0 4px 8px -4px rgb(0 0 0 / .04),0 16px 24px -8px rgb(0 0 0 / .06)',
  '--shadow-dialog':deep?'var(--shadow-popover-dark),0 32px 80px -16px rgb(0 0 0 / .42)':'var(--shadow-ring),0 1px 1px rgb(0 0 0 / .02),0 8px 16px -4px rgb(0 0 0 / .04),0 24px 32px -8px rgb(0 0 0 / .06)',
  // Two whites (round 12): the shell (tab strip, sidebar) is the chrome; a page's own nav column sits one quiet step
  // off the content (#f7f7f8 on white, no divider); content is the canvas. Dark: nav = content, as today.
  '--surface-shell':chrome,'--surface-nav':deep?canvas:canvas.toLowerCase()==='#ffffff'?'#f7f7f8':mix('#000000',canvas,.03),'--surface-content':canvas,
  // Text links: the finish accent's darker text step in light (default #2c58c9, 6:1 on white); dark keeps the accent.
  '--link':deep?accent:base.accent.toLowerCase()==='#3b6eea'?'#2c58c9':readable(base.accent,[canvas,raised,alt],6),'--elevation-rim':deep?'var(--rim-dark)':'var(--rim-light)','--float-shadow':popoverShadow,'--shadow':popoverShadow,
  '--well':alt,'--hair':divider,'--hair-2':divider,
  '--hover':hover,'--ed-hover':hover,'--hover-text':text,'--pressed-fill':pressed,
  '--ed-selected':selected,'--selection-bg':selected,'--selection-fg':text,'--selection-muted':muted,'--selection-marker':focus,
  '--toggle-on':toggleTrack(base.accent,surfaces),'--toggle-thumb':'#ffffff',
  '--accent':accent,'--ed-blue':accent,'--accent-soft':soft,'--ed-accentSoft':soft,'--ed-accentInk':accent,
  '--primary':primary,'--on-primary':onPrimary,'--on-accent':onPrimary,
  '--primary-hover':mix(primary,deep?'#ffffff':'#000000',.92),'--primary-pressed':mix(primary,deep?'#ffffff':'#000000',.84),
  '--disabled-fill':alt,'--disabled-text':mix(text,alt,.45),
  '--chrome-fg':chromeInk,'--chrome-rgb':triple(chrome),'--chrome-text-secondary':chromeMuted,'--chrome-icon':chromeMuted,
  '--chrome-input-fill':chromeSheet,'--chrome-input-edge':chromeEdge,'--chrome-focus-ring':chromeFocus,
  '--chrome-input-edge-strong':chromeStrongEdge,
  '--chrome-selection-bg':tabSelected,'--sidebar-selection-bg':sidebarSelected,'--tab-selection-bg':tabSelected,
  '--sidebar-hover':sidebarHover,'--tab-hover':tabHover,
  '--sidebar-rgb':triple(sidebar),'--sidebar-ink':sidebarInk,'--sidebar-ink-rgb':triple(sidebarInk),'--sidebar-muted':sidebarSeed?sidebarMuted:chromeMuted,
  '--tab-selection-fg':tabInk,'--sidebar-tone':sidebarDark?'dark':'light',
  // A carried row leaves its frame and sits on its own card. Its ink must follow
  // that card, never the dark sidebar it came from on an otherwise light page.
  '--tab-carry-bg':deep?canvas:'#ffffff','--tab-carry-fg':deep?text:'#1c1d21',
  '--sidebar-selection-marker':sidebarSeed?readable(sidebarMuted,sidebarSurfaces,3.2):readable(chromeFocus,chromeSurfaces,3.2),
  '--tab-selection-marker':readable(tabSeed||chromeFocus,chromeSurfaces,3.2),
  '--chrome-hover':chromeHover,'--chrome-pressed':chromePressed,'--chrome-divider':chromeDivider,
  '--frame':chrome,'--frame-text':chromeInk,'--frame-muted':chromeMuted,'--frame-hover':chromeHover,'--frame-hover-text':chromeInk,
  '--frame-selection-bg':tabSelected,'--frame-selection-fg':tabInk,'--frame-selection-muted':deep?chromeMuted:readable(mix(tabInk,tabSelected,.64),[tabSelected],4.6),'--frame-selection-marker':chromeFocus,
  '--popup-ink':popupInk,'--popup-ink-rgb':triple(popupInk),'--popup-muted':popupMuted,'--popup-icon':popupIcon,'--popup-focus-ring':popupFocus,
  '--native-material-tint':nativeTint,'--native-material-tint-rgb':triple(nativeTint),'--native-popup-ink':nativeInk,'--native-popup-ink-rgb':triple(nativeInk),
  '--native-popup-muted':nativeMuted,'--native-popup-icon':readable(icon,nativeSurfaces,3.2),
  '--native-popup-focus-ring':readable(focus,nativeSurfaces,3.2),
  '--popup-selection-bg':selected,'--popup-selection-fg':popupInk,'--popup-selection-muted':popupMuted,
  '--popup-selection-marker':popupFocus,'--popup-selection-outline':popupFocus,'--popup-selection-backdrop':overlay,
  '--group-tray':chrome,'--group-tray-top':chrome,'--group-tray-bottom':chrome,'--group-tray-hover':chromeHover,
  '--group-label':chromeInk,'--group-count':chromeMuted,'--group-tab-text':chromeInk,
  '--experience-background':canvas,'--experience-control':input,
  // The address field is one surface on every finish (bible §4/§5.1): an ink step over the chrome itself, never a page tone + rim.
  '--address-fill':`rgb(${chromeHairline} / ${base.chromeDark?.07:.05})`,'--address-hover':`rgb(${chromeHairline} / ${base.chromeDark?.1:.075})`,'--address-focus':`rgb(${chromeHairline} / ${base.chromeDark?.07:.05})`,
  '--glass-rgb':triple(overlay),'--glass':glass,'--frost-fill':glass,'--frost-edge':divider,
  '--overlay-opacity':String(overlayOpacity),
  '--native-overlay-opacity':'0',
  '--material-opacity':String(opacity),'--popup-material-opacity':String(popupOpacity),
  // Dark: preserve the lower range, then reach opaque without a last-step veil jump. Light reads light over any
  // wallpaper: Windows' light acrylic turns a black desktop into mid-grey, so the chrome's own color carries 93-100% of
  // the pixel and the slider moves within that band (a hint of glass over bright wallpapers). Measured on screen at the
  // default 64%: lower sidebar L* 92-94 over black, ~95 over white.
  '--chrome-veil-top':String(veil.top),'--chrome-veil-bottom':String(veil.bottom),
  // The toolbar's own surface (a toolbar color; otherwise the chrome) for B's toolbar and the junctions around it.
  '--toolbar':toolbar,'--toolbar-rgb':triple(toolbar),'--toolbar-ink':toolbarInk,'--toolbar-ink-rgb':triple(toolbarInk),
  '--toolbar-muted':toolbarMuted||chromeMuted,'--toolbar-hover':toolbarHover,'--toolbar-pressed':toolbarPressed,'--toolbar-tone':toolbarDark?'dark':'light','--toolbar-veil':String(toolbarVeil),
  '--field-shadow':'none',
  '--matrix-on':accent,'--matrix-off':mix(accent,canvas,.16),
  '--cover-text':'#ffffff','--cover-scrim-rgb':'17 21 28',
 };
 const core=readable(deep?'#69b4ff':'#1769c2',[chrome,chromeSheet,canvas,input],3.2);
 result['--navigation-progress-core']=core;
 result['--navigation-progress-glow']=`rgb(${triple(core)} / ${deep?.34:.28})`;
 for(const [name,seed]of Object.entries(deep?{danger:'#ffb4b6',warning:'#edcd8c',success:'#9dd8b9',info:'#b0ceff',private:'#7ee3da'}:{danger:'#a02b39',warning:'#76530a',success:'#216346',info:'#275ba8',private:'#0c746f'})){
  const color=readable(seed,surfaces,4.8);
  result[`--${name}`]=color;result[`--${name}-text`]=color;
  result[`--${name}-fill`]=mix(color,canvas,deep?.13:.07);
  result[`--${name}-edge`]=readable(color,[canvas,input,inputHover],3.2);
  result[`--popup-${name}`]=readable(color,popupSurfaces,4.6);
  result[`--native-popup-${name}`]=readable(color,nativeSurfaces,4.6);
 }
 for(const [name,color]of Object.entries(base.groups)){
  if(name==='--tab-group-none'){result[name]=color;continue;}
  const glyph=readable(color,[...chromeSurfaces,chromeSelected],3.2);
  result[name]=glyph;result[name.replace('--tab-group-','--selected-tab-group-')]=glyph;
 }
 // The Update pill (update-pill.css) draws an accent on a 13% whisper of itself: the page's on a light toolbar, the frame's on a dark one.
 // Neither is made against a colour of the person's own under the toolbar (a toolbar colour, or the sidebar colour the toolbar sits on in
 // sidebar mode), where "Update" fell to 1.05-2.6:1. There the pill keeps that accent if it reads (4.5:1 on its tint) and otherwise takes the
 // colour's own ink, as the toolbar's text does. Without such a colour no token: the pill keeps the frame's rule (beta.10, contrast-2).
 const pillInk=(surface:string,surfaceInk:string,drawn:string)=>{const tint=compositeColor(`rgb(${triple(drawn)} / .13)`,surface),own=contrast(drawn,tint);return own>=4.5||own>=contrast(surfaceInk,tint)?drawn:surfaceInk;};
 if(toolbarSeed)result['--toolbar-pill-ink']=pillInk(toolbar,toolbarInk,toolbarDark?base.chromeAccent:accent);
 if(sidebarSeed)result['--sidebar-pill-ink']=pillInk(sidebar,sidebarInk,base.chromeDark?base.chromeAccent:accent);
 return result;
}
