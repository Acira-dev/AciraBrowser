// The parent owns this disposable test process and asks for a normal shutdown.
const {app}=require('electron');
process.on('SIGTERM',()=>app.quit());
require('../desktop/main.cjs');
