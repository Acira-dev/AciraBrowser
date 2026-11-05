'use strict';
// Bridges and pluggable transports for Acira's Tor, as Tor Browser 15 ships them: the transport clients (lyrebird for obfs4,
// meek, WebTunnel and Snowflake; conjure-client for Conjure) beside tor.exe, the ClientTransportPlugin lines and built-in
// bridges of Tor Browser's pt_config.json (tor-engine/pt_config.json, a verbatim copy from Tor Browser 15.0.25), and the person's
// choice in <userData>/tor/bridges.json: off, a built-in type, or bridges they know (validated here, line by line).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const PT_CONFIG=require('./tor-engine/pt_config.json');
const manifest=require('./tor-engine/tor-version.json');

// Tor Browser's built-in bridge dialog lists obfs4 first (pt_config.json recommendedDefault), then Snowflake, then meek.
const BUILTIN_TYPES=['obfs4','snowflake','meek'].filter(type=>Array.isArray(PT_CONFIG.bridges?.[type])&&PT_CONFIG.bridges[type].length);
// Transports a bridge line may name, and the client that speaks each (pt_config.json "pluggableTransports").
const TRANSPORT_CLIENT={obfs4:'lyrebird',meek_lite:'lyrebird',webtunnel:'lyrebird',snowflake:'snowflake',conjure:'conjure'};
const PT_FOLDER='pluggable_transports',MAX_LINES=32,MAX_LINE=2000;
const MODES=['off','builtin','custom'];

/** The plugin lines with Tor Browser's ${pt_path} pointed at our folder, relative to tor's working directory (the bundled tor
 * folder): a path with a space (C:\Program Files\…) can't be written in a ClientTransportPlugin line, which tor splits on spaces. */
function pluginLines(platform=process.platform){
 return Object.entries(PT_CONFIG.pluggableTransports||{}).map(([client,line])=>{
  const m=/^ClientTransportPlugin (\S+) exec \$\{pt_path\}(\S+\.exe)(.*)$/.exec(String(line));if(!m)return null;
  const exe=platform!=='win32'?m[2].replace(/\.exe$/,''):m[2],separator=platform!=='win32'?'/':'\\';
  return {client,transports:m[1].split(','),exe,value:`${m[1]} exec ${PT_FOLDER}${separator}${exe}${m[3]}`};
 }).filter(Boolean);
}
/** Where the transport clients live: <resources>/tor/pluggable_transports in an installed app, tor-engine/win-x64/pluggable_transports in development. */
function transportDirectory({resourcesPath=process.resourcesPath,platform=process.platform,arch=process.arch}={}){
 const candidates=[resourcesPath&&path.join(resourcesPath,'tor',PT_FOLDER),path.join(__dirname,'..','..','resources','tor',PT_FOLDER),path.join(__dirname,'tor-engine',platform==='win32'?'win-x64':platform+'-'+arch,PT_FOLDER)].filter(Boolean);
 return candidates.find(dir=>{try{return fs.statSync(path.join(dir,platform!=='win32'?'lyrebird':'lyrebird.exe')).isFile();}catch{return false;}})||null;
}
const PINS=manifest.pluggableTransports?.files||{};
/** SHA-256 pins of the transport clients (tor-version.json "pluggableTransports"), by file name. */
const transportPins=({platform=process.platform,arch=process.arch,directory}={})=>{
 if(platform==='linux'){const dir=directory||transportDirectory({platform,arch}),native=dir&&require('./tor-linux.cjs').readLinuxTor(path.join(path.dirname(dir),'tor'),{arch});return native?Object.fromEntries(Object.entries(native.record.files).filter(([name])=>name.startsWith(PT_FOLDER+'/')&&!name.includes('LICENSE')).map(([name,digest])=>[path.basename(name),digest])):{};}
 if(platform!=='darwin')return Object.fromEntries(Object.entries(PINS).filter(([name])=>name.endsWith('.exe')).map(([name,entry])=>[path.basename(name),entry.sha256]));
 const dir=directory||transportDirectory({platform,arch}),native=dir&&require('./tor-mac.cjs').readMacTor(path.join(path.dirname(dir),'tor'),{arch});
 return native?Object.fromEntries(Object.entries(native.record.files).filter(([name])=>name.startsWith(PT_FOLDER+'/')).map(([name,digest])=>[path.basename(name),digest])):{};
};

