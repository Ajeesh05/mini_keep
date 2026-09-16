import { test as base, chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packDir } from '../helpers/pack.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Loads the extension the way the store would receive it - the packed file
 * set, not the repo root - so E2E can't accidentally pass on a file that
 * never ships.
 */
export const test = base.extend({
  context: async ({}, use) => {
    const workDir = mkdtempSync(join(tmpdir(), 'mini-keep-e2e-'))
    const extensionDir = join(workDir, 'extension')
    const profileDir = join(workDir, 'profile')

    packDir(REPO_ROOT, extensionDir)

    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        // Keep the run hermetic. context.route() cannot intercept this
        // navigation - the extension opens a brand-new window and the initial
        // request races Playwright's attachment to the page - so the request is
        // stopped at DNS instead. The popup still opens at the right URL, which
        // is what this extension is responsible for; whether Google's page then
        // renders is not something these tests should depend on.
        '--host-resolver-rules=MAP keep.google.com 127.0.0.1'
      ]
    })

    await use(context)

    await context.close()
    rmSync(workDir, { recursive: true, force: true })
  },

  /** The extension's MV3 service worker, once it has started. */
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent('serviceworker')
    await use(worker)
  }
})

export const expect = test.expect
