import { test, expect } from './fixtures.js'

/**
 * The action has no default_popup - clicking the toolbar icon fires
 * chrome.action.onClicked, which Playwright cannot click directly. openKeep()
 * is a top-level function in the service worker, so these tests invoke the same
 * entry point the click handler calls.
 *
 * Assertions read chrome.windows through the service worker rather than
 * Playwright's page list, because this extension's job is window management:
 * that a popup exists, that there is exactly one, and that it points at Keep.
 * Whether Google's page renders is not its responsibility, and headless
 * Chromium ignores requested window bounds, so the clamping maths is covered by
 * the unit tests instead.
 */

/** Every Keep popup the browser currently has open, as the extension sees it. */
const keepPopups = async serviceWorker =>
  serviceWorker.evaluate(async () => {
    const all = await chrome.windows.getAll({ populate: true })
    return all
      .filter(w => (w.tabs || []).some(t => (t.url || t.pendingUrl || '').includes('mini_keep=1')))
      .map(w => ({ id: w.id, type: w.type, url: w.tabs[0].url || w.tabs[0].pendingUrl }))
  })

test.describe('opening the Keep popup', () => {
  test('loads the extension and starts its service worker', async ({ serviceWorker }) => {
    expect(serviceWorker.url()).toContain('background.js')
  })

  test('opens a popup window pointed at Keep', async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => openKeep())

    await expect.poll(() => keepPopups(serviceWorker).then(w => w.length)).toBe(1)

    const [popup] = await keepPopups(serviceWorker)
    expect(popup.type).toBe('popup')
    expect(popup.url).toBe('https://keep.google.com/?mini_keep=1')
  })

  test('focuses the existing window instead of opening a second', async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => openKeep())
    await expect.poll(() => keepPopups(serviceWorker).then(w => w.length)).toBe(1)

    await serviceWorker.evaluate(() => openKeep())
    await serviceWorker.evaluate(() => openKeep())

    // Give a duplicate window time to appear if the guard were broken.
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(await keepPopups(serviceWorker)).toHaveLength(1)
  })

  test('reopens after the user closes the popup', async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => openKeep())
    await expect.poll(() => keepPopups(serviceWorker).then(w => w.length)).toBe(1)

    await serviceWorker.evaluate(async () => {
      const [popup] = (await chrome.windows.getAll({ populate: true })).filter(w =>
        (w.tabs || []).some(t => (t.url || '').includes('mini_keep=1'))
      )
      await chrome.windows.remove(popup.id)
    })
    await expect.poll(() => keepPopups(serviceWorker).then(w => w.length)).toBe(0)

    await serviceWorker.evaluate(() => openKeep())
    await expect.poll(() => keepPopups(serviceWorker).then(w => w.length)).toBe(1)
  })

  test('remembers the window bounds it opened with', async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => openKeep())

    const stored = await serviceWorker.evaluate(async () => {
      // The bounds write is debounced by 500ms.
      await new Promise(resolve => setTimeout(resolve, 1200))
      const data = await chrome.storage.sync.get('keep_window_bounds_v1')
      return data.keep_window_bounds_v1 ?? null
    })

    expect(stored).not.toBeNull()
    expect(stored).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number)
    })
  })
})
