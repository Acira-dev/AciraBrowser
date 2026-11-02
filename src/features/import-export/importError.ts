import { t } from '../../i18n';
export type ImportErrorAction = 'source' | 'selection' | 'receipt' | 'html' | 'export-html' | 'export-json' | 'previous';

/** Keep the native failure intact for details while making the next action clear. */
export function importErrorPresentation(details: string, action: ImportErrorAction) {
  const exporting = action === 'export-html' || action === 'export-json';
  const fileAction = action === 'html' || exporting;
  const code = details.match(/(?:^|\bError:\s*|:\s+)(ENOENT|ENOTDIR|EISDIR|EACCES|EPERM|EROFS)(?=:\s)/)?.[1];
  let title: string, message: string;
  if (fileAction && (code === 'ENOENT' || code === 'ENOTDIR')) {
    title = exporting ? t('import.err.destUnavailable') : t('import.err.fileUnavailable');
    message = exporting ? t('import.err.destUnavailableMsg') : t('import.err.fileUnavailableMsg');
  } else if (fileAction && code === 'EISDIR') {
    title = exporting ? t('import.err.chooseExportFile') : t('import.err.chooseBookmarksFile');
    message = exporting ? t('import.err.folderSelected') : t('import.err.selectHtml');
  } else if (fileAction && (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')) {
    title = exporting ? t('import.err.cantWrite') : t('import.err.cantRead');
    message = exporting ? t('import.err.cantWriteMsg') : t('import.err.cantReadMsg');
  } else if (exporting) {
    title = t('import.err.exportFailed'); message = t('import.err.exportFailedMsg');
  } else if (action === 'html') {
    title = t('import.err.importFailed'); message = t('import.err.htmlFailedMsg');
  } else if (action === 'receipt' || action === 'previous') {
    title = t('import.err.undoFailed'); message = t('import.err.undoFailedMsg');
  } else if (action === 'selection') {
    title = t('import.err.importFailed'); message = t('import.err.selectionMsg');
  } else {
    title = t('import.err.readFailed'); message = t('import.err.readFailedMsg');
  }
  return { title, message, details };
}
