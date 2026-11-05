'use strict';
const {t}=require('./tx.cjs');
// Tor engine for private windows with Tor (stream N): the official Tor Expert Bundle tor.exe, started on demand and
// stopped when the last Tor window lets go. Launch flags follow Brave (brave-core@1e6f002
// components/services/tor/tor_launcher_impl.cc): own DataDirectory, control port + cookie written to a run folder,
// __OwningControllerProcess + TAKEOWNERSHIP so tor never outlives Acira; torrc defaults follow Tor Browser 15.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const manifest=require('./tor-engine/tor-version.json');
const {readMacTor}=require('./tor-mac.cjs');
const {readLinuxTor}=require('./tor-linux.cjs');
const {createTorMoat}=require('./tor-moat.cjs');
const {createBridgeSettings,bridgeLines,bridgeArguments,bridgeSummary,neededClients,publicBridges,parseBridgeLines,transportDirectory,transportPins}=require('./tor-bridges.cjs');

// A first run downloads ~9,000 relay descriptors: measured 87 s here, with tor silent for 40 s at 50%. Later runs reuse the cache.
// Tor Browser has no time limit at all (tor keeps going until the person cancels); a slow network that is still making progress must
// not end in an error, so the overall limit is only a backstop. Hangs are caught by the stall limit instead, and re-routed (SLOW_RESTARTS).
const CONNECT_TIMEOUT=600000,STALL_TIMEOUT=120000,CONTROL_FILE_TIMEOUT=20000;
// Through a bridge the directory download is far slower: meek (domain fronting through a CDN) measured here sat at 50% for over
// two minutes without a log line before moving on. Bridges get longer limits; a blocked bridge is still caught early (BLOCKED_AFTER).
const BRIDGE_CONNECT_TIMEOUT=600000,BRIDGE_STALL_TIMEOUT=300000;
// The first consensus (3 MB) comes from ONE fallback relay picked at random. When that relay is slow or hangs, tor sits silent at 30% and
// takes minutes to give up on it (qa/r10-tor-fresh-*.mjs: 2 of 10 fresh bootstraps stalled there, one in each build, at the same moment).
// Past the first handshake the network is clearly not blocking Tor, so a stall restarts tor on a new random relay, with the connect
// page still saying it is connecting; the data folder is kept. Before the consensus has loaded (under 40%) a stall is 60 s.
const SLOW_RESTARTS=3,EARLY_STALL=60000,EARLY_PROGRESS=40;
// tor's own limit: one applied SIGNAL NEWNYM per 10 s (MAX_SIGNEWNYM_RATE); the margin is how long we wait past it for tor's confirmation.
const NEWNYM_RATE=10000,NEWNYM_MARGIN=4000;

/** The one place that knows the engine's file name and folder: tor.exe in win-x64 today; a macOS build would name its own binary here (`tor`, platform folder). */
const ENGINE={name:process.platform==='win32'?'tor.exe':'tor',folder:process.platform==='win32'?'win-x64':process.platform+'-'+process.arch};
function torExecutable({resourcesPath=process.resourcesPath}={}){
 const candidates=[resourcesPath&&path.join(resourcesPath,'tor',ENGINE.name),path.join(__dirname,'../../resources/tor',ENGINE.name),path.join(__dirname,'tor-engine',ENGINE.folder,ENGINE.name)].filter(Boolean);
 return candidates.find(file=>{try{return fs.statSync(file).isFile();}catch{return false;}})||null;
}
// Tor Browser 15's SOCKS port flags (extensions.torlauncher.socks_port_flags): per-site circuits keyed on the SOCKS username and
// password (IsolateSOCKSAuth is tor's default; KeepAliveIsolateSOCKSAuth keeps those circuits alive while used), onion-service
// error codes for clear errors (ExtendedErrors), and exits that may use IPv6 (the exit resolves names; nothing resolves here).
const SOCKS_FLAGS='ExtendedErrors IPv6Traffic PreferIPv6 KeepAliveIsolateSOCKSAuth';
// After a failure that may pass (no network yet, a stall, a crash), a Tor tab that is still open tries again by itself, at
// growing intervals, three times; then it waits for Try again. A missing or altered engine or a wrong clock never retries.
const AUTO_RETRY_DELAYS=[5000,20000,60000],AUTO_RETRY_CODES=new Set(['unreachable','timeout','crashed']);
// Tor looks blocked (Tor Browser's TorConnect "censorship" case): bootstrap has not finished a handshake with any relay or bridge
// (below 15%, "handshake_done") this long after start. Sooner when tor has already reported a bootstrap problem (refused, reset,
// timed out); later with bridges, whose transports take longer to start (Snowflake's rendezvous alone can take 20 s). Tor keeps
// trying meanwhile; the connect page offers a bridge or another kind of bridge.
const BLOCKED_AFTER={warned:20000,quiet:40000,bridgeWarned:45000,bridgeQuiet:75000},HANDSHAKE_DONE=15;
const online=()=>{try{return require('electron').net.isOnline();}catch{return true;}};
/** Command line for tor.exe. No torrc is read: every option is explicit, so a stray torrc can't weaken it. `bridges` are the
 * UseBridges / ClientTransportPlugin / Bridge options for the person's bridge choice (tor-bridges.cjs), empty when off. */
