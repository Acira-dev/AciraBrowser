#!/usr/bin/env node
// Generates desktop/browser-services/extension-api-surface.gen.cjs from Chromium's own extension API definitions, vendored unchanged in
// desktop/browser-services/chromium-api/ (see the README there for the source revision). Nothing here is hand-written API knowledge: every
// namespace, member, parameter, enum value, constant, default, callback/promise rule and permission gate comes from Chromium's schema files
// (JSON, the old extensions IDL and the newer WebIDL) and its feature files (_api_features / _permission_features / _manifest_features).
//
// What counts as "exposed": a namespace whose feature (with its dependencies) is available to a normal Chrome Web Store extension on Windows
// on the stable channel - not app-only, not component/policy/allowlisted, not ChromeOS/Android-only, not internal, not MV2-only. Everything
// else is listed under `excluded` with Chromium's reason, so a reader can see why it is not part of the surface.
//
// Usage:  node scripts/gen-extension-api.mjs            write the generated module
//         node scripts/gen-extension-api.mjs --check    exit 1 if the generated module is out of date
//         node scripts/gen-extension-api.mjs --model <file.json>   also write the full model (all namespaces, incl. excluded)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR = path.join(ROOT, 'desktop', 'browser-services', 'chromium-api');
export const OUT = path.join(ROOT, 'desktop', 'browser-services', 'extension-api-surface.gen.cjs');
const DIRS = ['chrome/common/extensions/api', 'extensions/common/api'];
const SCHEMA_DIRS = [...DIRS, 'chrome/common/extensions/api/devtools'];
// Chromium marks debugger developer_mode_only, but its own comment in _api_features.json says this holds only when the
// kDebuggerAPIRestrictedToDevMode feature is enabled (not in production), so it is treated as a normal API.
const PRODUCTION_IGNORES_DEV_MODE = new Set(['debugger']);
// Namespaces whose feature says "stable, all extension types" but which Chromium only binds in test builds.
const TEST_ONLY = {test: 'bound only in browser tests (chrome.test); not shipped to Web Store extensions'};

// ---------------------------------------------------------------- JSON with comments (Chromium's json_comment_eater rules: // and /* */
// outside strings).
export function stripComments(text) {
  let out = '', i = 0, inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) { out += c; if (c === '\\') { out += text[i + 1]; i += 2; continue; } if (c === '"') inString = false; i++; continue; }
    if (c === '"') { inString = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    out += c; i++;
  }
  return out;
}
export const readJsonc = file => JSON.parse(stripComments(fs.readFileSync(file, 'utf8')));

// ---------------------------------------------------------------- IDL tokenizer + parser (shared by the old IDL and WebIDL formats)
function tokenize(text) {
  const tokens = [];
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"((?:[^"\\]|\\.)*)"|(-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?))|([A-Za-z_][\w.]*)|(.)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) tokens.push({t: 'str', v: m[1]});
    else if (m[2] !== undefined) tokens.push({t: 'num', v: m[2]});
    else if (m[3] !== undefined) tokens.push({t: 'id', v: m[3]});
    else if (m[4] !== undefined) tokens.push({t: 'p', v: m[4]});
  }
  return tokens;
}
class Parser {
  constructor(text, file) { this.k = tokenize(text); this.i = 0; this.file = file; }
  peek(o = 0) { return this.k[this.i + o]; }
  next() { return this.k[this.i++]; }
  is(v, o = 0) { const t = this.peek(o); return !!t && t.t !== 'str' && t.v === v; }
  eat(v) { if (this.is(v)) { this.i++; return true; } return false; }
  fail(what) { throw Error(`${this.file}: expected ${what} near ${JSON.stringify(this.k.slice(this.i, this.i + 8).map(t => t.v).join(' '))}`); }
  expect(v) { if (!this.eat(v)) this.fail(`'${v}'`); }
  id() { const t = this.next(); if (!t || t.t !== 'id') { this.i--; this.fail('identifier'); } return t.v; }
  extAttrs() {
    const attrs = {};
    while (this.is('[')) {
      this.next();
      while (!this.eat(']')) {
        const name = this.id(); let value = true;
        if (this.eat('=')) value = this.attrValue();
        attrs[name] = value; this.eat(',');
      }
    }
    return attrs;
  }
  attrValue() {
    if (this.eat('(')) { const list = []; while (!this.eat(')')) { const t = this.next(); if (t.v !== ',') list.push(t.t === 'num' ? Number(t.v) : t.v); } return list; }
    const t = this.next(); return t.t === 'num' ? Number(t.v) : t.v;
  }
  type() {
    let ty;
    if (this.eat('(')) { const choices = [this.type()]; while (this.eat('or')) choices.push(this.type()); this.expect(')'); ty = {choices}; }
    else {
      let name = this.id();
      if (name === 'unsigned' || name === 'unrestricted') name = this.id();
      if (name === 'long' && this.is('long')) this.next();
      if (this.eat('<')) { const args = [this.type()]; while (this.eat(',')) args.push(this.type()); this.expect('>'); ty = {generic: name, args}; }
      else ty = {name};
    }
    if (this.eat('?')) ty.nullable = true;
    while (this.is('[') && this.is(']', 1)) { this.i += 2; ty = {generic: 'sequence', args: [ty]}; if (this.eat('?')) ty.nullable = true; }
    return ty;
  }
  literal() { // default values / const values
    const t = this.next();
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'str') return t.v;
    if (t.v === 'true') return true; if (t.v === 'false') return false; if (t.v === 'null') return null;
    if (t.v === '[' && this.eat(']')) return []; if (t.v === '{' && this.eat('}')) return {};
    return t.v;
  }
  args() { // '(' args ')'
    this.expect('(');
    const list = [];
    while (!this.eat(')')) {
      const attrs = this.extAttrs(); const optional = this.eat('optional'); const type = this.type(); const name = this.id();
      let def; if (this.eat('=')) def = this.literal();
      list.push({name, type, attrs, optional, def}); this.eat(',');
    }
    return list;
  }
  skipBlock() { let depth = 0; do { const t = this.next(); if (!t) return; if (t.v === '{') depth++; else if (t.v === '}') depth--; } while (depth > 0); }
}

