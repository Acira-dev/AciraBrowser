// Public AppKit APIs only. Change the behind-window material's appearance,
// never NSApp/NSWindow appearance or Chromium's webpage colour preference.
#include <node_api.h>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include "mac-passkeys.h"
#import <Cocoa/Cocoa.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <QuartzCore/QuartzCore.h>

@interface AciraDesktopMaterial : NSVisualEffectView
@property BOOL connectedFrame;
@property NSUInteger materialRegionCount;
@end
@implementation AciraDesktopMaterial
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

static AciraDesktopMaterial *DesktopMaterialIn(NSView *view) {
  if([view isKindOfClass:AciraDesktopMaterial.class])return (AciraDesktopMaterial*)view;
  for(NSView *child in view.subviews){AciraDesktopMaterial *found=DesktopMaterialIn(child);if(found)return found;}
  return nil;
}
static void ContentsViews(NSView *view,NSMutableArray<NSView*> *result) {
  // Electron's public native handle owns these views. Match the app's explicit
  // renderer order/count before installing; never guess which page is the UI.
  for(NSView *child in view.subviews){if([NSStringFromClass(child.class) isEqual:@"WebContentsViewCocoa"])[result addObject:child];else ContentsViews(child,result);}
}
static void StackDesktopMaterial(AciraDesktopMaterial *effect,NSView *ui) {
  // Chromium draws every renderer, the interface and websites alike, into the
  // window's ViewsCompositorSuperview; the WebContentsViewCocoa views above it
  // carry input only. Material placed above that compositor (inside the
  // interface's view or beside it) covered every control, so keep it beneath,
  // beside the window's own vibrancy view, where the transparent chrome shows it.
  NSView *parent=ui.superview;if(!parent)return;
  NSView *compositor=nil;for(NSView *view in parent.subviews)if([NSStringFromClass(view.class) isEqual:@"ViewsCompositorSuperview"]){compositor=view;break;}
  NSArray<NSView*> *siblings=parent.subviews;NSUInteger at=compositor?[siblings indexOfObject:compositor]:0;
  if(effect.superview!=parent||(compositor?at==0||siblings[at-1]!=effect:siblings.firstObject!=effect))[parent addSubview:effect positioned:NSWindowBelow relativeTo:compositor];
  if(!NSEqualRects(effect.frame,ui.frame))effect.frame=ui.frame;
  effect.layer.zPosition=0;
}
static void MaterialRect(CGMutablePathRef path,CGFloat x,CGFloat y,CGFloat w,CGFloat h,CGFloat radius,CGFloat height) {
  y=height-y-h;CGFloat r=MIN(radius,MIN(w,h)/2);
  // Keep identical path topology even for the zero-width hidden sidebar.
  CGPathMoveToPoint(path,nil,x+r,y);CGPathAddLineToPoint(path,nil,x+w-r,y);CGPathAddQuadCurveToPoint(path,nil,x+w,y,x+w,y+r);
  CGPathAddLineToPoint(path,nil,x+w,y+h-r);CGPathAddQuadCurveToPoint(path,nil,x+w,y+h,x+w-r,y+h);
  CGPathAddLineToPoint(path,nil,x+r,y+h);CGPathAddQuadCurveToPoint(path,nil,x,y+h,x,y+h-r);
  CGPathAddLineToPoint(path,nil,x,y+r);CGPathAddQuadCurveToPoint(path,nil,x,y,x+r,y);CGPathCloseSubpath(path);
}
static napi_value OverlayMaterial(napi_env env,napi_callback_info info) {
 @autoreleasepool {
  size_t argc=7,length=0;napi_value args[7];void *bytes=nullptr;bool buffer=false;napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(argc)napi_is_buffer(env,args[0],&buffer);
  uint32_t index=0,count=0;
  if(argc<3||!buffer||napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok||length!=sizeof(void*)||napi_get_value_uint32(env,args[1],&index)!=napi_ok||napi_get_value_uint32(env,args[2],&count)!=napi_ok||![NSThread isMainThread]){napi_throw_type_error(env,nullptr,"Expected an owned window and UI renderer order");return nullptr;}
  uintptr_t address=0;std::memcpy(&address,bytes,sizeof(address));if(!address){napi_throw_type_error(env,nullptr,"Window handle is null");return nullptr;}
  NSView *handle=(__bridge NSView*)(reinterpret_cast<void*>(address)),*root=handle.window.contentView;
  NSMutableArray<NSView*> *views=[NSMutableArray array];ContentsViews(root,views);
  NSView *ui=count==views.count&&index<count?views[index]:nil;
  AciraDesktopMaterial *effect=DesktopMaterialIn(root);
  if(!effect&&ui){effect=[[AciraDesktopMaterial alloc]initWithFrame:ui.frame];effect.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;effect.material=NSVisualEffectMaterialSidebar;effect.blendingMode=NSVisualEffectBlendingModeBehindWindow;effect.state=NSVisualEffectStateFollowsWindowActiveState;effect.wantsLayer=YES;
   // Copy the existing desktop material's appearance rather than NSApp's tone.
   for(NSView *view in root.subviews)if([view isKindOfClass:NSVisualEffectView.class]){NSVisualEffectView *source=(NSVisualEffectView*)view;effect.appearance=source.appearance;effect.state=source.state;effect.emphasized=source.emphasized;break;}
   CAShapeLayer *mask=[CAShapeLayer layer];mask.fillColor=NSColor.blackColor.CGColor;mask.frame=effect.bounds;CGMutablePathRef empty=CGPathCreateMutable();MaterialRect(empty,0,0,0,0,0,effect.bounds.size.height);MaterialRect(empty,0,0,0,0,0,effect.bounds.size.height);mask.path=empty;CGPathRelease(empty);effect.layer.mask=mask;
  }
  napi_value answer;napi_get_boolean(env,effect!=nil,&answer);if(!effect)return answer;
  if(ui)StackDesktopMaterial(effect,ui);
  bool enabled=true;if(argc>=7)napi_get_value_bool(env,args[6],&enabled);effect.hidden=!enabled;
  bool array=false;if(argc<4||napi_is_array(env,args[3],&array)!=napi_ok||!array)return answer;
  uint32_t number=0;napi_get_array_length(env,args[3],&number);if(number<2||number>6){napi_throw_type_error(env,nullptr,"Expected toolbar, sidebar and up to four page cut-outs");return nullptr;}
  // A split retains the material between panes. Subtract each pane separately
  // from the window instead of treating its first pane as the whole page card.
  const bool connected=number>2;
  CGMutablePathRef path=CGPathCreateMutable();
  if(connected)MaterialRect(path,0,0,effect.bounds.size.width,effect.bounds.size.height,0,effect.bounds.size.height);
  for(uint32_t i=connected?2:0;i<number;i++){napi_value row;napi_get_element(env,args[3],i,&row);double values[5]={};const char *keys[]={"x","y","width","height","radius"};
   for(unsigned j=0;j<5;j++){napi_value value;if(napi_get_named_property(env,row,keys[j],&value)!=napi_ok||napi_get_value_double(env,value,&values[j])!=napi_ok||!std::isfinite(values[j])||values[j]<0||values[j]>32768){CGPathRelease(path);napi_throw_type_error(env,nullptr,"Invalid material rectangle");return nullptr;}}
   MaterialRect(path,values[0],values[1],values[2],values[3],values[4],effect.bounds.size.height);
  }
  double duration=0;if(argc>=5)napi_get_value_double(env,args[4],&duration);duration=std::isfinite(duration)?MAX(0,MIN(2000,duration)):0;
  // Core Animation can interpolate matching path topology only. Adding or
  // removing panes commits its new topology; reveal/hide keeps animating it.
  if(effect.connectedFrame!=connected||effect.materialRegionCount!=number)duration=0;effect.connectedFrame=connected;effect.materialRegionCount=number;
  bool reveal=true;if(argc>=6)napi_get_value_bool(env,args[5],&reveal);
  CAShapeLayer *mask=(CAShapeLayer*)effect.layer.mask;mask.frame=effect.bounds;
  CGPathRef from=((CAShapeLayer*)mask.presentationLayer).path?:mask.path;
  CABasicAnimation *animation=[CABasicAnimation animationWithKeyPath:@"path"];animation.fromValue=(__bridge id)from;animation.toValue=(__bridge id)path;animation.duration=duration/1000.;animation.timingFunction=reveal?[CAMediaTimingFunction functionWithControlPoints:.16 :1 :.3 :1]:[CAMediaTimingFunction functionWithControlPoints:.65 :0 :.35 :1];
  // The new outline and the animation toward it go to the screen in ONE transaction. Committed on its own first, the final outline
  // was drawn for a frame before the animation began: as the Seamless sidebar left, the glass under it vanished for that frame and
  // the website showed through the still-present sidebar (founder, 31 Oct recording).
  [CATransaction begin];[CATransaction setDisableActions:YES];mask.fillRule=connected?kCAFillRuleEvenOdd:kCAFillRuleNonZero;mask.path=path;[mask removeAnimationForKey:@"acira-material-reveal"];if(duration>0)[mask addAnimation:animation forKey:@"acira-material-reveal"];[CATransaction commit];CGPathRelease(path);
  return answer;
 }
}

