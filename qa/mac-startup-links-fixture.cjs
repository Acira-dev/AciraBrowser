// Own hidden profile only. Exercise the OS-facing lifecycle without UI drivers.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
process.on('SIGTERM',()=>app.quit());
process.on('SIGUSR2',()=>{
 app.once('before-quit',event=>event.preventDefault());
 app.quit();
 fs.writeFileSync(path.join(app.getPath('userData'),'cancelled-quit.json'),JSON.stringify({pid:process.pid,cancelled:true}));
});
require('../desktop/main.cjs');