// Raw declarations (both IDL dialects): enum / dictionary / callback / interface / typedef.
function parseDecls(p, endToken) {
  const decls = [];
  while (p.peek() && !(endToken && p.is(endToken))) {
    const attrs = p.extAttrs();
    if (p.eat('enum')) {
      const name = p.id(); p.expect('{'); const values = [];
      while (!p.eat('}')) { p.extAttrs(); const t = p.next(); if (t.v !== ',') values.push(t.v); }
      p.eat(';'); decls.push({kind: 'enum', name, attrs, values});
    } else if (p.is('dictionary') || p.is('partial') && p.is('dictionary', 1)) {
      const partial = p.eat('partial'); p.expect('dictionary');
      const name = p.id(); if (p.eat(':')) p.id(); p.expect('{'); const members = [];
      while (!p.eat('}')) {
        const mattrs = p.extAttrs();
        if (p.is('static')) { p.next(); const type = p.type(); const mname = p.id(); const args = p.args(); p.eat(';'); members.push({fn: true, name: mname, type, args, attrs: mattrs}); continue; }
        const required = p.eat('required'); const type = p.type(); const mname = p.id(); let def; if (p.eat('=')) def = p.literal(); p.eat(';');
        members.push({name: mname, type, attrs: mattrs, required, def});
      }
      p.eat(';'); if (!partial) decls.push({kind: 'dictionary', name, attrs, members}); // partial ExtensionManifest = manifest keys, not API
    } else if (p.eat('callback')) {
      const name = p.id(); p.expect('='); const ret = p.type(); const args = p.args(); p.eat(';');
      decls.push({kind: 'callback', name, attrs, ret, args});
    } else if (p.is('partial') || p.is('interface')) {
      const partial = p.eat('partial'); p.expect('interface'); const name = p.id(); let parent; if (p.eat(':')) parent = p.id();
      p.expect('{'); const members = [];
      while (!p.eat('}')) {
        const mattrs = p.extAttrs();
        if (p.eat('const')) { const type = p.type(); const mname = p.id(); p.expect('='); const value = p.literal(); p.eat(';'); members.push({kind: 'const', name: mname, type, value, attrs: mattrs}); continue; }
        const isStatic = p.eat('static'); const readonly = p.eat('readonly');
        if (p.eat('attribute')) { const type = p.type(); const mname = p.id(); p.eat(';'); members.push({kind: 'attribute', name: mname, type, readonly, attrs: mattrs}); continue; }
        const type = p.type(); const mname = p.id(); const args = p.args(); p.eat(';');
        members.push({kind: 'operation', name: mname, type, args, attrs: mattrs, isStatic});
      }
      p.eat(';'); decls.push({kind: 'interface', name, partial, parent, attrs, members});
    } else if (p.eat('typedef')) {
      const tattrs = p.extAttrs(); const type = p.type(); const name = p.id(); p.eat(';'); decls.push({kind: 'typedef', name, attrs: {...attrs, ...tattrs}, type});
    } else if (p.eat('namespace')) {
      const name = p.id(); p.expect('{'); const inner = parseDecls(p, '}'); p.expect('}'); p.eat(';');
      decls.push({kind: 'namespace', name, attrs, decls: inner});
    } else if (p.peek()) { const t = p.next(); if (t.v === '{') { p.i--; p.skipBlock(); } }
  }
  return decls;
}

