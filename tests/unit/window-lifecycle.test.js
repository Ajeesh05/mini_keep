import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadBackground, display } from '../helpers/load.js'

/** A window carrying a tab that looks like the Keep popup. */
function keepWindow(id = 7, extra = {}) {
  return {
    id,
    type: 'popup',
    state: 'normal',
    tabs: [{ id: id * 10, url: 'https://keep.google.com/?mini_keep=1' }],
    ...extra
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('findExistingKeepWindow', () => {
  it('finds the window whose tab carries the mini_keep marker', async () => {
    const { sw } = loadBackground({ windows: [{ id: 1, tabs: [{ url: 'https://example.com' }] }, keepWindow(7)] })

    const found = await sw.findExistingKeepWindow()

    expect(found?.id).toBe(7)
  })

  it('returns null when no window matches', async () => {
    const { sw } = loadBackground({ windows: [{ id: 1, tabs: [{ url: 'https://keep.google.com/' }] }] })

    expect(await sw.findExistingKeepWindow()).toBeNull()
  })

  it('skips windows with no tabs array', async () => {
    const { sw } = loadBackground({ windows: [{ id: 1 }, { id: 2, tabs: null }, keepWindow(7)] })

    expect((await sw.findExistingKeepWindow())?.id).toBe(7)
  })

  it('tolerates tabs with a missing url', async () => {
    const { sw } = loadBackground({
      windows: [{ id: 1, tabs: [null, {}, { url: undefined }] }, keepWindow(7)]
    })

    expect((await sw.findExistingKeepWindow())?.id).toBe(7)
  })

  it('returns null instead of throwing when the windows API fails', async () => {
    const { chrome, sw } = loadBackground()
    chrome.windows.getAll.setImpl(async () => {
      throw new Error('no window manager')
    })

    expect(await sw.findExistingKeepWindow()).toBeNull()
  })
})

describe('focusWindowById', () => {
  it('focuses an existing window and draws attention', async () => {
    const { chrome, sw } = loadBackground({ windows: [keepWindow(7)] })

    expect(await sw.focusWindowById(7)).toBe(true)
    expect(chrome.windows.update.calls).toContainEqual([7, { focused: true, drawAttention: true }])
  })

  it('restores a minimized window before focusing it', async () => {
    const { chrome, sw } = loadBackground({ windows: [keepWindow(7, { state: 'minimized' })] })

    await sw.focusWindowById(7)

    expect(chrome.windows.update.calls[0]).toEqual([7, { state: 'normal' }])
    expect(chrome.windows.update.calls[1]).toEqual([7, { focused: true, drawAttention: true }])
  })

  it('does not attempt a state change for a window already normal', async () => {
    const { chrome, sw } = loadBackground({ windows: [keepWindow(7)] })

    await sw.focusWindowById(7)

    expect(chrome.windows.update.calls).toHaveLength(1)
  })

  it('returns false for an id that no longer exists', async () => {
    const { sw } = loadBackground({ windows: [] })

    expect(await sw.focusWindowById(404)).toBe(false)
  })
})

describe('openKeep', () => {
  it('creates a popup window when none exists', async () => {
    const { chrome, sw, consts } = loadBackground({ windows: [], displays: [display()] })

    await sw.openKeep()

    expect(chrome.windows.create.calls).toHaveLength(1)
    expect(chrome.windows.create.calls[0][0]).toMatchObject({
      url: consts.KEEP_URL,
      type: 'popup'
    })
  })

  it('focuses an existing Keep window rather than opening a second', async () => {
    const { chrome, sw } = loadBackground({ windows: [keepWindow(7)] })

    await sw.openKeep()

    expect(chrome.windows.create.calls).toHaveLength(0)
    expect(chrome.windows.update.calls).toContainEqual([7, { focused: true, drawAttention: true }])
  })

  it('reuses the tracked window on a second click without rescanning', async () => {
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })

    await sw.openKeep()
    const scansAfterFirst = chrome.windows.getAll.calls.length
    await sw.openKeep()

    expect(chrome.windows.create.calls).toHaveLength(1)
    expect(chrome.windows.getAll.calls).toHaveLength(scansAfterFirst)
  })

  it('opens at the bounds remembered in sync storage', async () => {
    const remembered = { left: 300, top: 120, width: 500, height: 700 }
    const { chrome, sw } = loadBackground({
      windows: [],
      displays: [display()],
      syncStorage: { keep_window_bounds_v1: remembered }
    })

    await sw.openKeep()

    expect(chrome.windows.create.calls[0][0]).toMatchObject(remembered)
  })

  it('falls back to the default bounds when nothing is stored', async () => {
    const { chrome, sw, consts } = loadBackground({ windows: [], displays: [display()] })

    await sw.openKeep()

    expect(chrome.windows.create.calls[0][0]).toMatchObject({
      left: consts.defaultBounds.left,
      top: consts.defaultBounds.top,
      width: consts.defaultBounds.width,
      height: consts.defaultBounds.height
    })
  })

  it('clamps remembered bounds that no longer fit the current display', async () => {
    // Bounds saved on a large monitor, reopened on a small laptop screen.
    const { chrome, sw } = loadBackground({
      windows: [],
      displays: [display({ width: 1366, height: 728 })],
      syncStorage: { keep_window_bounds_v1: { left: 2400, top: 900, width: 575, height: 850 } }
    })

    await sw.openKeep()

    const created = chrome.windows.create.calls[0][0]
    expect(created.left).toBeLessThanOrEqual(1366 - created.width)
    expect(created.top).toBeGreaterThanOrEqual(0)
    expect(created.height).toBeLessThanOrEqual(728)
  })

  it('survives a window creation failure without throwing', async () => {
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })
    chrome.windows.create.setImpl(async () => {
      throw new Error('cannot create window')
    })

    await expect(sw.openKeep()).resolves.toBeUndefined()
  })
})

