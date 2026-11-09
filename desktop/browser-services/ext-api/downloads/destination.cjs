'use strict';
// Where an extension's download goes (chrome.downloads.download's filename, conflictAction and saveAs). Chrome puts it in the Downloads folder
// without asking, whatever the person's "ask where to save" setting says; saveAs (or conflictAction "prompt" when the file exists) shows the
// Save dialog. The download engine calls chooseDestination() once the response has started.
const fs = require('node:fs');
const path = require('node:path');
const { deviceSafe, fitName, windowsNameUnits } = require('../../../download-preferences.cjs'); // Windows device names ("aux.pdf") get an underscore, as Chromium's own names do

const illegal = /[<>:"/\\|?*\u0000-\u001f]/g;
/** A file name from the server's suggestion: one safe path component. */
function safeName(name, platform = process.platform) {
  return deviceSafe(path.basename(String(name || 'download')).replace(illegal, '_').replace(/[. ]+$/, '') || 'download', platform);
}
const taken = file => fs.existsSync(file) || fs.existsSync(file + '.crdownload');
/** "report.pdf" -> "report (1).pdf" -> "report (2).pdf" ... the first free name beside the file. */
function uniquePath(file) {
  if (!taken(file)) return file;
  const folder = path.dirname(file), extension = require('../../../download-preferences.cjs').extensionOf(path.basename(file)), stem = path.basename(file, extension);
  for (let n = 1; n < 10000; n++) { const candidate = path.join(folder, `${stem} (${n})${extension}`); if (!taken(candidate)) return candidate; }
  throw new Error('No free file name in the download folder.');
}

/** Is `wanted` the folder itself or something inside it? A drive root ("D:\\") or a share root ("\\\\nas\\downloads") already ends with the separator: adding another one made every path in it "outside". */
function insideFolder(wanted, folder, pathApi = path) {
  return wanted === folder || wanted.startsWith(folder.endsWith(pathApi.sep) ? folder : folder + pathApi.sep);
}
/** The same name cut to what a file can be called there: 255 bytes everywhere, and on Windows (no long paths) a whole path under 260 characters, with room for " (n)" and ".crdownload". */
function fitWanted(wanted, platform = process.platform) {
  const folder = path.dirname(wanted), base = path.basename(wanted), extension = path.extname(base);
  return path.join(folder, fitName(extension ? base.slice(0, -extension.length) : base, extension, windowsNameUnits(folder, platform)) + extension);
}

/**
 * ctx: {item, owner, dialog, preferences, app, t, testDir, request: {filename?, conflictAction, saveAs}}
 * Returns {canceled, filePath} like dialog.showSaveDialog. The path is always inside the download folder unless the person chose it in the dialog.
 */
async function chooseDestination({item, owner, dialog, preferences, app, t = id => id, testDir, request = {}, platform = process.platform}) {
  const folder = path.resolve(testDir || (preferences && preferences.get().folder) || app.getPath('downloads'));
  const parts = request.filename ? String(request.filename).split(/[\\/]+/).filter(Boolean).map(part => safeName(part)) : [safeName(item.getFilename())];
  const resolved = path.resolve(folder, ...parts);
  if (!insideFolder(resolved, folder)) throw new Error('Invalid filename');
  const wanted = resolved === folder ? resolved : fitWanted(resolved, platform);
  const conflict = request.conflictAction || 'uniquify', exists = taken(wanted);
  if (request.saveAs || (conflict === 'prompt' && exists)) {
    fs.mkdirSync(path.dirname(wanted), {recursive: true});
    return dialog.showSaveDialog(owner && owner.window, {title: t('dl.saveTitle'), defaultPath: conflict === 'uniquify' ? uniquePath(wanted) : wanted});
  }
  fs.mkdirSync(path.dirname(wanted), {recursive: true});
  return {canceled: false, filePath: conflict === 'overwrite' ? wanted : uniquePath(wanted)};
}

module.exports = {chooseDestination, uniquePath, safeName, insideFolder, fitWanted};