// ---------------------------------------------------------------- IDL type -> Chromium JSON-schema spec
const PRIMITIVE = {DOMString: 'string', USVString: 'string', ByteString: 'string', long: 'integer', short: 'integer', byte: 'integer', octet: 'integer',
  double: 'number', float: 'number', boolean: 'boolean', object: 'object', any: 'any', ArrayBuffer: 'binary', ArrayBufferView: 'binary',
  Uint8Array: 'binary', Function: 'function', Blob: 'binary'};
function typeSpec(ty, ctx, attrs = {}) {
  if (attrs.ExternalExtensionType) return {$ref: attrs.ExternalExtensionType};
  if (ty.choices) return {choices: ty.choices.map(c => typeSpec(c, ctx)).filter(Boolean)};
  if (ty.generic === 'sequence' || ty.generic === 'FrozenArray') return {type: 'array', items: typeSpec(ty.args[0], ctx) || {type: 'any'}};
  if (ty.generic === 'record') return {type: 'object', additionalProperties: typeSpec(ty.args[1], ctx) || {type: 'any'}};
  if (ty.generic === 'Promise') return typeSpec(ty.args[0], ctx);
  const name = ty.name;
  if (name === 'void' || name === 'undefined') return null;
  if (PRIMITIVE[name]) {
    const spec = {type: PRIMITIVE[name]};
    if (attrs.instanceOf) spec.isInstanceOf = String(attrs.instanceOf);
    if (attrs.legalValues) spec.enum = attrs.legalValues.map(String);
    return spec;
  }
  const local = ctx.local.get(name);
  if (local?.kind === 'callback') return {type: 'function', parameters: local.args.map(a => param(a, ctx)).filter(Boolean)};
  if (local?.kind === 'typedef') return local.attrs.ExternalExtensionType ? {$ref: local.attrs.ExternalExtensionType} : typeSpec(local.type, ctx, local.attrs);
  if (local) return {$ref: ctx.ns + '.' + name};
  return {$ref: name.includes('.') ? name : ctx.ns + '.' + name, unresolvedLocal: !name.includes('.') || undefined};
}
function commonAttrs(spec, attrs) {
  if (attrs.deprecated !== undefined) spec.deprecated = attrs.deprecated === true ? true : String(attrs.deprecated);
  if (attrs.nodoc) spec.nodoc = true;
  if (attrs.platforms) spec.platforms = [].concat(attrs.platforms).map(String);
  if (attrs.instanceOf && spec.type === 'object') spec.isInstanceOf = String(attrs.instanceOf);
  if (attrs.additionalProperties || attrs.ignoreAdditionalProperties) spec.ignoreAdditionalProperties = true;
  if (attrs.serializableFunction) spec.serializableFunction = true;
  return spec;
}
function param(arg, ctx) {
  const spec = typeSpec(arg.type, ctx, arg.attrs); if (!spec) return null;
  const out = {name: arg.name, ...spec};
  if (arg.optional || arg.type.nullable) out.optional = true;
  if (arg.def !== undefined) out.default = arg.def;
  return commonAttrs(out, arg.attrs);
}

