// Both platforms integrate their own native controls into the browser header.
function windowChrome(platform = process.platform) {
  return platform === 'win32'
    ? {titleBarStyle:'hidden', titleBarOverlay:{color:'#eef0f2',symbolColor:'#26282b',height:40}, autoHideMenuBar:true}
    : platform === 'darwin' ? {titleBarStyle:'hidden',trafficLightPosition:{x:12,y:12},autoHideMenuBar:false}
    : {titleBarStyle:'default', autoHideMenuBar:true};
}

function updateCaption(window, caption, platform = process.platform) {
  const { background, hidden, ...overlay } = caption;
  if (platform === 'win32') window.setTitleBarOverlay(overlay);
  if (platform === 'darwin') {
    // Removing AppKit's buttons also removes their hit regions. Transparent
    // renderer chrome alone leaves a working close button over the website.
    // Visibility first: showing the buttons puts them back at AppKit's default
    // spot (9,9), so a position set before it was lost on leaving Seamless.
    window.setWindowButtonVisibility(!hidden);
    // Native controls do not scale with Chromium. Centre their 14pt frames in
    // the actual physical row, including the smallest interface scale.
    window.setWindowButtonPosition({x:12,y:Math.max(4,Math.round((caption.height-14)/2))});
  }
  window.setBackgroundColor(background || caption.color);
}

// Keep the existing Windows acrylic contract; macOS supplies its own sidebar
// material and lets AppKit follow the key window instead of forcing it active.
function windowMaterial({platform=process.platform,release,disabled=process.env.ACIRA_MATERIAL==='none',reducedTransparency=false}={}) {
  if (disabled) return 'none';
  if (platform==='win32') return require('./windows-version.cjs').windowMaterial({platform,release}).material;
  return platform==='darwin'&&!reducedTransparency ? 'vibrancy' : 'none';
}

function materialOptions(material) {
  if (material==='acrylic') return {backgroundMaterial:'acrylic'};
  if (material==='vibrancy') return {vibrancy:'sidebar',visualEffectState:'followWindow'};
  return {};
}

/** `report`: this build can send reports (desktop/browser-services/site-reports-config.cjs), so Help > Report a Problem… is offered. */
function macMenuTemplate(run,{report=false}={}) {
  const command=(label,accelerator,action)=>({label,accelerator,click:(item,window,event)=>run(action,item,window,event)});
  return [
    {label:'Acira',submenu:[{role:'about'},command('Settings…','Command+,',{action:'settings'}),{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},command('Quit Acira','Command+Q',{action:'quit'})]}, // R4-36: Quit asks about unsaved work and several tabs first
    {label:'File',submenu:[command('New Tab','Command+T',{action:'new-tab'}),command('New Window','Command+N',{action:'new-window'}),command('New Private Window','Command+Shift+N',{action:'private-window'}),...(bundledTorSupported()?[command('New Tor Window','Command+Option+N',{action:'tor-window'})]:[]),command('Reopen Closed Tab','Command+Shift+T',{action:'restore'}),command('Close Tab','Command+W',{action:'close-tab'}),command('Close Window','Command+Shift+W',{action:'close-window'}),{type:'separator'},command('Save Page…','Command+S',{action:'save-page'}),command('Print…','Command+P',{action:'print'})]},
    {role:'editMenu'},
    {label:'View',submenu:[command('Reload','Command+R',{action:'reload'}),command('Reload Without Cache','Command+Shift+R',{action:'hard-reload'}),{type:'separator'},command('Actual Size','Command+0',{action:'zoom',change:0}),command('Zoom In','Command+Plus',{action:'zoom',change:1}),command('Zoom Out','Command+-',{action:'zoom',change:-1}),{type:'separator'},command('Your Tabs','Command+Shift+A',{action:'tabs'}),command('Focus View','Command+Shift+F',{action:'focus-mode'}),command('Bookmarks Bar','Command+Shift+B',{action:'toggle-bookmarks'}),command('Enter Full Screen','Control+Command+F',{action:'fullscreen'})]},
    {label:'History',submenu:[command('Back','Command+[',{action:'back'}),command('Forward','Command+]',{action:'forward'}),{type:'separator'},command('Show History','Command+Y',{action:'history'})]},
    {label:'Bookmarks',submenu:[command('Bookmark This Page','Command+D',{action:'bookmark'}),command('Show Bookmarks','Command+Option+B',{action:'bookmarks'})]},
    {label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{type:'separator'},{role:'front'}]},
    // The Acira menu's "Report a problem…": opens that menu on the report form (about this site or about Acira).
    ...(report?[{role:'help',submenu:[command('Report a Problem…',undefined,{action:'report'})]}]:[])
  ];
}
// The application menu outlives individual windows, including private windows.
// Resolve its owner at invocation time rather than retaining the last creator.
function createMacMenuRouter({getControllers,getFallback,quit}) {
  return (command,item,window,event) => {
    if(command.action==='quit')return quit();
    const live=[...getControllers()].filter(c=>!c.closing&&c.window&&!c.window.isDestroyed());
    const owner=live.find(c=>c.ownsMenuWindow(window))||live.find(c=>c.window.isFocused())||getFallback();
    return owner?.runMenu(command,item,window,event);
  };
}
// Mac builds ship a verified, natively signed Tor executable and its library.
const bundledTorSupported=(platform=process.platform,arch=process.arch)=>platform==='win32'||platform==='darwin'&&['arm64','x64'].includes(arch);
module.exports={windowChrome,updateCaption,macMenuTemplate,createMacMenuRouter,windowMaterial,materialOptions,bundledTorSupported};