function torArguments({dataDirectory,runDirectory,ownerPid,bridges=[],geoip=null}){
 const countries=geoip?.v4?['--GeoIPFile',geoip.v4,...(geoip.v6?['--GeoIPv6File',geoip.v6]:[])]:[];
 return ['--ignore-missing-torrc','-f',path.join(runDirectory,'torrc-none'),'--defaults-torrc',path.join(runDirectory,'torrc-defaults-none'),
  '--DataDirectory',dataDirectory,'--ClientOnly','1','--SocksPort','127.0.0.1:auto '+SOCKS_FLAGS,'--ControlPort','127.0.0.1:auto',
  '--ControlPortWriteToFile',path.join(runDirectory,'controlport'),'--CookieAuthentication','1','--CookieAuthFile',path.join(runDirectory,'control_auth_cookie'),
  '--__OwningControllerProcess',String(ownerPid),'--AvoidDiskWrites','1','--DormantCanceledByStartup','1','--SafeLogging','1','--Log','notice stdout',...countries,...bridges];
}
/** The geoip tables that ship beside tor.exe (null when they are not there): the circuit view names each relay's country. */
const geoipFiles=file=>{const [v4,v6]=['geoip','geoip6'].map(name=>path.join(path.dirname(file),name)).map(candidate=>fs.existsSync(candidate)?candidate:'');return v4?{v4,v6}:null;};
/** GETINFO answers by key from a reply's raw lines: "250-key=value" lines and "250+key=" data blocks (up to the lone "."). */
function parseInfo(raw=[]){
 const out={};
 for(let i=0;i<raw.length;i++){const line=raw[i],m=/^250([-+ ])([^=]+)=(.*)$/.exec(line);if(!m)continue;
  if(m[1]!=='+'){out[m[2]]=m[3];continue;}
  const data=[];for(i++;i<raw.length&&raw[i]!=='.';i++)data.push(raw[i].startsWith('..')?raw[i].slice(1):raw[i]);out[m[2]]=data.join('\n');}
 return out;
}
/** `KEY=value KEY2="quoted value"` pairs from control-port lines (control-spec §2.1). */
function parseKeywords(text){const out={};const re=/([A-Za-z_]+)=("((?:[^"\\]|\\.)*)"|\S+)/g;let m;while((m=re.exec(text)))out[m[1].toUpperCase()]=m[3]!==undefined?m[3].replace(/\\(.)/g,'$1'):m[2];return out;}
/** Bootstrap progress from a STATUS_CLIENT event or a status/bootstrap-phase reply. */
function parseBootstrap(line){if(!/\bBOOTSTRAP\b/.test(line))return null;const k=parseKeywords(line),progress=Number(k.PROGRESS);if(!Number.isFinite(progress))return null;return {progress:Math.max(0,Math.min(100,progress)),tag:k.TAG||'',summary:k.SUMMARY||'',warning:/\bWARN\b/.test(line)?{reason:k.REASON||'',warning:k.WARNING||'',recommendation:k.RECOMMENDATION||''}:null};}
/** Same from tor's own stdout log ("Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors"). */
function parseLogBootstrap(line){const m=/Bootstrapped (\d{1,3})% \(([a-z_]+)\): (.+)$/.exec(line);return m?{progress:Number(m[1]),tag:m[2],summary:m[3].trim(),warning:null}:null;}

/** Minimal Tor control-port client: one command at a time, async 650 events to `onEvent`. A reply's data block ("250+key=" lines up to a
 * lone "."; control-spec §2.3) is read whole: its lines are not status lines, even when one starts with three digits and a space
 * (circuit 123 in circuit-status). Each reply's untrimmed lines are on its `.raw`. */