function asyncFromCallback(arg, ctx, attrs) {
  const cb = ctx.local.get(arg.type.name);
  return {name: arg.name, optional: !!(arg.optional || arg.type.nullable) || undefined,
    parameters: (cb?.args || []).map(a => param(a, ctx)).filter(Boolean),
    does_not_support_promises: attrs.doesNotSupportPromises ? (attrs.doesNotSupportPromises === true ? true : String(attrs.doesNotSupportPromises)) : undefined};
}
function opToFunction(op, ctx, {webidl}) {
  const fn = commonAttrs({name: op.name}, op.attrs);
  let args = op.args;
  const last = args.at(-1);
  if (webidl && op.type.generic === 'Promise') {
    const result = typeSpec(op.type.args[0], ctx);
    fn.returns_async = {name: 'callback', parameters: result ? [{name: 'result', ...result, ...(op.type.args[0].nullable ? {optional: true} : {})}] : []};
    if (op.attrs.requiredCallback) fn.returns_async.does_not_support_promises = true;
  } else if (last && ctx.local.get(last.type.name)?.kind === 'callback' && !op.attrs.trailingCallbackIsFunctionParameter) {
    fn.returns_async = asyncFromCallback(last, ctx, op.attrs); args = args.slice(0, -1);
    const ret = typeSpec(op.type, ctx); if (ret) fn.returns = ret;
  } else {
    const ret = typeSpec(op.type, ctx); if (ret) fn.returns = ret;
  }
  fn.parameters = args.map(a => param(a, ctx)).filter(Boolean);
  if (op.attrs.nocompile) fn.nocompile = true;
  return fn;
}
function dictionaryToType(d, ctx) {
  const type = commonAttrs({id: d.name, type: 'object', properties: {}}, d.attrs);
  const functions = [];
  for (const m of d.members) {
    if (m.fn) { functions.push(opToFunction({name: m.name, type: m.type, args: m.args, attrs: m.attrs}, ctx, {webidl: ctx.webidl})); continue; }
    const spec = typeSpec(m.type, ctx, m.attrs); if (!spec) continue;
    const prop = commonAttrs({...spec}, m.attrs);
    if (ctx.webidl ? !m.required : m.type.nullable) prop.optional = true;
    if (m.def !== undefined) prop.default = m.def;
    type.properties[m.name] = prop;
  }
  if (functions.length) type.functions = functions;
  return type;
}
function localTypes(decls, ns, webidl) {
  const local = new Map(); for (const d of decls) if (d.kind !== 'interface' && d.kind !== 'namespace') local.set(d.name, d);
  const ctx = {ns, local, webidl};
  const types = [];
  for (const d of decls) {
    if (d.kind === 'enum') types.push(commonAttrs({id: d.name, type: 'string', enum: d.values}, d.attrs));
    else if (d.kind === 'dictionary') types.push(dictionaryToType(d, ctx));
  }
  return {ctx, types};
}

export function parseOldIdl(text, file) {
  const out = [];
  for (const nsDecl of parseDecls(new Parser(text, file)).filter(d => d.kind === 'namespace')) {
    const {ctx, types} = localTypes(nsDecl.decls, nsDecl.name, false);
    const ns = commonAttrs({namespace: nsDecl.name, types, functions: [], events: [], properties: {}}, nsDecl.attrs);
    for (const iface of nsDecl.decls.filter(d => d.kind === 'interface')) {
      for (const op of iface.members.filter(m => m.kind === 'operation')) {
        if (iface.name === 'Functions') ns.functions.push(opToFunction(op, ctx, {webidl: false}));
        else if (iface.name === 'Events') ns.events.push(commonAttrs({name: op.name, type: 'function', parameters: op.args.map(a => param(a, ctx)).filter(Boolean),
          ...(op.attrs.supportsFilters ? {supportsFilters: true} : {}), ...(op.attrs.maxListeners ? {maxListeners: op.attrs.maxListeners} : {})}, op.attrs));
        else if (iface.name === 'Properties') ns.properties[op.name] = {...typeSpec(op.type, ctx), ...(op.attrs.value !== undefined ? {value: op.attrs.value} : {})};
      }
    }
    out.push(ns);
  }
  return out;
}

