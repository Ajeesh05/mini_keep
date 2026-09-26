/**
 * Framework-agnostic chrome.* test double.
 *
 * Deliberately has no vitest/jest dependency so the same file works in any
 * runner, and in plain `node --test` if a project ever wants that.
 *
 * Every mocked method is a `spy`: callable, records its arguments in `.calls`,
 * and delegates to an implementation you can override per test.
 */

/**
 * A callable that records its arguments and works in both chrome API styles.
 *
 * MV3 exposes most APIs as both promise-returning and callback-taking, and
 * extensions mix the two freely - gmeet_kit is callback-style throughout while
 * cookie_editor is promise-style. If the last argument is a function it is
 * treated as the callback, invoked asynchronously with the result, and left out
 * of `calls` so assertions read the same in either style.
 *
 * A rejected implementation surfaces the way Chrome surfaces it: the callback
 * still fires, with chrome.runtime.lastError set for the duration of the call.
 */
export function spy(impl, runtimeRef) {
  const fn = (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null
    fn.calls.push(args)

    if (!callback) return impl ? impl(...args) : undefined

    Promise.resolve()
      .then(() => (impl ? impl(...args) : undefined))
      .then(
        result => callback(result),
        error => {
          const runtime = runtimeRef?.()
          if (runtime) runtime.lastError = { message: error?.message || String(error) }
          try {
            callback(undefined)
          } finally {
            if (runtime) runtime.lastError = undefined
          }
        }
      )
    return undefined
  }
  fn.calls = []
  fn.reset = () => {
    fn.calls.length = 0
  }
  fn.setImpl = next => {
    impl = next
  }
  return fn
}

/** A chrome.events.Event stand-in with an `emit` escape hatch for tests. */
export function createEvent() {
  const listeners = []
  return {
    addListener: fn => listeners.push(fn),
    removeListener: fn => {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    hasListener: fn => listeners.includes(fn),
    get listenerCount() {
      return listeners.length
    },
    /** Fire every listener in order, awaiting each so async handlers settle. */
    async emit(...args) {
      const results = []
      for (const fn of [...listeners]) results.push(await fn(...args))
      return results
    }
  }
}

/** In-memory chrome.storage area backed by a plain object. */
function createStorageArea(initial = {}, runtimeRef) {
  let store = { ...initial }

  // Every area spy shares the runtime reference, so a failing storage call
  // sets chrome.runtime.lastError for callback-style callers.
  const areaSpy = impl => spy(impl, runtimeRef)

  const area = {
    get: areaSpy(async keys => {
      if (keys === null || keys === undefined) return { ...store }
      if (typeof keys === 'string') {
        return keys in store ? { [keys]: store[keys] } : {}
      }
      if (Array.isArray(keys)) {
        const out = {}
        for (const k of keys) if (k in store) out[k] = store[k]
        return out
      }
      // object form: keys are defaults
      const out = { ...keys }
      for (const k of Object.keys(keys)) if (k in store) out[k] = store[k]
      return out
    }),
    set: areaSpy(async items => {
      const changes = {}
      for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: store[k], newValue: v }
      store = { ...store, ...items }
      if (area._onChanged) area._onChanged(changes)
    }),
    remove: areaSpy(async keys => {
      for (const k of [].concat(keys)) delete store[k]
    }),
    clear: areaSpy(async () => {
      store = {}
    }),
    /**
     * Approximates chrome.storage.*.getBytesInUse.
     *
     * Chrome counts each key plus its JSON value; that is close enough for a
     * test that only needs the figure to move when data is added or removed.
     */
    getBytesInUse: areaSpy(async keys => {
      const wanted = keys === null || keys === undefined
        ? Object.keys(store)
        : [].concat(keys).filter(k => k in store)
      return wanted.reduce((n, k) => n + k.length + JSON.stringify(store[k] ?? null).length, 0)
    }),
    /** Set by createChromeMock so writes reach chrome.storage.onChanged. */
    _onChanged: null,
    /** Test-only: read the backing object directly. */
    _dump: () => ({ ...store }),
    _seed: next => {
      store = { ...next }
    }
  }

  return area
}

/**
 * Build a chrome mock.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.windows]  seed for chrome.windows.getAll
 * @param {object[]} [opts.tabs]     seed for chrome.tabs.query
 * @param {object[]} [opts.displays] seed for chrome.system.display.getInfo
 * @param {object}   [opts.syncStorage]  seed for chrome.storage.sync
 * @param {object}   [opts.localStorage] seed for chrome.storage.local
 */
