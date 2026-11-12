import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createPrism, createPrismAsync } from '../src/features/onboarding/prismRenderer';

// 13.7, glitch 19: on a brand-new profile the first-run screen (and its "Skip setup" button) came up 8 to 15 s after the window opened, on 13.6 as well. A CPU profile of the
// interface page showed one function of the Onboarding chunk, 4.4 to 5 s of a single task: prismRenderer.ts build(), which compiled five WebGL programs and read their link status
// at once (the thread waits for the driver to compile them all; D3D shader compiles on this laptop), before the scene or the card could be drawn. The programs are now handed to the
// driver (KHR_parallel_shader_compile) and read once it says it is done.

/** A WebGL2 context that does nothing, except what is looked at: the extension, the programs' completion and link status, and what asked for a uniform before they were done. */
function fakeContext({ parallel = true, polls = 3 } = {}) {
  const log: string[] = [];
  let done = 0, complete = false;
  const COMPLETION = 0x91b1, LINK = 0x8b82;
  const overrides: Record<string, unknown> = {
    getExtension: (name: string) => { if (name === 'KHR_parallel_shader_compile') log.push('extension asked'); return name === 'KHR_parallel_shader_compile' && parallel ? { COMPLETION_STATUS_KHR: COMPLETION } : name === 'EXT_color_buffer_float' ? {} : null; },
    compileShader: () => { log.push('compile'); },
    getProgramParameter: (_program: unknown, name: number) => {
      if (name === COMPLETION) { done++; complete = done > polls * 5; log.push(complete ? 'complete' : 'busy'); return complete; }
      log.push(complete || !parallel ? 'link status' : 'link status BEFORE the driver was done');
      return true;
    },
    getUniformLocation: () => { log.push(complete || !parallel ? 'uniform' : 'uniform BEFORE the driver was done'); return {}; },
    LINK_STATUS: LINK, isContextLost: () => false, createProgram: () => ({}), createShader: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}),
  };
  const gl = new Proxy({}, { get: (_t, key: string) => (key in overrides ? overrides[key] : /^[A-Z0-9_]+$/.test(key) ? 1 : () => undefined) });
  const canvas = { getContext: () => gl, getBoundingClientRect: () => ({ width: 100, height: 100 }), width: 100, height: 100 } as unknown as HTMLCanvasElement;
  return { canvas, log };
}

test('createPrismAsync waits for the driver to finish compiling before it reads a link status or a uniform, and polls instead of blocking', async () => {
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
  const { canvas, log } = fakeContext({ polls: 3 });
  const prism = await createPrismAsync(canvas, 1, 5000);
  assert.ok(prism && typeof prism.draw === 'function' && typeof prism.resize === 'function' && typeof prism.dispose === 'function', 'the renderer comes back');
  assert.ok(log.filter((line) => line === 'busy').length >= 1, 'the programs were still compiling when it first looked: ' + log.slice(0, 6).join(', '));
  assert.ok(log.indexOf('complete') > 0, 'it saw them complete');
  assert.deepEqual(log.filter((line) => /BEFORE/.test(line)), [], 'nothing asked for a link status or a uniform before the driver was done');
  // The driver only compiles in its own threads for programs made after the extension is on: the first build in 13.7 asked for it after compiling, and was still synchronous (4.8 s).
  assert.ok(log.indexOf('extension asked') >= 0 && log.indexOf('extension asked') < log.indexOf('compile'), 'the extension is asked for before the first shader is compiled');
  assert.ok(log.includes('link status') && log.includes('uniform'), 'and then it did');
});

test('without the extension it is the synchronous build, a turn later; the synchronous createPrism is as it was', async () => {
  const none = fakeContext({ parallel: false });
  assert.ok(await createPrismAsync(none.canvas, 1, 5000));
  assert.deepEqual(none.log.filter((line) => /BEFORE|busy|complete/.test(line)), []);
  assert.ok(createPrism(fakeContext({ parallel: true }).canvas), 'createPrism still returns a renderer at once');
});

test('the first-run field builds its renderer with createPrismAsync, and drops one that arrives after it was unmounted', () => {
  const field = fs.readFileSync(new URL('../src/features/onboarding/PrismField.tsx', import.meta.url), 'utf8');
  assert.match(field, /import \{ createPrismAsync, type Prism, type PrismInputs \} from "\.\/prismRenderer";/);
  assert.match(field, /void createPrismAsync\(host\)\.then\(\(prism\) => \{\s*if \(!live\) \{\s*prism\?\.dispose\(\);/);
  assert.doesNotMatch(field, /createPrism\(node\)/, 'no synchronous build at mount');
});
