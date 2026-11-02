// The main process is plain JS, so a name used outside the scope that declares it only fails at runtime (25 Oct: a
// per-window metrics service called from the app-wide startup timer crashed every launch after 20 s). Fail on any
// name TypeScript cannot resolve.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ts = require('typescript');

const entry = path.join(__dirname, '..', 'desktop', 'main.cjs');

test('desktop/main.cjs uses no undefined names', () => {
  const program = ts.createProgram([entry], {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, types: ['node'],
  });
  const source = program.getSourceFile(entry);
  const unresolved = ts.getPreEmitDiagnostics(program, source)
    .filter(d => d.code === 2304 || d.code === 2552)
    .map(d => {
      const { line, character } = source.getLineAndCharacterOfPosition(d.start);
      return `main.cjs:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
  assert.deepStrictEqual(unresolved, []);
});
