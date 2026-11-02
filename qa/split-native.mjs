// Shared by the split rigs (splitgroup-fit, splitgroup-drag, split-press-after-join): an isolated app whose window renders
// without ever taking focus, real input on the interface view, settled boxes and captures of this app's own view only.
//  - ACIRA_BROWSER_TEST_HIDDEN=1: main creates the window unfocusable, out of the taskbar, and never shows or focuses it.
//  - The rig then shows it inactive far off screen, ignoring the real mouse: it draws frames (FLIP slides, pointer drags and
//    rAF need them; a never-shown window draws none), but it can never take focus or sit under the founder's pointer.
//  - Input is webContents.sendInputEvent on the interface view (the path a real click takes), in its DIP coordinates: CSS px
//    times the interface scale (the view's zoom factor).
import {startApp,sleep} from './d-harness.mjs';

export async function startInactive({root,env={},width=1300,height=860}={}){
 delete process.env.D_VISIBLE;
 const app=await startApp({root,env:{ACIRA_BROWSER_TEST_HIDDEN:'1',...env}});
 try{
  const placed=await app.main(({BaseWindow},[width,height])=>{
   for(const window of BaseWindow.getAllWindows()){window.setFocusable(false);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);}
   const window=BaseWindow.getAllWindows()[0];window.setBounds({x:-20000,y:-20000,width,height});if(process.platform==='darwin'){for(const child of window.contentView.children)child.webContents?.setBackgroundThrottling(false);}else window.showInactive();
   return {bounds:window.getBounds(),focused:window.isFocused(),focusable:window.isFocusable(),visible:window.isVisible()};
  },[width,height]);
  if(placed.focused||placed.focusable||(process.platform==='darwin'?placed.visible:placed.bounds.x>-2000))throw Error(`Fixture window is not inactive and off screen: ${JSON.stringify(placed)}`);
  await frames(app);
  app.placed=placed;
  return app;
 }catch(error){await app.close();throw error;}
}

/** The interface draws frames (a shown window does; resolves once 6 animation frames ran, fails after 4 s). */
export const frames=app=>app.ui.evaluate(()=>new Promise((resolve,reject)=>{let count=0;const stop=setTimeout(()=>reject(Error('the interface draws no frames')),4000);const tick=()=>{if(++count>=6){clearTimeout(stop);resolve(document.visibilityState);}else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));

/** Focus guard: the fixture window never holds focus. */
export const focused=app=>app.main(({BaseWindow})=>BaseWindow.getAllWindows().some(window=>window.isFocused()));

/** One input event on the interface view, at CSS px (x, y) of the interface page. */
export function input(app,event){
 return app.main(({BaseWindow},event)=>{
  const collect=node=>[node,...(node.children||[]).flatMap(collect)];
  const view=collect(BaseWindow.getAllWindows()[0].contentView).find(item=>item.webContents?.getURL?.()==='acira-browser-ui://ui/index.html');
  if(!view)throw Error('no interface view');
  const zoom=view.webContents.getZoomFactor(),at=event.x===undefined?{}:{x:Math.round(event.x*zoom),y:Math.round(event.y*zoom)};
  view.webContents.sendInputEvent({...event,...at});
 },event);
}
/** Mouse helpers in CSS px. `held` marks moves made with the left button down (a drag). */
export function mouse(app){
 let at={x:0,y:0},held=false;
 const send=(type,x,y,extra={})=>{at={x,y};return input(app,{type,x,y,...extra});};
 return {
  get at(){return at;},
  move:(x,y)=>send('mouseMove',x,y,held?{button:'left',modifiers:['leftButtonDown']}:{}),
  down:async(x=at.x,y=at.y,button='left')=>{held=button==='left';await send('mouseDown',x,y,{button,clickCount:1});},
  up:async(x=at.x,y=at.y,button='left')=>{held=false;await send('mouseUp',x,y,{button,clickCount:1});},
  /** A move in steps (about one per frame), the way a hand drags. */
  async glide(x,y,steps=14,wait=16){const from=at;for(let i=1;i<=steps;i++){await this.move(from.x+(x-from.x)*i/steps,from.y+(y-from.y)*i/steps);await sleep(wait);}},
  /** Press and release at one point (no settle wait: the caller chooses when). */
  async click(x,y,button='left'){await this.move(x,y);await this.down(x,y,button);await this.up(x,y,button);},
  key:(keyCode,modifiers=[])=>input(app,{type:'keyDown',keyCode,modifiers}).then(()=>input(app,{type:'keyUp',keyCode,modifiers})),
 };
}

/** A node's box in CSS px once it has stopped moving (two equal reads 100 ms apart, at most 2.4 s). */
export async function settledBox(app,selector){
 let last=null;
 for(let i=0;i<24;i++){
  const next=await app.ui.evaluate(selector=>{const node=document.querySelector(selector);if(!node||!node.getClientRects().length)return null;const r=node.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height,moving:node.closest('.acira-sidebar')?[node,...node.querySelectorAll('*')].some(item=>item.getAnimations().some(animation=>animation.playState==='running')):false};},selector);
  if(next&&last&&!next.moving&&Math.abs(next.x-last.x)<.5&&Math.abs(next.y-last.y)<.5&&Math.abs(next.width-last.width)<.5&&Math.abs(next.height-last.height)<.5)return next;
  last=next;await sleep(100);
 }
 if(!last)throw Error(`no box for ${selector}`);
 return last;
}

/** This app's own interface view, as drawn (capturePage), to a PNG file. */
export async function capture(app,file){
 const png=await app.main(async({webContents})=>{const ui=webContents.getAllWebContents().find(item=>item.getURL()==='acira-browser-ui://ui/index.html');const image=await ui.capturePage();return image.toPNG().toString('base64');});
 const fs=await import('node:fs/promises');await fs.writeFile(file,Buffer.from(png,'base64'));return file;
}
