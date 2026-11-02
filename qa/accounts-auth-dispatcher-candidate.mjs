import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Reuse the exact frozen local proxy transport fixture with a staged central
// dispatcher. Never edit the frozen nine/five-file source batches to do this.
const root = process.cwd();
const broker = path.resolve(process.env.ACIRA_AUTH_DISPATCHER_CANDIDATE || "qa/artifacts/accounts-auth-dispatcher-candidate-20261024/website-auth-next.cjs");
assert.ok(broker.startsWith(root + path.sep));
const manifest = JSON.parse(await fs.readFile("docs/workstreams/accounts-proxy-auth-ready.json", "utf8"));
const fixturePath = "qa/accounts-proxy-auth.mjs";
const fixture = await fs.readFile(fixturePath, "utf8");
assert.equal(createHash("sha256").update(fixture).digest("hex"), manifest.hashes[fixturePath], "Frozen transport fixture changed");
const out = path.join(root, "qa/artifacts/accounts-auth-dispatcher-native-" + Date.now());
await fs.mkdir(out, { recursive: true });
const host = `const {app,BrowserWindow}=require('electron');const {BrowserDatabase}=require(${JSON.stringify(path.join(root, "desktop/database.cjs"))});const {createProxySettings}=require(${JSON.stringify(path.join(root, "desktop/browser-services/proxy-settings.cjs"))});const {createProxyAuthGuard}=require(${JSON.stringify(path.join(root, "desktop/accounts/proxy-auth.cjs"))});const {createWebsiteAuth}=require(${JSON.stringify(broker)});const {X509Certificate}=require('node:crypto');const path=require('node:path');
app.setPath('userData',process.env.ACIRA_PROXY_AUTH_DATA);app.setName('Acira isolated single auth dispatcher');app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{const database=new BrowserDatabase(path.join(app.getPath('userData'),'proxy.sqlite')),owners=new Map(),loads=new Map();let originChallenges=0;const service=createProxySettings({database,getContext:wc=>owners.get(wc.id),getWindow:ses=>[...owners.values()].find(o=>o.session===ses)?.window,dialog:{showMessageBox:async()=>({response:1})}});const guard=createProxyAuthGuard({status:ses=>service.status(ses),resolveOwner:wc=>owners.get(wc.id)});const broker=createWebsiteAuth({app,resolveOwner:wc=>owners.get(wc.id),proxyGuard:guard,publish:(_id,state)=>{if(state.requests.some(r=>r.kind==='origin'))originChallenges++;}});
async function make(id,privateMode=false){const window=new BrowserWindow({show:false,webPreferences:{partition:(privateMode?'':'persist:')+'proxy-auth-'+id,sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents;const owner={id,tabId:'tab-'+id,profileId:'profile-'+id,session:wc.session,privateMode,active:true,window};owners.set(wc.id,owner);window.on('closed',()=>{owner.active=false;owners.delete(wc.id);void broker.cancelOwner(id);});wc.session.setCertificateVerifyProc((details,callback)=>{let pinned=false;try{pinned=details.hostname==='proxy-secure.acira.test'&&new X509Certificate(details.certificate.data).fingerprint256===process.env.ACIRA_PROXY_FIXTURE_PIN;}catch{}callback(pinned?0:-3);});await service.attach(wc.session,'profile-'+id,privateMode);await wc.loadURL('about:blank');return wc;}
const a=await make('a'),b=await make('b'),p=await make('private',true);global.proxyAuthFixture={database,service,guard,owners,a,b,p,loads,broker,originChallenges:()=>originChallenges,async set(key,choice){const wc=this[key];if(!await broker.cancelSession(wc.session))throw Error('Native auth cache cleanup failed');return service.set(wc.session,choice);},start(key,url){const wc=this[key];loads.delete(key);void wc.loadURL(url).then(()=>loads.set(key,{loaded:true,title:wc.getTitle()}),()=>loads.set(key,{loaded:false}));},list(){return [...owners.values()].flatMap(owner=>broker.snapshot(owner.id).requests.map(request=>({...request,ownerId:owner.id,display:{kind:request.kind,origin:request.origin,destinationOrigin:request.destinationOrigin,host:request.host,port:request.port}})));},async answer(ownerId,id,credentials){const result=await broker.respond(ownerId,{id,action:credentials?'submit':'cancel',...(credentials||{})});return result.ok;},async closePrivate(){const wc=this.p;if(!await broker.cancelOwner('private'))throw Error('Private auth cache cleanup failed');service.release(wc.session);this.oldPrivateSession=wc.session;BrowserWindow.fromWebContents(wc).destroy();}};
});`;
const start = fixture.indexOf("await fs.writeFile(\n  entry,");
const end = fixture.indexOf("const selected =", start);
assert.ok(start >= 0 && end > start, "Expected native entry boundaries");
let generated = fixture.slice(0, start) + "await fs.writeFile(entry," + JSON.stringify(host) + ");\n" + fixture.slice(end);
const replace = (before, after) => {
  assert.equal(generated.split(before).length, 2, "Expected one fixture marker: " + before.slice(0, 60));
  generated = generated.replace(before, after);
};
replace('"./native-helpers.mjs"', JSON.stringify(pathToFileURL(path.join(root, "qa/native-helpers.mjs")).href));
replace("const before = Object.fromEntries(", "selected.push(" + JSON.stringify(path.relative(root, broker).replaceAll(path.sep, "/")) + ");\nconst before = Object.fromEntries(");
replace('await start("b", forward("/origin-auth"));\n  await load("b");', 'await start("b", forward("/origin-auth"));\n  const originRequest = await challenge("b");\n  assert.equal(originRequest.display.kind,"origin");\n  assert.equal(originRequest.display.origin,"http://proxy-target.acira.test:"+originPort);\n  await answer("b",originRequest);\n  await load("b");');
replace("singleQaLoginDispatcher: true,", "singleQaLoginDispatcher: true,\n    centralDispatcherCandidate: true,");
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(path.join(out, "provenance.json"), JSON.stringify({ broker, brokerSha256: createHash("sha256").update(await fs.readFile(broker)).digest("hex"), fixture: fixturePath, frozenFixtureSha256: manifest.hashes[fixturePath], generatedScript: script, sourceFilesModified: false, scope: "QA-only staged central dispatcher; actual shared product main/UI remain separate" }, null, 2));
console.log("Staged dispatcher native provenance: " + out);
await import(pathToFileURL(script).href);
