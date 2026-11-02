'use strict';
// Things that keep an idle Acira idle (docs/launch/LIGHTWEIGHT_RESULTS.md). The measured ones are in qa/d-lightweight.mjs; these hold the causes in place.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTabProgress}=require('../desktop/tab-progress.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
function fixture(){const sent=[],tasks=[];let current=true;const progress=createTabProgress({send:value=>sent.push(value),isCurrent:()=>current,setTimeout:(fn,ms)=>{const task={fn,ms,live:true};tasks.push(task);return task;},clearTimeout:task=>{if(task)task.live=false;}});return {progress,sent,run:()=>{const task=tasks.find(item=>item.live);if(!task)return false;task.live=false;task.fn();return true;},gone:()=>{current=false;}};}

test('a tab shown in the middle of a load is handed the progress it missed',()=>{
  const f=fixture();f.progress.begin('https://a.test/');assert.deepEqual(f.sent,[.1]);assert.ok(f.run());assert.ok(f.sent.at(-1)>.1);
  const before=f.sent.length;f.progress.resend();assert.equal(f.sent.length,before+1);assert.equal(f.sent.at(-1),f.progress.progress);
});
test('resend says nothing when nothing is loading or the page is gone',()=>{
  const f=fixture();f.progress.resend();assert.deepEqual(f.sent,[]);
  f.progress.begin('https://a.test/');f.gone();const count=f.sent.length;f.progress.resend();assert.equal(f.sent.length,count);
});
test('progress stops ticking once a stage is capped: it sleeps until a real event',()=>{
  const f=fixture();f.progress.begin('https://a.test/');let ticks=0;while(f.run()&&ticks<200)ticks++;
  assert.ok(ticks<200,'the timer must stop on its own');assert.ok(f.progress.progress<=.35+1e-9);
});

test('hidden tabs do not broadcast progress; the interface hears only that they started loading',()=>{
  const main=read('desktop/main.cjs');
  assert.ok(main.includes("if(entry.view.getVisible()||!loading){entry.hiddenLoading=undefined;send({progress,loading});}else if(entry.hiddenLoading!==true){entry.hiddenLoading=true;send({progress:undefined,loading:true});}"),'a hidden tab sends one loading flag, not 5 ticks a second');
  assert.match(main,/if\((?:visible|shown)\)entry\.progress\?\.resend\?\.\(\);/,'and a tab that becomes visible mid-load gets its value');
});
test('the browser UI view throttles when the window cannot be seen; the overlay keeps its frames (its show handshake runs before it is visible)',()=>{
  const main=read('desktop/main.cjs');
  assert.ok(main.includes("backgroundThrottling:kind==='browser'&&(!process.env.ACIRA_BROWSER_TEST_DATA||process.env.ACIRA_PERF==='1'),spellcheck:false,v8CacheOptions:'bypassHeatCheck'"));
  assert.ok(main.includes("else if(app.isPackaged)Menu.setApplicationMenu(null);"),'a released build builds no native menu');
});

test('the first start of a profile closes its splash before it quits to commit the native key (a splash left open held that quit for 20 seconds)',()=>{
  assert.ok(read('desktop/main.cjs').includes("if(!secureStartup.ready){if(secureStartup.restarting)closeSplash();"));
});

test('a load that never finishes does not repaint the interface at every frame (idle GPU process 14% -> 5% with ten real sites)',()=>{
  const progress=read('src/components/NavigationProgress.tsx')+read('src/ui/navigationLine.ts'),dots=read('src/components/DotMatrix.tsx');
  assert.ok(progress.includes('export const CALM_MS = 6000;')&&progress.includes('if (state.animating(now)) frame.current = requestAnimationFrame')&&progress.includes('animating(now: number) { return this.active && !this.calm(now); }'),'the progress glow rests after six quiet seconds instead of redrawing a blurred glow forever');
  assert.ok(dots.includes('now - lastPaint >= GAP_MS - 4')&&dots.includes('GAP_MS = 32')&&dots.includes('window.setTimeout(() => { frame = requestAnimationFrame(loop); }, EARLY_MS)'),'tab loading dots are painted at about 30 per second, woken by a timer ahead of the frame');
});
test('no renderer is kept for cookies: the cookie reader page is made on use and closed a second after the read (R4-37: on real sites the 20 s linger kept it for good)',()=>{
  const source=read('desktop/browser-services/session-cookie-restore.cjs');
  assert.ok(source.includes('idle=setTimeout(release,READER_LINGER_MS)')&&source.includes('READER_LINGER_MS=1000;')&&source.includes('CAPTURE_DELAY_MS=10000,')&&!source.includes("view=new WebContentsView({webPreferences:{session,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}}),wc=view.webContents;"));
});
