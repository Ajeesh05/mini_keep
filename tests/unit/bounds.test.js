import { describe, it, expect } from 'vitest'
import { loadBackground, display } from '../helpers/load.js'

/**
 * getSafePopupBounds clamps a remembered window position so the popup can
 * never open off-screen. Both recent bug fixes in this file were here, so it
 * gets the densest coverage.
 */
describe('getSafePopupBounds', () => {
  it('returns bounds unchanged when they already fit on screen', async () => {
    const { sw } = loadBackground({ displays: [display()] })

    const result = await sw.getSafePopupBounds({ left: 100, top: 50, width: 575, height: 850 })

    expect(result).toEqual({ left: 100, top: 50, width: 575, height: 850 })
  })

  it('shrinks a window wider than the work area', async () => {
    const { sw } = loadBackground({ displays: [display({ width: 800, height: 600 })] })

    const result = await sw.getSafePopupBounds({ left: 0, top: 0, width: 1200, height: 400 })

    expect(result.width).toBe(800)
    expect(result.height).toBe(400)
  })

  it('shrinks a window taller than the work area - the low-res display case', async () => {
    // A 1366x768 laptop with the default 850px-tall popup: the height must be
    // clamped or the popup opens with its lower half below the screen.
    const { sw } = loadBackground({ displays: [display({ width: 1366, height: 728 })] })

    const result = await sw.getSafePopupBounds({ left: 1325, top: 160, width: 575, height: 850 })

    expect(result.height).toBe(728)
    expect(result.top).toBe(0)
    expect(result.left).toBe(1366 - 575)
  })

  it('pulls a window back from beyond the right edge', async () => {
    const { sw } = loadBackground({ displays: [display({ width: 1920, height: 1040 })] })

    const result = await sw.getSafePopupBounds({ left: 5000, top: 10, width: 575, height: 850 })

    expect(result.left).toBe(1920 - 575)
  })

  it('pulls a window back from beyond the bottom edge', async () => {
    const { sw } = loadBackground({ displays: [display({ width: 1920, height: 1040 })] })

    const result = await sw.getSafePopupBounds({ left: 10, top: 5000, width: 575, height: 850 })

    expect(result.top).toBe(1040 - 850)
  })

  it('pulls a window back from negative coordinates', async () => {
    const { sw } = loadBackground({ displays: [display()] })

    const result = await sw.getSafePopupBounds({ left: -500, top: -200, width: 575, height: 850 })

    expect(result).toMatchObject({ left: 0, top: 0 })
  })

  it('honours a work area offset by a side taskbar', async () => {
    // Taskbar docked on the left: the usable area starts at x=80, so a window
    // at x=0 is under the taskbar and must be pushed right.
    const { sw } = loadBackground({ displays: [display({ left: 80, top: 0, width: 1840, height: 1040 })] })

    const result = await sw.getSafePopupBounds({ left: 0, top: 0, width: 575, height: 850 })

    expect(result.left).toBe(80)
  })

  it('supports a secondary display at negative coordinates', async () => {
    // Monitor positioned to the left of the primary: valid x range is -1920..0.
    const { sw } = loadBackground({
      displays: [display({ isPrimary: true, left: -1920, top: 0, width: 1920, height: 1040 })]
    })

    const result = await sw.getSafePopupBounds({ left: -3000, top: 20, width: 575, height: 850 })

    expect(result.left).toBe(-1920)
  })

  it('measures against the primary display, not merely the first one listed', async () => {
    const { sw } = loadBackground({
      displays: [
        display({ isPrimary: false, left: 0, top: 0, width: 800, height: 600 }),
        display({ isPrimary: true, left: 800, top: 0, width: 2560, height: 1400 })
      ]
    })

    const result = await sw.getSafePopupBounds({ left: 900, top: 100, width: 575, height: 850 })

    expect(result).toEqual({ left: 900, top: 100, width: 575, height: 850 })
  })

  it('falls back to the first display when none is flagged primary', async () => {
    const { sw } = loadBackground({
      displays: [display({ isPrimary: false, width: 1024, height: 768 })]
    })

    const result = await sw.getSafePopupBounds({ left: 0, top: 0, width: 2000, height: 2000 })

    expect(result).toMatchObject({ width: 1024, height: 768 })
  })

  it('falls back to the raw bounds when the display API fails', async () => {
    const { chrome, sw } = loadBackground()
    chrome.system.display.getInfo.setImpl(async () => {
      throw new Error('display service unavailable')
    })

    const raw = { left: 1325, top: 160, width: 575, height: 850 }
    const result = await sw.getSafePopupBounds(raw)

    expect(result).toEqual(raw)
  })
})
