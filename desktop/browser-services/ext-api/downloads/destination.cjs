'use strict';
// Where an extension's download goes (chrome.downloads.download's filename, conflictAction and saveAs). Chrome puts it in the Downloads folder
// without asking, whatever the person's "ask where to save" setting says; saveAs (or conflictAction "prompt" when the file exists) shows the
// Save dialog. The download engine calls chooseDestination() once the response has started.
const fs = require('node:fs');
const path = require('node:path');

const illegal = /[<>:"/\\|?*\u0000-\u001f]/g;
/** A file name from the server's suggestion: one safe path component. */
function safeName(name) {
  return path.basename(String(name || 'download')).replace(illegal, '_').replace(/[. ]+$/, '') || 'download';
}
const taken = file => fs.existsSync(file) || fs.existsSync(file + '.crdownload');
/** "report.pdf" -> "report (1).pdf" -> "report (2).pdf" ... the first free name beside the file. */
function uniquePath(file) {
  if (!taken(file)) return file;
  const folder = path.dirname(file), extension = path.extname(file), stem = path.basename(file, extension);
  for (let n = 1; n < 10000; n++) { const candidate = path.join(folder, `${stem} (${n})${extension}`); if (!taken(candidate)) return candidate; }
  throw new Error('No free file name in the download folder.');
}

/**
 * ctx: {item, owner, dialog, preferences, app, t, testDir, request: {filename?, conflictAction, saveAs}}
 * Returns {canceled, filePath} like dialog.showSaveDialog. The path is always inside the download folder unless the person chose it in the dialog.
 */
async function chooseDestination({item, owner, dialog, preferences, app, t = id => id, testDir, request = {}}) {
  const folder = path.resolve(testDir || (preferences && preferences.get().folder) || app.getPath('downloads'));
  const parts = request.filename ? String(request.filename).split(/[\\/]+/).filter(Boolean).map(safeName) : [safeName(item.getFilename())];
  const wanted = path.resolve(folder, ...parts);
  if (wanted !== folder && !wanted.startsWith(folder + path.sep)) throw new Error('Invalid filename');
  const conflict = request.conflictAction || 'uniquify', exists = taken(wanted);
  if (request.saveAs || (conflict === 'prompt' && exists)) {
    fs.mkdirSync(path.dirname(wanted), {recursive: true});
    return dialog.showSaveDialog(owner && owner.window, {title: t('dl.saveTitle'), defaultPath: conflict === 'uniquify' ? uniquePath(wanted) : wanted});
  }
  fs.mkdirSync(path.dirname(wanted), {recursive: true});
  return {canceled: false, filePath: conflict === 'overwrite' ? wanted : uniquePath(wanted)};
}

module.exports = {chooseDestination, uniquePath, safeName};