function connectControl(port,{onEvent=()=>{},onClose=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port});let buffer='',reply=[],queue=[],closed=false,inData=false;
  const fail=error=>{for(const item of queue)item.reject(error);queue=[];};
  socket.setEncoding('latin1');socket.setNoDelay(true);
  socket.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(inData){reply.push(line);if(line==='.')inData=false;continue;}
   if(/^650[ -]/.test(line)){onEvent(line.slice(4));continue;}
   reply.push(line);if(/^\d{3}\+/.test(line)){inData=true;continue;}
   if(/^\d{3} /.test(line)){const lines=reply;reply=[];const item=queue.shift();if(!item)continue;if(line.startsWith('250')){const out=lines.map(l=>l.slice(4));out.raw=lines;item.resolve(out);}else item.reject(Object.assign(new Error(line.slice(4)||'Tor refused the command.'),{code:line.slice(0,3)}));}}});
  socket.once('connect',()=>resolve({
   send(command){if(closed)return Promise.reject(new Error('Tor control connection closed.'));return new Promise((ok,no)=>{queue.push({resolve:ok,reject:no});socket.write(command+'\r\n');});},
   close(){closed=true;socket.end();setTimeout(()=>socket.destroy(),500).unref?.();},
  }));
  socket.once('error',error=>{fail(error);reject(error);});
  socket.once('close',()=>{closed=true;fail(new Error('Tor control connection closed.'));onClose();});
 });
}
async function waitForFile(file,timeout,alive){const end=Date.now()+timeout;while(Date.now()<end){if(!alive())throw new Error('Tor stopped while starting.');try{const text=fs.readFileSync(file,'latin1');if(text.trim())return text;}catch{}await new Promise(r=>setTimeout(r,60));}throw new Error('Tor did not open its control port.');}
async function fileSha256(file){return await new Promise((resolve,reject)=>{const hash=crypto.createHash('sha256');fs.createReadStream(file).on('data',d=>hash.update(d)).on('error',reject).on('end',()=>resolve(hash.digest('hex')));});}

/** Plain-language errors (bible §3.11: what happened, why, what to do). */
/** Read when an error is shown, so the words follow the current language. */
const ERRORS={
 get missing(){return {title:t('tor.missing.title'),detail:process.defaultApp?t('tor.missing.detailDev'):t('tor.missing.detail')};},
 get integrity(){return {title:t('tor.integrity.title'),detail:t('tor.integrity.detail')};},
 get crashed(){return {title:t('tor.crashed.title'),detail:t('tor.crashed.detail')};},
 get unreachable(){return {title:t('tor.unreachable.title'),detail:t('tor.unreachable.detail')};},
 get clock(){return {title:t('tor.clock.title'),detail:t('tor.clock.detail')};},
 get timeout(){return {title:t('tor.timeout.title'),detail:t('tor.timeout.detail')};},
 get transports(){return {title:t('tor.transports.title'),detail:t('tor.transports.detail')};},
};

/** A development or demo checkout (run through the electron CLI) that has no tor.exe yet downloads it once, verified like a build would. Packaged installs never do: they ship it. */
function repairDevEngine(){
 if(!process.defaultApp)return Promise.resolve(false);
 const script=path.join(__dirname,'..','..','scripts',process.platform==='darwin'?'fetch-tor-mac.mjs':process.platform==='linux'?'fetch-tor-linux.mjs':'fetch-tor.mjs');if(!fs.existsSync(script))return Promise.resolve(false);
 return new Promise(resolve=>{try{const child=spawn(process.execPath,[script,'--soft'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'ignore'});child.once('error',()=>resolve(false));child.once('exit',code=>resolve(code===0));}catch{resolve(false);}});
}
/** The in-memory session Acira's own Tor traffic (the engine updater) uses: nothing else ever loads in it. */
function ownTorSession(){const ses=require('electron').session.fromPartition('acira-tor-engine',{cache:false});if(!ses.__aciraTor){Object.defineProperty(ses,'__aciraTor',{value:true});require('./user-agent.cjs').applyTorUserAgent(ses);}return ses;}
/** QA only, on a disposable test profile: ACIRA_TEST_TOR_SIMULATE_BLOCK=1 points tor at a dead local proxy, so every connection it
 * tries is refused, as on a network that blocks Tor (qa/r9-tor-bridges.mjs shows the connect page's blocked state with it). */
