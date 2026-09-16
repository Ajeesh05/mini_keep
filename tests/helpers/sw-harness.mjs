/**
 * Loads a classic (non-module) MV3 service worker into a vm context so its
 * functions can be unit tested WITHOUT modifying the extension source.
 *
 * Why this exists: mini_keep and gmeet_kit register their listeners at top
 * level in a plain script with no exports. The alternatives were to refactor
 * them into ES modules - which means a manifest change and a store release
 * before a single test has proven anything - or to load them as-is. This does
 * the latter.
 *
 * Two mechanics worth knowing:
 *
 *  - Top-level `function` declarations become properties of the vm context, so
 *    they come back on the returned object for free. Top-level `const` and
 *    `let` are lexical and do NOT, which is what `expose` is for: it appends an
 *    assignment to the SAME script so those bindings are reachable.
 *
 *  - Timers are forwarded to globalThis at call time rather than captured at
 *    context creation, so vi.useFakeTimers() still controls code inside the vm.
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * @param {string} filePath  absolute path to the service worker source
 * @param {object} options
 * @param {object} options.chrome   a chrome mock (see chrome-mock.mjs)
 * @param {string[]} [options.expose]  names of top-level const/let bindings to
 *   make reachable on the returned context (e.g. ['MEETING_REGEX'])
 * @param {object} [options.globals]  extra globals to inject (document, window…)
 * @returns {object} the vm context: top-level functions, plus `__exposed`
 */
export function loadServiceWorker(filePath, { chrome, expose = [], globals = {} } = {}) {
  let source = readFileSync(filePath, 'utf8')

  if (expose.length > 0) {
    const pairs = expose.map(name => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`)
    source += `\n;globalThis.__exposed = { ${pairs.join(', ')} };\n`
  }

  const context = {
    chrome,
    console,
    // Forward timers dynamically so fake timers installed after load still win.
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
    queueMicrotask: (...args) => globalThis.queueMicrotask(...args),
    fetch: globalThis.fetch,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    Date,
    Math,
    JSON,
    Promise,
    Error,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Intl,
    ...globals
  }

  context.globalThis = context
  context.self = context

  vm.createContext(context)
  vm.runInContext(source, context, { filename: filePath })

  return context
}

/**
 * Convenience: load and return only the exposed lexical bindings.
 */
export function loadExposed(filePath, options) {
  return loadServiceWorker(filePath, options).__exposed
}
