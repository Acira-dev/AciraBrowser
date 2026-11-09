'use strict';
// A QA entry (like mac-interface-entry.cjs) that can make a window's restore slow: globalThis.__restoreDelay (ms), set from the test, holds every saved-window read
// that long, so a window stays "starting" (its state still the empty default) while the test asks for another switch.
const path=require('node:path');
const saved=require(path.resolve(path.dirname(path.resolve(process.env.ACIRA_QA_MAIN||'desktop/main.cjs')),'saved-window.cjs'));
const real=saved.readSavedWindow;
saved.readSavedWindow=async(...args)=>{const wait=Number(globalThis.__restoreDelay)||0;if(wait)await new Promise(resolve=>setTimeout(resolve,wait));return real.apply(saved,args);};
require('./mac-interface-entry.cjs');