describe('closeKeep', () => {
  it('removes the tracked window', async () => {
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })
    await sw.openKeep()
    const createdId = chrome.windows.create.calls.length && chrome._state.windows.at(-1).id

    await sw.closeKeep()

    expect(chrome.windows.remove.calls).toContainEqual([createdId])
  })

  it('does nothing when no window is tracked', async () => {
    const { chrome, sw } = loadBackground()

    await sw.closeKeep()

    expect(chrome.windows.remove.calls).toHaveLength(0)
  })
})

describe('window event listeners', () => {
  it('opens a fresh window after the tracked one is closed manually', async () => {
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })
    await sw.openKeep()
    const createdId = chrome._state.windows.at(-1).id

    // Simulate the user closing the popup: drop it from the browser, then fire
    // the event the browser would fire.
    chrome._state.windows.length = 0
    await chrome.windows.onRemoved.emit(createdId)

    await sw.openKeep()

    expect(chrome.windows.create.calls).toHaveLength(2)
  })

  it('ignores removal of an unrelated window', async () => {
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })
    await sw.openKeep()

    await chrome.windows.onRemoved.emit(9999)
    await sw.openKeep()

    expect(chrome.windows.create.calls).toHaveLength(1)
  })

  it('persists bounds when the tracked window is moved or resized', async () => {
    vi.useFakeTimers()
    const { chrome, sw } = loadBackground({ windows: [], displays: [display()] })
    await sw.openKeep()
    const created = chrome._state.windows.at(-1)

    Object.assign(created, { left: 42, top: 84, width: 600, height: 900 })
    await chrome.windows.onBoundsChanged.emit({ id: created.id })
    await vi.advanceTimersByTimeAsync(500)

    expect(chrome.storage.sync.set.calls.at(-1)[0]).toEqual({
      keep_window_bounds_v1: { left: 42, top: 84, width: 600, height: 900 }
    })
  })

  it('ignores bounds changes for windows it does not track', async () => {
    vi.useFakeTimers()
    const { chrome, sw } = loadBackground({ windows: [{ id: 55 }], displays: [display()] })
    await sw.openKeep()
    // Let openKeep's own initial bounds write settle, so the only write this
    // test could observe would be one caused by the event below.
    await vi.advanceTimersByTimeAsync(500)
    chrome.storage.sync.set.reset()

    await chrome.windows.onBoundsChanged.emit({ id: 55 })
    await vi.advanceTimersByTimeAsync(500)

    expect(chrome.storage.sync.set.calls).toHaveLength(0)
  })

  it('registers handlers for the toolbar click and the keyboard shortcut', () => {
    const { chrome } = loadBackground()

    expect(chrome.action.onClicked.listenerCount).toBe(1)
    expect(chrome.commands.onCommand.listenerCount).toBe(1)
  })
})

describe('scheduleStoreBounds', () => {
  it('debounces rapid drags into a single write', async () => {
    vi.useFakeTimers()
    const { chrome, sw } = loadBackground()

    sw.scheduleStoreBounds({ left: 1, top: 1, width: 100, height: 100 })
    sw.scheduleStoreBounds({ left: 2, top: 2, width: 200, height: 200 })
    sw.scheduleStoreBounds({ left: 3, top: 3, width: 300, height: 300 })
    await vi.advanceTimersByTimeAsync(500)

    expect(chrome.storage.sync.set.calls).toHaveLength(1)
    expect(chrome.storage.sync.set.calls[0][0]).toEqual({
      keep_window_bounds_v1: { left: 3, top: 3, width: 300, height: 300 }
    })
  })

  it('does not write before the debounce window elapses', async () => {
    vi.useFakeTimers()
    const { chrome, sw } = loadBackground()

    sw.scheduleStoreBounds({ left: 1, top: 1, width: 100, height: 100 })
    await vi.advanceTimersByTimeAsync(499)

    expect(chrome.storage.sync.set.calls).toHaveLength(0)
  })
})