const simulatedBlock=(env=process.env)=>Boolean(env.ACIRA_BROWSER_TEST_DATA)&&env.ACIRA_TEST_TOR_SIMULATE_BLOCK==='1'?['--Socks5Proxy','127.0.0.1:9']:[];
function createTorEngine({userData,platform=process.platform,executable=()=>torExecutable(),repair=repairDevEngine,updated=()=>null,spawnTor=spawn,ownerPid=process.pid,log=()=>{},timeouts={},ownSession=ownTorSession,bridgeSettings=null,transports=()=>transportDirectory({platform}),transportHashes=()=>transportPins({platform}),isOnline=online,extraArguments=simulatedBlock,moatFactory=createTorMoat}={}){
 if(!userData)throw new Error('Tor needs a data folder.');
 const bridgeChoice=bridgeSettings||createBridgeSettings({userData});
 const dataDirectory=path.join(userData,'tor','data'),runDirectory=path.join(userData,'tor','run');
 const limits={connect:CONNECT_TIMEOUT,stall:STALL_TIMEOUT,bridgeConnect:BRIDGE_CONNECT_TIMEOUT,bridgeStall:BRIDGE_STALL_TIMEOUT,controlFile:CONTROL_FILE_TIMEOUT,newnymRate:NEWNYM_RATE,newnymMargin:NEWNYM_MARGIN,retryDelays:AUTO_RETRY_DELAYS,slowRestarts:SLOW_RESTARTS,earlyStall:EARLY_STALL,blocked:BLOCKED_AFTER,...timeouts};
 const listeners=new Set(),leases=new Set();
 let status={state:'idle',progress:0,summary:'',error:null,socksPort:0,version:platform==='linux'?require('./tor-linux.cjs').manifest.tor:manifest.tor,blocked:null,bridges:null},child=null,control=null,starting=null,generation=0,timers=[],lastActivityAt=0,logTail=[],lastAppliedAt=0,circuitsUsed=false,exited=Promise.resolve(),retryTimer=null,retries=0,slowRestarts=0,wanted=false,launchedAt=0,warnings=0;const newnymWaiters=new Set();
 const emit=patch=>{if(patch.state==='ready'){retries=0;slowRestarts=0;}status={...status,...(patch.state==='ready'||patch.state==='idle'?{slowRestarts:0}:{}),...(patch.state&&patch.state!=='error'?{retryInMs:0}:{}),...patch};for(const fn of [...listeners])try{fn(status);}catch(error){log('Tor status listener failed: '+error.message);}};
 const clearTimers=()=>{for(const t of timers)clearInterval(t),clearTimeout(t);timers=[];};
 const cancelRetry=()=>{if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}};
 const fail=(code,extra)=>{const error={code,...ERRORS[code],...(extra||{})};log('Tor error: '+code+(extra?.reason?' ('+extra.reason+')':''));teardown();
  const delay=AUTO_RETRY_CODES.has(code)&&(leases.size||wanted)&&retries<limits.retryDelays.length?limits.retryDelays[retries]:0;
  emit({state:'error',error,socksPort:0,retryInMs:delay||0});
  if(delay){retries++;cancelRetry();retryTimer=setTimeout(()=>{retryTimer=null;if(status.state==='error'&&(leases.size||wanted)){log('Tor: trying again by itself ('+retries+'/'+limits.retryDelays.length+')');void start();}},delay);retryTimer.unref?.();}};
 function onBootstrap(info,gen){if(gen!==generation||!info)return;
  if(info.warning&&info.warning.recommendation==='warn'&&info.progress<100){if(/CLOCK|SKEW/i.test(info.warning.reason+info.warning.warning)){fail('clock',{reason:info.warning.reason});return;}status.lastWarning=info.warning;warnings++;}
  // Past the first handshake with a relay or bridge, the network lets Tor through: whatever looked blocked was not.
  if(info.progress>=status.progress||status.state==='starting')emit({state:info.progress>=100&&status.socksPort?'ready':'connecting',progress:info.progress,summary:info.summary,tag:info.tag,...(status.blocked&&info.progress>=HANDSHAKE_DONE?{blocked:null}:{})});}
 /** Tor looks blocked: no handshake with any relay or bridge yet, long after start (BLOCKED_AFTER). Not an error: tor keeps trying,
  * and the connect page says why it is slow and offers a bridge. `offline` when Windows has no network at all. */
 function checkBlocked(gen,usingBridges){
  if(gen!==generation||status.blocked||!['starting','connecting'].includes(status.state)||status.progress>=HANDSHAKE_DONE)return;
  const waited=Date.now()-launchedAt,after=usingBridges?(warnings?limits.blocked.bridgeWarned:limits.blocked.bridgeQuiet):(warnings?limits.blocked.warned:limits.blocked.quiet);
  if(waited<after)return;
  const blocked={phase:status.tag||'starting',progress:status.progress,reason:status.lastWarning?.reason||'stalled',bridges:usingBridges?status.bridges?.type||'custom':null,offline:!isOnline(),since:Date.now()};
  log('Tor: looks blocked ('+blocked.phase+' '+blocked.progress+'%, '+blocked.reason+(blocked.offline?', offline':'')+')');emit({blocked});
 }
 function onEvent(line,gen){if(gen!==generation)return;lastActivityAt=Date.now();
  // tor applies SIGNAL NEWNYM at once or, inside its 10 s rate limit, later; this event says when it really happened (control-spec 4.1.7).
  if(/^SIGNAL NEWNYM\b/.test(line)){lastAppliedAt=Date.now();for(const done of [...newnymWaiters])done(true);return;}
  // STREAM events (control-spec 4.1.2) go to whoever asked (tor-window.cjs: which circuit a site's latest stream rode); nothing here reads them.
  if(/^STREAM /.test(line)){for(const listener of [...streamListeners])try{listener(line);}catch{}return;}
  if(/^STATUS_CLIENT /.test(line)){if(/\bCLOCK_SKEW\b/.test(line)){fail('clock',{reason:'CLOCK_SKEW'});return;}onBootstrap(parseBootstrap(line),gen);}}
 function teardown(){generation++;clearTimers();for(const done of [...newnymWaiters])done(false);const c=control,p=child;control=null;child=null;starting=null;if(c){c.send('SIGNAL SHUTDOWN').catch(()=>{});c.close();}if(p&&p.exitCode===null&&p.signalCode===null){exited=new Promise(resolve=>{const t=setTimeout(()=>{try{p.kill();}catch{}},3000);t.unref?.();p.once('exit',()=>{clearTimeout(t);resolve();});});}return exited;}
 let moat=null;const moatClient=()=>moat||(moat=moatFactory({userData,platform,transports,pins:transportHashes,verify:(file,sha)=>verify(file,sha),log}));
 const transportsInstalled=()=>{const dir=transports();return Boolean(dir)&&[platform!=='win32'?'lyrebird':'lyrebird.exe'].every(name=>fs.existsSync(path.join(dir,name)));};
 const checked=new Map(),streamListeners=new Set();
 /** One hash check per file per run. `expected` is the pinned hash for the bundled engine, or the hash recorded when an update was verified. */
 async function verify(file,expected=manifest.files['tor.exe'].sha256,companions={}){if(Object.keys(companions).some(name=>!['libevent-2.1.7.dylib',...(platform==='linux'?['libcrypto.so.3','libssl.so.3','libevent-2.1.so.7']:[])].includes(name)))return false;const key=file+'|'+expected+'|'+JSON.stringify(companions);if(!checked.has(key))checked.set(key,(async()=>await fileSha256(file)===expected&&(await Promise.all(Object.entries(companions).map(async([name,digest])=>/^[a-f0-9]{64}$/.test(digest)&&await fileSha256(path.join(path.dirname(file),name))===digest))).every(Boolean))().catch(()=>false));if(!await checked.get(key)){checked.delete(key);return false;}return true;}
 async function launch(){
  const gen=++generation;let file=executable(),expected=manifest.files['tor.exe'].sha256,companions={},usingUpdate=false;
  // A newer engine installed by the updater (tor-update.cjs) is used when it still matches the hash recorded at install; otherwise the bundled one runs.
  try{const up=updated();if(up&&fs.existsSync(up.file)&&await verify(up.file,up.sha256,up.companions)){file=up.file;expected=up.sha256;companions=up.companions||{};usingUpdate=true;}else if(up)log('The updated Tor failed its check; using the bundled one.');}catch(error){log('Tor update lookup failed: '+error.message);}
  if(!file){emit({state:'starting',progress:0,summary:'Downloading Tor, one time',error:null,socksPort:0});try{await repair();}catch{}if(gen!==generation)return;file=executable();}
  if(!file){fail('missing');return;}
  if(['darwin','linux'].includes(process.platform)&&!usingUpdate&&path.basename(file)==='tor'){const native=process.platform==='linux'?readLinuxTor(file):readMacTor(file);if(!native){fail('integrity');return;}expected=native.sha256;companions=native.companions;}
  // Bridges: the lines for the person's choice (built-in lines in a fresh random order), and the transport clients they need.
  const choice=bridgeChoice.get(),lines=bridgeLines(choice);
  emit({state:'starting',progress:0,summary:'Starting Tor',tag:'starting',error:null,socksPort:0,blocked:null,bridges:bridgeSummary(choice,lines),firstConnection:!fs.existsSync(path.join(dataDirectory,'cached-microdesc-consensus'))});
  if(!await verify(file,expected,companions)){if(gen===generation)fail('integrity');return;}
  if(gen!==generation)return;
  let cwd=path.dirname(file);
  if(lines.length){
   const needed=[...neededClients(lines,platform)],pins=transportHashes(),present=dir=>Boolean(dir)&&needed.every(name=>fs.existsSync(path.join(dir,name)));
   let dir=transports();
   // A development checkout made before bridges existed has tor.exe but not the clients: fetch them once, verified like tor.exe.
   if(needed.length&&!present(dir)){try{await repair();}catch{}if(gen!==generation)return;dir=transports();}
   if(needed.length&&!present(dir)){if(gen===generation)fail('transports');return;}
   // Every client is checked against its pinned hash, like tor.exe, before tor may start it.
   for(const name of needed)if(!pins[name]||!await verify(path.join(dir,name),pins[name])){if(gen===generation)fail('integrity',{reason:name});return;}
   if(gen!==generation)return;
   // tor runs from the folder that holds pluggable_transports\: the ClientTransportPlugin paths are relative (tor splits them on spaces).
   if(dir)cwd=path.dirname(dir);
  }
  fs.mkdirSync(dataDirectory,{recursive:true});fs.rmSync(runDirectory,{recursive:true,force:true});fs.mkdirSync(runDirectory,{recursive:true});
  logTail=[];lastActivityAt=Date.now();launchedAt=Date.now();warnings=0;status.lastWarning=null;
  const proc=spawnTor(file,[...torArguments({dataDirectory,runDirectory,ownerPid,bridges:bridgeArguments(lines,platform),geoip:geoipFiles(file)}),...extraArguments()],{cwd,...(platform==='linux'?{env:require('./tor-linux.cjs').nativeEnvironment(file)}:{}),windowsHide:true,stdio:['ignore','pipe','pipe']});child=proc;
  let pending='';const onLog=chunk=>{pending+=chunk.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){lastActivityAt=Date.now();logTail.push(line);if(logTail.length>40)logTail.shift();onBootstrap(parseLogBootstrap(line),gen);}};
  proc.stdout?.on('data',onLog);proc.stderr?.on('data',onLog);
  proc.once('error',error=>{if(gen===generation)fail('crashed',{reason:error.message});});
  proc.once('exit',code=>{if(gen===generation&&status.state!=='stopping'){log('Tor exited with code '+code+'\n'+logTail.slice(-8).join('\n'));fail('crashed',{reason:'exit '+code});}});
  const connectLimit=lines.length?Math.max(limits.connect,limits.bridgeConnect):limits.connect,stallLimit=lines.length?Math.max(limits.stall,limits.bridgeStall):limits.stall;
  timers.push(setTimeout(()=>{if(gen===generation&&status.state!=='ready')fail(status.lastWarning?'unreachable':'timeout',{reason:status.lastWarning?.reason});},connectLimit));
  timers.push(setInterval(()=>{if(gen===generation&&status.state==='connecting'&&Date.now()-lastActivityAt>(status.progress<EARLY_PROGRESS&&!lines.length?Math.min(stallLimit,limits.earlyStall):stallLimit)){
   if(status.progress>=HANDSHAKE_DONE&&(leases.size||wanted)&&slowRestarts<limits.slowRestarts){slowRestarts++;log('Tor: silent at '+status.progress+'%; starting again on another route ('+slowRestarts+'/'+limits.slowRestarts+')');teardown();emit({state:'starting',progress:0,summary:'Starting Tor',tag:'starting',error:null,socksPort:0,slowRestarts});void start();return;}
   fail('unreachable',{reason:status.lastWarning?.reason||'stalled at '+status.progress+'%'});return;}checkBlocked(gen,lines.length>0);},limits.blockedCheck||2000));
  try{
   const portText=await waitForFile(path.join(runDirectory,'controlport'),limits.controlFile,()=>gen===generation&&proc.exitCode===null);
   const port=Number(/PORT=127\.0\.0\.1:(\d+)/.exec(portText)?.[1]);if(!port)throw new Error('Unreadable control port file.');
   const cookie=await waitForFile(path.join(runDirectory,'control_auth_cookie'),limits.controlFile,()=>gen===generation).then(()=>fs.readFileSync(path.join(runDirectory,'control_auth_cookie')).toString('hex'));
   const c=await connectControl(port,{onEvent:line=>onEvent(line,gen),onClose:()=>{if(gen===generation&&status.state!=='stopping'&&status.state!=='error')fail('crashed',{reason:'control closed'});}});
   if(gen!==generation){c.close();return;}control=c;
   await c.send('AUTHENTICATE '+cookie);await c.send('TAKEOWNERSHIP');await c.send('RESETCONF __OwningControllerProcess').catch(()=>{});
   await c.send('SETEVENTS STATUS_CLIENT SIGNAL STREAM');
   const socks=(await c.send('GETINFO net/listeners/socks')).join(' '),socksPort=Number(/127\.0\.0\.1:(\d+)/.exec(socks)?.[1]);if(!socksPort)throw new Error('Tor opened no SOCKS port.');
   if(gen!==generation)return;emit({socksPort});
   const phase=(await c.send('GETINFO status/bootstrap-phase')).join(' ');onBootstrap(parseBootstrap(phase),gen);
   if(status.progress>=100&&status.state!=='ready'&&gen===generation)emit({state:'ready'});
  }catch(error){if(gen===generation)fail('crashed',{reason:error.message});}
 }
 /** Best-effort SIGNAL NEWNYM once nobody is using Tor: new circuits for whichever Tor tab opens next. Only when some Tor page has used the
  * circuits since the last renewal: the tabs a New Tor identity closes must not trigger a second NEWNYM, which tor would hold back for 10 s and
  * then apply under the fresh tab the person has just opened. */
 async function freshCircuits(){try{if(control&&status.state==='ready'&&circuitsUsed){circuitsUsed=false;await control.send('SIGNAL NEWNYM');}}catch{}}
 async function request(line){
  if(!control||status.state!=='ready')throw new Error('Tor isn’t connected yet.');
  if(typeof line!=='string'||!line||line.length>2048||/[\r\n\0]/.test(line))throw new Error('Bad Tor control command.');
  return control.send(line);
 }
 function start(){if(status.state==='ready'||starting)return starting||Promise.resolve();starting=launch().finally(()=>{starting=null;});return starting;}
 /** Resolves with tor's SOCKS port once it is connected (starting it when idle); rejects on an error or after `timeout`. */
 function whenReady(timeout=limits.connect+30000){
  if(status.state==='ready'&&status.socksPort)return Promise.resolve(status.socksPort);
  if(['idle','error'].includes(status.state))void start();
  return new Promise((resolve,reject)=>{const done=()=>{listeners.delete(on);clearTimeout(timer);};
   const on=s=>{if(s.state==='ready'&&s.socksPort){done();resolve(s.socksPort);}else if(s.state==='error'){done();reject(new Error(s.error?.title||'Tor can’t connect.'));}};
   const timer=setTimeout(()=>{done();reject(new Error('Tor did not connect in time.'));},timeout);timer.unref?.();listeners.add(on);});
 }
 /** Acira's own Tor traffic (the engine updater) goes through tor, never directly: a direct request to torproject.org the moment a
  * Tor tab opens would tell the network that this computer uses Tor, which is what a bridge is there to hide. It leaves from a
  * private in-memory session pointed at tor's SOCKS port without credentials, so it never shares a circuit with a site (sites
  * always come through the isolation relay with theirs). */
 async function fetchThroughTor(url,init={}){
  const port=await whenReady(),ses=ownSession(),rules=`socks5://127.0.0.1:${port}`;
  if(ses.__aciraTorRules!==rules){await ses.setProxy({proxyRules:rules,proxyBypassRules:'<-loopback>'});await ses.closeAllConnections();ses.__aciraTorRules=rules;}
  const resolved=String(await ses.resolveProxy(url)).trim();if(resolved!==`SOCKS5 127.0.0.1:${port}`)throw new Error('Tor proxy did not apply ('+resolved+').');
  return ses.fetch(url,{...init,credentials:'omit',cache:'no-store'});
 }
 function stop(){cancelRetry();wanted=false;if(status.state==='idle')return exited;emit({state:'stopping'});const done=teardown();emit({state:'idle',progress:0,summary:'',socksPort:0,error:null,blocked:null});return done;}
 return {
  status:()=>({...status}),
  onStatus(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  /** One Tor connection per app session (R3-61): the first Tor tab or window starts tor and every later one reuses it. Tor keeps
   * running after the last one closes so the next Tor tab is connected at once; it ends with Acira (__OwningControllerProcess)
   * or stop(). A Tor tab or window holds a lease while it is open; when the last lease goes, circuits are renewed so the next
   * Tor tab can't be linked to the one that just closed. */
  acquire(id){leases.add(id);circuitsUsed=true;if(['idle','error'].includes(status.state))void start();let released=false;return()=>{if(released)return Promise.resolve();released=true;leases.delete(id);if(!leases.size)void freshCircuits();return Promise.resolve();};},
  /** Start connecting now (a Tor tab was opened, its page does not exist yet). Nothing happens while tor is starting or ready. */
  warm(){wanted=true;if(['idle','error'].includes(status.state))return start();return starting||Promise.resolve();},
  /** The Tor tab that asked for warm() is gone (it never loaded a page, so it holds no lease): stop retrying on its behalf. */
  unwarm(){wanted=false;if(!leases.size)cancelRetry();},
  retry(){cancelRetry();retries=0;slowRestarts=0;wanted=true;teardown();emit({state:'idle',progress:0,error:null});void start();return {...status};},
  /** After sleep or a network change: a connected tor is asked to wake (SIGNAL ACTIVE) and must still answer; one that has
   * gone silent is restarted. An error with a Tor tab still open is retried at once. */
  async heal(){
   if(status.state==='error'&&(leases.size||wanted)){cancelRetry();retries=0;void start();return 'restarted';}
   if(status.state!=='ready'||!control)return 'idle';
   try{await control.send('SIGNAL ACTIVE');const reply=(await control.send('GETINFO status/circuit-established')).join(' ');return /=1/.test(reply)?'ok':'building';}
   catch(error){fail('crashed',{reason:'no answer after wake: '+error.message});return 'restarted';}
  },
  /** SIGNAL NEWNYM: new circuits for new connections. Tor rate-limits it to one per 10 seconds and, inside that limit, answers OK but applies it
   * later: this resolves only once tor has really applied it (its SIGNAL event), so nothing opened afterwards can ride the old circuits.
   * `applied:false` means tor never confirmed (the event did not arrive within the limit plus a margin); the request itself was accepted. */
  async newIdentity(){
   if(!control||status.state!=='ready')throw new Error('Tor isn’t connected yet.');
   const wait=Math.max(0,lastAppliedAt+limits.newnymRate-Date.now()),applied=new Promise(resolve=>{const done=value=>{clearTimeout(timer);newnymWaiters.delete(done);resolve(value);},timer=setTimeout(()=>done(false),wait+limits.newnymMargin);newnymWaiters.add(done);});
   try{await control.send('SIGNAL NEWNYM');}catch(error){for(const done of [...newnymWaiters])done(false);throw error;}
   const confirmed=await applied;if(!control)throw new Error('Tor isn’t connected yet.');circuitsUsed=false;
   return {ok:true,delayed:wait>0,waitMs:wait,applied:confirmed};
  },
  /** One control-port command for the Tor features in tor-window.cjs (circuit display, onion client keys); main-process callers
   * only, which build `line` from validated parts. Resolves to the reply lines (`.raw` untrimmed); a refusal rejects with tor's code. */
  request,
  /** GETINFO keys → their values (circuit-status, ns/id/<fingerprint>, ip-to-country/<address>). */
  async getInfo(...keys){
   if(!keys.length||keys.some(key=>typeof key!=='string'||!/^[\w\-/.:$~=]{1,200}$/.test(key)))throw new Error('Bad GETINFO key.');
   return parseInfo((await request('GETINFO '+keys.join(' '))).raw);
  },
  /** Raw `STREAM ...` event lines (without the 650 prefix) as tor reports them. Returns the unsubscribe. */
  onStream(listener){streamListeners.add(listener);return()=>streamListeners.delete(listener);},
  leases:()=>leases.size,
  /** The bridge choice for Settings and the connect page, and whether this build has the transport clients. */
  bridges:()=>publicBridges(bridgeChoice.get(),{installed:transportsInstalled()}),
  /** Saves a bridge choice ({mode:'off'|'builtin'|'custom', builtin, custom}) and, when tor is running or failed, reconnects with it.
   * A choice that can't be used is not saved: the answer says why, line by line ({ok:false, code, errors}). */
  setBridges(next){
   let saved;try{saved=bridgeChoice.set(next||{});}catch(error){return {...publicBridges(bridgeChoice.get(),{installed:transportsInstalled()}),ok:false,code:error.code||'invalid',errors:error.errors||[]};}
   // Tor in use (or failing with a Tor tab still open) reconnects with the new choice at once; otherwise it applies on the next start.
   if(['starting','connecting','ready'].includes(status.state)||status.state==='error'&&leases.size){cancelRetry();retries=0;teardown();emit({state:'idle',progress:0,error:null,blocked:null});void start();}
   else if(status.state==='error')emit({state:'idle',progress:0,error:null,blocked:null});
   return {...publicBridges(saved,{installed:transportsInstalled()}),ok:true};
  },
  /** Moat (tor-moat.cjs): a CAPTCHA from bridges.torproject.org, reached by domain fronting (works where Tor is blocked). */
  moatFetch:()=>moatClient().fetch(),
  /** The person's answer: the bridges Moat gives are saved as "a bridge I know" (Tor in use reconnects with them). */
  async moatCheck({transport,challenge,solution}){
   const lines=await moatClient().check({transport,challenge,solution});
   if(!lines)return {ok:false,wrong:true};
   moatClient().stop();
   const saved=this.setBridges({mode:'custom',custom:lines.join('\n')});
   return {ok:saved.ok!==false,count:lines.length,bridges:saved};
  },
  /** Checks pasted bridge lines without saving them: the errors by line, as the field shows them while the person types. */
  checkBridges:text=>{const parsed=parseBridgeLines(text);return {count:parsed.lines.length,errors:parsed.errors,empty:parsed.empty};},
  whenReady,
  fetch:fetchThroughTor,
  stop,
  paths:{dataDirectory,runDirectory},
 };
}
module.exports={createTorEngine,torExecutable,torArguments,TOR_BLOCKED_AFTER:BLOCKED_AFTER,TOR_SOCKS_FLAGS:SOCKS_FLAGS,TOR_AUTO_RETRY_DELAYS:AUTO_RETRY_DELAYS,parseKeywords,parseBootstrap,parseLogBootstrap,parseInfo,connectControl,TOR_ERRORS:ERRORS,TOR_MANIFEST:manifest};
