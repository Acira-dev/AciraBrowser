'use strict';
// Runs on a worker thread (filter-updates.cjs buildEngineInWorker): compiles the filter lists and scriptlet resources into the serialized engine the browser loads.
// It uses the engine's core package, which has no Electron dependency, with the options the main process uses. Nothing here touches the network or the disk.
const {parentPort,workerData}=require('node:worker_threads'),{FiltersEngine}=require('@ghostery/adblocker');
try{
 const engine=FiltersEngine.parse(workerData.text,{enableCompression:true,loadNetworkFilters:true,loadCosmeticFilters:true,enableMutationObserver:true});
 if(workerData.resources)engine.updateResources(workerData.resources,workerData.checksum||'updated');
 // The rule count goes with the bytes: main checks the engine has rules without expanding every filter on its own thread (filter-updates.cjs checkCounted).
 const filters=engine.getFilters(),rules=filters.networkFilters.length+filters.cosmeticFilters.length;
 const serialized=engine.serialize(),bytes=new Uint8Array(serialized.length);bytes.set(serialized);
 parentPort.postMessage({bytes,rules},[bytes.buffer]);
}catch(error){parentPort.postMessage({error:String(error&&error.message||error)});}
