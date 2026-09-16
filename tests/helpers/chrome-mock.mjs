/**
 * Framework-agnostic chrome.* test double.
 *
 * Deliberately has no vitest/jest dependency so the same file works in any
 * runner, and in plain `node --test` if a project ever wants that.
 *
 * Every mocked method is a `spy`: callable, records its arguments in `.calls`,
 * and delegates to an implementation you can override per test.
 */

/** A callable that records its arguments. */
export function spy(impl) {
  const fn = (...args) => {
    fn.calls.push(args)
    return impl ? impl(...args) : undefined
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
function createStorageArea(initial = {}) {
  let store = { ...initial }

  const area = {
    get: spy(async keys => {
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
    set: spy(async items => {
      store = { ...store, ...items }
    }),
    remove: spy(async keys => {
      for (const k of [].concat(keys)) delete store[k]
    }),
    clear: spy(async () => {
      store = {}
    }),
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
        postMessage: spy(),
        disconnect: spy(),
        onMessage: createEvent(),
        onDisconnect: createEvent()
      })),
      sendMessage: spy(async () => undefined),
      onMessage: createEvent(),
      onConnect: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent()
    },

    storage: {
      sync: createStorageArea(opts.syncStorage),
      local: createStorageArea(opts.localStorage),
      session: createStorageArea(),
      onChanged: createEvent()
    },

    windows: {
      WINDOW_ID_NONE: -1,
      getAll: spy(async () => state.windows.map(w => ({ ...w }))),
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
      create: spy(async props => ({ id: 999, ...props })),
      remove: spy(async () => undefined),
      sendMessage: spy(async () => undefined),
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      onActivated: createEvent()
    },

    cookies: {
      getAll: spy(async () => []),
      get: spy(async () => null),
      set: spy(async details => ({ ...details })),
      remove: spy(async details => ({ ...details }))
    },

    scripting: {
      executeScript: spy(async ({ func, args = [] }) => [{ result: func ? func(...args) : undefined }])
    },

    action: {
      onClicked: createEvent(),
      setIcon: spy(),
      setTitle: spy(),
      setBadgeText: spy()
    },

    commands: {
      onCommand: createEvent()
    },

    sidePanel: {
      open: spy(async () => undefined),
      setOptions: spy(async () => undefined),
      setPanelBehavior: spy(async () => undefined)
    },

    system: {
      display: {
        getInfo: spy(async () => state.displays.map(d => ({ ...d })))
      }
    }
  }

  return chrome
}
