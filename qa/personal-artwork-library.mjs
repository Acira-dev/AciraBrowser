// Exercises the real local image store and Settings gallery on a disposable
// profile. Only the OS chooser is supplied fixture paths; no user data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startApp, poll, sleep} from './d-harness.mjs';

const root=path.resolve('.qa-profiles/personal-artwork-library-'+Date.now());
const out=path.resolve(process.env.ACIRA_ARTWORK_LIBRARY_OUT||path.join(root,'evidence'));
await fs.mkdir(root,{recursive:true});
await fs.mkdir(out,{recursive:true});
const originals=[];
for (const [index,name] of ['met-436229.jpg','aic-47582.jpg'].entries()) {
  const file=path.join(root,`My image ${index+1}.jpg`);
  const bytes=await fs.readFile(path.resolve('public/artwork/catalog-v2',name));
  await fs.writeFile(file,bytes); originals.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const report={checks:[],geometry:[]};let app;
const prefs=()=>app.ui.evaluate(async()=>JSON.parse(localStorage.getItem('acira-new-tab:'+(await window.acira.getSnapshot()).activeBrowserProfileId)||'{}'));
const library=()=>app.ui.locator('.nt-personal-library');
const group=()=>library().getByRole('radiogroup',{name:'My artworks'});
const collection=()=>app.ui.locator('[data-setting="newtab-collection"]');
try {
  app=await startApp({root,env:{ACIRA_TEST_QUIET_NETWORK:'1'}});
  await app.main(({BaseWindow})=>{
    const win=BaseWindow.getAllWindows()[0];
    win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setSkipTaskbar(true);
    win.setBounds({x:-20000,y:-20000,width:1352,height:900});
    if(win.getBounds().x>-2000)throw Error('Fixture must remain offscreen');
    win.showInactive();
    if(win.isFocused())throw Error('Fixture must not take user focus');
  });
  await app.act({type:'settings.update',patch:{language:'en',appearance:'dark',interfaceScale:100,verticalTabs:true}});
  await app.act({type:'tab.new',url:'acira://settings'});
  await app.ui.locator('.bs-sidebar nav button[aria-label="Appearance"]').click();
  await library().locator('summary').click();
  for(const [index,{file}] of originals.entries()) {
    await app.main(({dialog},file)=>{globalThis.__libraryChooser=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    let imported;
    try {await library().getByRole('button',{name:'Choose an image…',exact:true}).click();imported=await poll(()=>app.svc({type:'artwork.list'}),result=>result.artwork.assets.length===index+1,'real image import');}
    finally {await app.main(({dialog})=>{dialog.showOpenDialog=globalThis.__libraryChooser;delete globalThis.__libraryChooser;});}
    const added=imported.artwork.assets.find(asset=>asset.name===path.basename(file));
    assert.ok(added,'imported image is in the local library');
    await poll(()=>prefs(),value=>value.artwork==='personal:'+added.id,'import selects personal image');
  }
  assert.equal(await group().getByRole('radio').count(),2);
  assert.equal(await collection().getByRole('radio',{name:'My artworks',exact:true}).getAttribute('aria-checked'),'true');
  assert.equal(await collection().getByRole('radio',{name:'Paintings',exact:true}).getAttribute('aria-checked'),'false');
  assert.equal(await app.ui.locator('[data-setting="newtab-artwork"]').count(),0,'Local choice is not presented as a painting');
  await poll(()=>group().locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),Boolean,'real local thumbnail decoding');
  report.checks.push('Two real imports decode as local thumbnail cards; My artworks selected instead of Paintings');
  await group().getByRole('radio').first().click();const first=(await prefs()).artwork;
  await group().getByRole('radio').first().press('End');
  assert.notEqual((await prefs()).artwork,first,'Arrow/Home/End navigation selects a different actual image');
  await group().getByRole('radio').last().press('Home');assert.equal((await prefs()).artwork,first);
  await library().locator('summary').click();await sleep(350);
  assert.equal(await library().locator('details').evaluate(node=>node.open),false);
  await library().locator('summary').click();await sleep(350);
  await app.ui.reload();await library().locator('summary').waitFor();
  await poll(()=>group().getByRole('radio',{checked:true}).count(),count=>count===1,'local selection restored after renderer reload');
  assert.equal((await prefs()).artwork,first);assert.equal((await app.svc({type:'artwork.list'})).artwork.assets.length,2);
  report.checks.push('Keyboard selection, collapse/reopen and selection persistence after reload');
  for(const [appearance,interfaceScale] of [['dark',100],['light',150]]) {
    await app.act({type:'settings.update',patch:{appearance,interfaceScale}});await sleep(300);
    await library().scrollIntoViewIfNeeded();
    await poll(()=>group().locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),Boolean,'visible local thumbnails decode after reload');
    await group().locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
    await app.ui.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
    // Native capturePage needs the compositor commit after decoded local textures.
    await sleep(150);
    const bounds=await group().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth,cards:[...node.querySelectorAll('[role=radio]')].map(card=>card.getBoundingClientRect().toJSON())}));
    assert.ok(bounds.scroll<=bounds.width+1,'gallery has no horizontal overflow');
    assert.equal(await library().locator('button button').count(),0,'remove controls are outside radio buttons');
    report.geometry.push({appearance,interfaceScale,...bounds});
    const shot=await app.main(async({webContents})=>(await webContents.getAllWebContents().find(contents=>contents.getURL()==='acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(out,`${appearance}-${interfaceScale}.png`),Buffer.from(shot,'base64'));
  }
  report.checks.push('Matching thumbnail geometry in dark100/light150; independent accessible remove buttons');
  await library().getByRole('button',{name:'Remove personal image My image 1.jpg',exact:true}).click();
  await poll(()=>app.svc({type:'artwork.list'}),result=>result.artwork.assets.length===1,'selected imported copy removed');
  await poll(()=>prefs(),value=>!value.artwork.startsWith('personal:'),'selected deletion restores a built-in painting');
  await collection().getByRole('radio',{name:'My artworks',exact:true}).click();
  await poll(()=>prefs(),value=>value.artwork.startsWith('personal:'),'collection card opens remaining local artwork');
  await library().getByRole('button',{name:'Remove personal image My image 2.jpg',exact:true}).click();
  await poll(()=>app.svc({type:'artwork.list'}),result=>result.artwork.assets.length===0,'last imported copy removed');
  for(const item of originals)assert.equal(createHash('sha256').update(await fs.readFile(item.file)).digest('hex'),item.sha256,'source file unchanged');
  report.checks.push('Deleting selected/last local copies restores a valid cover and preserves both original files');
  report.status='PASS';
} catch(error) {report.status='FAIL';report.error=String(error);await app?.ui.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally {await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await app?.close();}
console.log(JSON.stringify({out,...report}));
