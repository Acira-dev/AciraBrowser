// Exercise the real native image backend with a controlled chooser. No window,
// user profile, desktop input or personal file is opened by this fixture.
const {app,nativeImage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {createWorkspaceArtwork}=require('../desktop/workspace-artwork.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'acira-artwork-store-'));
app.setPath('userData',directory);app.setPath('sessionData',directory);
const original=path.resolve(__dirname,'../public/artwork/met-436535.jpg');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=folder=>fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(folder,item.name)):[path.relative(directory,path.join(folder,item.name))]).sort():[];
let checks=0,choice=null;
const verify=(value,message)=>{assert.ok(value,message);checks++;};
app.whenReady().then(async()=>{
 try{
  const originalHash=hash(original),options={root:path.join(directory,'store'),nativeImage,dialog:{showOpenDialog:async()=>choice?{canceled:false,filePaths:[choice]}:{canceled:true,filePaths:[]}}};
  const store=createWorkspaceArtwork(options),scope=store.createScope({profileId:'ordinary'});
  verify((await scope.importImage()).cancelled&&scope.list().assets.length===0,'Cancel retains an empty profile');
  choice=original;const added=await scope.importImage(),asset=added.assets[0],capability=new URL(asset.url);
  verify(!!added.addedId&&asset.id===added.addedId,'Native chooser imports a real JPEG');
  const response=store.response(capability);
  verify(response?.mime==='image/jpeg'&&!nativeImage.createFromBuffer(response.bytes).isEmpty(),'The capability decodes to the imported copy');
  verify(hash(original)===originalHash,'The original image is unchanged');
  verify(store.response(new URL(asset.url+'?other=1'))===null,'Capabilities reject additional query data');
  verify(store.response(new URL(asset.url.replace('://ui/','://other/')))===null,'Capabilities reject another host');
  const other=store.createScope({profileId:'other'});verify(other.list().assets.length===0,'Another profile has no imported images');other.dispose();
  const restarted=createWorkspaceArtwork(options),restored=restarted.createScope({profileId:'ordinary'});
  verify(restored.list().assets[0]?.id===asset.id,'An ordinary copy survives a new backend instance');
  verify(!!restarted.response(new URL(restored.list().assets[0].url)),'A restored copy gets a working new capability');
  scope.dispose();verify(store.response(capability)===null,'Closing the scope revokes its old capability');
  const beforePrivate=JSON.stringify(files(path.join(directory,'store'))),privateScope=store.createScope({profileId:'private',privateMode:true});
  const privateAsset=(await privateScope.importImage()).assets[0],privateURL=new URL(privateAsset.url);
  verify(!!store.response(privateURL),'A private image has a window-owned capability');
  verify(JSON.stringify(files(path.join(directory,'store')))===beforePrivate,'Private images create no persistent files');
  privateScope.dispose();verify(store.response(privateURL)===null,'Private closure revokes the image capability');
  restored.remove(asset.id);verify(restored.list().assets.length===0&&hash(original)===originalHash,'Removal deletes only the imported copy');restored.dispose();
  const bad=path.join(directory,'invalid.jpg');fs.writeFileSync(bad,'Not an image');choice=bad;
  const malformed=store.createScope({profileId:'invalid'});await assert.rejects(malformed.importImage());checks++;malformed.dispose();
  console.log(JSON.stringify({passed:true,checks,scope:'Real native image import/copy, persistence, profile isolation, private memory and capability revocation; controlled chooser, no UI input.'}));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{app.quit();}
});
app.on('will-quit',()=>fs.rmSync(directory,{recursive:true,force:true}));
