'use strict';
// One quiet tip, once ever, so people find link preview (Peek) without a tour: after a few links opened as background tabs
// in one run of Acira, say that Alt-click or press-and-hold previews a link instead. Anyone who has used Peek never sees it.
// The text is the English of the catalog entry `peek.hint`, so the toast shows it in the app's language.
const fs=require('node:fs');
const path=require('node:path');
const TEXT='Preview links without opening a tab: Alt-click a link, or press and hold it.';

function createPeekHint({file,threshold=3}={}){
 let seen=read(),count=0;
 function read(){try{return JSON.parse(fs.readFileSync(file,'utf8')).seen===true;}catch{return false;}}
 function remember(){seen=true;try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({seen:true}));}catch{}}
 return {
  /** A link opened as a background tab. Calls show(text) once, on the threshold'th one, if Peek is still unknown. */
  note(show){if(seen)return false;count++;if(count<threshold)return false;remember();try{show(TEXT);}catch{}return true;},
  /** Peek was used: no tip, ever. */
  seen(){if(!seen)remember();},
  get done(){return seen;},
 };
}
let shared=null;
const sharedPeekHint=options=>shared??=createPeekHint(options);
module.exports={createPeekHint,sharedPeekHint,TEXT};
