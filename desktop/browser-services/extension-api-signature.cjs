'use strict';
// Chromium's extension-binding rules, in JavaScript, over the generated surface (extension-api-surface.gen.cjs). Mirrors
// extensions/renderer/bindings/api_signature.cc (argument resolution with optional parameters, callback vs promise), argument_spec.cc
// (type checks, enum/minimum/length rules, unexpected and missing properties), api_invocation_errors.cc (the exact error strings,
// vendored in chromium-api/extensions/renderer/bindings/), api_last_error.cc (runtime.lastError during callbacks, extension.lastError, and
// "Unchecked runtime.lastError: …" when a callback never reads it), api_request_handler.cc (promise-based calls reject instead) and
// event_emitter.cc (addListener rules). An implementation built with buildNamespace() only supplies behaviour: argument checking,
// constants, enums, event objects and the "not available" answer for members it does not implement come from Chromium's schema.
//
// createLastError() and createBindings() use nothing outside their own bodies: the extension engine's preload gets their source text
// (extension-runtime-patch.cjs, ext-api/index.cjs), so extension pages and service workers run the same code as the main process and tests.

/**
 * api_last_error.cc. Returns withLastError(message, run): runs `run` with chrome.runtime.lastError = {message} (and the deprecated
 * chrome.extension.lastError), then puts back what was there. When the callback never read runtime.lastError, the error is reported as
 * "Unchecked runtime.lastError: <message>" on the console, as in Chrome. With no message (undefined, null or '') it just runs.
 */
function createLastError(getChrome = () => globalThis.chrome, getConsole = () => globalThis.console) {
  const report = message => { try { getConsole().error('Unchecked runtime.lastError: ' + message); } catch (e) { /* no console */ } };
  function withLastError(message, run) {
    if (message === undefined || message === null || message === '') return run();
    let runtime = null, extension = null;
    try { const root = getChrome(); runtime = root && root.runtime; extension = root && root.extension; } catch (e) { runtime = null; }
    if (!runtime || typeof runtime !== 'object') return run();
    const value = {message: String(message)};
    let accessed = false, primary = null, secondary = null;
    try {
      const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
      Object.defineProperty(runtime, 'lastError', {configurable: true, enumerable: true, get() { accessed = true; return value; }, set() {}});
      primary = {previous};
    } catch (e) { primary = null; }
    try {
      if (extension && typeof extension === 'object') {
        const previous = Object.getOwnPropertyDescriptor(extension, 'lastError');
        Object.defineProperty(extension, 'lastError', {configurable: true, enumerable: true, writable: true, value});
        secondary = {previous};
      }
    } catch (e) { secondary = null; }
    try { return run(); } finally {
      const restore = (target, saved) => { try { if (saved.previous) Object.defineProperty(target, 'lastError', saved.previous); else delete target.lastError; } catch (e) { /* leave it */ } };
      if (primary) restore(runtime, primary);
      if (secondary) restore(extension, secondary);
      if (primary && !accessed) report(value.message);
    }
  }
  withLastError.report = report;
  return withLastError;
}

/**
 * Binding helpers over a schema source.
 *   getNamespace(name)     -> a namespace of the generated surface, or undefined.
 *   options.withLastError  -> createLastError()'s function (sets chrome.runtime.lastError around callbacks); default: none is set.
 *   options.console        -> where "Unchecked runtime.lastError" for calls without a callback goes (default globalThis.console).
 */