const ipv4=host=>net.isIP(host)===4&&host.split('.').every(part=>String(Number(part))===part);
/** One bridge line, as Tor Browser accepts it (TorParsers.parseBridgeLine) but stricter: a known transport, an IP:port tor can
 * use without resolving anything, an optional 40-hex fingerprint, then key=value arguments; obfs4 needs cert and iat-mode,
 * meek and WebTunnel need an https url. Returns {line} normalised, or {error} with a code the UI words. */
function parseBridgeLine(raw){
 let text=String(raw||'').trim().replace(/^bridge\s+(?=\S)/i,'').replace(/\s+/g,' ');
 if(!text)return {empty:true};
 if(text.length>MAX_LINE)return {error:'long'};
 if(/[\u0000-\u001f"'`\\]/.test(text))return {error:'characters'};
 const parts=text.split(' ');let transport='';
 if(!/^[[\d]/.test(parts[0])){transport=parts.shift().toLowerCase();if(transport==='meek')transport='meek_lite';if(!TRANSPORT_CLIENT[transport])return {error:'transport',transport};}
 const address=parts.shift()||'',m=/^(?:\[([0-9a-f:]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})$/i.exec(address);
 if(!m||!(m[1]?net.isIP(m[1])===6:ipv4(m[2]))||!(Number(m[3])>=1&&Number(m[3])<=65535))return {error:'address'};
 let fingerprint='';if(parts[0]&&/^\$?[0-9a-f]{40}$/i.test(parts[0]))fingerprint=parts.shift().replace(/^\$/,'').toUpperCase();
 else if(parts[0]&&!parts[0].includes('='))return {error:'fingerprint'};
 const args={};for(const part of parts){const kv=/^([A-Za-z0-9_-]+)=(\S*)$/.exec(part);if(!kv)return {error:'argument'};args[kv[1].toLowerCase()]=kv[2];}
 if(transport==='obfs4'&&(!args.cert||!/^[0-2]$/.test(args['iat-mode']||'')))return {error:'obfs4'};
 if((transport==='webtunnel'||transport==='meek_lite')&&!/^https:\/\/\S+$/i.test(args.url||''))return {error:transport==='webtunnel'?'webtunnel':'meek'};
 if(!transport&&parts.length)return {error:'argument'};
 return {line:[transport,address,fingerprint,...parts].filter(Boolean).join(' '),transport:transport||'vanilla'};
}
/** Every line of a pasted block: the valid bridges, and the errors by line number (counting from 1, as Tor Browser shows them). */
function parseBridgeLines(text){
 const lines=[],errors=[],seen=new Set();let count=0;
 String(text||'').split(/\r?\n/).forEach((raw,index)=>{if(/^\s*#/.test(raw))return;const parsed=parseBridgeLine(raw);if(parsed.empty)return;count++;
  if(parsed.error){errors.push({line:index+1,code:parsed.error,...(parsed.transport?{transport:parsed.transport}:{})});return;}
  if(!seen.has(parsed.line)){seen.add(parsed.line);lines.push(parsed.line);}});
 if(count>MAX_LINES)errors.push({line:0,code:'many'});
 return {lines,errors,empty:count===0};
}
const shuffle=list=>{const out=[...list];for(let i=out.length-1;i>0;i--){const j=crypto.randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;};

/** The person's bridge choice, kept beside tor's data (never with any site's data). */
function createBridgeSettings({userData}){
 const file=userData?path.join(userData,'tor','bridges.json'):'';
 const read=()=>{try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));const mode=MODES.includes(saved.mode)?saved.mode:'off';
  return {mode,builtin:BUILTIN_TYPES.includes(saved.builtin)?saved.builtin:BUILTIN_TYPES[0],custom:Array.isArray(saved.custom)?parseBridgeLines(saved.custom.join('\n')).lines:[]};}catch{return {mode:'off',builtin:BUILTIN_TYPES[0],custom:[]};}};
 let current=read();
 return {
  get:()=>({...current,custom:[...current.custom]}),
  /** Validates and saves; throws an Error with `code` and `errors` (by line) when the choice can't be used. */
  set(next={}){
   const mode=MODES.includes(next.mode)?next.mode:null;if(!mode)throw Object.assign(new Error('Choose off, a built-in bridge or bridges you know.'),{code:'mode'});
   const builtin=next.builtin===undefined?current.builtin:next.builtin;if(!BUILTIN_TYPES.includes(builtin))throw Object.assign(new Error('Unknown built-in bridge.'),{code:'builtin'});
   let custom=current.custom;
   if(next.custom!==undefined){const parsed=parseBridgeLines(Array.isArray(next.custom)?next.custom.join('\n'):next.custom);if(parsed.errors.length)throw Object.assign(new Error('Some bridge lines can’t be used.'),{code:'invalid',errors:parsed.errors});custom=parsed.lines;}
   if(mode==='custom'&&!custom.length)throw Object.assign(new Error('Add at least one bridge.'),{code:'empty',errors:[]});
   const saved={mode,builtin,custom};
   if(file){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(saved));fs.renameSync(temp,file);}
   current=saved;return this.get();
  },
  file,
 };
}
/** The bridge lines tor gets for a choice: a built-in type's lines in a fresh random order each start (as Tor Browser does), or the person's own. */
function bridgeLines(choice){
 if(!choice||choice.mode==='off')return [];
 if(choice.mode==='builtin')return shuffle(PT_CONFIG.bridges[choice.builtin]||[]);
 return [...(choice.custom||[])];
}
/** The transport a bridge line names ('vanilla' for a plain relay address). */
const transportOf=line=>{const first=String(line).split(' ')[0];return /^[[\d]/.test(first)?'vanilla':first;};
/** The plugin lines a set of bridge lines needs (vanilla bridges need none). */
const pluginsFor=(lines,platform)=>{const used=new Set(lines.map(transportOf));return pluginLines(platform).filter(plugin=>plugin.transports.some(transport=>used.has(transport)));};
/** Which transport clients a set of lines needs, by executable name. */
const neededClients=(lines,platform)=>new Set(pluginsFor(lines,platform).map(plugin=>plugin.exe));
/** tor command-line options for these bridge lines: UseBridges, one ClientTransportPlugin per plugin line they need, one Bridge each. */
function bridgeArguments(lines,platform){
 if(!lines?.length)return [];
 const args=['--UseBridges','1'];
 for(const plugin of pluginsFor(lines,platform))args.push('--ClientTransportPlugin',plugin.value);
 for(const line of lines)args.push('--Bridge',line);
 return args;
}
/** What a running Tor is using, for the connect page and the chip: off, or the kind of bridge and how many lines. */
function bridgeSummary(choice,lines){
 if(!lines?.length)return null;
 const kinds=[...new Set(lines.map(transportOf))];
 return {mode:choice.mode,type:choice.mode==='builtin'?choice.builtin:kinds.length===1?(kinds[0]==='meek_lite'?'meek':kinds[0]):'mixed',count:lines.length};
}
/** Public view for Settings and the connect page: the choice, the built-in types with their bridge counts, and whether the clients are installed. */
function publicBridges(choice,{installed=false}={}){
 return {mode:choice.mode,builtin:choice.builtin,custom:[...choice.custom],types:BUILTIN_TYPES.map(id=>({id,count:PT_CONFIG.bridges[id].length})),recommended:PT_CONFIG.recommendedDefault||'obfs4',installed};
}
module.exports={createBridgeSettings,parseBridgeLine,parseBridgeLines,bridgeLines,bridgeArguments,bridgeSummary,neededClients,transportOf,publicBridges,pluginLines,transportDirectory,transportPins,TOR_BUILTIN_BRIDGE_TYPES:BUILTIN_TYPES,TOR_PT_FOLDER:PT_FOLDER,TOR_PT_CONFIG:PT_CONFIG};