// Device-owner policy lets macOS choose Touch ID, Apple Watch or the account
// password. Acira receives only the system's result, never a credential.
struct AuthenticationWork {
  napi_async_work work;
  napi_deferred deferred;
  std::string reason;
  int result = 2; // 0 verified, 1 cancelled, 2 failed, 3 timeout, 4 unavailable
};
static napi_value AuthenticationAvailable(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    LAContext *context = [LAContext new];
    bool available = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil];
    [context invalidate];
    napi_value value; napi_get_boolean(env, available, &value); return value;
  }
}
static void ExecuteAuthentication(napi_env env, void *data) {
  AuthenticationWork *work = static_cast<AuthenticationWork *>(data);
  @autoreleasepool {
    LAContext *context = [LAContext new];
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil]) {
      work->result = 4; return;
    }
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    // The reply owns its result box, not the async-work allocation: a reply
    // arriving after timeout cannot touch freed work or a closed JS environment.
    __block int outcome = 2;
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
      localizedReason:[NSString stringWithUTF8String:work->reason.c_str()]
      reply:^(BOOL success, NSError *error) {
        outcome = success ? 0 : (error.code == LAErrorUserCancel ||
          error.code == LAErrorSystemCancel || error.code == LAErrorAppCancel) ? 1 : 2;
        dispatch_semaphore_signal(finished);
      }];
    const long timedOut = dispatch_semaphore_wait(finished, dispatch_time(DISPATCH_TIME_NOW, 90 * NSEC_PER_SEC));
    work->result = timedOut ? 3 : outcome;
    [context invalidate];
  }
}
static void CompleteAuthentication(napi_env env, napi_status status, void *data) {
  AuthenticationWork *work = static_cast<AuthenticationWork *>(data);
  const int result = status == napi_ok ? work->result : 2;
  const char *codes[] = {"verified", "cancelled", "failed", "timeout", "unavailable"};
  napi_value value, ok, code;
  napi_create_object(env, &value); napi_get_boolean(env, result == 0, &ok);
  napi_create_string_utf8(env, codes[result], NAPI_AUTO_LENGTH, &code);
  napi_set_named_property(env, value, "ok", ok); napi_set_named_property(env, value, "code", code);
  napi_resolve_deferred(env, work->deferred, value);
  napi_delete_async_work(env, work->work); delete work;
}
static napi_value Authenticate(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0; napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok || !length || length > 240) {
    napi_throw_type_error(env, nullptr, "Expected a short authentication reason"); return nullptr;
  }
  auto *work = new AuthenticationWork;
  work->reason.resize(length + 1);
  napi_get_value_string_utf8(env, args[0], work->reason.data(), length + 1, &length);
  work->reason.resize(length);
  if (work->reason.find_first_of("\r\n") != std::string::npos || work->reason.find('\0') != std::string::npos) {
    delete work; napi_throw_type_error(env, nullptr, "Invalid authentication reason"); return nullptr;
  }
  napi_value promise, name;
  napi_create_promise(env, &work->deferred, &promise);
  napi_create_string_utf8(env, "Acira device-owner verification", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteAuthentication, CompleteAuthentication, work, &work->work) != napi_ok) {
    delete work; napi_throw_error(env, nullptr, "Authentication unavailable"); return nullptr;
  }
  if (napi_queue_async_work(env, work->work) != napi_ok) {
    napi_delete_async_work(env, work->work); delete work;
    napi_throw_error(env, nullptr, "Authentication unavailable"); return nullptr;
  }
  return promise;
}