export function parseWebIdl(text, file) {
  const decls = parseDecls(new Parser(text, file));
  const interfaces = new Map();
  for (const d of decls.filter(d => d.kind === 'interface')) {
    const prev = interfaces.get(d.name);
    interfaces.set(d.name, prev ? {...prev, members: [...prev.members, ...d.members], partial: prev.partial && d.partial, attrs: {...prev.attrs, ...d.attrs}} : d);
  }
  const out = [];
  const visit = (container, prefix) => {
    for (const m of container.members.filter(m => m.kind === 'attribute')) {
      const target = interfaces.get(m.type.name); if (!target) continue;
      const nsName = prefix ? prefix + '.' + m.name : m.name;
      if (target.partial) { visit(target, nsName); continue; }
      out.push(namespaceFromInterface(nsName, target, {...container.attrs, ...m.attrs}));
    }
  };
  const namespaceFromInterface = (nsName, iface, outerAttrs) => {
    const {ctx, types} = localTypes(decls, nsName, true);
    const ns = commonAttrs({namespace: nsName, types, functions: [], events: [], properties: {}}, {...outerAttrs, ...iface.attrs});
    for (const m of iface.members) {
      if (m.kind === 'operation') ns.functions.push(opToFunction(m, ctx, {webidl: true}));
      else if (m.kind === 'const') ns.properties[m.name] = {...(typeSpec(m.type, ctx) || {}), value: m.value};
      else if (m.kind === 'attribute') {
        const evIface = interfaces.get(m.type.name);
        if (evIface && evIface.parent === 'ExtensionEvent') {
          const add = evIface.members.find(x => x.name === 'addListener');
          const listener = add?.args[0]; const cb = listener && ctx.local.get(listener.type.name);
          ns.events.push(commonAttrs({name: m.name, type: 'function', parameters: (cb?.args || []).map(a => param(a, ctx)).filter(Boolean),
            ...(add && add.args.length > 1 ? {filters: add.args.slice(1).map(a => param(a, ctx)).filter(Boolean)} : {}),
            ...(m.attrs.maxListeners ? {maxListeners: m.attrs.maxListeners} : {}), ...(m.attrs.supportsFilters ? {supportsFilters: true} : {})}, {...evIface.attrs, ...m.attrs}));
        } else {
          const spec = typeSpec(m.type, ctx, m.attrs); if (spec) ns.properties[m.name] = commonAttrs({...spec}, m.attrs);
        }
      }
    }
    return ns;
  };
  const browser = interfaces.get('Browser'); if (browser) visit(browser, '');
  return out;
}

// ---------------------------------------------------------------- JSON schema files: already in this model; normalise local $refs and legacy
// trailing callbacks into returns_async.
function normaliseJsonNamespace(ns) {
  const qualify = spec => {
    if (!spec || typeof spec !== 'object') return spec;
    if (Array.isArray(spec)) return spec.map(qualify);
    const out = {};
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'description' || k === 'nodoc' && v === false) continue;
      if (k === '$ref' && typeof v === 'string' && !v.includes('.')) out[k] = ns.namespace + '.' + v;
      else if (k === 'enum' && Array.isArray(v)) out[k] = v.map(e => (e && typeof e === 'object' ? e.name : e));
      else out[k] = typeof v === 'object' ? qualify(v) : v;
    }
    return out;
  };
  const fixFn = fn => {
    fn = qualify(fn);
    const params = fn.parameters || [];
    const last = params.at(-1);
    if (!fn.returns_async && last && last.type === 'function' && /^(callback|responseCallback)$/.test(last.name)) {
      fn.returns_async = {name: last.name, optional: last.optional, parameters: last.parameters || [], does_not_support_promises: true};
      fn.parameters = params.slice(0, -1);
    }
    return fn;
  };
  return {namespace: ns.namespace, ...(ns.platforms ? {platforms: ns.platforms} : {}), ...(ns.nodoc ? {nodoc: true} : {}), ...(ns.deprecated ? {deprecated: ns.deprecated} : {}),
    ...(ns.internal ? {internal: true} : {}),
    types: (ns.types || []).map(t => { const q = qualify(t); if (q.functions) q.functions = q.functions.map(fixFn); return q; }),
    functions: (ns.functions || []).map(fixFn), events: (ns.events || []).map(qualify), properties: qualify(ns.properties || {})};
}

// ---------------------------------------------------------------- load every schema file
export function loadSchemas(root = VENDOR) {
  const namespaces = [], errors = [];
  for (const dir of SCHEMA_DIRS) {
    const folder = path.join(root, dir);
    for (const name of fs.readdirSync(folder).sort()) {
      if (name.startsWith('_') || !fs.statSync(path.join(folder, name)).isFile()) continue;
      const file = path.join(folder, name), rel = dir + '/' + name;
      try {
        let defs;
        if (name.endsWith('.json')) defs = readJsonc(file).map(normaliseJsonNamespace);
        else if (name.endsWith('.webidl')) defs = parseWebIdl(fs.readFileSync(file, 'utf8'), rel);
        else if (name.endsWith('.idl')) defs = parseOldIdl(fs.readFileSync(file, 'utf8'), rel);
        else continue;
        for (const ns of defs) namespaces.push({...ns, file: rel});
      } catch (error) { errors.push({file: rel, error: String(error.message || error).slice(0, 300)}); }
    }
  }
  return {namespaces, errors};
}

