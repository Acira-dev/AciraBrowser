// Turns a crash stack from the packaged main process back into source locations.
//   node scripts/symbolicate-stack.mjs <main.cjs.map> [stack.txt]      (stack from the file, or from stdin)
// A packaged build runs desktop/main.cjs as one bundle, so a stack says "main.cjs:54218:766"; the map for that exact build
// (kept beside every release in sourcemaps/main.cjs.map, never shipped in the product) says which file and line that was.
import fs from 'node:fs';
import {SourceMap} from 'node:module';

const [mapFile, stackFile] = process.argv.slice(2);
if (!mapFile) { console.error('usage: node scripts/symbolicate-stack.mjs <main.cjs.map> [stack.txt]'); process.exit(2); }
const map = new SourceMap(JSON.parse(fs.readFileSync(mapFile, 'utf8')));
const stack = fs.readFileSync(stackFile || 0, 'utf8');
process.stdout.write(stack.replace(/[^\s()]*(main\.cjs):(\d+):(\d+)/g, (whole, name, line, column) => {
  const entry = map.findEntry(Number(line) - 1, Number(column) - 1);
  return entry && entry.originalSource ? `${entry.originalSource.replace(/^(?:\.\.\/)+/, '')}:${entry.originalLine + 1}:${entry.originalColumn + 1} (${whole})` : whole;
}));