function createBindings(getNamespace, options = {}) {
  const out = () => options.console || globalThis.console;

  // api_invocation_errors.cc
  const errors = {
    invalidEnumValue: values => `Value must be one of ${[...values].sort().join(', ')}.`,
    missingRequiredProperty: name => `Missing required property '${name}'.`,
    unexpectedProperty: name => `Unexpected property: '${name}'.`,
    tooFewArrayItems: (min, found) => `Array must have at least ${min} items; found ${found}.`,
    tooManyArrayItems: (max, found) => `Array must have at most ${max} items; found ${found}.`,
    tooFewStringChars: (min, found) => `String must have at least ${min} characters; found ${found}.`,
    tooManyStringChars: (max, found) => `String must have at most ${max} characters; found ${found}.`,
    numberTooSmall: min => `Value must be at least ${min}.`,
    numberTooLarge: max => `Value must be at most ${max}.`,
    numberIsNaNOrInfinity: () => 'Value must not be NaN or Infinity.',
    invalidType: (expected, found) => `Invalid type: expected ${expected}, found ${found}.`,
    notAnInstance: type => `Value must be an instance of ${type}.`,
    invalidChoice: () => 'Value did not match any choice.',
    unserializableValue: () => 'Value is unserializable.',
    noMatchingSignature: () => 'No matching signature.',
    indexError: (index, error) => `Error at index ${index}: ${error}`,
    propertyError: (name, error) => `Error at property '${name}': ${error}`,
    argumentError: (name, error) => `Error at parameter '${name}': ${error}`,
    invocationError: (method, signature, error) => `Error in invocation of ${method}(${signature}): ${error}`,
    // extension_function_dispatcher.cc: the answer for a function the browser does not implement or the caller may not use.
    accessDenied: () => 'Access to extension API denied.',
    // event_emitter.cc
    eventNoFilters: () => 'This event does not support filters',
    eventNoOptions: () => 'This event does not support options',
    eventInvalid: () => 'Invalid invocation',
    // api_last_error.cc
    uncheckedPrefix: 'Unchecked runtime.lastError: '
  };
  /** Chromium's feature-check message (simple_feature.cc) for a namespace or member a context may not use. */
  const featureErrors = {
    notPresent: name => `'${name}' requires a different Feature that is not present.`,
    manifestVersionTooLow: (name, v) => `'${name}' requires manifest version of at least ${v}.`,
    manifestVersionTooHigh: (name, v) => `'${name}' requires manifest version of ${v} or lower.`,
    developerMode: name => `'${name}' requires the user to have developer mode enabled.`,
    platform: name => `'${name}' is not allowed for specified platform.`
  };

  /**
   * simple_feature.cc, for one extension context: may `feature` be used? feature: a namespace's gate ({permissions, anyOf, manifestKeys})
   * or a member's feature ({ok, permissions, anyOf, manifestKeys, notInServiceWorkers, minManifestVersion, maxManifestVersion}).
   * ctx: {has(permission), manifest, isWorker}. Permissions and manifest keys in one set are all required; `anyOf` lists alternative
   * sets, any one of which is enough. ok === false (another platform, channel or Manifest V2 only) is never available.
   */
  function featureAllows(feature, ctx) {
    if (!feature || typeof feature !== 'object') return true;
    if (feature.ok === false) return false;
    const manifest = ctx && ctx.manifest || {};
    const has = ctx && typeof ctx.has === 'function' ? ctx.has : () => false;
    if (feature.notInServiceWorkers && ctx && ctx.isWorker) return false;
    const version = manifest.manifest_version;
    if (feature.minManifestVersion !== undefined && !(version >= feature.minManifestVersion)) return false;
    if (feature.maxManifestVersion !== undefined && !(version <= feature.maxManifestVersion)) return false;
    const satisfied = set => (set.permissions || []).every(name => has(name)) &&
      (set.manifestKeys || []).every(key => manifest[key] !== undefined && manifest[key] !== null);
    if (Array.isArray(feature.anyOf) && feature.anyOf.length) return feature.anyOf.some(satisfied);
    return satisfied(feature);
  }
  /** Is chrome.<namespace> bound in this context? Only namespaces Chromium exposes to Web Store extensions on Windows can be. */
  function namespaceAvailable(namespace, ctx) {
    const ns = getNamespace(namespace);
    if (!ns) return false;
    if (ns.gate) return featureAllows(ns.gate, ctx);
    if (ns.status !== 'exposed') return false;
    return featureAllows({permissions: ns.permissions, anyOf: ns.anyOf, manifestKeys: ns.manifestKeys}, ctx);
  }

  function lookupType(ref) {
    const cut = ref.lastIndexOf('.');
    const ns = getNamespace(ref.slice(0, cut));
    return ns && ns.types && ns.types[ref.slice(cut + 1)] || null;
  }
  const isInt32 = v => typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
  // argument_spec.cc GetV8ValueTypeString
  function foundType(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (isInt32(v)) return 'integer';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'string') return 'string';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'function') return 'function';
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return 'binary';
    if (typeof v === 'object') return 'object';
    return 'other';
  }
  // argument_spec.cc GetTypeName
  function typeName(spec) {
    if (spec.$ref) return spec.$ref;
    if (spec.choices) return `[${spec.choices.map(typeName).join('|')}]`;
    switch (spec.type) {
      case 'integer': return 'integer';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'string': return 'string';
      case 'object': return spec.isInstanceOf || 'object';
      case 'array': return 'array';
      case 'binary': return 'binary';
      case 'function': return 'function';
      default: return 'any';
    }
  }
  const resolve = spec => (spec.$ref ? lookupType(spec.$ref) || {type: 'any'} : spec);
  function isCorrectType(spec, v) {
    spec = resolve(spec);
    if (spec.choices) return spec.choices.some(c => isCorrectType(c, v));
    switch (spec.type) {
      case 'integer': return isInt32(v) || v === 0;
      case 'number': return typeof v === 'number';
      case 'boolean': return typeof v === 'boolean';
      case 'string': return typeof v === 'string';
      case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v); // functions and arrays excluded, as in Chromium
      case 'array': return Array.isArray(v);
      case 'binary': return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
      case 'function': return typeof v === 'function';
      default: return true;
    }
  }
  // argument_spec.cc ParseArgument: returns an error string, or '' when the value is acceptable.
  function check(spec, v) {
    const declared = spec;
    spec = resolve(spec);
    if (!isCorrectType(spec, v)) return errors.invalidType(typeName(declared.$ref ? spec : declared), foundType(v));
    if (spec.choices) return spec.choices.some(c => !check(c, v)) ? '' : errors.invalidChoice();
    switch (spec.type) {
      case 'integer': case 'number':
        if (spec.type === 'number' && !Number.isFinite(v)) return errors.numberIsNaNOrInfinity();
        if (spec.minimum !== undefined && v < spec.minimum) return errors.numberTooSmall(spec.minimum);
        if (spec.maximum !== undefined && v > spec.maximum) return errors.numberTooLarge(spec.maximum);
        return '';
      case 'string':
        if (spec.minLength !== undefined && v.length < spec.minLength) return errors.tooFewStringChars(spec.minLength, v.length);
        if (spec.maxLength !== undefined && v.length > spec.maxLength) return errors.tooManyStringChars(spec.maxLength, v.length);
        if (spec.enum && !spec.enum.includes(v)) return errors.invalidEnumValue(spec.enum);
        return '';
      case 'array': {
        if (spec.minItems !== undefined && v.length < spec.minItems) return errors.tooFewArrayItems(spec.minItems, v.length);
        if (spec.maxItems !== undefined && v.length > spec.maxItems) return errors.tooManyArrayItems(spec.maxItems, v.length);
        if (spec.items) for (let i = 0; i < v.length; i++) { const e = check(spec.items, v[i]); if (e) return errors.indexError(i, e); }
        return '';
      }
      case 'object': {
        const props = spec.properties || {};
        for (const key of Object.getOwnPropertyNames(v)) {
          const propSpec = Object.prototype.hasOwnProperty.call(props, key) ? props[key] : spec.additionalProperties;
          if (!propSpec) { if (spec.ignoreAdditionalProperties) continue; return errors.unexpectedProperty(key); }
          const value = v[key];
          // storage.set({key: null}) / ({key: undefined}): a value of an "any" additionalProperties object is data, never a missing property.
          if (value === undefined || value === null) { if (!propSpec.optional && !(propSpec === spec.additionalProperties && propSpec.type === 'any')) return errors.missingRequiredProperty(key); continue; }
          const e = check(propSpec, value);
          if (e && !(propSpec === spec.additionalProperties && propSpec.type === 'any')) return errors.propertyError(key, e);
        }
        for (const [key, propSpec] of Object.entries(props)) if (!propSpec.optional && !(key in v)) return errors.missingRequiredProperty(key);
        if (spec.isInstanceOf) {
          let found = false;
          for (let o = v; o && !found; o = Object.getPrototypeOf(o)) found = o.constructor && o.constructor.name === spec.isInstanceOf;
          if (!found) return errors.notAnInstance(spec.isInstanceOf);
        }
        return '';
      }
      default: return '';
    }
  }

  /** A function spec's signature as Chromium binds it: its parameters plus the trailing callback taken from returns_async. */
  function signatureFor(fn) {
    if (!fn) return null;
    const params = (fn.parameters || []).map(p => ({...p}));
    let hasCallback = false, promises = false;
    if (fn.returns_async) {
      hasCallback = true;
      promises = !fn.returns_async.does_not_support_promises;
      // api_signature.cc: with promise support the callback is always optional (omitting it asks for a promise).
      params.push({name: fn.returns_async.name || 'callback', type: 'function', optional: promises || !!fn.returns_async.optional});
    }
    return {params, hasCallback, promises,
      text: params.map(p => `${p.optional ? 'optional ' : ''}${typeName(p)} ${p.name}`).join(', ')};
  }
  function signatureOf(namespace, name, fn) {
    if (!fn) { const ns = getNamespace(namespace); fn = ns && ns.functions && ns.functions[name]; }
    return signatureFor(fn);
  }
  // api_signature.cc ResolveArguments: positional matching where optional parameters may be skipped.
  function resolveArguments(provided, expected, resolved, index) {
    if (!provided.length && !expected.length) return true;
    if (provided.length > expected.length) return false;
    if (provided.length) {
      let canMatch = false;
      if (expected[0].optional && (provided[0] === null || provided[0] === undefined)) { canMatch = true; resolved[index] = undefined; }
      else if (isCorrectType(expected[0], provided[0])) { canMatch = true; resolved[index] = provided[0]; }
      if (canMatch && resolveArguments(provided.slice(1), expected.slice(1), resolved, index + 1)) return true;
    }
    if (expected[0].optional) { resolved[index] = undefined; return resolveArguments(provided, expected.slice(1), resolved, index + 1); }
    return false;
  }
  /** parseArguments for any method: `label` is the name in the error message ("tabs.query", "storage.get", "types.ChromeSetting.get"). */
  function parseWith(label, sig, provided) {
    const fail = error => { throw new TypeError(errors.invocationError(label, sig.text, error)); };
    provided = [...provided];
    if (provided.length > sig.params.length) fail(errors.noMatchingSignature());
    const resolved = new Array(sig.params.length);
    if (!resolveArguments(provided, sig.params, resolved, 0)) fail(errors.noMatchingSignature());
    const end = sig.hasCallback ? sig.params.length - 1 : sig.params.length;
    const args = [];
    for (let i = 0; i < end; i++) {
      const spec = sig.params[i], value = resolved[i];
      if (value === undefined || value === null) { args.push(spec.default !== undefined ? spec.default : null); continue; }
      const e = check(spec, value); if (e) fail(errors.argumentError(spec.name, e));
      args.push(value);
    }
    let callback = null, async = 'none';
    if (sig.hasCallback) {
      const value = resolved[sig.params.length - 1];
      if (typeof value === 'function') { callback = value; async = 'callback'; }
      else async = sig.promises ? 'promise' : 'none';
    }
    return {args, callback, async};
  }
  /**
   * Check a call the way Chromium's bindings do. Returns {args, callback, async} where args lines up with the schema's parameters (omitted
   * optional ones are null) and async is 'promise' | 'callback' | 'none'. Throws a TypeError with Chromium's exact message otherwise.
   */
  function parseArguments(namespace, name, provided) {
    const sig = signatureOf(namespace, name);
    if (!sig) throw new TypeError(`${namespace}.${name} is not part of Chromium's extension API.`);
    return parseWith(`${namespace}.${name}`, sig, provided);
  }

  const withLastError = typeof options.withLastError === 'function' ? options.withLastError : (message, run) => run();
  function reportUnchecked(message) { try { out().error(errors.uncheckedPrefix + message); } catch (e) { /* no console */ } }
  const messageOf = error => String(error && typeof error === 'object' && 'message' in error ? error.message : error);

  /**
   * An event object with Chromium's rules (event_emitter.cc): addListener without a function does nothing, filters only where the schema
   * allows them, a listener is added once. `add` / `remove` connect it to whatever delivers the event; `dispatch(...args)` (not
   * enumerable) calls every listener, each in its own try so one failing listener does not stop the others; a listener's exception is
   * reported as "Error in event handler: …" on the console, as Chromium's exception handler does.
   */
  function createEvent(label = '', {supportsFilters = false, supportsOptions = false, add, remove, matches} = {}) {
    const listeners = [];
    const event = {
      addListener(listener, ...rest) {
        if (typeof listener !== 'function') return;
        if (rest.length && !supportsFilters) throw new TypeError(errors.eventNoFilters());
        const filter = rest[0];
        if (rest.length && (filter === null || typeof filter !== 'object')) throw new TypeError(errors.eventInvalid());
        if (rest.length > 1 && !supportsOptions) throw new TypeError(errors.eventNoOptions());
        if (listeners.some(entry => entry.listener === listener)) return;
        listeners.push({listener, filter});
        if (add) add(listener, filter, rest[1]);
      },
      removeListener(listener) {
        const at = listeners.findIndex(entry => entry.listener === listener);
        if (at < 0) return;
        listeners.splice(at, 1);
        if (remove) remove(listener);
      },
      hasListener(listener) { return listeners.some(entry => entry.listener === listener); },
      hasListeners() { return listeners.length > 0; }
    };
    Object.defineProperty(event, 'dispatch', {configurable: true, value(...args) {
      for (const entry of listeners.slice()) {
        // A listener added with a filter hears only what `matches(filter, ...args)` accepts (webNavigation url filters and the like).
        if (entry.filter !== undefined && typeof matches === 'function') { let ok = false; try { ok = !!matches(entry.filter, ...args); } catch (e) { ok = false; } if (!ok) continue; }
        try { Reflect.apply(entry.listener, globalThis, args); } catch (error) { try { out().error('Error in event handler: ' + (error && error.stack || error)); } catch (e) { /* no console */ } }
      }
    }});
    Object.defineProperty(event, 'label', {configurable: true, value: label});
    return event;
  }

  // Values a behaviour may return for the two unusual Chromium shapes.
  const LATER = Symbol('acira.later'), ARGS = Symbol('acira.callbackArgs');
  /** For a function with a synchronous result AND a callback (contextMenus.create, desktopCapture.chooseDesktopMedia). */
  const later = (value, promise) => ({[LATER]: true, value, promise});
  /** For a callback that takes several arguments (desktopCapture: streamId, options). */
  const callbackArgs = (...values) => ({[ARGS]: values});
  const checked = new WeakSet();

  /** One bound method: checks its arguments, runs `behaviour(...normalizedArgs)` and answers by promise or callback like Chromium. */
  function makeFunction(label, fn, behaviour, setLastError) {
    const sig = signatureFor(fn);
    const async = fn.returns_async;
    const method = function (...provided) {
      const {args, callback, async: mode} = parseWith(label, sig, provided);
      if (!async) return behaviour ? behaviour.apply(this, args) : undefined;
      let produced;
      try { produced = behaviour ? behaviour.apply(this, args) : Promise.reject(new Error(errors.accessDenied())); }
      catch (error) { produced = Promise.reject(error); }
      let syncValue;
      if (produced && typeof produced === 'object' && produced[LATER]) { syncValue = produced.value; produced = produced.promise; }
      const result = Promise.resolve(produced).then(value => (value && typeof value === 'object' && value[ARGS] ? value : {[ARGS]: async.parameters && async.parameters.length ? [value] : []}));
      if (mode === 'promise') return result.then(value => value[ARGS][0], error => { throw new Error(messageOf(error)); });
      if (mode === 'callback') {
        result.then(value => setLastError(undefined, () => Reflect.apply(callback, globalThis, value[ARGS])), error => setLastError(messageOf(error), () => Reflect.apply(callback, globalThis, [])));
      } else {
        // No callback and no promise (callback-only function called without one): an error is still reported.
        result.catch(error => reportUnchecked(messageOf(error)));
      }
      return syncValue;
    };
    checked.add(method);
    try { Object.defineProperty(method, 'name', {configurable: true, value: fn.name || label.slice(label.lastIndexOf('.') + 1)}); } catch (e) { /* keep */ }
    return method;
  }

  const enumKey = value => {
    // api_binding.cc GetJSEnumEntryName: splits camelCase with '_', turns '-' into '_', upper-cases, prefixes a leading digit with '_'.
    let key = /^\d/.test(value) ? '_' : '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (i > 0 && /[a-z]/.test(value[i - 1]) && /[A-Z]/.test(c)) key += '_' + c;
      else key += c === '-' ? '_' : c.toUpperCase();
    }
    return key;
  };
  const listOf = value => (Array.isArray(value) ? value.map(entry => [entry.name, entry]) : Object.entries(value || {}));
  // A member Chromium does not bind here: another platform, a feature that is off, or (with a context) a permission, manifest key or
  // context type this extension lacks (runtime.connectNative without nativeMessaging, extension.getViews in a service worker).
  const usable = (spec, context) => !(spec.notOnWindows || spec.feature && (spec.feature.ok === false || context && !featureAllows(spec.feature, context)));
  /** The name Chromium's errors use for a method of a typed object (StorageArea is "storage.get", ChromeSetting "types.ChromeSetting.get"). */
  const typeLabel = ref => (ref === 'storage.StorageArea' ? 'storage' : ref);

  /** Builds an object (a namespace or a type with methods) from its schema. impl: {functions, events, properties, objects}. */
  function buildObject(label, schema, impl, setLastError, context) {
    const api = {};
    for (const [name, fn] of listOf(schema.functions)) {
      if (!usable(fn, context)) continue;
      api[name] = makeFunction(`${label}.${name}`, fn, impl.functions && impl.functions[name], setLastError);
    }
    for (const [name, ev] of listOf(schema.events)) {
      if (!usable(ev, context)) continue;
      api[name] = impl.events && impl.events[name] || createEvent(`${label}.${name}`, {supportsFilters: !!(ev.filters || ev.supportsFilters)});
    }
    return api;
  }

  /** A typed object (types.ChromeSetting, storage.StorageArea, contentSettings.ContentSetting) built from its type in the schema. */
  function buildType(ref, impl = {}, {setLastError = withLastError, label, context} = {}) {
    const type = lookupType(ref);
    if (!type) throw new Error(`${ref} is not a type of Chromium's extension API.`);
    return buildObject(label || typeLabel(ref), type, impl, setLastError, context);
  }

  function buildProperty(namespace, path, prop, impl, setLastError, context) {
    const override = impl.properties && Object.prototype.hasOwnProperty.call(impl.properties, path);
    if (override) return {value: impl.properties[path]};
    if (!usable(prop, context)) return null;
    const type = prop.$ref ? lookupType(prop.$ref) : null;
    if (type && (type.functions || type.events)) {
      const object = buildObject(typeLabel(prop.$ref), type, impl.objects && impl.objects[path] || {}, setLastError, context);
      for (const [name, constant] of Object.entries(prop.properties || {})) if (constant && constant.value !== undefined) object[name] = constant.value;
      return {value: object};
    }
    if (!prop.$ref && prop.type === 'object' && prop.properties && Object.values(prop.properties).some(p => p.$ref)) {
      const object = {};
      for (const [name, child] of Object.entries(prop.properties)) {
        const built = buildProperty(namespace, `${path}.${name}`, child, impl, setLastError, context);
        if (built) object[name] = built.value;
      }
      return {value: object};
    }
    if (prop.value !== undefined && !prop.$ref && typeof prop.value !== 'object') return {value: prop.value};
    return null;
  }

  /**
   * Build a chrome.<namespace> object from Chromium's schema. `impl` supplies behaviour only:
   *   impl.functions[name](...normalizedArgs) -> value | Promise   (called after Chromium's argument checks; may return later() / callbackArgs())
   *   impl.events[name]                                            (an event object; default: createEvent() with dispatch())
   *   impl.properties[name]                                        (value overrides; schema constants are filled in automatically)
   *   impl.objects[path]                                           (behaviour for a typed property: {functions, events}, e.g. objects.sync
   *                                                                 for storage.sync, objects['network.webRTCIPHandlingPolicy'] for privacy)
   * Members the impl does not provide still exist, check their arguments, and answer with Chromium's "Access to extension API denied."
   * `setLastError(message, run)` exposes chrome.runtime.lastError around callbacks (default: withLastError above).
   * `context` ({has, manifest, isWorker}): when given, members whose own feature this extension does not meet are left out, as Chromium
   * leaves them unbound (ext-api/index.cjs passes the extension's context; without one only platform/channel rules apply).
   */
  function buildNamespace(namespace, impl = {}, {setLastError = withLastError, context} = {}) {
    const schema = getNamespace(namespace);
    if (!schema) throw new Error(`${namespace} is not exposed to extensions by this Chromium.`);
    const api = buildObject(namespace, schema, impl, setLastError, context);
    for (const [name, type] of Object.entries(schema.types || {})) {
      if (!type.enum) continue;
      api[name] = Object.freeze(Object.fromEntries(type.enum.map(value => [enumKey(String(value)), value])));
    }
    for (const [name, prop] of Object.entries(schema.properties || {})) {
      const built = buildProperty(namespace, name, prop, impl, setLastError, context);
      if (built) api[name] = built.value;
    }
    for (const [name, value] of Object.entries(impl.properties || {})) if (!(name in api) && !name.includes('.')) api[name] = value;
    return api;
  }

  /** Members Chromium exposes in a namespace that `impl` does not implement (for coverage reports and tests). */
  function unimplemented(namespace, impl = {}) {
    const schema = getNamespace(namespace);
    return Object.keys(schema.functions).filter(name => !(impl.functions && impl.functions[name]))
      .concat(Object.keys(schema.events).filter(name => !(impl.events && impl.events[name])));
  }

  const isNative = fn => { try { return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn)); } catch (e) { return false; } };
  /**
   * The signature layer for members Acira did not build with buildNamespace (the engine's own JavaScript, older Acira shims): the call is
   * checked with Chromium's rules first and, when it passes, handed to the existing implementation with exactly the arguments it got, so
   * its behaviour is unchanged. Chromium's own (native) functions and functions already checked are returned as they are.
   */
  function guardLegacy(label, fn, implementation) {
    if (typeof implementation !== 'function' || checked.has(implementation) || isNative(implementation) || !fn) return implementation;
    const sig = signatureFor(fn);
    const guarded = function (...provided) { parseWith(label, sig, provided); return implementation.apply(this, provided); };
    checked.add(guarded);
    try { Object.defineProperty(guarded, 'name', {configurable: true, value: implementation.name || fn.name || ''}); } catch (e) { /* keep */ }
    return guarded;
  }

  return {errors, featureErrors, signatureOf, signatureFor, parseArguments, parseWith, buildNamespace, buildType, createEvent, withLastError,
    guardLegacy, unimplemented, typeName, foundType, check, lookupType, isNative, isChecked: fn => checked.has(fn), later, callbackArgs,
    typeLabel, enumKey, reportUnchecked, messageOf, featureAllows, namespaceAvailable};
}

let surfaceCache = null;
const surface = () => surfaceCache || (surfaceCache = require('./extension-api-surface.gen.cjs'));
const bindings = createBindings(name => surface().namespaces[name], {withLastError: createLastError()});

module.exports = {...bindings, surface, createBindings, createLastError};