// ---------------------------------------------------------------- feature files: who may use what
export function loadFeatures(root = VENDOR) {
  const features = {api: {}, permission: {}, manifest: {}};
  for (const kind of Object.keys(features)) for (const dir of DIRS) {
    const file = path.join(root, dir, `_${kind}_features.json`);
    if (fs.existsSync(file)) Object.assign(features[kind], readJsonc(file));
  }
  return features;
}
const EXTENSION_CONTEXTS = ['privileged_extension', 'unprivileged_extension', 'content_script', 'user_script', 'offscreen_extension', 'all'];
function resolveSimple(map, name, seen = new Set()) {
  const raw = map[name]; if (!raw || seen.has(name)) return null; seen.add(name);
  const list = [].concat(raw);
  let parent = null;
  for (let n = name; n.includes('.');) { n = n.slice(0, n.lastIndexOf('.')); if (map[n]) { parent = resolveSimple(map, n, seen); break; } }
  const base = parent && (parent.length === 1 ? parent[0] : parent.find(p => p.default_parent) || parent[0]);
  return list.map(s => (s.noparent || !base ? s : {...base, ...s}));
}
export function evaluateFeature(features, kind, name, depth = 0) {
  const simple = resolveSimple(features[kind], name);
  if (!simple) return null;
  let best = null;
  for (const s of simple) {
    const why = [], notes = {};
    if (s.internal) why.push('internal to Chromium');
    if (s.channel && s.channel !== 'stable') why.push(`${s.channel} channel only`);
    const types = [].concat(s.extension_types || []);
    if (types.length && !types.includes('extension') && !types.includes('all')) why.push(`only for ${types.join('/')}`);
    const platforms = [].concat(s.platforms || []);
    if (platforms.length && !platforms.includes('win')) why.push(`only on ${platforms.join('/')}`);
    if (s.allowlist?.length) why.push('allowlisted extension IDs only');
    if (s.location) why.push(`${s.location} extensions only`);
    if (s.session_types) why.push(`${[].concat(s.session_types).join('/')} sessions only`);
    if (s.command_line_switch) why.push(`needs --${s.command_line_switch}`);
    if (s.max_manifest_version && s.max_manifest_version < 3) why.push('Manifest V2 only (removed)');
    if (s.min_manifest_version && s.min_manifest_version > 3) why.push(`MV${s.min_manifest_version}+ only`);
    if (kind === 'api' && s.contexts) {
      const contexts = [].concat(s.contexts);
      if (!contexts.some(c => EXTENSION_CONTEXTS.includes(c))) why.push(`only in ${contexts.join('/')} contexts`);
      notes.contexts = contexts;
    }
    if (s.feature_flag) notes.featureFlag = s.feature_flag;
    if (s.developer_mode_only) notes.developerModeOnly = true;
    if (s.disallow_for_service_workers) notes.notInServiceWorkers = true;
    if (s.min_manifest_version) notes.minManifestVersion = s.min_manifest_version;
    if (s.max_manifest_version) notes.maxManifestVersion = s.max_manifest_version;
    const permissions = [], manifestKeys = [];
    for (const dep of [].concat(s.dependencies || [])) {
      const [depKind, depName] = dep.split(':');
      const target = depKind === 'permission' ? 'permission' : depKind === 'manifest' ? 'manifest' : 'api';
      if (depKind === 'permission') permissions.push(depName); else if (depKind === 'manifest') manifestKeys.push(depName);
      const result = depth < 6 ? evaluateFeature(features, target, depName, depth + 1) : null;
      if (result && !result.ok) why.push(`needs ${dep}: ${result.why.join('; ')}`);
      if (result?.notes.featureFlag) notes.featureFlag = result.notes.featureFlag;
      if (result?.notes.developerModeOnly) notes.developerModeOnly = true;
    }
    const candidate = {ok: !why.length, why, notes, permissions, manifestKeys};
    if (!best || (candidate.ok && !best.ok) || (!candidate.ok && !best.ok && candidate.why.length < best.why.length)) best = candidate;
    if (best.ok && !best.notes.featureFlag) break;
  }
  return best;
}

/** Every way a feature is available to a Web Store extension on Windows. A complex feature (a list in the feature file) is available
 *  when ANY of its entries is; each entry needs ALL of its dependencies. Returns the distinct dependency sets of the entries that pass,
 *  e.g. declarativeNetRequest: [{permissions: ['declarativeNetRequest']}, {permissions: ['declarativeNetRequestWithHostAccess']}]. */
