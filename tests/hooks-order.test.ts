import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Rules of hooks, kept for the whole interface: a hook (use…) is never called after a `return` that only some renders reach, and never inside an if, loop,
// switch, try, ternary or the right side of &&, || and ??. A component that does so draws a different number of hooks from one render to the next, and React
// throws "Rendered more hooks than during the previous render" (error #310, or #300 when fewer): the view shows "Acira couldn't display this view" and reloads
// itself. Found on 9 Nov 2026: SidebarApps called useSidebarSize after `if(hidden)return null` and the no-favorites returns, so the first favorite added to a
// sidebar that had none (and the last one removed, and Hide favorites) crashed the interface. The check reads the source, as the node test runner has no DOM
// to re-render a component in.

type Hit = { line: number; fn: string; hook: string; why: string };
const isFn = (node: ts.Node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node);
const isHookCall = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node) && (
  (ts.isIdentifier(node.expression) && /^use[A-Z0-9]/.test(node.expression.text)) ||
  (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'React' && /^use[A-Z0-9]/.test(node.expression.name.text)));
const CONDITIONAL_OPERATORS = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];

/** Hook calls that are not reached by every render of the function that holds them. */
export function hookOrderHits(source: string, name = 'source.tsx'): Hit[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const check = (fn: ts.Node) => {
    const hooks: { node: ts.CallExpression; conditional: boolean }[] = [], returns: { node: ts.ReturnStatement; conditional: boolean }[] = [];
    const visit = (node: ts.Node, conditional: boolean) => {
      if (node !== fn && isFn(node)) return; // another function is checked on its own
      if (ts.isBinaryExpression(node) && CONDITIONAL_OPERATORS.includes(node.operatorToken.kind)) { visit(node.left, conditional); visit(node.right, true); return; }
      const inner = conditional || ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
      if (ts.isReturnStatement(node)) returns.push({ node, conditional });
      if (isHookCall(node)) hooks.push({ node, conditional });
      ts.forEachChild(node, child => visit(child, inner));
    };
    visit(fn, false);
    const label = (fn as { name?: ts.Node }).name?.getText() || (fn.parent && ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText() : '(anonymous)');
    for (const hook of hooks) {
      const text = hook.node.expression.getText();
      if (hook.conditional) { hits.push({ line: lineOf(hook.node), fn: label, hook: text, why: 'inside a condition or loop' }); continue; }
      const earlier = returns.find(item => item.node.getEnd() <= hook.node.getStart());
      if (earlier) hits.push({ line: lineOf(hook.node), fn: label, hook: text, why: `after the return on line ${lineOf(earlier.node)}` });
    }
  };
  const all = (node: ts.Node) => { if (isFn(node)) check(node); ts.forEachChild(node, all); };
  all(file);
  return hits;
}

test('the check sees a hook after an early return, in a condition, and a loop; it leaves ordered hooks alone', () => {
  const early = hookOrderHits('function A({hidden}){ const a = useX(); if (hidden) return null; const b = useSidebarSize(1); return b; }');
  assert.deepEqual(early.map(hit => [hit.fn, hit.hook, hit.why]), [['A', 'useSidebarSize', 'after the return on line 1']]);
  assert.equal(hookOrderHits('function B({on}){ if (on) { useY(); } return null; }').length, 1);
  assert.equal(hookOrderHits('function C({on}){ const v = on && useY(); return v; }').length, 1);
  assert.equal(hookOrderHits('function D({list}){ for (const i of list) useY(i); return null; }').length, 1);
  assert.equal(hookOrderHits('const E = ({on}) => on ? useY() : null;').length, 1);
  assert.deepEqual(hookOrderHits('function F({on}){ const a = useX(), b = React.useMemo(() => 1, []); if (on) return null; return <p>{a}{b}</p>; }', 'f.tsx'), []);
  assert.deepEqual(hookOrderHits('function G(){ return useSyncExternalStore(a, b, c); }'), []);
  // a return inside a callback, or inside an accessor, is not the component's own return
  assert.deepEqual(hookOrderHits('function H(){ const go = () => { if (1) return 2; return 3; }; const a = useX(); return { get v() { return a; } }; }'), []);
});

test('no component or hook in src/ calls a hook after a return some renders skip, or inside a condition or loop', () => {
  const files: string[] = [];
  const walk = (folder: string) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else if (/\.tsx?$/.test(entry.name)) files.push(full); } };
  walk(path.resolve(import.meta.dirname, '..', 'src'));
  assert.ok(files.length > 300, 'the interface sources were found');
  const found = files.flatMap(file => hookOrderHits(fs.readFileSync(file, 'utf8'), file).map(hit => `${path.relative(path.resolve(import.meta.dirname, '..'), file)}:${hit.line} ${hit.fn}: ${hit.hook} ${hit.why}`));
  assert.deepEqual(found, [], 'React would throw error #310/#300 when the number of hooks changes between renders');
});
