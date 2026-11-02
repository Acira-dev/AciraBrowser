const tokens = require('../design-tokens.json');
const equalBounds = (a, b) => !!a && !!b && ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);

// Native child views can receive input outside their parent's visible crop.
// Keep the renderer itself inside the popup host; its stage retains window
// coordinates through a CSS offset delivered only to the trusted UI preload.
function placePopupCanvas(content, bounds, size, scale = 1, options, bounded = true) {
  const local = bounded ? {x: 0, y: 0, width: bounds.width, height: bounds.height}
    : {x: -bounds.x, y: -bounds.y, width: size[0], height: size[1]};
  if (!equalBounds(content.getBounds(), local)) content.setBounds(local, options);
  const viewport = {x: bounded ? bounds.x / scale : 0, y: bounded ? bounds.y / scale : 0, width: size[0] / scale, height: size[1] / scale};
  if (!equalBounds(content.popupViewport, viewport)) {
    content.popupViewport = viewport;
    content.webContents?.send('acira:popup-viewport', viewport);
  }
}

// The same cubic-bezier(.16, 1, .3, 1) used by PopupSurface's material plane.
function materialEase(progress) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  let low=0,high=1;
  for(let i=0;i<16;i++) {const t=(low+high)/2,rest=1-t,x=3*rest*rest*t*.16+3*rest*t*t*.3+t*t*t;if(x<progress)low=t;else high=t;}
  return 1-Math.pow(1-(low+high)/2,3);
}
// Transparent host margin around a floating popover: the popover shadow (contact edge, 0 8px 24px, 0 24px 64px -12px)
// must fall off inside it, never against a hard host edge.
const SHADOW={side:56,top:36,bottom:84};
const motionSpeed=layout=>Math.max(.1,Math.min(10,Number(layout.motionSpeed)||1));
/** The finish's floating-surface tone as RRGGBB for native frost, or null to use the neutral light/dark tint. */
const materialOpacity=layout=>Number.isFinite(layout.materialOpacity)?Math.max(.4,Math.min(1,layout.materialOpacity)):tokens.material.tint;
// Popovers use denser glass than the chrome (ui/semanticColors.ts popupOpacity), so a dark tint never greys out over a white page.
const popupOpacity=opacity=>opacity>=1?1:Math.min(.94,Math.max(.84,opacity+.2));
const materialTint=layout=>/^#[0-9a-f]{6}$/i.test(layout.materialTint||'')?layout.materialTint.slice(1).toUpperCase():null;

function clampBounds(bounds, size) {
  const x = Math.max(0, Math.min(size[0], Math.round(bounds.x)));
  const y = Math.max(0, Math.min(size[1], Math.round(bounds.y)));
  return {x, y, width: Math.max(0, Math.min(Math.round(bounds.width), size[0] - x)), height: Math.max(0, Math.min(Math.round(bounds.height), size[1] - y))};
}

function originBounds(config, bounds, size) {
  const anchor = config.anchor;
  if (anchor) {
    const width=Math.max(1,Math.min(size[0],Math.round(anchor.width))),height=Math.max(1,Math.min(size[1],Math.round(anchor.height)));
    return {x:Math.max(0,Math.min(size[0]-width,Math.round(anchor.x))),y:Math.max(0,Math.min(size[1]-height,Math.round(anchor.y))),width,height};
  }
  return {x: bounds.x + bounds.width - 36, y: bounds.y, width: 36, height: 36};
}

/** Native material and its crisp, full-size content move together. No frame-by-frame IPC. */
class MaterialHost {
  constructor(container, content, raise, makeBackdrop, getFrameInterval=()=>1000/60) {
    this.container = container;
    this.content = content;
    this.raise = raise;
    this.makeBackdrop = makeBackdrop;
    this.getFrameInterval = getFrameInterval;
    this.visible = false;
    this.generation = 0;
  }