export function featureAlternatives(features, kind, name) {
  const simple = resolveSimple(features[kind], name);
  if (!simple) return [];
  const out = [], seen = new Set();
  for (const s of simple) {
    const alone = {...features, [kind]: {...features[kind], [name]: {...s, noparent: true}}};
    const result = evaluateFeature(alone, kind, name);
    if (!result || !result.ok || result.notes.featureFlag) continue;
    const key = JSON.stringify([result.permissions, result.manifestKeys]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({permissions: result.permissions, manifestKeys: result.manifestKeys});
  }
  return out;
}

/** The permissions a Web Store extension may declare on Windows (stable channel), from _permission_features (as plan.mjs requests). */
export function permissionFeatures(features) {
  const out = {};
  for (const name of Object.keys(features.permission).sort()) {
    const result = evaluateFeature(features, 'permission', name);
    if (!result || !result.ok || result.notes.featureFlag) continue;
    out[name] = {...(result.notes.minManifestVersion ? {minManifestVersion: result.notes.minManifestVersion} : {}),
      ...(result.notes.maxManifestVersion ? {maxManifestVersion: result.notes.maxManifestVersion} : {})};
  }
  return out;
}

// ---------------------------------------------------------------- build the surface
const KEEP = ['type', '$ref', 'enum', 'properties', 'items', 'choices', 'optional', 'isInstanceOf', 'additionalProperties', 'minimum', 'maximum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'value', 'parameters', 'default', 'preserveNull', 'ignoreAdditionalProperties', 'name',
  'serializableFunction', 'deprecated', 'platforms', 'functions', 'events', 'returns_async', 'returns', 'does_not_support_promises', 'filters',
  'supportsFilters', 'maxListeners', 'id', 'nodoc', 'nocompile'];
function compact(spec) {
  if (Array.isArray(spec)) return spec.map(compact);
  if (!spec || typeof spec !== 'object') return spec;
  const out = {};
  for (const k of KEEP) {
    if (spec[k] === undefined) continue;
    let v = spec[k];
    if (k === 'deprecated' && typeof v === 'string') v = v.replace(/\s+/g, ' ').slice(0, 160);
    if (k === 'properties' || k === 'additionalProperties' && typeof v === 'object') out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([n, s]) => [n, compact(s)])) : compact(v);
    else out[k] = typeof v === 'object' ? compact(v) : v;
  }
  return out;
}

