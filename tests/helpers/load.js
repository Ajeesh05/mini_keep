import { fileURLToPath } from 'node:url'
import { createChromeMock } from './chrome-mock.mjs'
import { loadServiceWorker } from './sw-harness.mjs'

export const BACKGROUND_PATH = fileURLToPath(new URL('../../background.js', import.meta.url))

/**
 * Fresh service worker + fresh chrome mock for each test.
 *
 * background.js keeps `keepWindowId` in module scope, so every test needs its
 * own instance or window-tracking state leaks between cases.
 */
export function loadBackground(mockOptions = {}) {
  const chrome = createChromeMock(mockOptions)
  const sw = loadServiceWorker(BACKGROUND_PATH, {
    chrome,
    expose: ['KEEP_URL', 'STORAGE_KEY', 'defaultBounds']
  })
  return { chrome, sw, consts: sw.__exposed }
}

/** A display definition, with sane defaults, for system.display.getInfo. */
export function display({ isPrimary = true, left = 0, top = 0, width = 1920, height = 1040 } = {}) {
  return {
    id: `${left}-${top}`,
    isPrimary,
    bounds: { left, top, width, height },
    workArea: { left, top, width, height }
  }
}
