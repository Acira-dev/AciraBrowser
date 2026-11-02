import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Helpers are generated from retained C# and frame inputs. Always rebuild them;
// signing may modify a file before it reports failure, so restore both files in
// finally without trusting the signer's returned list or modifying the Git index.
export function withInstallerHelpers({root, sign, build, compile = () =>
  execFileSync(process.execPath, [path.join(root, 'scripts/build-installer-helper.cjs')],
    {cwd: root, stdio: 'inherit', windowsHide: true})}) {
  const files = ['acira-progress.exe', 'acira-uninstall.exe']
    .map(name => path.join(root, 'packaging/installer', name));
  const original = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
  try {
    compile();
    files.forEach(file => fs.readFileSync(file)); // Missing output fails closed.
    sign(files);
    return build();
  } finally {
    for (let i = 0; i < files.length; i++) {
      const restore = original[i];
      if (restore) fs.writeFileSync(files[i], restore);
      else fs.rmSync(files[i], {force: true});
    }
  }
}