  raiseLayers() {
    if (!this.visible) return;
    if (this.backdrop && (!this.pendingReadyId || this.materialReady)) this.raise(this.backdrop);
    this.raise(this.container);
  }

  /** Acknowledge only the generation whose hidden foreground is being prepared. */
  ready(id, stage, provider) {
    if(provider!==undefined){
      if(!this.visible||!this.floatingPopup||id!==this.configId||!this.readyTarget)return false;
      if(stage==='material'){
        this.rendererMaterial=provider==='renderer';this.staticMaterial=provider==='native';
        this.materialReady=true;this.hideBackdrop();return true;
      }
      if(stage!=='content'||!this.materialReady)return false;
      this.pendingReadyId=null;clearTimeout(this.opticalTimer);this.opticalTimer=null;
      this.panelRect={...this.readyTarget};this.opticalAlpha=this.readyTarget.alpha;this.opticalBlur=this.readyTarget.blur;this.opticalScale=1;
      this.paintFloatingMaterial();
      const readyId=id;
      this.opticalTimer=setTimeout(()=>{if(this.visible&&this.configId===readyId)this.setFloatingHost(this.readyDestination,this.readySize);},this.rendererMaterial&&!this.reducedMotion?tokens.motion.morph:0);
      if(this.staticMaterial)this.backdrop.setVisible(true);else this.hideBackdrop();
      this.raiseLayers();return true;
    }
    // A renderer reload reconstructs its hidden foreground while the native
    // material can already be ready. Re-acknowledge this exact visible popup
    // without restarting its animation or accepting a dismissed generation.
    if(this.visible&&this.floatingPopup&&id===this.configId&&this.pendingReadyId==null&&this.materialReady){
      return stage==='material'||stage==='content';
    }
    if (!this.visible || id !== this.pendingReadyId || !this.readyTarget) return false;
    if (stage === 'material') {
      // Tint and blur already exist on this painted quad. Commit it before the
      // renderer reveals text; a transparent quad cannot prime backdrop blur.
      this.backdrop.setVisible(true);
      this.materialReady = true;
      this.raiseLayers();
      return true;
    }
    if (stage !== 'content' || !this.materialReady) return false;
    this.pendingReadyId = null;
    this.raiseLayers();
    const generation = ++this.generation;
    this.animateFloating(this.readyTarget, this.readyDuration, () => {
      if (this.generation === generation && this.visible) this.setFloatingHost(this.readyDestination, this.readySize);
    });
    return true;
  }

  setFloatingHost(bounds,size) {
    const force=!this.floatingPopup;
    // The floating shape has its own frame controller. A zero-duration native
    // animator here recreates a clip mask during the final union-host crop and
    // can commit the parent crop separately from the child's coordinate rebase.
    // Only preempt a panel-relative animator when moving to a floating popup.
    const cancelRelative=this.floatingPopup===false?{animate:{duration:0}}:undefined;
    if(force||!equalBounds(this.bounds,bounds))this.container.setBounds(bounds,cancelRelative);
    this.bounds=bounds;
    placePopupCanvas(this.content,bounds,size,this.uiScale||1,cancelRelative,this.boundedInput);
    this.paintFloatingMaterial();
  }

  setBackdropBlur(blur) {
    if(this.backdrop&&this.paintedBlur!==blur){this.backdrop.setBackgroundBlur(blur);this.paintedBlur=blur;}
  }

  hideBackdrop() {
    this.backdrop?.setVisible(false);
    this.setBackdropBlur(0);
  }