export function createChromeMock(opts = {}) {
  // Late-bound so spies can set chrome.runtime.lastError on failure.
  let built = null
  const runtimeRef = () => built?.runtime
  const state = {
    windows: [...(opts.windows || [])],
    tabs: [...(opts.tabs || [])],
    displays: opts.displays || [
      {
        id: '1',
        isPrimary: true,
        bounds: { left: 0, top: 0, width: 1920, height: 1080 },
        workArea: { left: 0, top: 0, width: 1920, height: 1040 }
      }
    ],
    nextWindowId: 100,
    lastError: undefined
  }

  const chrome = {
    _state: state,

    runtime: {
      lastError: undefined,
      id: 'test-extension-id',
      getURL: spy(path => `chrome-extension://test-extension-id/${path}`),
      connect: spy(() => ({
        name: 'content',
        postMessage: spy(undefined, runtimeRef),
        disconnect: spy(undefined, runtimeRef),
        onMessage: createEvent(),
        onDisconnect: createEvent()
      })),
      sendMessage: spy(async () => undefined, runtimeRef),
      onMessage: createEvent(),
      onConnect: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent()
    },

    storage: {
      sync: createStorageArea(opts.syncStorage, runtimeRef),
      local: createStorageArea(opts.localStorage, runtimeRef),
      session: createStorageArea({}, runtimeRef),
      onChanged: createEvent()
    },


    windows: {
      WINDOW_ID_NONE: -1,
      getAll: spy(async () => state.windows.map(w => ({ ...w })), runtimeRef),
      get: spy(async id => {
        const win = state.windows.find(w => w.id === id)
        if (!win) throw new Error(`No window with id: ${id}`)
        return { ...win }
      }),
      create: spy(async createData => {
        const win = { id: state.nextWindowId++, type: 'normal', state: 'normal', tabs: [], ...createData }
        state.windows.push(win)
        return { ...win }
      }),
      update: spy(async (id, info) => {
        const win = state.windows.find(w => w.id === id)
        if (!win) throw new Error(`No window with id: ${id}`)
        Object.assign(win, info)
        return { ...win }
      }),
      remove: spy(async id => {
        const i = state.windows.findIndex(w => w.id === id)
        if (i < 0) throw new Error(`No window with id: ${id}`)
        state.windows.splice(i, 1)
      }),
      onRemoved: createEvent(),
      onBoundsChanged: createEvent(),
      onFocusChanged: createEvent()
    },

    tabs: {
      query: spy(async queryInfo => {
        return state.tabs
          .filter(t => (queryInfo.active === undefined ? true : t.active === queryInfo.active))
          .map(t => ({ ...t }))
      }),
      get: spy(async id => {
        const tab = state.tabs.find(t => t.id === id)
        if (!tab) throw new Error(`No tab with id: ${id}`)
        return { ...tab }
      }),
      create: spy(async props => ({ id: 999, ...props }), runtimeRef),
      remove: spy(async () => undefined, runtimeRef),
      sendMessage: spy(async () => undefined, runtimeRef),
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      onActivated: createEvent()
    },

    cookies: {
      getAll: spy(async () => [], runtimeRef),
      get: spy(async () => null, runtimeRef),
      set: spy(async details => ({ ...details }), runtimeRef),
      remove: spy(async details => ({ ...details }), runtimeRef)
    },

    scripting: {
      executeScript: spy(async ({ func, args = [] }) => [{ result: func ? func(...args) : undefined }], runtimeRef)
    },

    action: {
      onClicked: createEvent(),
      setIcon: spy(undefined, runtimeRef),
      setTitle: spy(undefined, runtimeRef),
      setBadgeText: spy(undefined, runtimeRef)
    },

    commands: {
      onCommand: createEvent()
    },

    sidePanel: {
      open: spy(async () => undefined, runtimeRef),
      setOptions: spy(async () => undefined, runtimeRef),
      setPanelBehavior: spy(async () => undefined, runtimeRef)
    },

    system: {
      display: {
        getInfo: spy(async () => state.displays.map(d => ({ ...d })), runtimeRef)
      }
    }
  }

  // A write to any area now reaches chrome.storage.onChanged, the way
  // extensions learn that a setting was changed from another page.
  for (const name of ['sync', 'local', 'session']) {
    chrome.storage[name]._onChanged = changes => chrome.storage.onChanged.emit(changes, name)
  }

  built = chrome
  return chrome
}
