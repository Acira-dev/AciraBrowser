// Checks that a FINISHED Acira app carries every extension API package.
//   node scripts/check-bundled-ext-api.mjs <app.asar | the app's resources or app folder | a main.cjs> [--commit <rev>]
// Until 13.8 the packaged Mac and Windows apps shipped none of the packages (desktop/browser-services/ext-api/): the loader read a folder the bundle does not have. The release
// builds now fail when a package is missing from the bundle (scripts/desktop-bundle.mjs bundleDesktop); this is the same check on a packaged app, for the Mac and Windows
// packagers and for a person: it reads desktop/main.cjs out of the app (an app.asar is read with @electron/asar) and compares it with the package files of the source tree.
// Two kinds of app: the Mac and Windows apps hold ONE bundled main.cjs (the packages are inside it: each one's source-path comment and its binding are checked), the Linux app holds
// the unbundled tree as written (desktop/main.cjs is source; the packages are files of the app.asar: each one, and _packages.cjs, must be there). Which it is is read from main.cjs.
// The expected files come from the working tree next to this script, or from a commit (--commit), which is what a build of that commit must carry.
// Exit 0: every package is in. Exit 1: names what is missing. Nothing is written anywhere.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EXT_API_DIR, extApiPackageFiles, checkBundledText, checkUnbundledTree, isBundledMain} from './desktop-bundle.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const commitAt = args.indexOf('--commit');
const commit = commitAt >= 0 ? args[commitAt + 1] : null;
const target = args.find((value, index) => !value.startsWith('--') && index !== (commitAt >= 0 ? commitAt + 1 : -1));
if (!target) { console.error('Usage: node scripts/check-bundled-ext-api.mjs <app.asar | app or resources folder | main.cjs> [--commit <rev>]'); process.exit(2); }

/** The names in a folder as repository-style paths (desktop/browser-services/ext-api/x.cjs); nothing when the folder is not there. */
const folderPaths = folder => { try { return fs.readdirSync(folder).map(name => `${EXT_API_DIR}/${name}`); } catch { return []; } };

/** The app: the text of desktop/main.cjs, and (asked for only when main.cjs is not a bundle) the paths the app holds. From the file itself, an app.asar, or a folder that holds
 *  desktop/main.cjs, app.asar or resources/app.asar. */
function readApp(location) {
  const full = path.resolve(location);
  const stat = fs.statSync(full);
  const fromAsar = file => ({text: require('@electron/asar').extractFile(file, 'desktop/main.cjs').toString('utf8'), paths: () => require('@electron/asar').listPackage(file, {isPack: false})});
  const fromTree = main => ({text: fs.readFileSync(main, 'utf8'), paths: () => folderPaths(path.join(path.dirname(main), 'browser-services', 'ext-api'))});
  if (stat.isFile() && full.endsWith('.asar')) return fromAsar(full);
  if (stat.isFile()) return fromTree(full);
  for (const candidate of ['desktop/main.cjs', 'app/desktop/main.cjs', 'resources/app/desktop/main.cjs']) if (fs.existsSync(path.join(full, candidate))) return fromTree(path.join(full, candidate));
  for (const candidate of ['app.asar', 'resources/app.asar', 'Contents/Resources/app.asar']) if (fs.existsSync(path.join(full, candidate))) return fromAsar(path.join(full, candidate));
  throw new Error(`No desktop/main.cjs or app.asar found in ${full}`);
}

/** The package files the tree has: the folder on disk, or a commit's tree. */
function expectedFiles() {
  if (commit) return extApiPackageFiles(execFileSync('git', ['ls-tree', '-r', '--name-only', commit, EXT_API_DIR + '/'], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean));
  return extApiPackageFiles(fs.readdirSync(path.join(root, EXT_API_DIR)).map(name => `${EXT_API_DIR}/${name}`));
}

try {
  const app = readApp(target), files = expectedFiles();
  if (isBundledMain(app.text)) {
    checkBundledText(app.text, files);
    console.log(`OK: ${files.length} extension API package files are in ${target} (${(app.text.length / 1e6).toFixed(1)} MB of main.cjs)`);
  } else {
    const paths = app.paths();
    checkUnbundledTree(paths, files);
    const held = paths.filter(item => String(item).replaceAll('\\', '/').includes(EXT_API_DIR + '/')).length;
    console.log(`OK: ${files.length} extension API package files and _packages.cjs are in ${target} as files (an unbundled app: main.cjs is source; ${held} entries under ${EXT_API_DIR})`);
  }
} catch (error) {
  console.error('FAIL: ' + (error && error.message || error));
  process.exit(1);
}