  paintFloatingMaterial() {
    if(this.rendererMaterial){this.hideBackdrop();return;}
    if(!this.backdrop||!this.panelRect||!this.bounds)return;
    const p=this.panelRect,scale=this.opticalScale??1,o=this.backdropOrigin||{x:.5,y:.5};
    // Frost is a root sibling immediately below the trusted content host. A
    // rounded/reset host mask isolates native descendants from the website's
    // backdrop; placing the material there can make both tint and blur vanish.
    const x=p.x+p.width*(1-scale)*o.x,y=p.y+p.height*(1-scale)*o.y;
    // Cover the fractional DOM silhouette. Rounding inward can shave a whole
    // pixel from both edges just before the final frame, then abruptly restore
    // it when the exact target is assigned.
    const left=Math.floor(x),top=Math.floor(y);
    const bounds={x:left,y:top,width:Math.max(0,Math.ceil(x+p.width*scale)-left),height:Math.max(0,Math.ceil(y+p.height*scale)-top)};
    // This private material layer never runs a native bounds animation. Avoid
    // constructing a zero-duration animator (and clip mask) for every frame.
    if(!equalBounds(this.paintedBounds,bounds)){this.backdrop.setBounds(bounds);this.paintedBounds=bounds;}
    // A zero-alpha native background emits no painted quad to filter. Put the
    // translucent tint on this SAME native layer as its background blur.
    const alpha=Math.round(Math.max(0,Math.min(1,this.opticalAlpha||0))*255).toString(16).padStart(2,'0');
    // Dark appearance uses a dark frost so menus never flash white over dark pages.
    const tint='#'+alpha+(this.opticalTint||(this.opticalDark?'1E1F23':'FFFFFF'));
    if(tint!==this.paintedTint){this.backdrop.setBackgroundColor(tint);this.paintedTint=tint;}
    this.setBackdropBlur(Math.round(this.opticalBlur||0));
  }

  animateFloating(target,duration,settled) {
    clearTimeout(this.opticalTimer);
    const from={...this.panelRect,alpha:this.opticalAlpha||0,blur:this.opticalBlur||0,scale:this.opticalScale??1};
    const started=performance.now();
    const frameInterval=Math.max(1000/360,Math.min(1000/30,Number(this.getFrameInterval())||1000/60));
    // Fade the tint and move the silhouette; rebuilding the Gaussian kernel on
    // each frame adds compositor work and briefly exposes sharp page details.
    // On Windows a native background blur turns a see-through backdrop (the
    // acrylic sidebar) opaque dark, so blur may only sit under a tint thick
    // enough to cover that: it joins late while opening and leaves first when
    // closing, otherwise a dark patch shows where the menu was.
    const closing=target.alpha<from.alpha,cover=Math.max(from.alpha,target.alpha)*.6;
    // The kernel then grows with the tint instead of switching on at full radius in one frame.
    const blurFor=alpha=>closing||alpha<cover?0:Math.round(target.blur*Math.min(1,(alpha-cover)/Math.max(.01,target.alpha-cover)));
    this.opticalBlur=target.fadeBlur?blurFor(from.alpha):target.blur;
    const frame=()=>{
      const elapsed=performance.now()-started,t=duration?Math.min(1,elapsed/duration):1,e=materialEase(t);
      this.panelRect=Object.fromEntries(['x','y','width','height'].map(k=>[k,from[k]+(target[k]-from[k])*e]));
      const scaleDelay=Math.max(0,Math.min(duration,target.scaleDelay||0)),scaleProgress=duration>scaleDelay?Math.max(0,Math.min(1,(elapsed-scaleDelay)/(duration-scaleDelay))):1;
      this.opticalAlpha=from.alpha+(target.alpha-from.alpha)*e;this.opticalScale=from.scale+(target.scale-from.scale)*materialEase(scaleProgress);
      // View has no public layer-opacity API: tint alpha alone leaves its
      // backdrop filter fully visible. Only dismissal tapers the kernel so a
      // full-strength blur rectangle cannot remain and pop away at the end.
      if(target.fadeBlur)this.opticalBlur=blurFor(this.opticalAlpha);
      this.paintFloatingMaterial();
      if(t<1){const elapsed=performance.now()-started,next=Math.min(duration,(Math.floor(elapsed/frameInterval)+1)*frameInterval);this.opticalTimer=setTimeout(frame,Math.max(1,next-elapsed));}else {this.opticalTimer=null;settled?.();}
    };
    frame();
  }

