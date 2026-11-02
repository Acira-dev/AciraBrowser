'use strict';
// CSV import/export for passwords. Import is the ONLY way other browsers' passwords come in: the user exports from Chrome, Edge
// or Brave's own password page and picks the file. Chrome/Edge/Brave columns: name,url,username,password[,note].
// Also accepted: Bitwarden/1Password/Firefox-style headers. Bounded and strict: nothing is executed or rendered.
const {normalizeOrigin}=require('./origin-match.cjs');
const {tr}=require('./text.cjs');
const LIMITS={bytes:8*1024*1024,rows:20000,origin:2048,username:512,password:1024,note:4096};

/** RFC 4180 parser: quotes, doubled quotes, CRLF/LF/CR, embedded newlines, UTF-8 BOM. Returns array of rows (arrays of strings). */
function parseCsv(text){
 if(typeof text!=='string')throw new Error(tr('pw.csv.notText','Not a text file.'));
 if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
 const rows=[];let row=[],field='',quoted=false,i=0;const n=text.length;
 while(i<n){
  const ch=text[i];
  if(quoted){
   if(ch==='"'){if(text[i+1]==='"'){field+='"';i+=2;continue;}quoted=false;i++;continue;}
   field+=ch;i++;continue;
  }
  if(ch==='"'&&field===''){quoted=true;i++;continue;}
  if(ch===','){row.push(field);field='';i++;continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.length>1||row[0]!=='')rows.push(row);row=[];i++;if(rows.length>LIMITS.rows+1)throw new Error('Too many rows.');continue;}
  field+=ch;i++;
 }
 if(field!==''||row.length){row.push(field);if(row.length>1||row[0]!=='')rows.push(row);}
 return rows;
}
const HEADER_ALIASES={
 url:['url','login_uri','website','web site','origin','address','login url'],
 username:['username','login_username','user name','user','login','email','e-mail','account'],
 password:['password','login_password','pass'],
 note:['note','notes','extra','comments','comment'],
 name:['name','title','label'],
};
function columnMap(header){
 const lower=header.map(cell=>String(cell).trim().toLowerCase()),map={};
 for(const [key,aliases] of Object.entries(HEADER_ALIASES)){const index=lower.findIndex(cell=>aliases.includes(cell));if(index>=0)map[key]=index;}
 return map;
}
function toOrigin(raw){
 let value=String(raw||'').trim();if(!value)return null;
 if(/^(?:javascript|data|vbscript|file|blob|about|chrome|acira|mailto|tel|view-source|ftp|ws|wss):/i.test(value))return null;
 if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)){if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^[^/]+:\d+(\/|$)/.test(value))return null;value='https://'+value;}
 return normalizeOrigin(value);
}
/** -> {entries:[{origin,username,password,note}], skipped, reasons:{...}} or throws {message} for an unreadable file. */
function parseLogins(text){
 if(typeof text!=='string')throw new Error(tr('pw.csv.notText','Not a text file.'));
 if(Buffer.byteLength(text,'utf8')>LIMITS.bytes)throw new Error(tr('pw.err.tooLarge','This file is larger than 8 MB.'));
 const rows=parseCsv(text);if(rows.length<2)throw new Error(tr('pw.csv.empty','This file has no passwords in it.'));
 const map=columnMap(rows[0]);
 if(map.url===undefined||map.password===undefined)throw new Error(tr('pw.csv.notPasswords','This doesn’t look like a passwords file. It needs website and password columns.'));
 const entries=[],reasons={invalid:0,empty:0,tooLong:0};
 for(const row of rows.slice(1)){
  const cell=index=>index===undefined?'':String(row[index]??'');
  const origin=toOrigin(cell(map.url)),username=cell(map.username),password=cell(map.password),note=cell(map.note);
  if(!origin){reasons.invalid++;continue;}
  if(!password){reasons.empty++;continue;}
  if(origin.length>LIMITS.origin||username.length>LIMITS.username||password.length>LIMITS.password||note.length>LIMITS.note){reasons.tooLong++;continue;}
  entries.push({origin,username,password,note});
 }
 return {entries,skipped:reasons.invalid+reasons.empty+reasons.tooLong,reasons};
}
const quote=value=>{const s=String(value??'');return /[",\r\n]/.test(s)||s!==s.trim()?`"${s.replace(/"/g,'""')}"`:s;};
/** Chrome-compatible export. entries: [{origin,username,password,note}]. */
function exportLogins(entries){
 const lines=['name,url,username,password,note'];
 for(const entry of entries){let name=entry.origin;try{name=new URL(entry.origin).host.replace(/^www\./,'');}catch{}lines.push([name,entry.origin,entry.username,entry.password,entry.note].map(quote).join(','));}
 return lines.join('\r\n')+'\r\n';
}
module.exports={parseCsv,parseLogins,exportLogins,LIMITS};
