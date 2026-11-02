'use strict';
// Reuse the exact Creation artwork and layout used by the Windows installer.
// Replace its study timeline with native installation state: no simulated progress.
const {catalogs}=require('./strings.cjs');
function buildInstallerPage(template){
 template=String(template).replace(/\r\n/g,'\n');// a Windows checkout has CRLF; the patterns below are written for the stored LF
 const match=template.match(/<script>([\s\S]*?)<\/script>/);if(!match)throw Error('Installer artwork script is missing.');let art=match[1];
 const begin=art.indexOf('function setUi('),end=art.indexOf('function frame(',begin);if(begin<0||end<0||!art.includes('progressAt((now-start)/1000)'))throw Error('Review the changed upstream installer artwork driver.');
 const bridge=`
const catalogs=${JSON.stringify(catalogs)};const t=key=>(catalogs[actual.locale]||catalogs.en)[key]||catalogs.en[key];
let actual={locale:'en',phase:'idle',progress:0,message:'Add Acira to your Applications. Your browser data stays separate.',attempt:0},visual=0,lastAttempt=0,previousTime=performance.now(),scheduled=0,lastDone=false;
const installButton=document.querySelector('[data-action=install]'),cancelButton=document.querySelector('[data-action=cancel]'),openButton=document.querySelector('[data-action=open]');
function receive(value){if(value&&typeof value.phase==='string'){actual=value;if(actual.attempt!==lastAttempt){visual=0;doneAt=null;lastAttempt=actual.attempt;lastDone=false;}schedule();}}
window.aciraInstaller.subscribe(receive);window.aciraInstaller.state().then(receive);
async function action(command){try{await window.aciraInstaller.action(command);}catch{document.getElementById('status').textContent=t('actionFailed');}}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>action(button.dataset.action)));
function setUi(p,done){
 const phase=actual.phase,busy=['checking','installing','verifying','committing'].includes(phase)||phase==='done'&&!done;win.classList.toggle('done',done);
 document.getElementById('title').textContent=done?t('ready'):busy?(phase==='done'?t('finishing'):t('installing')):phase==='error'?t('errorTitle'):phase==='cancelled'?t('cancelledTitle'):t('install');
 const status=document.getElementById('status');status.textContent=actual.message;status.setAttribute('role','status');
 document.getElementById('fill').style.width=(p*100).toFixed(2)+'%';document.getElementById('pct').textContent=Math.floor(p*100)+'%';
 const track=document.querySelector('.track');track.hidden=!busy&&!done;track.setAttribute('aria-valuenow',String(Math.floor(p*100)));document.getElementById('pct').hidden=!busy;
 installButton.hidden=busy||done;installButton.textContent=phase==='error'?t('retry'):t('install');cancelButton.textContent=t('cancel');openButton.textContent=t('open');document.querySelector('[data-action=close]').textContent=t('close');document.documentElement.lang=(catalogs[actual.locale]||catalogs.en).lang;document.title=t('install');track.setAttribute('aria-label',t('installing'));cancelButton.hidden=!busy||phase==='done';cancelButton.disabled=phase==='committing';
 if(done&&!lastDone&&[installButton,cancelButton,document.body].includes(document.activeElement))openButton.focus();lastDone=done;
}
function schedule(){if(scheduled||document.hidden)return;scheduled=requestAnimationFrame(now=>{scheduled=0;frame(now);if(!reduce)schedule();});}
addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(scheduled);scheduled=0;}else schedule();});
addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();action(['checking','installing','verifying'].includes(actual.phase)?'cancel':'close');}});
`;
 art=art.slice(0,begin)+bridge+art.slice(end);
 const demo=/ (?:if\(playDone&&doneAt===null\)doneAt=now;\n )?const done=stillDone\|\|\(!still&&doneAt!==null\);\n const p=[^\n]*progressAt\(\(now-start\)\/1000\);\n if\(!still&&p>=1&&doneAt===null\)doneAt=now;/;
 if(!demo.test(art))throw Error('Review the changed upstream installer progress driver.');
 art=art.replace(demo,` const target=Math.max(0,Math.min(1,actual.progress||0)),delta=Math.min(100,now-previousTime);previousTime=now;
 visual=reduce?target:Math.min(target,visual+(target-visual)*(1-Math.exp(-delta/95)));if(target===1&&visual>.999)visual=1;
 const p=visual,done=actual.phase==='done'&&p===1;if(done&&doneAt===null)doneAt=now;`);
 art=art.replace('const doneT=stillDone?fixedT:', 'const doneT=reduce&&done?6:stillDone?fixedT:');
 art=art.replace(" if(!still||document.fonts.status!=='loaded')requestAnimationFrame(frame);",'');
 art=art.replace(/addEventListener\('click',e=>\{if\(e\.target\.closest\('\.btn,\.close'\)[^\n]*\n/,'');
 art=art.replace('Promise.resolve(window.ready||null).then(()=>requestAnimationFrame(frame));','Promise.all([window.ready,document.fonts.ready]).then(()=>{frame(performance.now());window.aciraInstaller.ready();schedule();});');
 let html=template.replace(match[0],'<script src="./installer-art.js"></script>').replace(/<button class="close"[^]*?<\/button>/,'');
 html=html.replace('id="title">Installing Acira','id="title">Install Acira');
 html=html.replace('<title>Acira installer — Creation</title>','<title>Install Acira</title>');
 html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; frame-src \'none\'">');
 html=html.replace('<button class="btn text">Cancel</button>','<button class="btn primary" data-action="install">Install Acira</button><button class="btn text" data-action="cancel" hidden>Cancel</button>');
 html=html.replace('<button class="btn text">Close</button>','<button class="btn text" data-action="close">Close</button>').replace('<button class="btn primary" autofocus>Open Acira</button>','<button class="btn primary" data-action="open">Open Acira</button>');
 html=html.replace('<div class="track" aria-hidden="true">','<div class="track" role="progressbar" aria-label="Installing Acira" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>');
 html=html.replace('</style>','[hidden]{display:none!important}.win{-webkit-app-region:drag}.btn{-webkit-app-region:no-drag}.btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}.title,.status{-webkit-app-region:no-drag}\n</style>');
 return {html,script:art};
}
module.exports={buildInstallerPage};