  placeFloating(config,layout,size) {
    const changedId=this.configId!==config.id;
    this.configId=config.id;
    // Menus retain their outside-click dismissal canvas. Passive surfaces must
    // leave the website interactive throughout their entire visible lifetime.
    this.boundedInput=['toast','zoom','group-preview'].includes(config.kind);
    const opening=!this.visible,wasClosing=!!this.hideTimer,fresh=opening&&!wasClosing||!this.floatingPopup;
    clearTimeout(this.hideTimer);this.hideTimer=null;
    const p=clampBounds(config.bounds,size),x=Math.max(0,p.x-SHADOW.side);
    const centered=config.origin?.x===.5&&config.origin?.y===.5;
    const closedScale=tokens.motion.materialScale;this.closedScale=closedScale;
    const belowAnchor=!centered&&config.anchor&&config.origin?.y===0;
    const aboveAnchor=!centered&&config.anchor&&config.origin?.y===1;
    // Transparent shadow margins must never become invisible hit targets over
    // the toolbar control that opened this panel (or its neighboring controls).
    const topLimit=belowAnchor?config.anchor.y+config.anchor.height:layout.captionHeight||40;
    const y=Math.max(layout.captionHeight||40,topLimit,p.y-SHADOW.top);
    const bottom=Math.min(size[1],aboveAnchor?config.anchor.y:size[1],p.y+p.height+SHADOW.bottom);
    let destination=clampBounds({x,y,width:Math.min(size[0],p.x+p.width+SHADOW.side)-x,height:Math.max(0,bottom-y)},size);
    // A child form extends only the input/crop host. The primary panel and its
    // material retain their coordinates, including caption/toolbar exclusions.
    if(config.auxiliaryBounds){
      const child=clampBounds(config.auxiliaryBounds,size);
      const left=Math.max(0,Math.min(destination.x,child.x-SHADOW.side));
      const top=Math.max(layout.captionHeight||40,topLimit,Math.min(destination.y,child.y-SHADOW.top));
      const right=Math.min(size[0],Math.max(destination.x+destination.width,child.x+child.width+SHADOW.side));
      const end=Math.min(size[1],aboveAnchor?config.anchor.y:size[1],Math.max(destination.y+destination.height,child.y+child.height+SHADOW.bottom));
      destination=clampBounds({x:left,y:top,width:right-left,height:Math.max(0,end-top)},size);
    }
    const glass=!layout.reducedTransparency,dark=layout.appearance==='dark',finishTint=materialTint(layout);
    const opacity=materialOpacity(layout);
    const identity=['profile','extensions'].includes(config.kind);
    const target={...p,alpha:glass?popupOpacity(opacity):1,blur:glass?Math.round((identity?tokens.material.identityBlur:tokens.material.blur)*(this.uiScale||1)):0,scale:1};
    const signature=JSON.stringify({target,destination,size,dark,finishTint,kind:config.kind,id:config.id,origin:config.origin,reduced:layout.reducedMotion,speed:motionSpeed(layout)});
    if(this.floatingPopup&&this.visible&&signature===this.opticalSignature)return false;
    this.opticalSignature=signature;this.opticalDark=dark;this.opticalTint=finishTint;
    this.backdropOrigin=config.origin||(config.kind==='tabs'?{x:.5,y:.5}:{x:1,y:0});
    if(!this.backdrop){this.backdrop=this.makeBackdrop();this.backdrop.setVisible(false);}this.backdrop.setBorderRadius(Math.round(tokens.geometry.materialRadius*(this.uiScale||1)));
    if(this.tint!=='#00000000'){this.container.setBackgroundColor('#00000000');this.tint='#00000000';}
    if(this.blur!==0){this.container.setBackgroundBlur(0);this.blur=0;}
    // A fresh glass opening condenses like vapor: tint and blur rise together from almost nothing.
    const vapor=fresh&&glass&&!layout.reducedMotion;
    if(fresh||!this.panelRect){this.panelRect=p;this.opticalAlpha=vapor?tokens.material.vaporSeed:target.alpha;this.opticalBlur=vapor?0:target.blur;this.opticalScale=layout.reducedMotion?1:closedScale;}
    // Accessibility opacity takes effect immediately, independently of motion.
    if(!glass)this.opticalAlpha=1;
    if(!vapor)this.opticalBlur=target.blur;
    let host=destination;
    if(!fresh&&this.bounds){const left=Math.min(this.bounds.x,destination.x),top=Math.min(this.bounds.y,destination.y);host=clampBounds({x:left,y:top,width:Math.max(this.bounds.x+this.bounds.width,destination.x+destination.width)-left,height:Math.max(this.bounds.y+this.bounds.height,destination.y+destination.height)-top},size);}
    const preparing=Number.isSafeInteger(config.id)&&(opening||fresh||changedId||this.pendingReadyId!=null);
    if(preparing){
      this.pendingReadyId=config.id;
      // Retargeting an opening or reversing a close retains any frost already
      // painted. A fresh open starts hidden until the material acknowledgement.
      if(fresh){this.materialReady=false;this.backdrop.setVisible(false);}
    }
    this.setFloatingHost(host,size);
    // A hidden parent suspends renderer animation frames. Keep only the empty
    // transparent canvas alive; PopupSurface is immediately hidden and inert
    // until this generation's material and content acknowledgements complete.
    this.container.setVisible(true);
    this.visible=true;this.floatingPopup=true;this.reducedMotion=layout.reducedMotion;this.origin=originBounds(config,destination,size);
    const generation=++this.generation;
    if(preparing){
      clearTimeout(this.opticalTimer);this.opticalTimer=null;
      this.readyTarget=vapor?{...target,fadeBlur:true}:target;this.readyDuration=layout.reducedMotion?0:(opening?(vapor?tokens.motion.vapor:tokens.motion.material):tokens.motion.morph)/motionSpeed(layout);this.readyDestination=destination;this.readySize=size;
      this.raiseLayers();
    }else if(this.rendererMaterial||this.staticMaterial){
      clearTimeout(this.opticalTimer);this.opticalTimer=null;
      this.panelRect={...target};this.opticalAlpha=target.alpha;this.opticalBlur=target.blur;this.opticalScale=1;
      this.readyTarget=target;this.readyDestination=destination;this.readySize=size;
      if(this.staticMaterial)this.backdrop.setVisible(true);else this.hideBackdrop();
      this.setFloatingHost(host,size);
      this.opticalTimer=setTimeout(()=>{if(this.generation===generation&&this.visible)this.setFloatingHost(destination,size);},layout.reducedMotion?0:tokens.motion.morph/motionSpeed(layout));
    }else{
      this.backdrop.setVisible(true);if(opening||fresh)this.raiseLayers();
      this.animateFloating(target,layout.reducedMotion?0:(opening?tokens.motion.material:tokens.motion.morph)/motionSpeed(layout),()=>{if(this.generation===generation&&this.visible)this.setFloatingHost(destination,size);});
    }
    return opening;
  }