static void Visit(NSView *view, NSAppearance *appearance, bool apply,
                  NSMutableArray *result, unsigned depth = 0) {
  if (!view || depth > 64) return;
  if ([view isKindOfClass:[NSVisualEffectView class]]) {
    NSVisualEffectView *effect = (NSVisualEffectView *)view;
    if (effect.material == NSVisualEffectMaterialSidebar &&
        effect.blendingMode == NSVisualEffectBlendingModeBehindWindow) {
      if (apply && ![effect.appearance.name isEqual:appearance.name]) effect.appearance = appearance;
      NSString *match = [effect.effectiveAppearance bestMatchFromAppearancesWithNames:
        @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
      [result addObject:@{@"tone": [match isEqual:NSAppearanceNameDarkAqua] ? @"dark" : @"light",
        @"material": @(effect.material), @"state": @(effect.state),
        @"blendingMode": @(effect.blendingMode)}];
    }
  }
  for (NSView *child in view.subviews) Visit(child, appearance, apply, result, depth + 1);
}

static napi_value Material(napi_env env, napi_callback_info info, bool apply) {
  @autoreleasepool {
    size_t argc = 2; napi_value args[2];
    if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < (apply ? 2u : 1u)) {
      napi_throw_type_error(env, nullptr, "Expected an Electron native window handle and appearance"); return nullptr;
    }
    bool isBuffer = false; void *bytes = nullptr; size_t length = 0;
    napi_is_buffer(env, args[0], &isBuffer);
    if (!isBuffer || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *)) {
      napi_throw_type_error(env, nullptr, "Invalid native window handle"); return nullptr;
    }
    if (![NSThread isMainThread]) {
      napi_throw_error(env, nullptr, "AppKit material must run on the main thread"); return nullptr;
    }
    NSAppearance *appearance = nil;
    if (apply) {
      char mode[16]; size_t size = 0;
      if (napi_get_value_string_utf8(env, args[1], mode, sizeof(mode), &size) != napi_ok ||
          (std::strcmp(mode, "light") && std::strcmp(mode, "dark") && std::strcmp(mode, "system"))) {
        napi_throw_type_error(env, nullptr, "Appearance must be light, dark or system"); return nullptr;
      }
      if (!std::strcmp(mode, "light")) appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
      if (!std::strcmp(mode, "dark")) appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    }
    uintptr_t address = 0; std::memcpy(&address, bytes, sizeof(address));
    if (!address) { napi_throw_error(env, nullptr, "Window handle is null"); return nullptr; }
    NSView *nativeView = (__bridge NSView *)(reinterpret_cast<void *>(address));
    NSView *root = nativeView.window.contentView.superview;
    NSMutableArray *result = [NSMutableArray array];
    Visit(root, appearance, apply, result);
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    napi_value value; napi_create_string_utf8(env, (const char *)json.bytes, json.length, &value); return value;
  }
}
static napi_value Set(napi_env env, napi_callback_info info) { return Material(env, info, true); }
static napi_value Inspect(napi_env env, napi_callback_info info) { return Material(env, info, false); }
// App-owned native geometry only: verify which transparent renderer hosts the
// shared window material without reading webpages or capturing the desktop.
static void ViewFrames(NSView *view, NSMutableArray *rows, unsigned depth=0) {
  if(!view||depth>10)return;
  NSRect r=view.frame;
  NSMutableDictionary *row=[@{@"class":NSStringFromClass(view.class),@"depth":@(depth),@"x":@(r.origin.x),@"y":@(r.origin.y),@"width":@(r.size.width),@"height":@(r.size.height),@"hidden":@(view.hidden),@"layerZ":@(view.layer.zPosition)} mutableCopy];
  if([view isKindOfClass:NSVisualEffectView.class]){NSVisualEffectView *effect=(NSVisualEffectView*)view;row[@"material"]=@(effect.material);row[@"state"]=@(effect.state);row[@"emphasized"]=@(effect.emphasized);row[@"blending"]=@(effect.blendingMode);row[@"flipped"]=@(effect.isFlipped);row[@"layerFlipped"]=@(effect.layer.geometryFlipped);row[@"tone"]=effect.effectiveAppearance.name?:@"";}
  if([view isKindOfClass:AciraDesktopMaterial.class]){CAShapeLayer *mask=(CAShapeLayer*)view.layer.mask;row[@"maskFlipped"]=@(mask.geometryFlipped);CGRect box=CGPathGetBoundingBox(mask.path);row[@"maskBounds"]=@[@(box.origin.x),@(box.origin.y),@(box.size.width),@(box.size.height)];row[@"connected"]=@(((AciraDesktopMaterial*)view).connectedFrame);}
  [rows addObject:row];
  for(NSView *child in view.subviews)ViewFrames(child,rows,depth+1);
}
static napi_value InspectViewFrames(napi_env env,napi_callback_info info) {
  size_t argc=1,length=0;napi_value args[1];void *bytes=nullptr;bool buffer=false;napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(argc)napi_is_buffer(env,args[0],&buffer);
  if(!buffer||napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok||length!=sizeof(void*)||![NSThread isMainThread]){napi_throw_type_error(env,nullptr,"Expected an owned native window handle");return nullptr;}
  uintptr_t address=0;std::memcpy(&address,bytes,sizeof(address));if(!address){napi_throw_type_error(env,nullptr,"Window handle is null");return nullptr;}
  NSView *view=(__bridge NSView*)(reinterpret_cast<void*>(address));NSMutableArray *rows=[NSMutableArray array];ViewFrames(view.window.contentView,rows);
  NSData *json=[NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];napi_value value;napi_create_string_utf8(env,(const char*)json.bytes,json.length,&value);return value;
}
// Read-only native geometry for window-control regression checks. DOM captures
// cannot see AppKit buttons or tell whether a hidden button still receives hits.
static napi_value InspectWindowButtons(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 1; napi_value args[1]; void *bytes = nullptr; size_t length = 0; bool buffer = false;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc) napi_is_buffer(env, args[0], &buffer);
    if (!buffer || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *) || ![NSThread isMainThread]) {
      napi_throw_type_error(env, nullptr, "Expected a native window handle on the main thread"); return nullptr;
    }
    uintptr_t address = 0; std::memcpy(&address, bytes, sizeof(address));
    if (!address) { napi_throw_error(env, nullptr, "Window handle is null"); return nullptr; }
    NSView *view = (__bridge NSView *)(reinterpret_cast<void *>(address)); NSWindow *window = view.window;
    NSView *root = window.contentView.superview; NSMutableArray *result = [NSMutableArray array];
    for (NSNumber *kind in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)]) {
      NSButton *button = [window standardWindowButton:(NSWindowButton)kind.integerValue];
      if (!button) continue;
      NSRect rect = [button convertRect:button.bounds toView:root];
      const CGFloat top = root.isFlipped ? rect.origin.y : root.bounds.size.height - NSMaxY(rect);
      NSView *hit = [root hitTest:NSMakePoint(NSMidX(rect), NSMidY(rect))];
      [result addObject:@{@"kind": kind, @"x": @(rect.origin.x), @"y": @(top), @"width": @(rect.size.width), @"height": @(rect.size.height),
        @"hidden": @(button.hiddenOrHasHiddenAncestor), @"enabled": @(button.enabled), @"receivesHit": @(hit == button || [hit isDescendantOf:button])}];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    napi_value value; napi_create_string_utf8(env, (const char *)json.bytes, json.length, &value); return value;
  }
}
// Native fullscreen puts a second window over the top 32pt of the content whenever the pointer touches the top of the screen: AppKit's
// full-screen titlebar strip (NSToolbarFullScreenWindow). Electron leaves titlebarAppearsTransparent off in fullscreen, so for a window with a
// hidden title bar the strip is an opaque bar with the title and the traffic lights, and it covers the tab row and toolbar (the menu bar
// above it is the system's and stays). Keep that window invisible and out of the mouse's way for as long as the window is fullscreen. Public
// AppKit only: the window list, ignoresMouseEvents, alphaValue, and KVO on that alpha (AppKit sets it back to 1 on every reveal).
@interface AciraFullscreenStrip : NSObject
@property(nonatomic,strong) NSMutableArray<NSWindow *> *strips;
@property(nonatomic,strong) NSMutableArray *tokens;
@end
@implementation AciraFullscreenStrip
- (instancetype)init { if((self=[super init])){_strips=[NSMutableArray array];_tokens=[NSMutableArray array];} return self; }
- (void)observeValueForKeyPath:(NSString *)path ofObject:(id)object change:(NSDictionary *)change context:(void *)context { NSWindow *strip=object; if(strip.alphaValue>0)strip.alphaValue=0; }
- (void)hold:(NSWindow *)strip {
  if([self.strips containsObject:strip])return;
  strip.ignoresMouseEvents=YES; strip.alphaValue=0;
  [strip addObserver:self forKeyPath:@"alphaValue" options:NSKeyValueObservingOptionNew context:nil]; [self.strips addObject:strip];
}
// Before the strip window is torn down (the window leaves fullscreen or closes): no observer may outlive it.
- (void)letGo {
  for(NSWindow *strip in self.strips){@try{[strip removeObserver:self forKeyPath:@"alphaValue"];}@catch(id ignored){}}
  [self.strips removeAllObjects];
  for(id token in self.tokens)[NSNotificationCenter.defaultCenter removeObserver:token];
  [self.tokens removeAllObjects];
}
@end
static NSMapTable<NSWindow *, AciraFullscreenStrip *> *FullscreenStrips() { static NSMapTable *table=nil; if(!table)table=[NSMapTable weakToStrongObjectsMapTable]; return table; }
static napi_value HideFullscreenStrip(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 1, length = 0; napi_value args[1]; void *bytes = nullptr;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc != 1 || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *)) {
      napi_throw_type_error(env, nullptr, "Expected a native window handle"); return nullptr;
    }
    uintptr_t address = 0; std::memcpy(&address, bytes, sizeof(address));
    if (!address) { napi_throw_error(env, nullptr, "Window handle is null"); return nullptr; }
    NSView *view = (__bridge NSView *)(reinterpret_cast<void *>(address)); NSWindow *window = view.window; int held = 0;
    if (window && (window.styleMask & NSWindowStyleMaskFullScreen)) {
      AciraFullscreenStrip *keeper = [FullscreenStrips() objectForKey:window];
      if (!keeper) {
        keeper = [AciraFullscreenStrip new]; [FullscreenStrips() setObject:keeper forKey:window]; __weak AciraFullscreenStrip *weak = keeper;
        for (NSNotificationName name in @[NSWindowWillExitFullScreenNotification, NSWindowWillCloseNotification]) {
          [keeper.tokens addObject:[NSNotificationCenter.defaultCenter addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *note) { [FullscreenStrips() removeObjectForKey:note.object]; [weak letGo]; }]];
        }
      }
      // This window's strip: AppKit's own class, the same width, flush with the window's top edge (a second fullscreen window has its own).
      for (NSWindow *strip in NSApp.windows) {
        if (![NSStringFromClass(strip.class) isEqual:@"NSToolbarFullScreenWindow"]) continue;
        const NSRect f = strip.frame, m = window.frame;
        if (fabs(f.origin.x - m.origin.x) > 1 || fabs(f.size.width - m.size.width) > 1 || fabs(NSMaxY(f) - NSMaxY(m)) > 1) continue;
        [keeper hold:strip]; held++;
      }
    }
    napi_value answer; napi_create_int32(env, held, &answer); return answer;
  }
}
// Is this window on the Space the person is looking at (a fullscreen window is its own Space, so this is "its Space is showing on its display")?
// Electron's isVisible() stays true for a window on another Space, and isFocused() is false whenever another app has the keyboard.
static NSWindow *WindowOf(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0; napi_value args[1]; void *bytes = nullptr;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *)) { napi_throw_type_error(env, nullptr, "Expected a native window handle"); return nil; }
  uintptr_t address = 0; std::memcpy(&address, bytes, sizeof(address));
  if (!address) { napi_throw_error(env, nullptr, "Window handle is null"); return nil; }
  NSView *view = (__bridge NSView *)(reinterpret_cast<void *>(address)); return view.window;
}
static napi_value WindowOnActiveSpace(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSWindow *window = WindowOf(env, info); bool on = window && window.isOnActiveSpace && window.isVisible && !window.isMiniaturized && !NSApp.isHidden;
    napi_value answer; napi_get_boolean(env, on, &answer); return answer;
  }
}
NAPI_MODULE_INIT() {
  InstallMacPasskeys(env,exports);
  { napi_value onSpace; napi_create_function(env, "windowOnActiveSpace", NAPI_AUTO_LENGTH, WindowOnActiveSpace, nullptr, &onSpace); napi_set_named_property(env, exports, "windowOnActiveSpace", onSpace); }
  napi_value set, inspect, buttons, available, authenticate;
  napi_create_function(env, "setAppearance", NAPI_AUTO_LENGTH, Set, nullptr, &set);
  napi_create_function(env, "inspect", NAPI_AUTO_LENGTH, Inspect, nullptr, &inspect);
  napi_set_named_property(env, exports, "setAppearance", set);
  napi_set_named_property(env, exports, "inspect", inspect);
  napi_value overlay;napi_create_function(env,"overlayMaterial",NAPI_AUTO_LENGTH,OverlayMaterial,nullptr,&overlay);napi_set_named_property(env,exports,"overlayMaterial",overlay);
  napi_value frames;napi_create_function(env,"inspectViewFrames",NAPI_AUTO_LENGTH,InspectViewFrames,nullptr,&frames);napi_set_named_property(env,exports,"inspectViewFrames",frames);
  napi_create_function(env, "inspectWindowButtons", NAPI_AUTO_LENGTH, InspectWindowButtons, nullptr, &buttons);
  napi_set_named_property(env, exports, "inspectWindowButtons", buttons);
  napi_value strip; napi_create_function(env, "hideFullscreenStrip", NAPI_AUTO_LENGTH, HideFullscreenStrip, nullptr, &strip); napi_set_named_property(env, exports, "hideFullscreenStrip", strip);
  napi_create_function(env, "authenticationAvailable", NAPI_AUTO_LENGTH, AuthenticationAvailable, nullptr, &available);
  napi_create_function(env, "authenticate", NAPI_AUTO_LENGTH, Authenticate, nullptr, &authenticate);
  napi_set_named_property(env, exports, "authenticationAvailable", available);
  napi_set_named_property(env, exports, "authenticate", authenticate);
  return exports;
}
