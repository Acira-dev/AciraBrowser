import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// The Windows helper programs compiled from packaging/installer (scripts/build-installer-helper.cjs): the installer's two, and
// acira-verify.exe, which ships inside the app (resources/acira-verify.exe; desktop/windows-helper.cjs).
export const HELPERS = Object.freeze(['acira-progress.exe', 'acira-uninstall.exe', 'acira-verify.exe']);
export const APP_HELPERS = Object.freeze(['acira-verify.exe']);

// Helpers are generated from retained C# and frame inputs. Always rebuild them;
// signing may modify a file before it reports failure, so restore both files in
// finally without trusting the signer's returned list or modifying the Git index.
export function withInstallerHelpers({root, sign, build, names = HELPERS, compile = () =>
  execFileSync(process.execPath, [path.join(root, 'scripts/build-installer-helper.cjs'), ...(names === HELPERS ? [] : names)],
    {cwd: root, stdio: 'inherit', windowsHide: true})}) {
  const files = names.map(name => path.join(root, 'packaging/installer', name));
  const original = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
  try {
    compile();
    files.forEach(file => fs.readFileSync(file)); // Missing output fails closed.
    sign(files);
    return build(files);
  } finally {
    for (let i = 0; i < files.length; i++) {
      const restore = original[i];
      if (restore) fs.writeFileSync(files[i], restore);
      else fs.rmSync(files[i], {force: true});
    }
  }
}