  place(config, layout, size) {
    if (!config) { this.hide(layout); return; }
    if(config.kind&&this.makeBackdrop)return this.placeFloating(config,layout,size);
    this.pendingReadyId=null;this.materialReady=false;this.readyTarget=null;
    clearTimeout(this.opticalTimer);this.opticalTimer=null;this.opticalSignature=null;
    const opening = !this.visible;
    const wasClosing = !!this.hideTimer;
    const b = clampBounds(config.bounds, size);
    const glass = !layout.reducedTransparency;
    this.tintBase = materialTint(layout) || (layout.appearance==='dark' ? '1E1F23' : 'FFFFFF');
    const tint = glass ? '#'+Math.round(materialOpacity(layout)*255).toString(16)+this.tintBase : '#FF'+(materialTint(layout) || (layout.appearance==='dark' ? '1B1C1F' : 'FFFFFF'));
    if (tint !== this.tint) { this.container.setBackgroundColor(tint); this.tint = tint; }
    const blur = glass ? Math.round(tokens.material.blur*(this.uiScale||1)) : 0;
    this.hideBackdrop();
    this.container.setBorderRadius(Math.round(tokens.geometry.materialRadius*(this.uiScale||1)));
    if (blur !== this.blur) { this.container.setBackgroundBlur(blur); this.blur = blur; }
    clearTimeout(this.hideTimer); this.hideTimer = null; this.generation++;
    const animate = false;
    const duration = 0;
    // Electron's nonanimated path does not cancel an existing native animation.
    // A zero-duration animation preempts it, preventing an old closing target
    // from moving a newly opened menu offscreen after a panel mode change.
    const options = {animate: animate ? {duration, easing: 'ease-out'} : {duration:0}};
    if (opening && !wasClosing) {
      const start = b;
      this.container.setBounds(start,{animate:{duration:0}});
      this.content.setBounds({x: b.x - start.x, y: b.y - start.y, width: b.width, height: b.height},{animate:{duration:0}});
      this.container.setVisible(true);
      this.raise(this.container);
    }
    if (opening || wasClosing || this.reducedMotion!==layout.reducedMotion || !equalBounds(this.bounds, b)) {
      this.container.setBounds(b, options);
      this.content.setBounds({x: 0, y: 0, width: b.width, height: b.height}, options);
    }
    this.floatingPopup=false;
    this.visible = true; this.bounds = b; this.origin = originBounds(config, b, size);this.reducedMotion=layout.reducedMotion;
    return opening;
  }

