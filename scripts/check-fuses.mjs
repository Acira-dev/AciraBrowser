// Reads the Electron fuses back from a packaged Acira and compares them with the set it must ship (packaging/fuses.cjs).
//   node scripts/check-fuses.mjs "/Applications/Acira Browser.app"          a Mac app bundle (the full Mac set)
//   node scripts/check-fuses.mjs release\...\AciraBrowser.exe                a Windows program (the Windows set)
//   A Windows program with AciraBrowser.exe.sig beside it is a Widevine build (npm run build:windows:widevine): it must carry the full Mac set,
//   the only one free EVS signs (packaging/windows-widevine.cjs).
// Reads only; never changes the program. Prints the wire as JSON and exits 1 when a fuse is wrong.
import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {forPlatform, SHIPPED, readFuses, fuseProblems, describe} = require('../packaging/fuses.cjs');
const program = process.argv[2];
if (!program || !fs.existsSync(program)) { console.error('Pass a packaged Acira: a Mac .app bundle or a Windows .exe.'); process.exit(2); }
const platform = /\.app\/?$/i.test(program) ? 'darwin' : /\.exe$/i.test(program) ? 'win32' : null;
if (!platform) { console.error('Pass a Mac .app bundle or a Windows .exe.'); process.exit(2); }
const widevine = platform === 'win32' && fs.existsSync(path.resolve(program) + '.sig');
const fuses = await readFuses(path.resolve(program)), problems = await fuseProblems(path.resolve(program), widevine ? SHIPPED : forPlatform(platform));
console.log(JSON.stringify({program: path.resolve(program), platform, ...(widevine ? {build: 'widevine (EVS fuse set)'} : {}), ok: !problems.length, fuses, ...(problems.length ? {problems: describe(problems)} : {})}, null, 2));
process.exit(problems.length ? 1 : 0);