export function buildSurface({root = VENDOR} = {}) {
  const {namespaces, errors} = loadSchemas(root);
  const features = loadFeatures(root);
  const revision = fs.readFileSync(path.join(root, 'REVISION'), 'utf8').trim();
  const surface = {}, excluded = {}, model = {};
  const byName = new Map();
  for (const ns of namespaces) byName.set(ns.namespace, ns);
  for (const ns of [...byName.values()].sort((a, b) => a.namespace.localeCompare(b.namespace))) {
    const name = ns.namespace;
    const feature = evaluateFeature(features, 'api', name);
    const typesOnly = !ns.functions.length && !ns.events.length && !Object.keys(ns.properties).length;
    if (feature && PRODUCTION_IGNORES_DEV_MODE.has(name)) delete feature.notes.developerModeOnly;
    let status;
    if (typesOnly && (!feature || feature.why.every(w => /internal|contexts/.test(w)))) status = 'types';
    else if (!feature) status = 'no-feature';
    else if (TEST_ONLY[name]) { status = 'excluded'; feature.ok = false; feature.why = [TEST_ONLY[name]]; }
    else if (!feature.ok) status = 'excluded';
    else if (ns.platforms && !ns.platforms.includes('win')) status = 'excluded';
    else if (feature.notes.featureFlag) status = 'flagged';
    else if (feature.notes.developerModeOnly) status = 'developer-mode';
    else status = 'exposed';
    const why = feature && !feature.ok ? feature.why : ns.platforms && !ns.platforms.includes('win') ? [`only on ${ns.platforms.join('/')}`] :
      status === 'no-feature' ? ['no API feature: not bound for extensions'] : [];
    const members = (list, kind) => Object.fromEntries(list.filter(m => !m.nocompile || kind !== 'function' || true).map(m => {
      const memberFeature = evaluateFeature(features, 'api', `${name}.${m.name}`);
      const entry = compact(m); delete entry.name;
      if (memberFeature) {
        const alternatives = featureAlternatives(features, 'api', `${name}.${m.name}`);
        entry.feature = {ok: memberFeature.ok, ...(memberFeature.why.length ? {why: memberFeature.why} : {}),
          ...(memberFeature.permissions.length ? {permissions: memberFeature.permissions} : {}),
          ...(memberFeature.manifestKeys.length ? {manifestKeys: memberFeature.manifestKeys} : {}),
          ...(alternatives.length > 1 ? {anyOf: alternatives} : {}), ...(memberFeature.notes.contexts ? {contexts: memberFeature.notes.contexts} : {}),
          ...(memberFeature.notes.maxManifestVersion ? {maxManifestVersion: memberFeature.notes.maxManifestVersion} : {}),
          ...(memberFeature.notes.notInServiceWorkers ? {notInServiceWorkers: true} : {})};
      }
      if (m.platforms && !m.platforms.includes('win')) entry.notOnWindows = true;
      return [m.name, entry];
    }));
    const alternatives = feature ? featureAlternatives(features, 'api', name) : [];
    const entry = {file: ns.file, status,
      ...(feature ? {permissions: feature.permissions, manifestKeys: feature.manifestKeys, ...(alternatives.length > 1 ? {anyOf: alternatives} : {}),
        contexts: feature.notes.contexts || [],
        ...(feature.notes.minManifestVersion ? {minManifestVersion: feature.notes.minManifestVersion} : {}),
        ...(feature.notes.featureFlag ? {featureFlag: feature.notes.featureFlag} : {}),
        ...(feature.notes.notInServiceWorkers ? {notInServiceWorkers: true} : {})} : {}),
      ...(ns.deprecated ? {deprecated: String(ns.deprecated).slice(0, 160)} : {}),
      functions: members(ns.functions, 'function'), events: members(ns.events, 'event'),
      properties: Object.fromEntries(Object.entries(ns.properties).map(([k, v]) => [k, compact(v)])),
      types: Object.fromEntries(ns.types.map(t => { const c = compact(t); delete c.id; return [t.id, c]; }))};
    model[name] = {...entry, ...(why.length ? {why} : {})};
    if (status === 'exposed' || status === 'developer-mode' || status === 'types' || status === 'flagged') surface[name] = entry;
    else excluded[name] = {file: ns.file, why};
  }
  return {revision, surface, excluded, model, errors, permissions: permissionFeatures(features)};
}

export function renderModule({revision, surface, excluded, errors, permissions}) {
  const header = `// GENERATED by scripts/gen-extension-api.mjs from Chromium's extension API schemas (${revision}),
// vendored in desktop/browser-services/chromium-api/. Do not edit by hand: change the generator or re-vendor and run
//   node scripts/gen-extension-api.mjs
// Data only (no behaviour). Runtime helpers that use it: extension-api-signature.cjs.
// status: exposed = available to Web Store extensions on Windows (stable); developer-mode = needs the user's developer-mode switch;
// flagged = behind a Chromium feature flag; types = shared type namespace (no functions).
// anyOf (on a namespace or member feature): the alternative dependency sets when Chromium's feature lists several; any one is enough.
// permissions: every permission a Web Store extension may declare on Windows (stable), from _permission_features.
'use strict';
`;
  const body = {chromium: revision, namespaces: surface, excluded, permissions: permissions || {}, parseErrors: errors};
  return header + 'module.exports = ' + JSON.stringify(body) + ';\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const built = buildSurface();
  const text = renderModule(built);
  if (args.includes('--check')) {
    // A Windows checkout (core.autocrlf) turns the committed LF file into CRLF; the content is what counts.
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) { console.error('extension-api-surface.gen.cjs is out of date: run node scripts/gen-extension-api.mjs'); process.exit(1); }
    console.log('extension-api-surface.gen.cjs is up to date');
  } else {
    fs.writeFileSync(OUT, text);
    const counts = {};
    for (const entry of Object.values(built.model)) counts[entry.status] = (counts[entry.status] || 0) + 1;
    console.log(`wrote ${path.relative(ROOT, OUT)} (${(text.length / 1024).toFixed(0)} KB): ${JSON.stringify(counts)}; parse errors: ${built.errors.length}`);
    for (const e of built.errors) console.log('  parse error', e.file, e.error);
  }
  const modelAt = args.indexOf('--model');
  if (modelAt >= 0) fs.writeFileSync(args[modelAt + 1], JSON.stringify({revision: built.revision, namespaces: built.model, errors: built.errors}, null, 1));
}