  hide(layout) {
    if (!this.visible && !this.hideTimer) return;
    const immediate=this.pendingReadyId!=null || layout.reducedMotion || !this.bounds;
    // An accessibility change must also finish an already-running close.
    if(!this.visible&&!immediate)return;
    this.visible = false;this.pendingReadyId=null;this.materialReady=false;this.readyTarget=null;
    const generation = ++this.generation;
    if (immediate) {
      clearTimeout(this.opticalTimer);clearTimeout(this.hideTimer);this.opticalTimer=null;this.hideTimer=null;
      this.opticalAlpha=0;this.opticalBlur=0;this.hideBackdrop();this.container.setVisible(false);return;
    }
    if (this.floatingPopup) {
      if(this.rendererMaterial||this.staticMaterial){
        clearTimeout(this.opticalTimer);this.opticalTimer=null;this.hideBackdrop();
        const duration=this.staticMaterial?0:tokens.motion.vaporExit/motionSpeed(layout);
        this.hideTimer=setTimeout(()=>{if(this.generation===generation){this.container.setVisible(false);this.hideTimer=null;}},duration+10);return;
      }
      // Fade the native optical layer too; otherwise a blurred rectangle hangs
      // behind the already-faded DOM contents and then disappears in one frame.
      const duration=tokens.motion.vaporExit/motionSpeed(layout);
      // Text stays at its natural size while the separate material fades.
      this.animateFloating({...this.panelRect,alpha:0,blur:0,fadeBlur:true,scale:this.closedScale??tokens.motion.materialScale,scaleDelay:0},duration);
      this.hideTimer=setTimeout(()=>{if(this.generation===generation){this.hideBackdrop();this.container.setVisible(false);this.hideTimer=null;}},duration+10);
      return;
    }
    const duration=tokens.motion.assistantExit,started=performance.now();
    // As with floating menus, the blur leaves first so it never sits under a thinning tint.
    if(this.blur){this.blur=0;this.container.setBackgroundBlur(0);}
    const fade=()=>{
      if(this.generation!==generation)return;
      const progress=Math.min(1,(performance.now()-started)/duration),remaining=1-materialEase(progress);
      const tint='#'+Math.round(materialOpacity(layout)*remaining*255).toString(16).padStart(2,'0')+(this.tintBase||'FFFFFF');
      this.container.setBackgroundColor(tint);this.tint=tint;
      if(progress<1)this.opticalTimer=setTimeout(fade,16);
    };
    fade();
    this.hideTimer=setTimeout(()=>{if(this.generation===generation){clearTimeout(this.opticalTimer);this.opticalTimer=null;this.container.setVisible(false);this.hideTimer=null;}},duration+10);
  }
}

/** Windows 11 replaces a system backdrop with its solid fallback while the window is
 * inactive. Tell Acira's own views, so the chrome paints its clean finish colour then
 * instead of a translucent veil over that grey fallback. */
const uiContents = contents => contents && !contents.isDestroyed() && contents.getURL().startsWith('acira-browser-ui://ui/');
const allViews = view => view ? [view, ...(view.children || []).flatMap(allViews)] : [];
/** The overlay look Mac builds on a material behind the window (`desktopMaterial=ready`: the sidebar and toolbar are one veil over it, the page
 * stands clear of the sidebar) holds on Windows too while the acrylic backdrop is live: the window is active and system transparency is on.
 * Inactive or transparency off, DWM paints its solid fallback and the chrome paints its own finish instead (the rules above). */
const glassScript = process.platform === 'win32' ? "(()=>{const d=document.documentElement.dataset;d.desktopMaterial=d.material==='acrylic'&&d.windowActive==='true'&&d.systemTransparency!=='off'?'ready':'unavailable';})()" : 'void 0';
function markWindowActivation(window, active) {
  if (!window || window.isDestroyed?.()) return;
  const script = `document.documentElement.dataset.windowActive=${active ? '"true"' : '"false"'};${glassScript}`;
  for (const view of allViews(window.contentView)) if (uiContents(view.webContents)) view.webContents.executeJavaScript(script).catch(() => {});
}
/** Windows turns transparency effects off for Energy saver (and the user can turn them off); DWM then drops acrylic.
 * Tell Acira's views so the chrome paints an opaque, Mica-like finish tone instead of a veil over the grey fallback. */
function markSystemTransparency(window) {
  if (!window || window.isDestroyed?.()) return;
  const {nativeTheme} = require('electron');
  const off = nativeTheme.prefersReducedTransparency === true;
  const script = `document.documentElement.dataset.systemTransparency=${off ? '"off"' : '"on"'};${glassScript}`;
  for (const view of allViews(window.contentView)) if (uiContents(view.webContents)) view.webContents.executeJavaScript(script).catch(() => {});
}
const trackedWindows = new WeakSet();
/** BaseWindow focus is not forwarded to app events, so each Acira UI page finds its own window once loaded. */
function trackWindowActivation(app) {
  const {BaseWindow} = require('electron');
  const attach = (contents, attempt = 0) => {
    if (!uiContents(contents)) return;
    const window = BaseWindow.getAllWindows().find(item => !item.isDestroyed() && allViews(item.contentView).some(view => view.webContents === contents));
    // A UI view can finish loading just before its window attaches it.
    if (!window) { if (attempt < 20) setTimeout(() => attach(contents, attempt + 1), 150); return; }
    if (!trackedWindows.has(window)) {
      trackedWindows.add(window);
      window.on('focus', () => markWindowActivation(window, true));
      window.on('blur', () => markWindowActivation(window, false));
    }
    markWindowActivation(window, window.isFocused());
    markSystemTransparency(window);
  };
  app.on('web-contents-created', (_event, contents) => contents.on('dom-ready', () => attach(contents)));
  app.whenReady().then(() => {
    const {nativeTheme} = require('electron');
    nativeTheme.on('updated', () => { for (const window of BaseWindow.getAllWindows()) if (trackedWindows.has(window)) markSystemTransparency(window); });
  });
}

module.exports = {equalBounds, clampBounds, MaterialHost, materialEase, glassScript, markWindowActivation, trackWindowActivation, popupOpacity, placePopupCanvas};
